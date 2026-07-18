/**
 * pvp.ts — Turn-based PvP combat system
 *
 * Players challenge each other to duels using .duel @user.
 * The challenged player has 2 minutes to .accept or .decline.
 * Once accepted, both players share a battle screen and alternate turns
 * using the same moves as the dungeon system (attack / heavy / defend /
 * special / arcane / flee).  PvP is stateless across restarts (in-memory
 * Maps) — a crash ends all live fights gracefully.
 *
 * Rewards:
 *   Winner  → +3 SP · +200 XP · +$2,000 · weekly pvp_wins progress
 *   Loser   → +1 SP · +50  XP · +$500   (consolation — never leave empty)
 */
import type { CommandContext } from "./index.js";
import { sendText } from "../connection.js";
import {
  ensureRpg, updateRpg, getUser, updateUser,
  getPvpCooldown, setPvpCooldown,
  incrementWeeklyProgress,
} from "../db/queries.js";
import { formatNumber, mentionTag } from "../utils.js";
import { levelStatMultiplier } from "../../lib/xp-curve.js";
import { applyXpModifiers } from "../../lib/xp-curve.js";
import { getMentionName } from "../db/queries.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PvpChallenge {
  challengerJid: string;   // full sender JID
  challengerId: string;    // phone
  defenderJid: string;
  defenderId: string;
  groupId: string;
  expiresAt: number;       // ms timestamp
}

interface PvpBattle {
  groupId: string;
  challengerJid: string;
  challengerId: string;
  challengerName: string;
  defenderJid: string;
  defenderId: string;
  defenderName: string;
  currentTurnId: string;   // phone of whoever moves next
  // Challenger stats
  cHp: number; cMaxHp: number;
  cAtk: number; cDef: number;
  cDodge: number; cCrit: number;
  cDefending: boolean;
  // Defender stats
  dHp: number; dMaxHp: number;
  dAtk: number; dDef: number;
  dDodge: number; dCrit: number;
  dDefending: boolean;
  lastActivity: number;
  turnCount: number;
}

// ── State ─────────────────────────────────────────────────────────────────────

// Pending challenges keyed by defenderJid
export const pendingPvpChallenges = new Map<string, PvpChallenge>();
// Active battles keyed by BOTH participant JIDs (same object, two keys)
export const activePvpBattles = new Map<string, PvpBattle>();

const PVP_CHALLENGE_TTL = 2 * 60 * 1000; // 2 minutes
const PVP_BATTLE_TTL    = 10 * 60 * 1000; // 10 minute inactivity timeout
const PVP_COOLDOWN_SECS = 30 * 60;        // 30 minutes between fights

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHpBar(current: number, max: number, len = 12): string {
  const pct = max > 0 ? Math.max(0, current) / max : 0;
  const filled = Math.round(pct * len);
  const bar = "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, len - filled));
  const dot = pct > 0.6 ? "🟢" : pct > 0.25 ? "🟡" : "🔴";
  return `${dot}${bar}`;
}

function pvpBattleDisplay(b: PvpBattle, header?: string): string {
  const turnName = b.currentTurnId === b.challengerId ? b.challengerName : b.defenderName;
  const lines: string[] = [];
  if (header) lines.push(header, "");
  lines.push(
    `⚔️ *PVP DUEL — Round ${b.turnCount}*`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🗡️ *${b.challengerName}*`,
    `   ${makeHpBar(b.cHp, b.cMaxHp)} \`${Math.max(0, b.cHp)}/${b.cMaxHp}\`${b.cDefending ? " 🛡️" : ""}`,
    ``,
    `🛡️ *${b.defenderName}*`,
    `   ${makeHpBar(b.dHp, b.dMaxHp)} \`${Math.max(0, b.dHp)}/${b.dMaxHp}\`${b.dDefending ? " 🛡️" : ""}`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🎮 *${turnName}'s turn!*`,
    ``,
    `Moves: \`attack\` · \`heavy\` · \`defend\` · \`special\` · \`flee\``,
  );
  return lines.join("\n");
}

function calcDmg(base: number, mult = 1.0): number {
  const variance = 0.85 + Math.random() * 0.30; // ±15%
  return Math.max(1, Math.floor(base * mult * variance));
}

async function buildCombatStats(userId: string): Promise<{
  hp: number; maxHp: number; atk: number; def: number; dodge: number; crit: number;
}> {
  const rpg = await ensureRpg(userId);
  const lvlMult = levelStatMultiplier(rpg.level || 1);
  const str = rpg.strength || 0;
  const agi = rpg.agility || 0;
  const maxHp = Math.floor((rpg.max_hp ?? 100) * lvlMult);
  const atk   = Math.floor((rpg.attack ?? 15) * lvlMult * (1 + Math.floor(str / 10) * 0.15));
  const def   = Math.floor((rpg.defense ?? 10) * lvlMult);
  const dodge = Math.min(0.45, agi * 0.012);
  const crit  = Math.min(0.40, agi * 0.008);
  // Use current HP capped to new max so entering at low HP still matters
  const hp = Math.min(rpg.hp ?? maxHp, maxHp);
  return { hp, maxHp, atk, def, dodge, crit };
}

// ── Challenge ─────────────────────────────────────────────────────────────────

export async function handlePvpChallenge(ctx: CommandContext): Promise<void> {
  const { from, sender, args, sock } = ctx;
  if (!from.endsWith("@g.us")) { await sendText(from, "❌ PvP duels must be started in a group."); return; }

  const user = await getUser(sender);
  const userId = user?.id || sender.split("@")[0].split(":")[0].replace(/\D/g, "");

  // Cooldown check
  const nowSecs = Math.floor(Date.now() / 1000);
  const lastPvp = await getPvpCooldown(userId);
  if (nowSecs - lastPvp < PVP_COOLDOWN_SECS) {
    const remaining = PVP_COOLDOWN_SECS - (nowSecs - lastPvp);
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    await sendText(from, `⏳ PvP cooldown: *${mins}m ${secs}s* left before your next duel.`);
    return;
  }

  // Must not already be in a battle
  if (activePvpBattles.has(sender)) { await sendText(from, "❌ You're already in a PvP battle!"); return; }

  // Resolve target
  const { resolveMentionedJidAsync } = await import("../utils/identity.js");
  const targetJid = await resolveMentionedJidAsync(ctx);
  if (!targetJid) { await sendText(from, "❌ Usage: *.duel @user*\nMention the player you want to challenge."); return; }

  const targetPhone = targetJid.split("@")[0].split(":")[0].replace(/\D/g, "");
  if (targetPhone === userId) { await sendText(from, "❌ You can't duel yourself."); return; }

  if (activePvpBattles.has(targetJid)) { await sendText(from, "❌ That player is already in a duel."); return; }

  // Check target has an RPG character
  const targetRpg = await ensureRpg(targetPhone);
  if (!targetRpg.class) { await sendText(from, "❌ That player hasn't chosen a class yet! They need to use *.class* first."); return; }

  const challengerName = user?.name || userId;
  const defenderName = await getMentionName(targetPhone);

  // Store challenge
  pendingPvpChallenges.set(targetJid, {
    challengerJid: sender,
    challengerId: userId,
    defenderJid: targetJid,
    defenderId: targetPhone,
    groupId: from,
    expiresAt: Date.now() + PVP_CHALLENGE_TTL,
  });

  // Auto-expire
  setTimeout(() => {
    const ch = pendingPvpChallenges.get(targetJid);
    if (ch && ch.expiresAt <= Date.now()) {
      pendingPvpChallenges.delete(targetJid);
    }
  }, PVP_CHALLENGE_TTL);

  await sendText(from,
    `⚔️ *PVP CHALLENGE!*\n\n` +
    `🗡️ *${challengerName}* challenges ${mentionTag(targetJid)} to a duel!\n\n` +
    `${mentionTag(targetJid)} — type *.accept* to fight or *.decline* to refuse.\n` +
    `_Challenge expires in 2 minutes._`,
    { mentions: [targetJid] }
  );
}

// ── Accept / Decline ──────────────────────────────────────────────────────────

export async function handlePvpAccept(ctx: CommandContext): Promise<void> {
  const { from, sender, sock } = ctx;
  const user = await getUser(sender);
  const userId = user?.id || sender.split("@")[0].split(":")[0].replace(/\D/g, "");

  const challenge = pendingPvpChallenges.get(sender);
  if (!challenge || challenge.expiresAt < Date.now()) {
    pendingPvpChallenges.delete(sender);
    await sendText(from, "❌ You have no pending PvP challenge (or it expired)."); return;
  }
  if (challenge.groupId !== from) {
    await sendText(from, "❌ Accept the challenge in the same group it was sent."); return;
  }
  pendingPvpChallenges.delete(sender);

  // Cooldown check for defender too
  const nowSecs = Math.floor(Date.now() / 1000);
  const defLastPvp = await getPvpCooldown(userId);
  if (nowSecs - defLastPvp < PVP_COOLDOWN_SECS) {
    const remaining = PVP_COOLDOWN_SECS - (nowSecs - defLastPvp);
    const mins = Math.floor(remaining / 60);
    await sendText(from, `❌ Your PvP cooldown isn't up yet — ${mins}m remaining.`); return;
  }

  // Build both stat sets
  const [cStats, dStats] = await Promise.all([
    buildCombatStats(challenge.challengerId),
    buildCombatStats(challenge.defenderId),
  ]);
  const [cName, dName] = await Promise.all([
    getMentionName(challenge.challengerId),
    getMentionName(challenge.defenderId),
  ]);

  const battle: PvpBattle = {
    groupId: from,
    challengerJid: challenge.challengerJid,
    challengerId: challenge.challengerId,
    challengerName: cName,
    defenderJid: sender,
    defenderId: challenge.defenderId,
    defenderName: dName,
    currentTurnId: challenge.challengerId, // challenger goes first
    cHp: cStats.hp, cMaxHp: cStats.maxHp,
    cAtk: cStats.atk, cDef: cStats.def,
    cDodge: cStats.dodge, cCrit: cStats.crit,
    cDefending: false,
    dHp: dStats.hp, dMaxHp: dStats.maxHp,
    dAtk: dStats.atk, dDef: dStats.def,
    dDodge: dStats.dodge, dCrit: dStats.crit,
    dDefending: false,
    lastActivity: Date.now(),
    turnCount: 1,
  };

  activePvpBattles.set(challenge.challengerJid, battle);
  activePvpBattles.set(sender, battle);

  // Auto-timeout
  setTimeout(() => {
    const b = activePvpBattles.get(challenge.challengerJid);
    if (b && Date.now() - b.lastActivity > PVP_BATTLE_TTL) {
      activePvpBattles.delete(challenge.challengerJid);
      activePvpBattles.delete(sender);
    }
  }, PVP_BATTLE_TTL);

  await sendText(from,
    pvpBattleDisplay(battle, `✅ *${dName}* accepted the challenge!\n\n🎲 *${cName}* goes first — good luck both!`),
    { mentions: [challenge.challengerJid, sender] }
  );
}

export async function handlePvpDecline(ctx: CommandContext): Promise<void> {
  const { from, sender } = ctx;
  const challenge = pendingPvpChallenges.get(sender);
  if (!challenge) { await sendText(from, "❌ You have no pending PvP challenge."); return; }
  pendingPvpChallenges.delete(sender);
  const cName = await getMentionName(challenge.challengerId);
  const dName = await getMentionName(challenge.defenderId);
  await sendText(from, `🚫 *${dName}* declined the duel with *${cName}*.`, { mentions: [challenge.challengerJid, sender] });
}

// ── Battle moves ──────────────────────────────────────────────────────────────

export async function processPvpMove(ctx: CommandContext, battle: PvpBattle): Promise<void> {
  const { from, sender, command: cmd } = ctx;
  const user = await getUser(sender);
  const userId = user?.id || sender.split("@")[0].split(":")[0].replace(/\D/g, "");

  // Enforce turns
  if (userId !== battle.currentTurnId) {
    const waitingName = userId === battle.challengerId ? battle.challengerName : battle.defenderName;
    await sendText(from, `⏸️ *${waitingName}* — it's not your turn yet! Wait for your opponent.`);
    return;
  }

  battle.lastActivity = Date.now();

  const isChallenger = userId === battle.challengerId;
  // Attacker/defender stats references
  const atk = isChallenger ? battle.cAtk : battle.dAtk;
  const myDef = isChallenger ? battle.cDef : battle.dDef;
  const oppDodge = isChallenger ? battle.dDodge : battle.cDodge;
  const myCrit = isChallenger ? battle.cCrit : battle.dCrit;
  const myName = isChallenger ? battle.challengerName : battle.defenderName;
  const oppName = isChallenger ? battle.defenderName : battle.challengerName;

  // Reset defending flag for attacker
  if (isChallenger) battle.cDefending = false;
  else battle.dDefending = false;

  const resultLines: string[] = [];

  if (cmd === "flee") {
    activePvpBattles.delete(battle.challengerJid);
    activePvpBattles.delete(battle.defenderJid);
    // Award small consolation to opponent for holding field
    const oppId = isChallenger ? battle.defenderId : battle.challengerId;
    await sendText(from,
      `🏳️ *${myName}* fled the battle!\n\n*${oppName}* wins by default!\n\n` +
      `💨 *${myName}* — no rewards for fleeing.`,
      { mentions: [battle.challengerJid, battle.defenderJid] }
    );
    await endPvpBattle(oppId, userId, battle, from, "flee");
    return;
  }

  if (cmd === "defend") {
    if (isChallenger) battle.cDefending = true;
    else battle.dDefending = true;
    resultLines.push(`🛡️ *${myName}* takes a defensive stance — next hit reduced by 50%!`);
  } else if (cmd === "attack") {
    const dodged = Math.random() < oppDodge;
    if (dodged) {
      resultLines.push(`💨 *${oppName}* dodged the attack!`);
    } else {
      const crit = Math.random() < myCrit;
      const oppIsDefending = isChallenger ? battle.dDefending : battle.cDefending;
      const defMult = oppIsDefending ? 0.5 : 1.0;
      const dmg = calcDmg(atk, crit ? 1.5 : 1.0) - Math.floor((isChallenger ? battle.dDef : battle.cDef) * 0.3 * defMult);
      const finalDmg = Math.max(1, dmg);
      if (isChallenger) { battle.dHp -= finalDmg; if (battle.dDefending) battle.dDefending = false; }
      else               { battle.cHp -= finalDmg; if (battle.cDefending) battle.cDefending = false; }
      resultLines.push(
        crit ? `⚡ *CRITICAL HIT!* *${myName}* strikes *${oppName}* for *${finalDmg} dmg*!`
              : `⚔️ *${myName}* hits *${oppName}* for *${finalDmg} dmg*${oppIsDefending ? " (blocked!)" : ""}!`
      );
    }
  } else if (cmd === "heavy") {
    const dodged = Math.random() < oppDodge * 0.6; // harder to dodge
    if (dodged) {
      resultLines.push(`💨 *${oppName}* barely dodged the heavy blow!`);
    } else {
      const oppIsDefending = isChallenger ? battle.dDefending : battle.cDefending;
      const dmg = calcDmg(atk, 1.7) - Math.floor((isChallenger ? battle.dDef : battle.cDef) * 0.3);
      const finalDmg = Math.max(1, dmg);
      if (isChallenger) { battle.dHp -= finalDmg; battle.dDefending = false; }
      else               { battle.cHp -= finalDmg; battle.cDefending = false; }
      resultLines.push(`🪓 *${myName}* unleashes a *HEAVY BLOW* on *${oppName}* for *${finalDmg} dmg*!${oppIsDefending ? " (shattered guard!)" : ""}`);
    }
  } else if (cmd === "special") {
    // Special: heals self 10% max HP + deals moderate damage
    const healAmt = Math.floor((isChallenger ? battle.cMaxHp : battle.dMaxHp) * 0.10);
    const dmg = Math.max(1, calcDmg(atk, 0.9) - Math.floor((isChallenger ? battle.dDef : battle.cDef) * 0.2));
    if (isChallenger) {
      battle.cHp = Math.min(battle.cMaxHp, battle.cHp + healAmt);
      battle.dHp -= dmg;
    } else {
      battle.dHp = Math.min(battle.dMaxHp, battle.dHp + healAmt);
      battle.cHp -= dmg;
    }
    resultLines.push(`✨ *${myName}* uses *Special!* — deals *${dmg} dmg* and recovers *${healAmt} HP*!`);
  } else {
    await sendText(from, "❌ Invalid PvP move. Use: `attack` · `heavy` · `defend` · `special` · `flee`");
    return;
  }

  // Switch turns
  battle.currentTurnId = isChallenger ? battle.defenderId : battle.challengerId;
  battle.turnCount++;

  const header = resultLines.join("\n");

  // Victory check
  const challengerDead = battle.cHp <= 0;
  const defenderDead   = battle.dHp <= 0;

  if (challengerDead || defenderDead) {
    const winnerId = defenderDead ? battle.challengerId : battle.defenderId;
    const loserId  = defenderDead ? battle.defenderId   : battle.challengerId;
    const winnerName = defenderDead ? battle.challengerName : battle.defenderName;
    const loserName  = defenderDead ? battle.defenderName   : battle.challengerName;
    const winnerJid = defenderDead ? battle.challengerJid : battle.defenderJid;
    const loserJid  = defenderDead ? battle.defenderJid   : battle.challengerJid;

    activePvpBattles.delete(battle.challengerJid);
    activePvpBattles.delete(battle.defenderJid);

    await sendText(from,
      header + "\n\n" +
      `🏆 *VICTORY!* *${winnerName}* defeats *${loserName}*!\n\n` +
      `🗡️ ${winnerName}: +3 SP · +200 XP · +$2,000\n` +
      `🛡️ ${loserName}: +1 SP · +50 XP · +$500 (consolation)`,
      { mentions: [winnerJid, loserJid] }
    );
    await endPvpBattle(winnerId, loserId, battle, from, "win");
    return;
  }

  await sendText(from, pvpBattleDisplay(battle, header), { mentions: [battle.challengerJid, battle.defenderJid] });
}

async function endPvpBattle(
  winnerId: string, loserId: string, battle: PvpBattle, from: string, reason: "win" | "flee"
): Promise<void> {
  const nowSecs = Math.floor(Date.now() / 1000);
  await Promise.all([
    setPvpCooldown(winnerId),
    setPvpCooldown(loserId),
  ]);

  if (reason === "win") {
    // Winner rewards
    const [winnerUser, winnerRpg] = await Promise.all([getUser(winnerId), ensureRpg(winnerId)]);
    const winXp = applyXpModifiers(200, winnerRpg.level, winnerRpg.dungeon_floor ?? 1, winnerUser?.xp_boost_until);
    await Promise.all([
      updateRpg(winnerId, {
        xp: winnerRpg.xp + winXp,
        skill_points: (winnerRpg.skill_points || 0) + 3,
        last_pvp: nowSecs,
      }),
      updateUser(winnerId, { balance: (winnerUser?.balance || 0) + 2000 }),
      incrementWeeklyProgress(winnerId, "pvp_wins"),
    ]);
    // Loser consolation
    const [loserUser, loserRpg] = await Promise.all([getUser(loserId), ensureRpg(loserId)]);
    await Promise.all([
      updateRpg(loserId, {
        xp: loserRpg.xp + 50,
        skill_points: (loserRpg.skill_points || 0) + 1,
        last_pvp: nowSecs,
      }),
      updateUser(loserId, { balance: (loserUser?.balance || 0) + 500 }),
    ]);
  }
}

export function getPvpBattle(senderJid: string): PvpBattle | undefined {
  const b = activePvpBattles.get(senderJid);
  if (b && Date.now() - b.lastActivity > PVP_BATTLE_TTL) {
    activePvpBattles.delete(b.challengerJid);
    activePvpBattles.delete(b.defenderJid);
    return undefined;
  }
  return b;
}
