import type { CommandContext } from "./index.js";
import { sendText } from "../connection.js";
import { getUser, ensureUser, updateUser, incrementAndSetUserFields, getRpg } from "../db/queries.js";
import { formatNumber, coinFlip, rollDice, spin, checkSlotWin, getRouletteColor } from "../utils.js";
import type { WASocket } from "@whiskeysockets/baileys";

// ── Per-command cooldowns (seconds) — single source of truth, also used by .cds ──
export const CMD_COOLDOWNS: Record<string, number> = {
  slots: 300, dice: 120, coinflip: 120, cf: 120,
  casino: 420, doublebet: 240, db: 240, doublepayout: 300, dp: 300,
  roulette: 300, horse: 240, spin: 180,
};

// ── House edge — 3% deducted from gross winnings on all games ───────────────
// Applied only on wins (losses are full). Gives ~1.5% house advantage on
// symmetric (50/50) games, preventing infinite-money exploits over time.
const HOUSE_EDGE = 0.03;

// PROGRESSIVE WEALTH TAX (2026-07-20): an additional edge applied only to
// players above the intended economy ceiling (~300k = "rich" per the
// stated economy design). This is deliberately separate from HOUSE_EDGE
// so the base game odds stay identical for every player below the
// threshold — only players who are already comfortably rich pay more,
// and the tax scales up further the richer they are. Applied on WINS
// only (a losing bet already costs the player money; taxing losses too
// would be a double penalty). Thresholds are balance-at-time-of-bet, not
// balance-after-win, so this reads from the `user` object already fetched
// at the top of the command — no extra DB round trip.
const WEALTH_TAX_BRACKETS: Array<{ min: number; extraEdge: number }> = [
  { min: 1_000_000, extraEdge: 0.20 }, // very rich: heavy extra tax
  { min: 500_000, extraEdge: 0.12 },
  { min: 300_000, extraEdge: 0.06 },   // at/above the stated "rich" ceiling
];

function wealthTaxEdge(balance: number): number {
  for (const bracket of WEALTH_TAX_BRACKETS) {
    if (balance >= bracket.min) return bracket.extraEdge;
  }
  return 0;
}

/** Applies both the flat house edge and, if applicable, the progressive
 * wealth tax on top — replaces the plain applyEdge() for any WIN payout.
 * Losses are unaffected (see comment above). */
function applyEdgeWithWealthTax(grossWin: number, currentBalance: number): number {
  const extra = wealthTaxEdge(currentBalance);
  if (extra === 0) return applyEdge(grossWin);
  return Math.floor(grossWin * (1 - HOUSE_EDGE - extra));
}
function applyEdge(grossWin: number): number {
  return Math.floor(grossWin * (1 - HOUSE_EDGE));
}

/** Returns the remaining cooldown seconds (0 = ready). */
function getCooldownRemaining(user: any, cmdLabel: string, cdSecs: number): number {
  const lastKey = `last_${cmdLabel}`;
  const lastSecs = normalizeToSeconds(user[lastKey]);
  const nowSecs = Math.floor(Date.now() / 1000);
  const diff = nowSecs - lastSecs;
  return Math.max(0, cdSecs - diff);
}

// Defensive normalizer: any last_* value stored before the ms→seconds fix
// above will still be sitting in the DB as a ~13-digit millisecond epoch.
// A seconds-epoch "now" is currently ~10 digits — treat anything with
// more digits than that as milliseconds and convert it, so old records
// self-heal on next read instead of producing a nonsense cooldown forever.
function normalizeToSeconds(value: any): number {
  const n = Number(value || 0);
  if (n === 0) return 0;
  return n > 100_000_000_000 ? Math.floor(n / 1000) : n;
}

/** Format a duration for display. */
function fmtDur(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60), s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// ── Horse configuration — true RNG odds ──────────────────────────────────────
// Win probabilities tuned upward (Jul 2026) for a more rewarding player experience.
const HORSES = [
  { name: "Thunder", emoji: "🐎", odds: 1.8,  winProb: 0.36, maxAdv: 5, minAdv: 2 },
  { name: "Storm",   emoji: "🏇", odds: 2.5,  winProb: 0.27, maxAdv: 4, minAdv: 2 },
  { name: "Eclipse", emoji: "🦄", odds: 3.5,  winProb: 0.22, maxAdv: 4, minAdv: 1 },
  { name: "Shadow",  emoji: "🐴", odds: 5.0,  winProb: 0.17, maxAdv: 3, minAdv: 1 },
  { name: "Blaze",   emoji: "🌪️", odds: 7.0,  winProb: 0.13, maxAdv: 3, minAdv: 1 },
  { name: "Phantom", emoji: "👻", odds: 12.0, winProb: 0.09, maxAdv: 2, minAdv: 1 },
] as const;
const TRACK_LEN = 12;
const TICKS = 15;

export async function handleGambling(ctx: CommandContext): Promise<void> {
  const { from, sender, args, command: cmd, sock } = ctx;

  // ── Per-group gambling toggle ─────────────────────────────────────────────
  // Admins/mods can disable gambling in a group with .gamble off.
  // When disabled, redirect users with a helpful message.
  if (from.endsWith("@g.us")) {
    const { getGroup } = await import("../db/queries.js");
    const group = await getGroup(from);
    if ((group?.gambling_enabled || "on") === "off") {
      const redirectLink = (group as any)?.gambling_redirect;
      if (redirectLink) {
        await sendText(from, `🎰 Gambling is *disabled* in this group.\n\n📌 Head to the gambling group: ${redirectLink}`);
      } else {
        await sendText(from, `🎰 Gambling commands are *disabled* in this group.\n\n_A mod can re-enable with *.gamble on*_`);
      }
      return;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const user = await ensureUser(sender);

  // ── Per-command cooldown check ─────────────────────────────────────────────
  const cmdLabel = resolveLabel(cmd);
  const cdSecs = CMD_COOLDOWNS[cmd] ?? CMD_COOLDOWNS[cmdLabel];
  if (cdSecs) {
    const remaining = getCooldownRemaining(user, cmdLabel, cdSecs);
    if (remaining > 0) {
      await sendText(from, `⏳ *${cmdLabel.charAt(0).toUpperCase() + cmdLabel.slice(1)}* cooldown: *${fmtDur(remaining)}* left.`);
      return;
    }
  }

  const limit = await checkGamblingAccess(from, sender, user, cmd);
  if (!limit.allowed) return;

  if (cmd === "slots") {
    const amount = parseAmount(args[0], user.balance);
    if (!(await checkBet(from, user, amount, "slots"))) return;
    if (amount === null) return; // unreachable — narrows type for TS
    const result = spin();
    const multiplier = checkSlotWin(result);
    const slots = result.split(" | ");
    const SYMBOLS = ["🍒","🍋","🍊","🍇","⭐","💎","7️⃣"];
    const randSym = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

    const spinningMsg = await sock.sendMessage(from, { text: `🎰 *SPINNING...*\n\n⟦ 🎰 ⟧  ⟦ 🎰 ⟧  ⟦ 🎰 ⟧` });
    for (let i = 0; i < 8; i++) {
      await sleep(300);
      if (spinningMsg?.key) {
        await sock.sendMessage(from, {
          text: `🎰 *SPINNING...*\n\n${[randSym(), randSym(), randSym()].map((s) => `⟦ ${s} ⟧`).join("  ")}`,
          edit: spinningMsg.key,
        });
      }
    }

    const resultRow = slots.map((s) => `⟦ ${s} ⟧`).join("  ");
    const reelRow = () => [randSym(), randSym(), randSym()].map((s) => `⟦ ${s} ⟧`).join("  ");
    let winnings = 0;
    let outcome = "";
    if (multiplier === 3) { winnings = applyEdgeWithWealthTax(amount * 3, user.balance || 0); outcome = `🎉 JACKPOT! +${formatNumber(winnings)} (3x)`; }
    else if (multiplier === 2) { winnings = applyEdgeWithWealthTax(amount * 2, user.balance || 0); outcome = `✨ Double Win! +${formatNumber(winnings)} (2x)`; }
    else { winnings = -amount; outcome = `😭 No match. -${formatNumber(amount)}`; }
    {
      const { inc, set } = gambleUpdate(limit, winnings);
      await incrementAndSetUserFields(sender, inc, set);
    }
    const msg =
      `╭─❰ 🎰 𝐒𝐋𝐎𝐓 𝐌𝐀𝐂𝐇𝐈𝐍𝐄 ❱─╮\n│\n│  ${reelRow()}\n│  ${reelRow()}\n│━━━━━━━━━━━━━━━━━━━━━\n│▶ ${resultRow} ◀\n│━━━━━━━━━━━━━━━━━━━━━\n│  ${reelRow()}\n│  ${reelRow()}\n│\n│  🎲 ʙᴇᴛ: $${formatNumber(amount)}\n│  ✨ ᴏᴜᴛᴄᴏᴍᴇ: ${outcome}\n│  💰 ʙᴀʟᴀɴᴄᴇ: $${formatNumber((user.balance || 0) + winnings)}\n╰──────────────────────╯`;
    if (spinningMsg?.key) {
      await sock.sendMessage(from, { text: msg, edit: spinningMsg.key });
    } else {
      await sendText(from, msg);
    }
    return;
  }

  if (cmd === "dice") {
    const amount = parseAmount(args[0], user.balance);
    if (!(await checkBet(from, user, amount, "dice"))) return;
    if (amount === null) return;
    const roll = rollDice();
    const win = roll >= 4;
    const winnings = win ? applyEdgeWithWealthTax(amount, user.balance || 0) : -amount;
    {
      const { inc, set } = gambleUpdate(limit, winnings, win);
      await incrementAndSetUserFields(sender, inc, set);
    }
    await sendText(from,
      `🎲 Rolled: *${roll}* ${["⚀","⚁","⚂","⚃","⚄","⚅"][roll-1]}\n` +
      `${win ? `🎉 Win! +${formatNumber(winnings)}` : `😭 Lose. -${formatNumber(amount)}`}\n` +
      `Balance: ${formatNumber((user.balance || 0) + winnings)}`
    );
    return;
  }

  if (cmd === "coinflip" || cmd === "cf") {
    const choice = args[0]?.toLowerCase();
    const amount = parseAmount(args[1] || args[0], user.balance);
    if (!choice || !["h","t","heads","tails"].includes(choice)) { await sendText(from, "❌ Usage: .cf [h/t] [amount]"); return; }
    if (!(await checkBet(from, user, amount, "cf"))) return;
    if (amount === null) return;
    const result = coinFlip();
    const userPick = choice === "h" || choice === "heads" ? "heads" : "tails";
    // Streak-adjusted: losing-streak players get a slight edge toward winning
    const win = streakWin(limit.streak, 0.54) ? userPick === result : userPick !== result;
    const winnings = win ? applyEdgeWithWealthTax(amount, user.balance || 0) : -amount;
    {
      const { inc, set } = gambleUpdate(limit, winnings, win);
      await incrementAndSetUserFields(sender, inc, set);
    }
    await sendText(from,
      `🪙 Coin flip result: *${result === "heads" ? "Heads" : "Tails"}*!\n` +
      (win ? `You won ${formatNumber(winnings)}` : `You lost ${formatNumber(amount)}`) +
      `\nBalance: ${formatNumber((user.balance || 0) + winnings)}`
    );
    return;
  }

  if (cmd === "casino") {
    const amount = parseAmount(args[0], user.balance);
    if (!(await checkBet(from, user, amount, "casino"))) return;
    if (amount === null) return;
    const win = streakWin(limit.streak, 0.50);
    const winnings = win ? applyEdgeWithWealthTax(amount, user.balance || 0) : -amount;
    {
      const { inc, set } = gambleUpdate(limit, winnings, win);
      await incrementAndSetUserFields(sender, inc, set);
    }
    await sendText(from,
      `Outcome: ${win ? "Win" : "Lose"}! 💰You won ${win ? `${formatNumber(winnings)} coins.` : `nothing.`}\nBalance: ${formatNumber((user.balance || 0) + winnings)}`
    );
    return;
  }

  if (cmd === "doublebet" || cmd === "db") {
    const amount = parseAmount(args[0], user.balance);
    if (!(await checkBet(from, user, amount, "doublebet"))) return;
    if (amount === null) return;
    const win = streakWin(limit.streak, 0.50);
    const winnings = win ? applyEdgeWithWealthTax(amount, user.balance || 0) : -amount;
    {
      const { inc, set } = gambleUpdate(limit, winnings, win);
      await incrementAndSetUserFields(sender, inc, set);
    }
    await sendText(from,
      `╭─❰ 🎲 ᴅᴏᴜʙʟᴇ ʙᴇᴛ ❱─╮\n│\n│  🎰 Result: ${win ? "🎯 𝗪𝗜𝗡" : "💀 𝗟𝗢𝗦𝗘"}\n│  💰 Amount: ${formatNumber(amount)}\n│  ✨ Outcome: ${win ? `+${formatNumber(winnings)}` : `-${formatNumber(amount)}`}\n│  🏦 Balance: ${formatNumber((user.balance || 0) + winnings)}\n╰──────────────╯`
    );
    return;
  }

  if (cmd === "doublepayout" || cmd === "dp") {
    const amount = parseAmount(args[0], user.balance);
    if (!(await checkBet(from, user, amount, "doublepayout"))) return;
    if (amount === null) return;
    const win = streakWin(limit.streak, 0.46);
    const payout = win ? applyEdgeWithWealthTax(amount * 3, user.balance || 0) : -amount;
    {
      const { inc, set } = gambleUpdate(limit, payout, win);
      await incrementAndSetUserFields(sender, inc, set);
    }
    await sendText(from, win ? `🎰 Triple payout! +${formatNumber(payout)}` : `😭 Lost. -${formatNumber(amount)}`);
    return;
  }

  if (cmd === "roulette") {
    const color = args[0]?.toLowerCase();
    const amount = parseAmount(args[1], user.balance);
    if (!["red","black","green"].includes(color)) { await sendText(from, "❌ Usage: .roulette [red/black/green] [amount]"); return; }
    if (!(await checkBet(from, user, amount, "roulette"))) return;
    if (amount === null) return;
    const num = Math.floor(Math.random() * 37);
    const result = getRouletteColor(num);
    const win = result === color;
    const multiplier = color === "green" ? 14 : 2;
    const winnings = win ? applyEdgeWithWealthTax(amount * multiplier, user.balance || 0) : -amount;
    {
      const { inc, set } = gambleUpdate(limit, winnings);
      await incrementAndSetUserFields(sender, inc, set);
    }
    await sendText(from,
      `🎡 Ball landed on *${num}* (${result})\n` +
      `${win ? `🎉 You picked ${color} — win! +${formatNumber(winnings)}` : `😭 You picked ${color} — lose. -${formatNumber(amount)}`}\n` +
      `Balance: ${formatNumber((user.balance || 0) + winnings)}`
    );
    return;
  }

  // ── Horse Racing — real-time animated, proper RNG odds ────────────────────
  if (cmd === "horse") {
    // Parse args: .horse <name|number> <amount>
    if (!args[0]) {
      const list = HORSES.map((h, i) => `${i+1}. ${h.emoji} ${h.name.padEnd(8)} odds: ${h.odds}x`).join("\n");
      await sendText(from,
        `🏇 *HORSE RACING*\n\n` +
        `Pick a horse and bet!\nUsage: *.horse <name or number> <amount>*\n\nExample: *.horse Thunder 500*\n\n` +
        list + `\n\n_Higher odds = bigger payout = less likely to win_`
      );
      return;
    }

    // Resolve horse pick (by name or number)
    const raw = args[0].toLowerCase();
    let horseIdx = -1;
    const byNum = parseInt(raw);
    if (!isNaN(byNum) && byNum >= 1 && byNum <= HORSES.length) {
      horseIdx = byNum - 1;
    } else {
      horseIdx = HORSES.findIndex(h => h.name.toLowerCase() === raw || h.name.toLowerCase().startsWith(raw));
    }
    if (horseIdx < 0) {
      await sendText(from, `❌ Unknown horse. Choose: ${HORSES.map((h,i)=>`${i+1}.${h.name}`).join(", ")}`);
      return;
    }

    const amount = parseAmount(args[1] || args[0], user.balance);
    if (!(await checkBet(from, user, amount, "horse <name>"))) return;
    if (amount === null) return;

    const pick = HORSES[horseIdx];

    // Apply Luck bonus from RPG (if user has an RPG character)
    const rpgChar = await getRpg(sender.split("@")[0].split(":")[0]);
    const luckBonus = rpgChar ? rpgChar.luck * 0.003 : 0; // +0.3% win probability per LCK point

    // Select winner via weighted RNG (odds-based), with Luck nudging the player's horse
    const winnerIdx = selectHorseWinner(horseIdx, luckBonus);
    const winner = HORSES[winnerIdx];

    // ── Animate race ───────────────────────────────────────────────────────
    const pos = [0, 0, 0, 0, 0, 0];

    const raceMsg = await sock.sendMessage(from, {
      text: buildHorseFrame(pos, horseIdx, -1, pick.odds, amount),
    });

    for (let tick = 0; tick < TICKS; tick++) {
      await sleep(700);
      for (let i = 0; i < HORSES.length; i++) {
        const h = HORSES[i];
        let adv = h.minAdv + Math.floor(Math.random() * (h.maxAdv - h.minAdv + 1));
        // In final 4 ticks give winner a consistent small boost
        if (tick >= TICKS - 4 && i === winnerIdx) adv += 1;
        pos[i] = Math.min(TRACK_LEN, pos[i] + adv);
      }
      if (raceMsg?.key) {
        await sock.sendMessage(from, {
          text: buildHorseFrame(pos, horseIdx, -1, pick.odds, amount),
          edit: raceMsg.key,
        });
      }
    }
    // Guarantee winner finishes
    pos[winnerIdx] = TRACK_LEN;

    const win = winnerIdx === horseIdx;
    const winnings = win ? applyEdgeWithWealthTax(Math.floor(amount * pick.odds), user.balance || 0) - amount : -amount;
    const newBalance = (user.balance || 0) + winnings;
    {
      const { inc, set } = gambleUpdate(limit, winnings);
      await incrementAndSetUserFields(sender, inc, set);
    }

    const finalFrame = buildHorseFrame(pos, horseIdx, winnerIdx, pick.odds, amount);
    const finalMsg =
      finalFrame +
      `\n\n🏆 *${winner.emoji} ${winner.name}* crosses the finish line!` +
      `\n\n${win
        ? `🎉 *You won!* +$${formatNumber(Math.floor(amount * pick.odds))} (${pick.odds}x)`
        : `😭 *${pick.emoji} ${pick.name}* didn't make it. -$${formatNumber(amount)}`}` +
      `\n💰 Balance: $${formatNumber(newBalance)}`;

    if (raceMsg?.key) {
      await sock.sendMessage(from, { text: finalMsg, edit: raceMsg.key });
    } else {
      await sendText(from, finalMsg);
    }
    return;
  }

  if (cmd === "spin") {
    const amount = parseAmount(args[0], user.balance);
    if (!(await checkBet(from, user, amount, "spin"))) return;
    if (amount === null) return;
    const outcomes = [
      { label: "💰 2x", multi: 2, chance: 0.2 },
      { label: "💸 1.5x", multi: 1.5, chance: 0.25 },
      { label: "❌ 0x", multi: 0, chance: 0.35 },
      { label: "💥 3x", multi: 3, chance: 0.1 },
      { label: "☠️ -0.5x", multi: -0.5, chance: 0.1 },
    ];
    let rand = Math.random();
    let outcome = outcomes[outcomes.length - 1];
    for (const o of outcomes) { if (rand < o.chance) { outcome = o; break; } rand -= o.chance; }
    const grossWon = Math.floor(amount * outcome.multi);
    const won = outcome.multi > 1 ? applyEdgeWithWealthTax(grossWon, user.balance || 0) : grossWon;
    const diff = won - amount;
    {
      const { inc, set } = gambleUpdate(limit, diff);
      await incrementAndSetUserFields(sender, inc, set);
    }
    await sendText(from,
      `🌀 Spin result: *${outcome.label}*\n${diff >= 0 ? `+$${formatNumber(diff)}` : `-$${formatNumber(-diff)}`}\nBalance: $${formatNumber((user.balance || 0) + diff)}`
    );
    return;
  }
}

// ── Horse winner selection (RNG with odds + luck bonus) ──────────────────────
function selectHorseWinner(playerPick: number, luckBonus: number): number {
  const probs = HORSES.map((h, i) => {
    let p = h.winProb;
    if (i === playerPick) p = Math.min(p + luckBonus, p * 1.3);
    return p;
  });
  const total = probs.reduce((a, b) => a + b, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < probs.length; i++) {
    rand -= probs[i];
    if (rand <= 0) return i;
  }
  return HORSES.length - 1;
}

// ── Race frame renderer ───────────────────────────────────────────────────────
function buildHorseFrame(pos: number[], pick: number, winner: number, odds: number, amount: number): string {
  const lines = pos.map((p, i) => {
    const h = HORSES[i];
    const filled = "─".repeat(p);
    const empty = "─".repeat(Math.max(0, TRACK_LEN - p));
    const track = `${filled}${h.emoji}${empty}`;
    const myTag = i === pick ? "◀" : "";
    const winTag = winner >= 0 && i === winner ? "🏆" : "";
    return `${(i + 1)}.${h.name.slice(0,6).padEnd(6)}|${track}|${myTag}${winTag}`;
  });
  const header = `🏇 *HORSE RACE*\nPick:${HORSES[pick].emoji}${HORSES[pick].name}(${odds}x) $${formatNumber(amount)}\n\n`;
  return header + lines.join("\n");
}

// ── Utilities ────────────────────────────────────────────────────────────────
/**
 * Parses a bet amount. Returns null if none was given or it couldn't be
 * parsed as a valid positive number — callers MUST treat null as "ask the
 * player to specify an amount and stop", not fall back to a default bet.
 * Previously this silently defaulted to $100 for a missing/garbage amount
 * (bare ".slots", ".slots banana", a typo'd number), which placed a real
 * bet — burning the player's cooldown and daily gambling-limit count — for
 * an amount they never actually specified.
 */
function parseAmount(raw: string | undefined, balance: number): number | null {
  if (!raw) return null;
  if (raw === "all" || raw === "max") return Math.min(balance, 100000);
  if (raw === "half") return Math.floor(balance / 2);
  const n = parseInt(raw.replace(/,/g, ""));
  return isNaN(n) || n <= 0 ? null : n;
}

/** Shared "you must specify a bet amount" message + usage hint. */
async function requireAmountMessage(from: string, cmdLabel: string, example: string): Promise<void> {
  await sendText(from, `❌ Specify an amount to bet.\n\nUsage: *.${cmdLabel} ${example}*\n_(or "all", "half", "max")_`);
}

async function checkBet(from: string, user: any, amount: number | null, cmdLabel?: string): Promise<boolean> {
  if (amount === null) {
    await sendText(from, `❌ Specify an amount to bet.\n\nUsage: *.${cmdLabel || "slots"} <amount>*\n_(or "all", "half", "max")_`);
    return false;
  }
  if (amount < 50) { await sendText(from, "❌ Minimum bet is $50."); return false; }
  if ((user.balance || 0) < amount) { await sendText(from, `❌ Not enough coins. Balance: $${formatNumber(user.balance || 0)}`); return false; }
  return true;
}

async function checkGamblingAccess(from: string, sender: string, user: any, cmd: string): Promise<any> {
  const label = resolveLabel(cmd);
  const day = new Date().toISOString().split("T")[0];
  const field = `gamble_${label}_date`;
  const countField = `gamble_${label}_count`;
  const DAILY_LIMIT = 20;

  const count = user[field] === day ? (user[countField] || 0) : 0;
  if (count >= DAILY_LIMIT) {
    await sendText(from, `🎲 Daily ${label} limit reached (${DAILY_LIMIT}/day). Come back tomorrow!`);
    return { allowed: false };
  }
  const streak = Number(user.gambling_streak || 0);
  return { allowed: true, now: day, day, count, field: countField, dateField: field, label, streak };
}

// Streak-adjusted RNG — players on a losing streak of 3+ get a small win
// probability boost (up to +8%) to prevent demoralising death-spiral sessions.
// Players on a winning streak do NOT get a penalty — wins are unaffected.
function streakWin(streak: number, baseProb: number): boolean {
  const boost = streak <= -3 ? Math.min(0.08, Math.abs(streak) * 0.02) : 0;
  return Math.random() < (baseProb + boost);
}

/** Returns { inc, set } for use with incrementAndSetUserFields — see that
 * function's doc comment for why balance and bookkeeping fields need to
 * land in one atomic operation rather than a read-modify-write.
 * `balanceChange` is the signed delta (positive for a win, negative for
 * a loss) rather than a precomputed new balance, so it can go through
 * $inc directly instead of being computed from a possibly-stale read. */
function gambleUpdate(limit: any, balanceChange: number, won?: boolean): { inc: Record<string, number>; set: Record<string, any> } {
  const inc: Record<string, number> = { balance: balanceChange };
  if (!limit?.field) return { inc, set: {} };
  const nowSecs = Math.floor(Date.now() / 1000);
  const set: Record<string, any> = {
    [limit.dateField]: limit.day,
    last_gamble: nowSecs,
    // Record per-command last-used timestamp (read by .cds and cooldown check)
    [`last_${limit.label}`]: nowSecs,
  };
  // Daily gamble count is itself a simple counter — genuinely safe (and
  // more correct under concurrency) as an $inc rather than a computed set.
  inc[limit.field] = 1;
  if (won !== undefined) {
    const cur = Number(limit.streak || 0);
    // Positive streak = consecutive wins, negative = consecutive losses.
    // Streak resets/direction-flips still need a computed value (not a
    // pure increment), so this stays a $set — the rare race window here
    // (two concurrent gambles both reading the same stale streak) only
    // affects the cosmetic streak-boost display, not real currency, so
    // it's an acceptable tradeoff versus the complexity of an atomic
    // streak state machine.
    set.gambling_streak = won
      ? (cur <= 0 ? 1 : cur + 1)
      : (cur >= 0 ? -1 : cur - 1);
  }
  return { inc, set };
}

function resolveLabel(cmd: string): string {
  if (cmd === "cf") return "coinflip";
  if (cmd === "db") return "doublebet";
  if (cmd === "dp") return "doublepayout";
  return cmd;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
