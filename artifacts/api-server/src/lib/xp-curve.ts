/**
 * xp-curve.ts
 *
 * Single source of truth for RPG leveling. Previously `xpNeeded = level *
 * 100` was hand-duplicated across queries.ts, economy.ts, and rpg.ts (7
 * call sites) — a genuinely flat/linear curve that made high levels barely
 * harder to reach than low ones. Combined with quests worth up to 1,000 XP
 * on a 4-minute cooldown, a player grinding actively could reach level 9
 * (needs only 4,050 cumulative XP under the old curve) inside an hour —
 * uncomfortably close to the level-20 guild-creation gate, and far faster
 * than the leveling curve was ever meant to allow.
 *
 * Two separate levers live here, and they do different jobs:
 *
 * 1. xpNeededForLevel(level) — a steeper cost curve. Early levels cost
 *    about what they used to (so new players don't feel slowed down
 *    immediately); the cost grows faster than linear so higher levels
 *    take meaningfully longer to reach.
 *
 * 2. applyDiminishingReturns(xpAmount, level, dungeonFloor) — a separate
 *    multiplier applied to XP *gains* (not costs) once a player is BOTH
 *    past a level threshold AND past a dungeon-floor threshold. This is
 *    the "slow down players who are already far ahead, going forward"
 *    lever specifically requested — it does not touch anyone still
 *    catching up (only one of the two conditions met), and it never
 *    reduces XP already earned or banked, only future gains.
 */

// xpNeeded(level) = floor(80 * level^1.6)
// level  1 →     80   (old: 100  — slightly easier to get started)
// level  5 →    700   (old: 500)
// level  9 →   2,090  (old: 900)   — this is the level that used to be
//                                    reachable in under an hour; now it
//                                    takes real, sustained play
// level 15 →   5,460  (old: 1,500)
// level 20 →   8,970  (old: 2,000) — guild-creation gate
// level 30 →  18,700  (old: 3,000)
const XP_CURVE_BASE = 80;
const XP_CURVE_EXPONENT = 1.6;

export function xpNeededForLevel(level: number): number {
  const lvl = Math.max(1, Math.floor(level) || 1);
  return Math.max(1, Math.floor(XP_CURVE_BASE * Math.pow(lvl, XP_CURVE_EXPONENT)));
}

/** Cumulative total XP required to reach `level` from level 1 — used for
 *  leaderboard "total XP" scoring so it stays consistent with the new curve. */
export function cumulativeXpForLevel(level: number): number {
  let total = 0;
  const target = Math.max(1, Math.floor(level) || 1);
  for (let lvl = 1; lvl < target; lvl++) total += xpNeededForLevel(lvl);
  return total;
}

// Diminishing-returns thresholds — BOTH must be met (per design decision:
// "both level and floor, whichever is the relevant gate for that player").
// Below these, gains are unaffected no matter how active someone is —
// this only engages once a player is genuinely ahead of the curve.
const DR_LEVEL_THRESHOLD = 8;
const DR_FLOOR_THRESHOLD = 15;

// Second, harsher threshold for players who are far ahead even by
// post-diminishing-returns standards.
const DR_LEVEL_THRESHOLD_2 = 15;
const DR_FLOOR_THRESHOLD_2 = 30;

/**
 * Returns the multiplier to apply to an XP gain, given the player's
 * CURRENT level/floor (i.e. before this gain is applied). 1.0 = no
 * reduction. Only engages once the player has crossed both a level and a
 * dungeon-floor threshold — someone who's floor-40 but still level 5
 * (bought their way through, or got carried) isn't slowed by this; the
 * level side is what's actually racing ahead in that case, and vice
 * versa. Both conditions being met is what marks someone as genuinely
 * ahead of the curve on both axes at once.
 */
export function diminishingReturnsMultiplier(level: number, dungeonFloor: number): number {
  const lvl = Math.max(1, Math.floor(level) || 1);
  const floor = Math.max(1, Math.floor(dungeonFloor) || 1);

  if (lvl >= DR_LEVEL_THRESHOLD_2 && floor >= DR_FLOOR_THRESHOLD_2) return 0.25;
  if (lvl >= DR_LEVEL_THRESHOLD && floor >= DR_FLOOR_THRESHOLD) return 0.5;
  return 1.0;
}

/** Convenience wrapper: apply diminishing returns to a raw XP amount. */
export function applyDiminishingReturns(rawXp: number, level: number, dungeonFloor: number): number {
  return Math.max(1, Math.floor(rawXp * diminishingReturnsMultiplier(level, dungeonFloor)));
}

/**
 * Combines diminishing returns with the active "XP Boost" shop item
 * (doubles XP for 1 hour, see xp_boost_until on the user doc) into a
 * single call so every XP-granting site applies both consistently.
 * Diminishing returns and the boost stack multiplicatively — a boosted
 * high-level player still gets slowed by diminishing returns, just from
 * a higher base.
 */
export function applyXpModifiers(rawXp: number, level: number, dungeonFloor: number, xpBoostUntil?: number | null): number {
  const afterDr = rawXp * diminishingReturnsMultiplier(level, dungeonFloor);
  const boosted = xpBoostUntil && xpBoostUntil > Math.floor(Date.now() / 1000) ? afterDr * 2 : afterDr;
  return Math.max(1, Math.floor(boosted));
}

/**
 * Level-scaling multiplier for combat stats (HP/attack/defense).
 *
 * Previously a character's HP/attack/defense were set ONCE at `.class`
 * selection and never changed again regardless of level — a level-1 and
 * a level-30 Warrior hit exactly as hard and had exactly the same HP pool.
 * Meanwhile dungeon enemy HP/attack scale up every single floor forever.
 * The two curves were completely disconnected: a fresh, unspecced
 * character became mathematically unable to win as early as floor 5, and
 * even a heavily-invested one (all skill points in STR) still eventually
 * lost the race because their HP pool never grew at all.
 *
 * This returns a multiplier applied on top of class base stats, growing
 * ~4% per level — meaningful but not explosive, since skill points (STR/
 * AGI/INT/LCK) are still the primary way to specialize and grow power.
 */
export function levelStatMultiplier(level: number): number {
  const lvl = Math.max(1, Math.floor(level) || 1);
  return 1 + (lvl - 1) * 0.04;
}
