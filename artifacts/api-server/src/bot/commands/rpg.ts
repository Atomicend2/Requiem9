import type { CommandContext } from "./index.js";
import { sendText, sendTextWithPreview } from "../connection.js";
import {
  ensureRpg, updateRpg, addToInventory, getInventory, removeFromInventory,
  getUser, updateUser, getGroup, updateGroup,
  grantAchievement, getUserAchievements, countUserAchievements,
  addWorldHistory, getWorldHistory, getActiveRumors, getRecentWorldEvents,
  getTerritoryControl, getLastRpgVisit, setLastRpgVisit,
  incrementQuestCount, incrementRaidCount,
  getUserGuild, getGuildById, getGuildsByIds, claimTerritory, getTerritoryState, getAllTerritoryState, setTerritoryTaxRate,
  getMentionName,
  getDailyQuestDoc, incrementDailyProgress, claimDailyQuestKey,
  getWeeklyQuestDoc, incrementWeeklyProgress, claimWeeklyQuestKey,
} from "../db/queries.js";
import { formatNumber, mentionTag } from "../utils.js";
import { getTerritoryDef, getRegionDef, getContinentDef, TERRITORIES } from "../atlas.js";
import { xpNeededForLevel, diminishingReturnsMultiplier, applyXpModifiers, levelStatMultiplier } from "../../lib/xp-curve.js";
import { handlePvpChallenge, handlePvpAccept, handlePvpDecline, processPvpMove, getPvpBattle } from "./pvp.js";
import { handleMentorship, applyMentorshipBonus } from "./mentorship.js";

// ── Classes ───────────────────────────────────────────────────────────────────
const CLASSES = ["Warrior", "Mage", "Archer", "Rogue", "Paladin", "Assassin", "Berserker", "Necromancer"];
const CLASS_STATS: Record<string, { hp: number; attack: number; defense: number; speed: number; desc: string }> = {
  Warrior:    { hp: 150, attack: 25, defense: 20, speed: 10, desc: "Durable front-line fighter" },
  Mage:       { hp: 75,  attack: 42, defense: 7,  speed: 18, desc: "High spell damage, arcane mastery" },
  Archer:     { hp: 100, attack: 35, defense: 12, speed: 24, desc: "Ranged precision, high crit" },
  Rogue:      { hp: 88,  attack: 38, defense: 10, speed: 30, desc: "Stealth, devastating burst damage" },
  Paladin:    { hp: 140, attack: 22, defense: 30, speed: 8,  desc: "Divine defender, healing bonus" },
  Assassin:   { hp: 82,  attack: 48, defense: 6,  speed: 34, desc: "Lethal opener, high risk-reward" },
  Berserker:  { hp: 130, attack: 40, defense: 8,  speed: 14, desc: "Rage-fueled — stronger at low HP" },
  Necromancer:{ hp: 70,  attack: 38, defense: 9,  speed: 16, desc: "Dark arts, mana-driven power" },
};

// ── Adventures (expanded) ─────────────────────────────────────────────────────
const ADVENTURES = [
  { name: "Old Railway Ruins",        enemy: "Scrap Golem",         reward: 280,   xp: 45,  difficulty: 1, lore: "Iron and rust — the empire's forgotten relics." },
  { name: "Forest of Whispers",       enemy: "Shadow Sprites",      reward: 420,   xp: 65,  difficulty: 1, lore: "The trees remember what men have forgotten." },
  { name: "Merchant Quarter Heist",   enemy: "Pickpocket Ring",     reward: 580,   xp: 90,  difficulty: 2, lore: "Crime never sleeps in the city districts." },
  { name: "Snowbound Mountain Pass",  enemy: "Frost Troll",         reward: 800,   xp: 130, difficulty: 2, lore: "Few survive the crossing in winter." },
  { name: "Ancient Library",          enemy: "Corrupted Archivist", reward: 1200,  xp: 190, difficulty: 3, lore: "Books that read you back." },
  { name: "Cave of Deep Echoes",      enemy: "Void Serpent",        reward: 1800,  xp: 280, difficulty: 3, lore: "The deeper you go, the louder it breathes." },
  { name: "Black Citadel Approach",   enemy: "Dark Knight Captain", reward: 3200,  xp: 420, difficulty: 4, lore: "The Citadel has stood for centuries. Few return." },
  { name: "Shadow Realm Gate",        enemy: "Demon Lord Shade",    reward: 5500,  xp: 600, difficulty: 4, lore: "A rift between worlds, growing wider each day." },
  { name: "Abyss Crossing",           enemy: "World Eater Larva",   reward: 11000, xp: 950, difficulty: 5, lore: "Nothing lives here — except what feeds on nothing." },
  { name: "The Void Itself",          enemy: "Zero, the Unnamed",   reward: 24000, xp: 1800,difficulty: 5, lore: "To face the Void is to question your existence." },
];

// ── Quests (expanded, tiered) ─────────────────────────────────────────────────
const QUESTS = [
  // Easy
  { name: "Patrol the Northern Wall",         reward: 200,  xp: 50,  difficulty: 1, successChance: 0.85 },
  { name: "Deliver a Package to District 3",  reward: 160,  xp: 40,  difficulty: 1, successChance: 0.90 },
  { name: "Gather Medicinal Herbs",           reward: 180,  xp: 45,  difficulty: 1, successChance: 0.88 },
  { name: "Guard the Market Stall",           reward: 220,  xp: 55,  difficulty: 1, successChance: 0.85 },
  // Medium
  { name: "Track the Missing Merchant",       reward: 500,  xp: 100, difficulty: 2, successChance: 0.72 },
  { name: "Clear Bandits from the Road",      reward: 620,  xp: 120, difficulty: 2, successChance: 0.68 },
  { name: "Recover the Lost Artifact",        reward: 750,  xp: 150, difficulty: 2, successChance: 0.65 },
  { name: "Negotiate Guild Truce",            reward: 680,  xp: 130, difficulty: 2, successChance: 0.70 },
  // Hard
  { name: "Infiltrate the Crimson Guild",     reward: 1500, xp: 300, difficulty: 3, successChance: 0.52 },
  { name: "Hunt the Ashen Beast",             reward: 2000, xp: 400, difficulty: 3, successChance: 0.50 },
  { name: "Recover the Imperial Seal",        reward: 2500, xp: 500, difficulty: 3, successChance: 0.48 },
  // Elite
  { name: "Storm the Dark Fortress",          reward: 5200, xp: 800, difficulty: 4, successChance: 0.38 },
  { name: "Silence the Shadow Council",       reward: 7000, xp: 1000,difficulty: 4, successChance: 0.33 },
  // Legendary
  { name: "Seal the Void Rift",               reward: 12000,xp: 1500,difficulty: 5, successChance: 0.25 },
  { name: "Assassinate the Forgotten King",   reward: 18000,xp: 2000,difficulty: 5, successChance: 0.20 },
];

// ── Dungeon enemies ───────────────────────────────────────────────────────────
interface DungeonBattle {
  groupId: string;
  floor: number;
  enemyName: string;
  enemyHp: number;
  enemyMaxHp: number;
  enemyAttack: number;
  enemyLevel: number;
  enemyReward: number;
  playerHp: number;
  playerMaxHp: number;
  playerAttack: number;
  playerDefense: number;
  playerDodge: number;
  playerCrit: number;
  mana: number;
  maxMana: number;
  healCooldown: number;
  defendActive: boolean;
  lastActivity: number;
  // Caps how many times .item (potions/elixirs) can be used in a single
  // battle. Previously uncapped — a player could spam .item every turn to
  // fully sustain HP indefinitely against any enemy, turning the dungeon
  // into a pure gold-vs-time exchange (buy potions, facetank forever)
  // rather than an actual fight. 2 uses gives real tactical relief for a
  // rough fight without letting inventory substitute for combat entirely.
  itemUsesRemaining: number;
}

export const activeDungeonBattles = new Map<string, DungeonBattle>();
const BATTLE_TIMEOUT = 15 * 60 * 1000;

function getDungeonEnemy(floor: number) {
  const safeFloor = Math.max(1, Math.floor(floor) || 1);
  // Rewards scaled ×10 so dungeon is a meaningful income source at higher floors.
  // Floor 1 → $1,500  |  Floor 10 → $90,000  |  Floor 25+ → $200k+
  const base = [
    { name: "Goblin Scout",      hp: 40,  attack: 8,  reward: 1500,  level: 1 },
    { name: "Orc Brute",         hp: 70,  attack: 14, reward: 2800,  level: 2 },
    { name: "Dark Mage",         hp: 100, attack: 20, reward: 4500,  level: 3 },
    { name: "Corrupted Knight",  hp: 140, attack: 28, reward: 7000,  level: 4 },
    { name: "Shadow Wraith",     hp: 190, attack: 38, reward: 11000, level: 5 },
    { name: "Demon Warlord",     hp: 260, attack: 52, reward: 18000, level: 6 },
    { name: "Ancient Dragon",    hp: 340, attack: 68, reward: 28000, level: 7 },
    { name: "Void Lich",         hp: 440, attack: 85, reward: 42000, level: 8 },
    { name: "Chaos Titan",       hp: 560, attack: 105,reward: 60000, level: 9 },
    { name: "The World Serpent", hp: 700, attack: 130,reward: 90000, level: 10 },
  ];
  const idx = Math.min(safeFloor - 1, base.length - 1);
  const e = { ...base[idx] };
  if (safeFloor > base.length) {
    const extra = safeFloor - base.length;
    e.hp     += extra * 80;
    e.attack += extra * 10;
    // Reward growth above floor 10 tapers instead of staying linear
    // forever. Flat $8k/floor meant floor 100 alone paid ~$720k more than
    // floor 10 — a single clear could out-earn weeks of every other
    // income source combined, which is what let one very active player's
    // wallet run away from everyone else's. The dungeon itself stays
    // endless (floor keeps climbing with no ceiling) — only how fast the
    // per-floor reward keeps growing is capped, via sqrt taper: full $8k/
    // floor for the next 20 floors past 10, then diminishing per floor
    // after that.
    const taperedFloors = Math.min(extra, 20);
    const beyondTaper = Math.max(0, extra - 20);
    e.reward += taperedFloors * 8000 + Math.floor(Math.sqrt(beyondTaper) * 8000);
    e.level  += extra;
    e.name = `⚫ Abyssal ${e.name}`;
  }
  return e;
}

// ── Skill attribute effects ───────────────────────────────────────────────────
function getStrEffects(str: number) {
  return {
    damageMult: 1 + Math.floor(str / 10) * 0.15,
    heavyUnlocked: str >= 20,
    dualWieldUnlocked: str >= 50,
  };
}

function getAgiEffects(agi: number) {
  return {
    dodgeChance: Math.min(agi * 0.7, 40),
    critChance: Math.min(agi * 0.5, 25),
  };
}

function getIntEffects(intel: number) {
  return {
    spellMult: 1 + intel * 0.012,
    maxMana: 50 + intel * 2,
    arcaneUnlocked: intel >= 20,
  };
}

function getLckEffects(lck: number) {
  return {
    lootBonus: 1 + lck * 0.008,
    gamblingEdge: lck * 0.005,
    rareChance: lck * 0.003,
  };
}

// ── Achievement definitions ───────────────────────────────────────────────────
const ACHIEVEMENT_DEFS = [
  { key: "first_quest",   name: "First Steps",       desc: "Complete your first quest",       icon: "🏃" },
  { key: "quest_10",      name: "Journeyman",         desc: "Complete 10 quests",              icon: "📜" },
  { key: "quest_50",      name: "Quest Master",       desc: "Complete 50 quests",              icon: "📚" },
  { key: "dungeon_1",     name: "Dungeon Initiate",   desc: "Clear Dungeon Floor 1",           icon: "🏰" },
  { key: "dungeon_5",     name: "Dungeon Knight",     desc: "Clear Dungeon Floor 5",           icon: "⚔️" },
  { key: "dungeon_10",    name: "Dungeon Master",     desc: "Clear Dungeon Floor 10",          icon: "🏆" },
  { key: "dungeon_25",    name: "Floor Sovereign",    desc: "Clear Dungeon Floor 25",          icon: "👑" },
  { key: "level_20",      name: "Veteran",            desc: "Reach RPG Level 20",              icon: "🎖️" },
  { key: "level_50",      name: "Legend",             desc: "Reach RPG Level 50",              icon: "🌌" },
  { key: "raid_10",       name: "Raid Commander",     desc: "Complete 10 raids",               icon: "⚡" },
  { key: "skill_100",     name: "Transcendent",       desc: "Max out a skill attribute to 100",icon: "✨" },
  { key: "adventure_abyss", name: "Abyss Walker",    desc: "Survive the Abyss Crossing",      icon: "🌀" },
  { key: "adventure_void",  name: "Void Walker",      desc: "Survive the Void itself",         icon: "⭕" },
] as const;

async function checkAndGrant(userId: string, key: string, from: string, sock?: any): Promise<void> {
  const def = ACHIEVEMENT_DEFS.find(a => a.key === key);
  if (!def) return;
  const granted = await grantAchievement(userId, key, def.name, def.desc, def.icon);
  if (granted && sock && from) {
    await sendText(from, `🏅 *Achievement Unlocked!*\n\n${def.icon} *${def.name}*\n_${def.desc}_`).catch(() => {});
  }
}

// ── Living World display ──────────────────────────────────────────────────────
const DEFAULT_WORLD_NEWS = [
  "Tensions rising between the Eastern Guild and the Imperial Order...",
  "Dark energy surges detected near the Void Rift — dungeon floors growing deeper.",
  "A faction of rogue Mages has declared independence from the Imperial Academy.",
  "The Black Citadel has been sighted moving — or so the scouts say.",
  "Missing adventurers near Floor 10 — the Void Lich grows bolder.",
];

const DEFAULT_RUMORS = [
  "💬 \"They say the deepest dungeon floor holds an item that can't be named.\"",
  "💬 \"The merchant at District 3 buys rare cards at triple market rate.\"",
  "💬 \"Max out your LCK stat — the Void itself rewards the lucky.\"",
  "💬 \"Floor 10 boss drops a legendary artifact... if you're alive to pick it up.\"",
  "💬 \"High INT unlocks Arcane Blast — single-target nuke inside dungeons.\"",
];

function makeHpBar(current: number, max: number, length = 10): string {
  const pct = max > 0 ? Math.max(0, current) / max : 0;
  const filled = Math.round(pct * length);
  const empty = length - filled;
  const bar = "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, empty));
  const color = pct > 0.6 ? "🟢" : pct > 0.2 ? "🟡" : "🔴";
  return `${color} ${bar}`;
}

function getPlayerTitle(level: number): string {
  if (level >= 50) return "Living Legend";
  if (level >= 30) return "Champion";
  if (level >= 20) return "Knight";
  if (level >= 10) return "Veteran";
  if (level >= 5) return "Adventurer";
  return "Novice";
}

async function buildLivingWorld(from: string, rpg: any, displayName: string): Promise<{ text: string; mentionedJids: string[] }> {
  const [history, rumors, events, territories] = await Promise.all([
    getWorldHistory(from, 5),
    getActiveRumors(from, 3),
    getRecentWorldEvents(from, 4),
    getTerritoryControl(from),
  ]);

  const mentionedJids: string[] = [];

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  let out = `╔══════════════════════════════╗\n`;
  out    += `  𝗥𝗘𝗤𝗨𝗜𝗘𝗠  𝗢𝗥𝗗𝗘𝗥  𝗡𝗘𝗧𝗪𝗢𝗥𝗞\n`;
  out    += `  ${dateStr}  ·  ${timeStr}\n`;
  out    += `╚══════════════════════════════╝\n\n`;

  // World Events (breaking news)
  out += `⚡ *WORLD TRANSMISSIONS*\n`;
  if (events.length > 0) {
    for (const ev of events) {
      out += `• ${ev.title || ev.text || "Unknown event"}\n`;
    }
  } else {
    const newsItems = DEFAULT_WORLD_NEWS.sort(() => 0.5 - Math.random()).slice(0, 3);
    for (const n of newsItems) out += `• ${n}\n`;
  }

  // Recent History (player actions)
  out += `\n📰 *RECENT ACTIVITY*\n`;
  if (history.length > 0) {
    for (const h of history.slice(0, 4)) {
      // actor_name is written as the actor's raw JID at every addWorldHistory
      // call site (see .adventure/.quest/.raid/.dungeon below) — it was
      // printed as plain text here, showing the literal JID string instead
      // of a real @mention tag. mentionTag() + collecting into
      // mentionedJids (merged into the message's `mentions` array by the
      // caller) matches how AFK and .ci correctly render actor tags.
      const actorJid = h.actor || h.actor_name;
      if (actorJid && typeof actorJid === "string" && actorJid.includes("@")) {
        mentionedJids.push(actorJid);
        out += `• ${mentionTag(actorJid)} ${h.title || "did something notable"}\n`;
      } else {
        out += `• ${h.actor_name || "Someone"} ${h.title || "did something notable"}\n`;
      }
    }
  } else {
    out += `• _The world is quiet. Be the first to make history._\n`;
  }

  // Territory control
  if (territories.length > 0) {
    out += `\n🗺️ *TERRITORY CONTROL*\n`;
    for (const t of territories.slice(0, 3)) {
      out += `• ${t.name}: *${t.controller || "Contested"}*\n`;
    }
  }

  // Rumors
  out += `\n🗣️ *RUMORS & INTEL*\n`;
  const rumorTexts = rumors.length > 0
    ? rumors.map(r => `💬 "${r.text}"`)
    : DEFAULT_RUMORS.sort(() => 0.5 - Math.random()).slice(0, 2);
  for (const r of rumorTexts) out += `${r}\n`;

  // Player status
  const hpBar = makeHpBar(rpg.hp, rpg.max_hp, 10);
  const title = getPlayerTitle(rpg.level);
  const sp = rpg.skill_points || 0;
  const manaDisplay = rpg.max_mana ? ` | 💙 ${rpg.mana || 0}/${rpg.max_mana} MP` : "";

  out += `\n${"─".repeat(32)}\n`;
  out += `👤 *YOUR STATUS* — ${displayName}\n\n`;
  out += `${hpBar} \`${Math.max(0, rpg.hp)}/${rpg.max_hp} HP\`${manaDisplay}\n`;
  out += `🗡️ Lv.${rpg.level} ${title} · ${rpg.class}\n`;
  out += `✨ XP: ${rpg.xp} / ${xpNeededForLevel(rpg.level)} | 🏰 Floor ${rpg.dungeon_floor ?? 1}\n`;
  if (sp > 0) out += `⚡ *${sp} Skill Points available!*\n`;

  out += `\n${"─".repeat(32)}\n`;
  out += `⚔️ _.dungeon_ · 📜 _.quest_ · 🗺️ _.adventure_\n`;
  out += `⚡ _.skill_ · 🎭 _.class_ · 📊 _.rpgstats_`;

  return { text: out, mentionedJids };
}

function dungeonBattleDisplay(battle: DungeonBattle, rpgLevel: number, header?: string): string {
  const title = getPlayerTitle(rpgLevel);
  const healNote = battle.healCooldown > 0 ? ` (${battle.healCooldown}t CD)` : "";
  const hasMana = battle.maxMana > 0;
  const manaLine = hasMana ? `  💙 MP: ${battle.mana}/${battle.maxMana}\n` : "";
  let msg = "";
  if (header) msg += `${header}\n\n`;
  msg +=
    `🏰 *DUNGEON FLOOR ${battle.floor}*  |  📊 Lv.${rpgLevel} ${title}\n` +
    `A *${battle.enemyName}* (Lv.${battle.enemyLevel}) stands before you!\n\n` +
    `⚔️ *You*   ❤️ ${makeHpBar(battle.playerHp, battle.playerMaxHp)} \`${Math.max(0,battle.playerHp)}/${battle.playerMaxHp}\`\n` +
    manaLine +
    `👾 *${battle.enemyName}*  💀 ${makeHpBar(battle.enemyHp, battle.enemyMaxHp)} \`${Math.max(0,battle.enemyHp)}/${battle.enemyMaxHp}\`\n\n` +
    `_🎯 Dodge: ${battle.playerDodge.toFixed(1)}%  |  ⚡ Crit: ${battle.playerCrit.toFixed(1)}%_\n\n` +
    `_Choose your move:_\n` +
    `⚔️ *.attack*   💥 *.heavy*   🛡️ *.defend*\n` +
    `🌟 *.special*  🧪 *.heal*${healNote}  🎒 *.item*\n` +
    (hasMana && battle.mana >= 30 ? `✨ *.arcane* — Arcane Blast (30 MP)\n` : "") +
    `🏃 *.flee*     🔍 *.explore*  🏕️ *.rest*`;
  return msg;
}

function calcDmg(base: number, multiplier: number): number {
  const safeBase = Number.isFinite(base) ? base : 10;
  const variance = 0.8 + Math.random() * 0.4;
  return Math.max(1, Math.floor(safeBase * multiplier * variance));
}

const RPG_GROUP_LINK = "https://chat.whatsapp.com/Gobh9CiNhMgAwgSP6fX35j?s=cl&p=a&ilr=4";

// ── Main Handler ──────────────────────────────────────────────────────────────
export async function handleRpg(ctx: CommandContext): Promise<void> {
  const { from, sender, args, command: cmd, sock, isAdmin, isOwner } = ctx;

  // Admin toggle
  if (cmd === "rpg" && (args[0]?.toLowerCase() === "on" || args[0]?.toLowerCase() === "off")) {
    if (!isAdmin && !isOwner && !ctx.isBotAdmin) {
      await sendText(from, "❌ Only group admins can toggle RPG."); return;
    }
    const toggle = args[0].toLowerCase() as "on" | "off";
    await updateGroup(from, { rpg_enabled: toggle });
    await sendText(from, `✅ RPG commands ${toggle === "on" ? "enabled" : "disabled"} for this group.`);
    return;
  }

  const group = from.endsWith("@g.us") ? await getGroup(from) : null;
  if (group && (group.rpg_enabled || "on") === "off") {
    await sendTextWithPreview(from, `❌ RPG commands are unavailable in this group.\nWant to battle? Join ${RPG_GROUP_LINK}`);
    return;
  }

  const user = await getUser(sender);
  const userId = user?.id || sender.split("@")[0].split(":")[0].replace(/\D/g, "");
  const rpg = await ensureRpg(userId);
  const now = Math.floor(Date.now() / 1000);

  const DUNGEON_MOVES = ["attack", "heavy", "defend", "special", "item", "flee", "explore", "rest", "arcane"];

  if (DUNGEON_MOVES.includes(cmd)) {
    // PvP battles share the same move vocabulary as dungeon — check PvP first.
    const pvpBattle = getPvpBattle(sender);
    if (pvpBattle) {
      await processPvpMove(ctx, pvpBattle);
      return;
    }
    const battle = activeDungeonBattles.get(sender);
    if (battle && Date.now() - battle.lastActivity > BATTLE_TIMEOUT) activeDungeonBattles.delete(sender);
    const cur = activeDungeonBattles.get(sender);
    if (!cur) {
      await sendText(from, "❌ You're not in an active dungeon battle. Use *.dungeon* to start one!"); return;
    }
    if (cur.groupId !== from) {
      await sendText(from, "❌ Continue your dungeon battle in the same group you started it."); return;
    }
    cur.lastActivity = Date.now();
    await processDungeonMove(ctx, cur, rpg);
    return;
  }

  // ── .skill ──────────────────────────────────────────────────────────────────
  if (cmd === "skill") {
    const sp = rpg.skill_points || 0;
    const str = rpg.strength   || 0;
    const agi = rpg.agility    || 0;
    const intel = rpg.intelligence || 0;
    const lck = rpg.luck       || 0;

    if (!args[0]) {
      const strFx = getStrEffects(str);
      const agiFx = getAgiEffects(agi);
      const intFx = getIntEffects(intel);
      const lckFx = getLckEffects(lck);
      await sendText(from,
        `⚡ *SKILL ATTRIBUTES* — ${userId}\n\n` +
        `📊 Available: *${sp} SP*\n` +
        `_Earn SP by clearing dungeon floors_\n\n` +
        `💪 *STRENGTH* — ${str} pts\n` +
        `   Every 10 pts: +15% dmg bonus. At 20: heavy weapons.\n` +
        `   → Damage mult: *×${strFx.damageMult.toFixed(2)}*${str >= 20 ? " | ⚔️ Heavy UNLOCKED" : ""}\n\n` +
        `🌀 *AGILITY* — ${agi} pts\n` +
        `   Per pt: +0.7% dodge (max 40%), +0.5% crit (max 25%)\n` +
        `   → Dodge: *${agiFx.dodgeChance.toFixed(1)}%* | Crit: *${agiFx.critChance.toFixed(1)}%*\n\n` +
        `🧠 *INTELLIGENCE* — ${intel} pts\n` +
        `   Per pt: +1.2% spell dmg, +2 max mana. At 20: Arcane Blast.\n` +
        `   → Spell ×*${intFx.spellMult.toFixed(2)}* | Mana: *${intFx.maxMana}*${intel >= 20 ? " | ✨ Arcane UNLOCKED" : ""}\n\n` +
        `🍀 *LUCK* — ${lck} pts\n` +
        `   Per pt: +0.8% loot, +0.5% gambling edge, rare encounters\n` +
        `   → Loot: *×${lckFx.lootBonus.toFixed(3)}* | Gamble edge: *+${(lckFx.gamblingEdge * 100).toFixed(1)}%*\n\n` +
        `*Spend SP:* _.skill [str/agi/int/lck] [points]_\n` +
        `Example: _.skill str 5_ → +5 Strength`
      );
      return;
    }

    const attrMap: Record<string, string> = {
      str: "strength", strength: "strength",
      agi: "agility",  agility: "agility",
      int: "intelligence", intelligence: "intelligence", intel: "intelligence",
      lck: "luck",     luck: "luck",
    };
    const attrKey = attrMap[args[0]?.toLowerCase()];
    if (!attrKey) {
      await sendText(from, "❌ Unknown attribute. Use: *str*, *agi*, *int*, *lck*"); return;
    }
    const points = Math.max(1, parseInt(args[1] || "1", 10));
    if (points > sp) {
      await sendText(from, `❌ Not enough skill points. You have *${sp} SP*.`); return;
    }
    const current = rpg[attrKey] || 0;
    const newVal = current + points;
    await updateRpg(userId, {
      skill_points: sp - points,
      [attrKey]: newVal,
      ...(attrKey === "intelligence" ? { max_mana: 50 + newVal * 2, mana: Math.min(rpg.mana || 0, 50 + newVal * 2) } : {}),
    });

    const label = { strength: "💪 Strength", agility: "🌀 Agility", intelligence: "🧠 Intelligence", luck: "🍀 Luck" }[attrKey]!;
    await sendText(from,
      `✅ Spent *${points} SP* on *${label}*!\n\n` +
      `${label}: ${current} → *${newVal}*\n` +
      `⚡ Remaining SP: ${sp - points}`
    );

    // Achievement: max out an attribute
    if (newVal >= 100) await checkAndGrant(userId, "skill_100", from, sock);
    return;
  }

  // ── .rpg (Living World view) ──────────────────────────────────────────────
  if (cmd === "rpg") {
    const displayName = userId;
    const { text: worldView, mentionedJids } = await buildLivingWorld(from, rpg, displayName);
    const allMentions = Array.from(new Set([sender, ...mentionedJids]));
    await sendText(from, worldView, allMentions);
    await setLastRpgVisit(userId).catch(() => {});
    return;
  }

  // ── .rpgstats (detailed stats) ────────────────────────────────────────────
  if (cmd === "rpgstats") {
    const strFx = getStrEffects(rpg.strength || 0);
    const agiFx = getAgiEffects(rpg.agility || 0);
    const intFx = getIntEffects(rpg.intelligence || 0);
    const lckFx = getLckEffects(rpg.luck || 0);
    const achievements = await getUserAchievements(userId);
    const title = getPlayerTitle(rpg.level);
    await sendText(from,
      `⚔️ *RPG STATS* — ${userId}\n\n` +
      `🏆 ${title} · ${rpg.class}\n` +
      `🗡️ Level ${rpg.level} | ✨ ${rpg.xp}/${xpNeededForLevel(rpg.level)} XP\n` +
      `🏰 Dungeon Floor ${rpg.dungeon_floor ?? 1}\n\n` +
      `❤️ HP: ${makeHpBar(rpg.hp, rpg.max_hp, 8)} ${rpg.hp}/${rpg.max_hp}\n` +
      (rpg.max_mana ? `💙 MP: ${rpg.mana || 0}/${rpg.max_mana}\n` : "") +
      `\n⚔️ Base ATK: ${rpg.attack ?? 15}  🛡️ Base DEF: ${rpg.defense ?? 10}  💨 SPD: ${rpg.speed ?? 10}\n\n` +
      `*ATTRIBUTES*\n` +
      `💪 STR ${rpg.strength || 0}  → ×${strFx.damageMult.toFixed(2)} dmg\n` +
      `🌀 AGI ${rpg.agility || 0}  → ${agiFx.dodgeChance.toFixed(1)}% dodge / ${agiFx.critChance.toFixed(1)}% crit\n` +
      `🧠 INT ${rpg.intelligence || 0}  → ×${intFx.spellMult.toFixed(2)} spell\n` +
      `🍀 LCK ${rpg.luck || 0}  → ×${lckFx.lootBonus.toFixed(3)} loot\n` +
      `⚡ Skill Points: ${rpg.skill_points || 0}\n\n` +
      `🏅 Achievements: ${achievements.length}\n` +
      (achievements.slice(0, 3).map(a => `  ${a.icon} ${a.name}`).join("\n") || "  _None yet_")
    , [sender]);
    return;
  }

  // ── .class ───────────────────────────────────────────────────────────────
  if (cmd === "class") {
    const newClass = args[0];
    if (!newClass) {
      const lines = Object.entries(CLASS_STATS).map(([name, s]) =>
        `➺ *${name}* — ❤️${s.hp} ⚔️${s.attack} 🛡️${s.defense} 💨${s.speed}\n   _${s.desc}_`
      ).join("\n");
      await sendText(
        from,
        `🌸━━━『 反逆 』━━━🌸\n\n` +
        `❀━━━━━━━━━━━━━━❀\n` +
        `      🎭 𝗔𝗩𝗔𝗜𝗟𝗔𝗕𝗟𝗘 𝗖𝗟𝗔𝗦𝗦𝗘𝗦\n` +
        `❀━━━━━━━━━━━━━━❀\n` +
        `${lines}\n\n` +
        `_Use .class [name] to pick one._`
      );
      return;
    }
    const cls = Object.keys(CLASS_STATS).find(c => c.toLowerCase() === newClass.toLowerCase());
    if (!cls) { await sendText(from, "❌ Invalid class. Type _.class_ to see the list."); return; }
    const s = CLASS_STATS[cls];
    const intFx = getIntEffects(rpg.intelligence || 0);
    await updateRpg(userId, {
      class: cls, hp: s.hp, max_hp: s.hp,
      attack: s.attack, defense: s.defense, speed: s.speed,
      max_mana: intFx.maxMana, mana: intFx.maxMana,
    });
    await sendText(from,
      `✅ *Class changed to ${cls}!*\n\n` +
      `❤️ HP: ${s.hp} | ⚔️ ATK: ${s.attack} | 🛡️ DEF: ${s.defense} | 💨 SPD: ${s.speed}\n` +
      `_${s.desc}_`
    );
    return;
  }

  // ── .adventure ────────────────────────────────────────────────────────────
  if (cmd === "adventure") {
    const cooldown = 3600;
    if (now - (rpg.last_adventure || 0) < cooldown) {
      await sendText(from, `⏳ Adventure cooldown: ${formatDuration(cooldown - (now - rpg.last_adventure))} left.`);
      return;
    }
    const lckFx = getLckEffects(rpg.luck || 0);
    const adv = ADVENTURES[Math.floor(Math.random() * ADVENTURES.length)];
    const baseSuccess = Math.min(0.88, 0.35 + (rpg.level * 0.08) - (adv.difficulty * 0.1) + (rpg.luck || 0) * 0.005);
    const success = Math.random() < baseSuccess;

    if (success) {
      const rawReward = adv.reward + Math.floor(Math.random() * adv.reward * 0.4);
      const reward = Math.floor(rawReward * lckFx.lootBonus);
      const xp = applyXpModifiers(adv.xp + Math.floor((rpg.luck || 0) * 0.5), rpg.level, rpg.dungeon_floor ?? 1, user?.xp_boost_until);
      await updateRpg(userId, { last_adventure: now, xp: rpg.xp + xp });
      await updateUser(userId, { balance: (user?.balance || 0) + reward });
      await checkLevelUp(userId, rpg.xp + xp, rpg.level, from, sock);
      await addWorldHistory({ title: `cleared the ${adv.name}`, actor: userId, actor_name: userId, group_id: from, category: "adventure" }).catch(() => {});

      if (adv.difficulty === 5 && adv.name.includes("Abyss")) await checkAndGrant(userId, "adventure_abyss", from, sock);
      if (adv.difficulty === 5 && adv.name.includes("Void")) await checkAndGrant(userId, "adventure_void", from, sock);

      await sendText(from,
        `🗺️ *Adventure: ${adv.name}*\n\n` +
        `_${adv.lore}_\n\n` +
        `You defeated the *${adv.enemy}*!\n\n` +
        `💰 Reward: +$${formatNumber(reward)}${lckFx.lootBonus > 1 ? ` *(×${lckFx.lootBonus.toFixed(2)} Luck bonus!)*` : ""}\n` +
        `✨ XP: +${xp}\n` +
        `⚔️ Success chance was ${Math.floor(baseSuccess * 100)}%`
      );
    } else {
      const hpLost = Math.floor(rpg.max_hp * (0.2 + adv.difficulty * 0.05));
      await updateRpg(userId, { hp: Math.max(1, rpg.hp - hpLost), last_adventure: now });
      await sendText(from,
        `🗺️ *Adventure: ${adv.name}*\n\n` +
        `_${adv.lore}_\n\n` +
        `The *${adv.enemy}* overpowered you!\n\n` +
        `❤️ HP lost: ${hpLost} (${Math.max(1, rpg.hp - hpLost)}/${rpg.max_hp})\n` +
        `_Use .heal to recover, then try again._`
      );
    }
    return;
  }

  // ── .heal (out-of-dungeon) ────────────────────────────────────────────────
  if (cmd === "heal") {
    const battle = activeDungeonBattles.get(sender);
    if (battle && battle.groupId === from) {
      battle.lastActivity = Date.now();
      await processDungeonMove(ctx, battle, rpg);
      return;
    }
    const missingHp = Math.max(0, rpg.max_hp - rpg.hp);
    const missingMp = Math.max(0, (rpg.max_mana || 0) - (rpg.mana || 0));
    if (missingHp === 0 && missingMp === 0) { await sendText(from, "❤️ You're already at full HP and MP!"); return; }
    // Cost scales with how much is actually being restored, not a flat
    // fee regardless of amount — previously $200 healed you fully whether
    // you were missing 5 HP or 950 HP, which was trivial for high-level
    // characters with big HP pools and made .heal essentially free
    // compared to genuine dungeon risk. 4 gold per HP + 6 gold per MP
    // (MP costs more per point — it gates stronger spell/arcane actions)
    // with a small flat minimum so tiny top-offs aren't literally free.
    const cost = Math.max(50, Math.ceil(missingHp * 4 + missingMp * 6));
    if (!user || (user.balance || 0) < cost) {
      await sendText(from,
        `❌ Need $${formatNumber(cost)} to fully heal (${missingHp} HP${missingMp > 0 ? ` + ${missingMp} MP` : ""} missing). ` +
        `You have $${formatNumber(user?.balance || 0)}.\nUse potions from inventory with _.item_ in dungeon for a cheaper partial heal.`
      );
      return;
    }
    await updateUser(userId, { balance: (user.balance || 0) - cost });
    await updateRpg(userId, { hp: rpg.max_hp, mana: rpg.max_mana || rpg.mana || 0 });
    await sendText(from, `❤️ Healed to full HP${missingMp > 0 ? "/MP" : ""}! (${rpg.max_hp}/${rpg.max_hp} HP) — -$${formatNumber(cost)}`);
    return;
  }

  // ── .quest ────────────────────────────────────────────────────────────────
  if (cmd === "quest") {
    const cooldown = 240;
    if (now - (rpg.last_quest || 0) < cooldown) {
      await sendText(from, `⏳ Quest cooldown: ${formatDuration(cooldown - (now - rpg.last_quest))} left.`);
      return;
    }
    const lckFx = getLckEffects(rpg.luck || 0);
    const quest = QUESTS[Math.floor(Math.random() * QUESTS.length)];
    const successChance = Math.min(0.92, quest.successChance + (rpg.luck || 0) * 0.005);
    const success = Math.random() < successChance;

    if (success) {
      const rawReward = quest.reward + Math.floor(Math.random() * quest.reward * 0.3);
      const reward = Math.floor(rawReward * lckFx.lootBonus);
      const xp = applyXpModifiers(quest.xp, rpg.level, rpg.dungeon_floor ?? 1, user?.xp_boost_until);
      // Mentorship bonus — apprentice gets +15% XP; mentor earns +1 SP +50 XP passively
      const mentorXpBonus = await applyMentorshipBonus(userId, "quest", xp, from, sock);
      const totalXp = xp + mentorXpBonus;
      await updateRpg(userId, { last_quest: now, xp: rpg.xp + totalXp });
      await updateUser(userId, { balance: (user?.balance || 0) + reward });
      await checkLevelUp(userId, rpg.xp + totalXp, rpg.level, from, sock);
      const totalQuests = await incrementQuestCount(userId);
      await addWorldHistory({ title: `completed quest "${quest.name}"`, actor: userId, actor_name: userId, group_id: from, category: "quest" }).catch(() => {});
      // Daily / weekly progress tracking
      await Promise.all([
        incrementDailyProgress(userId, "quests"),
        incrementDailyProgress(userId, "xp", totalXp),
        incrementWeeklyProgress(userId, "quests"),
      ]);

      // Quest achievements
      if (totalQuests === 1) await checkAndGrant(userId, "first_quest", from, sock);
      if (totalQuests >= 10) await checkAndGrant(userId, "quest_10", from, sock);
      if (totalQuests >= 50) await checkAndGrant(userId, "quest_50", from, sock);

      await sendText(from,
        `📜 *Quest: ${quest.name}*\n\n✅ Quest complete!\n\n` +
        `💰 +${formatNumber(reward)}${lckFx.lootBonus > 1 ? " *(Luck bonus!)*" : ""}\n` +
        `✨ +${totalXp} XP${mentorXpBonus > 0 ? ` *(+${mentorXpBonus} mentor bonus!)*` : ""}\n` +
        `📋 Total quests: ${totalQuests}`
      );
    } else {
      await updateRpg(userId, { last_quest: now });
      await sendText(from, `📜 *Quest: ${quest.name}*\n\n❌ Quest failed. Better luck next time!\n_Success chance: ${Math.floor(successChance * 100)}%_`);
    }
    return;
  }

  // ── .territory ────────────────────────────────────────────────────────────
  // Guilds claim and hold territories from the world atlas. This is the
  // piece that makes the website's world map a live view of real guild
  // control instead of static lore — claiming here is what changes the
  // document the map reads.
  if (cmd === "territory" || cmd === "claim") {
    const sub = (args[0] || "").toLowerCase();

    // .territory  (no args) — list every territory and who holds it
    if (!sub || sub === "list") {
      const states = await getAllTerritoryState();
      const stateByTerritory = new Map(states.map((s) => [s.territory_id, s]));
      const guildIds = [...new Set(states.map((s) => s.guild_id).filter(Boolean))] as string[];
      const guilds = await getGuildsByIds(guildIds);
      const guildNameById = new Map(guilds.map((g: any) => [String(g._id), g.name]));

      let out = `🗺️ *WORLD ATLAS — TERRITORY CONTROL*\n\n`;
      for (const t of TERRITORIES) {
        const state = stateByTerritory.get(t.id);
        const owner = state?.guild_id ? (guildNameById.get(state.guild_id) || "Unknown Guild") : "_Unclaimed_";
        out += `• *${t.name}* (${t.resource}) — ${owner}\n`;
      }
      out += `\nUse *.territory <name>* for details, or *.territory claim <name>* to claim one for your guild.`;
      await sendText(from, out);
      return;
    }

    // .territory <name> — detail view
    if (sub !== "claim" && sub !== "tax") {
      const queryName = args.join(" ");
      const def = getTerritoryDef(queryName);
      if (!def) { await sendText(from, `❌ No territory found matching "${queryName}". Use *.territory* to see the full list.`); return; }
      const state = await getTerritoryState(def.id);
      const region = getRegionDef(def.region);
      const continent = region ? getContinentDef(region.continent) : undefined;
      let ownerName = "_Unclaimed_";
      if (state?.guild_id) {
        const g = await getGuildById(state.guild_id);
        ownerName = (g as any)?.name || "Unknown Guild";
      }
      await sendText(
        from,
        `🗺️ *${def.name}*\n` +
        `${continent?.name || "?"} → ${region?.name || "?"}\n\n` +
        `👑 Owner: ${ownerName}\n` +
        `💎 Resource: ${def.resource}\n` +
        `💰 Base Income: ${formatNumber(def.baseIncome)} gold/day\n` +
        (state ? `📊 Tax Rate: ${state.tax_rate ?? 10}%\n⚠️ Danger: ${state.danger_level ?? 1}/10\n` : "") +
        `\nUse *.territory claim ${def.name}* to claim this territory for your guild.`
      );
      return;
    }

    // .territory claim <name>
    if (sub === "claim") {
      const territoryName = args.slice(1).join(" ");
      const def = getTerritoryDef(territoryName);
      if (!def) { await sendText(from, `❌ No territory found matching "${territoryName}". Use *.territory* to see the full list.`); return; }

      const guild = await getUserGuild(sender);
      if (!guild) { await sendText(from, "❌ You need to be in a guild to claim territory. Use *.guild create* or *.guild join*."); return; }
      if ((guild as any).owner_id !== sender) { await sendText(from, "❌ Only your guild's owner can claim territory."); return; }

      const CLAIM_COST = 5000;
      const CLAIM_COOLDOWN = 6 * 3600; // 6 hours between claims, per guild owner
      const user = await getUser(sender);
      const lastClaim = Number((user as any)?.last_territory_claim || 0);
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec - lastClaim < CLAIM_COOLDOWN) {
        const remaining = CLAIM_COOLDOWN - (nowSec - lastClaim);
        await sendText(from, `⏳ Your guild can claim again in ${Math.ceil(remaining / 60)} minutes.`);
        return;
      }
      const balance = Number((user as any)?.balance || 0);
      if (balance < CLAIM_COST) { await sendText(from, `❌ Claiming a territory costs 💰${formatNumber(CLAIM_COST)}. You have 💰${formatNumber(balance)}.`); return; }

      const existing = await getTerritoryState(def.id);
      if (existing?.guild_id === String((guild as any)._id)) {
        await sendText(from, `❌ Your guild already controls *${def.name}*.`);
        return;
      }

      await updateUser(sender, { balance: balance - CLAIM_COST, last_territory_claim: nowSec });
      const { outcome } = await claimTerritory(def.id, String((guild as any)._id), (guild as any).name, sender, mentionTag(sender));

      if (outcome === "taken_over") {
        await sendText(from, `⚔️ *${(guild as any).name}* has seized *${def.name}* from a rival guild! 💰 -${formatNumber(CLAIM_COST)}`);
      } else {
        await sendText(from, `🏴 *${(guild as any).name}* now controls *${def.name}*! 💰 -${formatNumber(CLAIM_COST)}\n\nIt produces ${def.resource} worth ${formatNumber(def.baseIncome)} gold/day.`);
      }
      return;
    }

    // .territory tax <name> <0-50>
    if (sub === "tax") {
      const rateArg = args[args.length - 1];
      const territoryName = args.slice(1, -1).join(" ");
      const rate = parseInt(rateArg, 10);
      const def = getTerritoryDef(territoryName);
      if (!def || isNaN(rate)) { await sendText(from, "❌ Usage: .territory tax <territory name> <0-50>"); return; }

      const guild = await getUserGuild(sender);
      if (!guild || (guild as any).owner_id !== sender) { await sendText(from, "❌ Only your guild's owner can set the tax rate."); return; }

      const ok = await setTerritoryTaxRate(def.id, String((guild as any)._id), rate);
      if (!ok) { await sendText(from, `❌ Your guild doesn't control *${def.name}*.`); return; }
      await sendText(from, `✅ Tax rate for *${def.name}* set to ${Math.max(0, Math.min(50, rate))}%.`);
      return;
    }
  }

  // ── .dungeon ──────────────────────────────────────────────────────────────
  if (cmd === "dungeon") {
    const existing = activeDungeonBattles.get(sender);
    if (existing) {
      if (Date.now() - existing.lastActivity > BATTLE_TIMEOUT) {
        activeDungeonBattles.delete(sender);
      } else {
        await sendText(from, dungeonBattleDisplay(existing, rpg.level));
        return;
      }
    }
    const cooldown = 360;
    if (now - (rpg.last_dungeon || 0) < cooldown) {
      await sendText(from, `⏳ Dungeon cooldown: ${formatDuration(cooldown - (now - rpg.last_dungeon))} left.`);
      return;
    }
    if (rpg.hp < Math.floor(rpg.max_hp * 0.2)) {
      await sendText(from, `❤️ Too injured to enter! HP: ${rpg.hp}/${rpg.max_hp}\nUse *.heal* first.`); return;
    }
    const floor = rpg.dungeon_floor ?? 1;

    // Entry fee for floor 4+. Floors 1-3 are free so new players can learn
    // the system; each floor beyond 3 costs $1,500 more at the gate.
    const entryFee = floor > 3 ? (floor - 3) * 1500 : 0;
    let entryFeeNotice = "";
    if (entryFee > 0) {
      const dungeonUser = await getUser(sender);
      const walletBal = dungeonUser?.balance || 0;
      if (walletBal < entryFee) {
        await sendText(from,
          `🏰 *Floor ${floor} Entry Fee: ${formatNumber(entryFee)}*\n\n` +
          `You don't have enough gold to attempt this floor.\n` +
          `💰 Wallet: ${formatNumber(walletBal)}\n\n` +
          `Earn more and return!`
        );
        return;
      }
      await updateUser(userId, { balance: walletBal - entryFee });
      // PERF: previously sent as its own sendText() call, immediately
      // followed by a second sendText() for the battle-start message a
      // few lines below. Each WhatsApp send in production traces
      // (2026-07-19) costs 8-12s regardless of command, so two sends
      // for one .dungeon invocation doubled that cost for no UX reason
      // — folded into a single prefix on the battle-start message instead.
      entryFeeNotice = `💸 Entry fee paid: *${formatNumber(entryFee)}* for Floor ${floor}\n\n`;
    }

    const enemy = getDungeonEnemy(floor);
    const strFx = getStrEffects(rpg.strength || 0);
    const agiFx = getAgiEffects(rpg.agility || 0);
    const intFx = getIntEffects(rpg.intelligence || 0);
    const baseAttack = rpg.attack ?? 15;
    const baseDefense = rpg.defense ?? 10;
    // Level-scaled stats: every level adds ~4% to HP, attack, and defense so
    // a level-10 player is meaningfully stronger than a level-1 of the same
    // class, matching the steady floor-by-floor enemy climb in getDungeonEnemy.
    const lvlMult = levelStatMultiplier(rpg.level || 1);
    const scaledMaxHp = Math.floor((rpg.max_hp ?? 100) * lvlMult);
    const scaledAttack = Math.floor(baseAttack * lvlMult);
    const scaledDefense = Math.floor(baseDefense * lvlMult);
    // Strength Elixir (str_boost effect): +25% attack while active.
    // Previously this item did nothing at all when used.
    const dungeonUser = await getUser(sender);
    const strBoostActive = !!(dungeonUser as any)?.str_boost_until && (dungeonUser as any).str_boost_until > now;
    const effAttack = Math.floor(scaledAttack * strFx.damageMult * (strBoostActive ? 1.25 : 1));

    const battle: DungeonBattle = {
      groupId: from, floor,
      enemyName: enemy.name, enemyHp: enemy.hp, enemyMaxHp: enemy.hp,
      enemyAttack: enemy.attack, enemyLevel: enemy.level, enemyReward: enemy.reward,
      // Cap current HP to the new scaled max so it's never impossible to start
      playerHp: Math.min(rpg.hp ?? scaledMaxHp, scaledMaxHp),
      playerMaxHp: scaledMaxHp,
      playerAttack: effAttack, playerDefense: scaledDefense,
      playerDodge: agiFx.dodgeChance, playerCrit: agiFx.critChance,
      mana: rpg.mana || intFx.maxMana, maxMana: intFx.maxMana,
      healCooldown: 0, defendActive: false, lastActivity: Date.now(), itemUsesRemaining: 2,
    };
    activeDungeonBattles.set(sender, battle);
    await updateRpg(userId, { last_dungeon: now });
    await sendText(from, entryFeeNotice + dungeonBattleDisplay(battle, rpg.level, `🏰 *Entering Dungeon Floor ${floor}...*`));
    return;
  }

  // ── .raid ─────────────────────────────────────────────────────────────────
  if (cmd === "raid") {
    const cooldown = 21600;
    if (now - (rpg.last_raid || 0) < cooldown) {
      await sendText(from, `⏳ Raid cooldown: ${formatDuration(cooldown - (now - rpg.last_raid))} left.`);
      return;
    }
    const lckFx = getLckEffects(rpg.luck || 0);
    const successChance = 0.50 + (rpg.luck || 0) * 0.003;
    const success = Math.random() < successChance;
    if (success) {
      // Raid rewards: balanced to $15,000–$40,000 so no single 6-hr action
      // can outproduce a full day of normal play.
      const floor = rpg.dungeon_floor ?? 1;
      const levelBonus = (rpg.level || 1) * 800;
      const floorBonus = floor * 400;
      const variance = Math.floor(Math.random() * 6000); // 0–6k random
      const base = 8000 + levelBonus + floorBonus + variance;
      const reward = Math.min(40000, Math.floor(base * lckFx.lootBonus));
      const xp = applyXpModifiers(200 + (rpg.level || 1) * 10, rpg.level, floor, user?.xp_boost_until);
      await updateRpg(userId, { last_raid: now, xp: rpg.xp + xp });
      await updateUser(userId, { balance: (user?.balance || 0) + reward });
      await checkLevelUp(userId, rpg.xp + xp, rpg.level, from, sock);
      const totalRaids = await incrementRaidCount(userId);
      await addWorldHistory({ title: "completed a raid on the enemy fortress", actor: userId, actor_name: userId, group_id: from, category: "raid" }).catch(() => {});
      await incrementWeeklyProgress(userId, "raids");
      if (totalRaids >= 10) await checkAndGrant(userId, "raid_10", from, sock);
      await sendText(from,
        `⚔️ *Raid Complete!*\n\n` +
        `Your party stormed the fortress and prevailed!\n\n` +
        `💰 +${formatNumber(reward)}${lckFx.lootBonus > 1 ? " *(Luck!)*" : ""}\n` +
        `✨ +${xp} XP | Total raids: ${totalRaids}`
      );
    } else {
      const hpLost = Math.floor(rpg.max_hp * 0.4);
      await updateRpg(userId, { hp: Math.max(1, rpg.hp - hpLost), last_raid: now });
      await sendText(from, `⚔️ *Raid Failed!*\n\nThe enemy fortress repelled your forces.\n\n❤️ -${hpLost} HP\n_Use .heal then try again in 6 hours._`);
    }
    return;
  }

  // ── .achievements ─────────────────────────────────────────────────────────
  if (cmd === "achievements" || cmd === "achieve") {
    const list = await getUserAchievements(userId);
    if (list.length === 0) {
      await sendText(from, "🏅 *Achievements*\n\n_You haven't earned any achievements yet._\n\nComplete quests, dungeon floors, and raids to unlock them!"); return;
    }
    const lines = list.map(a => `${a.icon} *${a.name}* — _${a.description}_`).join("\n");
    await sendText(from, `🏅 *Achievements* (${list.length})\n\n${lines}`);
    return;
  }

  // ── .duel / .accept / .decline — PvP ────────────────────────────────────
  if (cmd === "duel")    { await handlePvpChallenge(ctx); return; }
  if (cmd === "accept")  { await handlePvpAccept(ctx);    return; }
  if (cmd === "decline") { await handlePvpDecline(ctx);   return; }

  // ── .mentor / .mentors ────────────────────────────────────────────────────
  if (cmd === "mentor" || cmd === "mentors") { await handleMentorship(ctx); return; }

  // ── .quests — Daily quest board ───────────────────────────────────────────
  if (cmd === "quests") {
    const sub = (args[0] || "").toLowerCase();
    const doc = await getDailyQuestDoc(userId);
    const progress: Record<string, number> = doc?.progress || {};
    const claimed: string[] = doc?.claimed || [];
    const today = new Date().toISOString().slice(0, 10);

    const DAILY_DEFS = [
      { key: "quests",   label: "Complete 3 quests",    target: 3,   reward: 2000, sp: 2, xp: 200 },
      { key: "dungeons", label: "Win 2 dungeon battles", target: 2,   reward: 5000, sp: 3, xp: 300 },
      { key: "xp",       label: "Earn 500 XP",           target: 500, reward: 3000, sp: 2, xp: 0   },
    ];

    if (sub === "claim") {
      let claimedAny = false;
      for (const def of DAILY_DEFS) {
        const current = progress[def.key] || 0;
        if (current >= def.target && !claimed.includes(def.key)) {
          const ok = await claimDailyQuestKey(userId, def.key);
          if (ok) {
            claimedAny = true;
            const freshRpg = await ensureRpg(userId);
            await updateRpg(userId, {
              xp: freshRpg.xp + def.xp,
              skill_points: (freshRpg.skill_points || 0) + def.sp,
            });
            await updateUser(userId, { balance: (user?.balance || 0) + def.reward });
            if (def.xp) await checkLevelUp(userId, freshRpg.xp + def.xp, freshRpg.level, from, sock);
            const xpLine = def.xp ? ` · ✨ +${def.xp} XP` : "";
            await sendText(from, `✅ *Daily Claimed!* — ${def.label}\n💰 +${formatNumber(def.reward)} · ⚡ +${def.sp} SP${xpLine}`);
          }
        }
      }
      if (!claimedAny) await sendText(from, "❌ No completed daily quests ready to claim yet.");
      return;
    }

    // Board display
    const rows = DAILY_DEFS.map(d => {
      const cur = Math.min(progress[d.key] || 0, d.target);
      const done = cur >= d.target;
      const isClaimed = claimed.includes(d.key);
      const icon = isClaimed ? "✅" : done ? "🎯" : cur > 0 ? "🔄" : "⬜";
      const claimHint = isClaimed ? " *(CLAIMED)*" : done ? " — *.daily claim*" : "";
      const xpLine = d.xp ? ` · ✨ ${d.xp} XP` : "";
      return `${icon} *${d.label}*\n   \`[${cur}/${d.target}]\` 💰 ${formatNumber(d.reward)} · ⚡ ${d.sp} SP${xpLine}${claimHint}`;
    });
    await sendText(from,
      `📅 *Daily Quests — ${today}*\n\n${rows.join("\n\n")}\n\n` +
      `_Resets at midnight UTC · Type_ *.daily claim* _to collect_`
    );
    return;
  }

  // ── .weekly — Weekly quest board ──────────────────────────────────────────
  if (cmd === "weekly") {
    const sub = (args[0] || "").toLowerCase();
    const doc = await getWeeklyQuestDoc(userId);
    const progress: Record<string, number> = doc?.progress || {};
    const claimed: string[] = doc?.claimed || [];
    const dObj = new Date();
    const dayOff = (dObj.getUTCDay() + 6) % 7;
    const monday = new Date(dObj.getTime() - dayOff * 86400000).toISOString().slice(0, 10);

    const WEEKLY_DEFS: { key: string; label: string; target: number; reward: number; sp: number; xp: number; item: string | null }[] = [
      { key: "quests",          label: "Complete 15 quests",           target: 15, reward: 15000, sp: 10, xp: 1000, item: null },
      { key: "dungeons",        label: "Win 5 dungeon battles",        target: 5,  reward: 20000, sp: 8,  xp: 800,  item: "Dragon Scale" },
      { key: "pvp_wins",        label: "Win 5 PvP duels",              target: 5,  reward: 10000, sp: 8,  xp: 600,  item: null },
      { key: "raids",           label: "Complete 1 raid",              target: 1,  reward: 12000, sp: 6,  xp: 500,  item: null },
      { key: "mentor_sessions", label: "🎓 Guide 5 apprentice sessions", target: 5,  reward: 8000,  sp: 5,  xp: 400,  item: null },
    ];

    if (sub === "claim") {
      let claimedAny = false;
      for (const def of WEEKLY_DEFS) {
        const current = progress[def.key] || 0;
        if (current >= def.target && !claimed.includes(def.key)) {
          const ok = await claimWeeklyQuestKey(userId, def.key);
          if (ok) {
            claimedAny = true;
            const freshRpg = await ensureRpg(userId);
            await updateRpg(userId, {
              xp: freshRpg.xp + def.xp,
              skill_points: (freshRpg.skill_points || 0) + def.sp,
            });
            await updateUser(userId, { balance: (user?.balance || 0) + def.reward });
            if (def.item) await addToInventory(userId, def.item);
            if (def.xp) await checkLevelUp(userId, freshRpg.xp + def.xp, freshRpg.level, from, sock);
            const itemLine = def.item ? ` · 🎁 ${def.item}` : "";
            await sendText(from, `✅ *Weekly Claimed!* — ${def.label}\n💰 +${formatNumber(def.reward)} · ⚡ +${def.sp} SP · ✨ +${def.xp} XP${itemLine}`);
          }
        }
      }
      if (!claimedAny) await sendText(from, "❌ No completed weekly quests ready to claim yet.");
      return;
    }

    // Board display
    const rows = WEEKLY_DEFS.map(d => {
      const cur = Math.min(progress[d.key] || 0, d.target);
      const done = cur >= d.target;
      const isClaimed = claimed.includes(d.key);
      const icon = isClaimed ? "✅" : done ? "🎯" : cur > 0 ? "🔄" : "⬜";
      const claimHint = isClaimed ? " *(CLAIMED)*" : done ? " — *.weekly claim*" : "";
      const itemLine = d.item ? ` · 🎁 ${d.item}` : "";
      return `${icon} *${d.label}*\n   \`[${cur}/${d.target}]\` 💰 ${formatNumber(d.reward)} · ⚡ ${d.sp} SP · ✨ ${d.xp} XP${itemLine}${claimHint}`;
    });
    await sendText(from,
      `📆 *Weekly Quests — Week of ${monday}*\n\n${rows.join("\n\n")}\n\n` +
      `_Resets every Monday UTC · Type_ *.weekly claim* _to collect_`
    );
    return;
  }
}

// ── Dungeon Move Processor ────────────────────────────────────────────────────
async function processDungeonMove(ctx: CommandContext, battle: DungeonBattle, rpg: any): Promise<void> {
  const { from, sender, command: cmd, sock } = ctx;
  const user = await getUser(sender);
  const userId = user?.id || sender.split("@")[0].split(":")[0].replace(/\D/g, "");
  const intFx = getIntEffects(rpg.intelligence || 0);

  if (battle.healCooldown > 0) battle.healCooldown--;
  const wasDefending = battle.defendActive;
  battle.defendActive = false;

  let resultLines: string[] = [];
  let playerDmgDealt = 0;
  let enemyDmgTaken = 0;
  let ended = false;

  if (cmd === "attack") {
    const crit = Math.random() * 100 < battle.playerCrit;
    playerDmgDealt = calcDmg(battle.playerAttack, crit ? 1.5 : 1.0);
    battle.enemyHp -= playerDmgDealt;
    resultLines.push(crit
      ? `⚡ *CRITICAL HIT!* You struck *${battle.enemyName}* for *${playerDmgDealt} damage*!`
      : `⚔️ You struck *${battle.enemyName}* for *${playerDmgDealt} damage*!`
    );
  } else if (cmd === "heavy") {
    if (!battle.playerDodge && rpg.strength < 20) {
      // low STR players may fail heavy more
    }
    const hitChance = Math.random() < (0.65 + (rpg.agility || 0) * 0.003);
    if (hitChance) {
      playerDmgDealt = calcDmg(battle.playerAttack, 1.9);
      battle.enemyHp -= playerDmgDealt;
      resultLines.push(`💥 *HEAVY HIT!* You smashed *${battle.enemyName}* for *${playerDmgDealt} damage*!`);
    } else {
      resultLines.push(`💥 Swung hard but *missed*! Off-balance...`);
      enemyDmgTaken = calcDmg(battle.enemyAttack, 1.5);
    }
  } else if (cmd === "defend") {
    playerDmgDealt = calcDmg(battle.playerAttack, 0.5);
    battle.enemyHp -= playerDmgDealt;
    battle.defendActive = true;
    resultLines.push(`🛡️ You defend and counter for *${playerDmgDealt} damage*! Blocking incoming attack...`);
  } else if (cmd === "special") {
    const isMage = rpg.class === "Mage" || rpg.class === "Necromancer";
    const mult = isMage ? 1.5 * intFx.spellMult : 1.5;
    playerDmgDealt = calcDmg(battle.playerAttack, mult);
    battle.enemyHp -= playerDmgDealt;
    resultLines.push(isMage
      ? `🌟 *Arcane Focus!* Your spell surged for *${playerDmgDealt} spell damage*! (×${intFx.spellMult.toFixed(2)} INT bonus)`
      : `🌟 *Special Attack!* You focused and dealt *${playerDmgDealt} damage*!`
    );
  } else if (cmd === "arcane") {
    if (!intFx.arcaneUnlocked) {
      await sendText(from, "❌ Arcane Blast requires 20 Intelligence. Use _.skill int_ to unlock."); return;
    }
    if (battle.mana < 30) {
      await sendText(from, `❌ Not enough mana for Arcane Blast (need 30, have ${battle.mana}).`); return;
    }
    playerDmgDealt = calcDmg(Math.floor(battle.playerAttack * intFx.spellMult), 2.5);
    battle.enemyHp -= playerDmgDealt;
    battle.mana -= 30;
    resultLines.push(`✨ *ARCANE BLAST!* A wave of void energy deals *${playerDmgDealt} damage*! (-30 MP)`);
  } else if (cmd === "heal") {
    if (battle.healCooldown > 0) {
      await sendText(from, `🧪 Heal on cooldown (${battle.healCooldown} turns left)`);
      battle.healCooldown++; return;
    }
    const palBonus = rpg.class === "Paladin" ? 1.4 : 1.0;
    const healAmt = Math.floor(battle.playerMaxHp * 0.2 * palBonus);
    battle.playerHp = Math.min(battle.playerMaxHp, battle.playerHp + healAmt);
    battle.healCooldown = 3;
    resultLines.push(`🧪 Recovered *${healAmt} HP*! (3-turn cooldown)${rpg.class === "Paladin" ? " *(Paladin bonus!)*" : ""}`);
  } else if (cmd === "item") {
    if (battle.itemUsesRemaining <= 0) {
      await sendText(from, "🎒 You've used all your item uses for this fight (2 max per battle) — fight it out or *.flee*!");
      return;
    }
    const inv = await getInventory(userId);
    const potion = (inv as any[]).find((i: any) =>
      i.item.toLowerCase().includes("potion") || i.item.toLowerCase().includes("elixir")
    );
    if (!potion) { await sendText(from, "🎒 No potions! Buy one with _.buy Health Potion_ in the shop."); return; }
    const full = potion.item.toLowerCase().includes("elixir");
    const healAmt = full ? battle.playerMaxHp - battle.playerHp : 50;
    battle.playerHp = Math.min(battle.playerMaxHp, battle.playerHp + healAmt);
    battle.itemUsesRemaining -= 1;
    await removeFromInventory(userId, potion.item);
    resultLines.push(`🎒 Used *${potion.item}* — recovered *${healAmt} HP*! (${battle.itemUsesRemaining} use${battle.itemUsesRemaining === 1 ? "" : "s"} left this fight)`);
  } else if (cmd === "flee") {
    const fleeChance = 0.45 + (rpg.agility || 0) * 0.004;
    if (Math.random() < fleeChance) {
      activeDungeonBattles.delete(sender);
      await sendText(from, "🏃 *Escaped!* No reward this time.\n\n_Use *.dungeon* to try again._"); return;
    } else {
      resultLines.push("🏃 You tried to flee but *couldn't escape*!");
    }
  } else if (cmd === "explore") {
    const lckFx = getLckEffects(rpg.luck || 0);
    const base = 50 + Math.floor(Math.random() * 150);
    const gold = Math.floor(base * lckFx.lootBonus);
    await updateUser(userId, { balance: (user?.balance || 0) + gold });
    resultLines.push(`🔍 Found *$${formatNumber(gold)}* while exploring!${lckFx.lootBonus > 1 ? " *(Lucky find!)*" : ""}`);
    enemyDmgTaken = calcDmg(battle.enemyAttack, 0.8);
  } else if (cmd === "rest") {
    const restHeal = Math.floor(battle.playerMaxHp * 0.06);
    battle.playerHp = Math.min(battle.playerMaxHp, battle.playerHp + restHeal);
    if (battle.maxMana > 0) { battle.mana = Math.min(battle.maxMana, battle.mana + 15); }
    resultLines.push(`🏕️ Rested — recovered *${restHeal} HP*${battle.maxMana ? " and *15 MP*" : ""}. Enemy grows impatient...`);
  }

  // Enemy attack phase (skip for item, flee, arcane-success)
  const enemyAttacks = cmd !== "item" && cmd !== "flee";
  if (enemyAttacks && battle.enemyHp > 0) {
    // Dodge check
    const dodged = Math.random() * 100 < battle.playerDodge;
    if (dodged) {
      resultLines.push(`💨 *Dodged* ${battle.enemyName}'s attack!`);
    } else {
      const defendMult = battle.defendActive ? 0.35 : (cmd === "heavy" && resultLines[0]?.includes("missed")) ? 1.5 : 1.0;
      const dmg = enemyDmgTaken || calcDmg(battle.enemyAttack - Math.floor(battle.playerDefense * 0.3), defendMult);
      const berserkerRage = rpg.class === "Berserker" && battle.playerHp < battle.playerMaxHp * 0.3;
      battle.playerHp -= dmg;
      resultLines.push(`👾 *${battle.enemyName}* hits you for *${dmg} damage*!${berserkerRage ? " _(Berserker Rage building!)_" : ""}`);
    }
  }

  // Get fresh RPG data for updates
  const rpgFresh = await ensureRpg(userId);

  // Victory check
  if (battle.enemyHp <= 0) {
    const rawXp = battle.floor * 80;
    const xp = applyXpModifiers(rawXp, rpgFresh.level, battle.floor, user?.xp_boost_until);
    const lckFx = getLckEffects(rpg.luck || 0);
    const baseReward = battle.enemyReward;
    const reward = Math.floor(baseReward * lckFx.lootBonus);
    const newFloor = battle.floor + 1;
    const hpAfter = Math.max(1, battle.playerHp);
    const skillPts = Math.max(1, Math.floor(battle.floor / 2));
    const berserkerBonus = rpg.class === "Berserker" && battle.playerHp < battle.playerMaxHp * 0.3 ? Math.floor(xp * 0.2) : 0;

    // ── Dungeon loot drops ─────────────────────────────────────────────────
    // Flat loot table — each entry has a base drop chance and a coin value
    // shown in the victory message so players know what they earned.
    // Luck boosts the drop chance (not the value), so high-LCK builds get
    // more frequent drops rather than just bigger gold rewards.
    const DUNGEON_LOOT: { item: string; value: number; baseChance: number }[] = [
      { item: "Ancient Coin",     value: 1500,  baseChance: 0.55 },
      { item: "Mystic Shard",     value: 4500,  baseChance: 0.30 },
      { item: "Dragon Scale",     value: 12000, baseChance: 0.12 },
      { item: "Void Crystal",     value: 35000, baseChance: 0.04 },
      { item: "Abyssal Relic",    value: 90000, baseChance: 0.01 },
    ];
    // Each floor cleared gives one roll against the whole table; higher
    // floors give a floor bonus to all drop chances (small, so it stays
    // rare even at floor 50).
    const floorBonus = Math.min(0.20, (battle.floor - 1) * 0.005);
    const lootDrop = DUNGEON_LOOT.find(
      (l) => Math.random() < (l.baseChance + floorBonus) * lckFx.lootBonus
    );

    await updateRpg(userId, {
      dungeon_floor: newFloor,
      hp: hpAfter,
      mana: battle.mana,
      xp: rpgFresh.xp + xp + berserkerBonus,
      skill_points: (rpgFresh.skill_points || 0) + skillPts,
    });
    await updateUser(userId, { balance: (user?.balance || 0) + reward + (lootDrop?.value ?? 0) });
    await addToInventory(userId, "Dungeon Key");
    if (lootDrop) await addToInventory(userId, lootDrop.item);
    await checkLevelUp(userId, rpgFresh.xp + xp + berserkerBonus, rpgFresh.level, from, sock);
    // Mentorship — mentor earns +1 SP + 80 XP when apprentice clears a floor
    await applyMentorshipBonus(userId, "dungeon", 0, from, sock);
    // Daily / weekly dungeon progress tracking
    await Promise.all([
      incrementDailyProgress(userId, "dungeons"),
      incrementWeeklyProgress(userId, "dungeons"),
    ]);
    activeDungeonBattles.delete(sender);

    await addWorldHistory({
      title: `cleared Floor ${battle.floor} (defeated ${battle.enemyName})`,
      actor: userId, actor_name: userId, group_id: from, category: "dungeon",
    }).catch(() => {});

    // Dungeon achievements
    if (battle.floor >= 1)  await checkAndGrant(userId, "dungeon_1", from, sock);
    if (battle.floor >= 5)  await checkAndGrant(userId, "dungeon_5", from, sock);
    if (battle.floor >= 10) await checkAndGrant(userId, "dungeon_10", from, sock);
    if (battle.floor >= 25) await checkAndGrant(userId, "dungeon_25", from, sock);

    const lootLine = lootDrop
      ? `🎁 Loot drop: *${lootDrop.item}* (+${formatNumber(lootDrop.value)})${lckFx.lootBonus > 1 ? " *(Lucky find!)*" : ""}\n`
      : "";
    const totalEarned = reward + (lootDrop?.value ?? 0);
    const victoryMsg =
      resultLines.join("\n") + "\n\n" +
      `🏆 *VICTORY!* You defeated *${battle.enemyName}*!\n\n` +
      `💰 Reward: ${formatNumber(reward)}${lckFx.lootBonus > 1 ? " *(Luck!)*" : ""}\n` +
      lootLine +
      (lootDrop ? `💵 Total earned: *${formatNumber(totalEarned)}*\n` : "") +
      `✨ XP: +${xp + berserkerBonus}${berserkerBonus ? " *(Berserker Rage bonus!)*" : ""}\n` +
      `⚡ Skill Points: +${skillPts}\n` +
      `🗝️ Dungeon Key obtained!\n` +
      `🏰 Next floor: *Floor ${newFloor}*\n\n` +
      `_Use *.dungeon* to continue._`;
    await sendText(from, victoryMsg);
    return;
  }

  // Defeat check
  if (battle.playerHp <= 0) {
    // Resurrection Stone: if the player owns one, it's auto-consumed here
    // to save them instead of a normal defeat — revives with 50% max HP
    // and lets the fight continue. Previously this item did nothing when
    // bought; "revives you in battle with 50% HP" was pure flavor text.
    const stoneEntry = (await getInventory(userId)).find((i: any) => i.item.toLowerCase() === "resurrection stone");
    if (stoneEntry) {
      await removeFromInventory(userId, stoneEntry.item);
      battle.playerHp = Math.floor(battle.playerMaxHp * 0.5);
      resultLines.push(`💠 *Resurrection Stone* shatters and pulls you back from defeat! HP restored to ${battle.playerHp}/${battle.playerMaxHp}.`);
      await updateRpg(userId, { hp: Math.max(1, battle.playerHp), mana: battle.mana });
      const header = resultLines.join("\n");
      await sendText(from, dungeonBattleDisplay(battle, rpgFresh.level, header));
      return;
    }
    await updateRpg(userId, { hp: 1, mana: battle.mana });
    activeDungeonBattles.delete(sender);
    const defeatMsg =
      resultLines.join("\n") + "\n\n" +
      `💀 *DEFEATED!* *${battle.enemyName}* overcame you...\n\n` +
      `❤️ HP reduced to 1\n🏰 Floor ${battle.floor} — try again!\n\n` +
      `_Use *.heal* then *.dungeon* to re-enter._`;
    await sendText(from, defeatMsg);
    return;
  }

  // Sync mid-battle state
  await updateRpg(userId, { hp: Math.max(1, battle.playerHp), mana: battle.mana });
  const header = resultLines.join("\n");
  await sendText(from, dungeonBattleDisplay(battle, rpgFresh.level, header));
}

// ── Level Up ──────────────────────────────────────────────────────────────────
async function checkLevelUp(userId: string, xp: number, currentLevel: number, from?: string, sock?: any): Promise<void> {
  let level = currentLevel;
  let remainingXp = xp;
  let skillPointsGained = 0;
  // Cascade — a single large XP grant (mentorship bonus, big quest, etc.)
  // can cross more than one level threshold at once. The old version only
  // ever checked a single level-up per call, silently dropping any XP
  // beyond the very next threshold instead of continuing to level up.
  while (remainingXp >= xpNeededForLevel(level)) {
    remainingXp -= xpNeededForLevel(level);
    level += 1;
    skillPointsGained += 2;
  }
  if (level > currentLevel) {
    // Add to the player's EXISTING skill points rather than overwriting —
    // the previous version set skill_points to just the newly-gained
    // amount, silently wiping out any unspent points from earlier levels
    // (pre-existing bug, unrelated to the XP curve change above; caught
    // while touching this function because the correct additive pattern
    // is already used elsewhere in this file, e.g. the dungeon-clear path).
    const current = await ensureRpg(userId);
    const newTotal = (current.skill_points || 0) + skillPointsGained;
    await updateRpg(userId, { level, xp: remainingXp, skill_points: newTotal });
    if (from) {
      const jump = level - currentLevel > 1 ? ` (+${level - currentLevel} levels!)` : "";
      await sendText(from, `🌟 *LEVEL UP!*\n\n${userId} reached *Level ${level}*${jump}!\n⚡ +${skillPointsGained} Skill Points awarded!`).catch(() => {});
    }
    if (level >= 20 && from) await checkAndGrant(userId, "level_20", from, sock);
    if (level >= 50 && from) await checkAndGrant(userId, "level_50", from, sock);
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────
function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}
