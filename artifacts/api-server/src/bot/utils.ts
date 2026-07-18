import { randomBytes } from "crypto";

export function generateId(length = 5): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const bytes = randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export function generateUniqueCardId(existingIds: Set<string>): string {
  let id = generateId(5);
  while (existingIds.has(id)) {
    id = generateId(5);
  }
  return id;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function timeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * "Debit card" payment: covers a cost using wallet (balance) first, then
 * automatically draws any shortfall from bank — up to a limit scaled to
 * the player's level and bank balance — instead of requiring a manual
 * .withdraw first. A small fee (DEBIT_FEE_RATE) applies only to the
 * portion actually drawn from bank, as a mild disincentive so this stays
 * a convenience rather than a reason to never use .withdraw/.deposit at
 * all. Used by .claim and .shop purchases.
 *
 * Overdraft limit = min(bankBalance, level * DEBIT_PER_LEVEL), so newer
 * players have a small safety net and it grows as they level up, but it's
 * always capped by what's actually sitting in their bank (never lets
 * someone go into real negative-bank debt).
 */
const DEBIT_PER_LEVEL = 2000;
const DEBIT_FEE_RATE = 0.05; // 5% fee on the bank-drawn portion only

export interface DebitResult {
  ok: boolean;
  /** Total actually removed from wallet+bank combined (cost + fee on the drawn portion). */
  totalCharged: number;
  fromWallet: number;
  fromBank: number;
  fee: number;
  newBalance: number;
  newBank: number;
  message?: string;
}

export function computeDebitPayment(
  cost: number,
  wallet: number,
  bank: number,
  level: number
): DebitResult {
  if (wallet >= cost) {
    return { ok: true, totalCharged: cost, fromWallet: cost, fromBank: 0, fee: 0, newBalance: wallet - cost, newBank: bank };
  }
  const shortfall = cost - wallet;
  const overdraftLimit = Math.max(0, Math.min(bank, level * DEBIT_PER_LEVEL));
  if (shortfall > overdraftLimit) {
    return {
      ok: false, totalCharged: 0, fromWallet: 0, fromBank: 0, fee: 0, newBalance: wallet, newBank: bank,
      message: `Not enough funds. Wallet: $${wallet.toLocaleString()}, and your bank overdraft limit is $${overdraftLimit.toLocaleString()} (scales with level) — this needs $${shortfall.toLocaleString()} more than that.`,
    };
  }
  const fee = Math.ceil(shortfall * DEBIT_FEE_RATE);
  return {
    ok: true,
    totalCharged: cost + fee,
    fromWallet: wallet,
    fromBank: shortfall + fee,
    fee,
    newBalance: 0,
    newBank: bank - shortfall - fee,
  };
}

/**
 * Escapes regex metacharacters in user-supplied text before it's used to
 * build a RegExp (client-side) or a MongoDB $regex filter (server-side).
 * Without this, a search term containing an unbalanced `(`, `[`, etc.
 * throws — "Unterminated group", "Invalid regular expression", or for
 * MongoDB queries a MongoServerError — which was previously uncaught and
 * surfaced to users as a generic "❌ An error occurred" with no indication
 * of what actually went wrong (e.g. .slb, card/shop/guild name lookups).
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseJid(jid: string): string {
  return jid.split(":")[0].split("@")[0];
}

export function getTierEmoji(tier: string): string {
  const map: Record<string, string> = {
    T1: "⚪",
    T2: "🟢",
    T3: "🔵",
    T4: "🟣",
    T5: "🔴",
    T6: "🌀",
    TS: "⭐",
    TX: "💎",
    TZ: "🔱",
  };
  return map[tier] || "❓";
}

/**
 * Returns a small badge emoji for event cards based on their event_name.
 * Falls back to a generic 🎉 if the event isn't recognized.
 * Pass card.event_name (e.g. "christmas", "halloween") — case-insensitive.
 */
export function getEventEmoji(eventName: string | null | undefined): string {
  if (!eventName) return "";
  const map: Record<string, string> = {
    christmas: "🎄",
    xmas: "🎄",
    halloween: "🎃",
    easter: "🐰",
    valentine: "💘",
    summer: "☀️",
    winter: "❄️",
    "new year": "🎆",
    newyear: "🎆",
    anniversary: "🎂",
    lunar: "🧧",
  };
  return map[eventName.toLowerCase().trim()] || "🎉";
}

/**
 * Builds the display label for a card, e.g. "⭐🎃 Rem (Halloween)".
 * Use this anywhere a card name is rendered to players.
 */
export function getCardDisplayLabel(card: { name: string; tier: string; is_event?: number | boolean; event_name?: string | null }): string {
  const tierEmoji = getTierEmoji(card.tier);
  if (!card.is_event) return `${tierEmoji} ${card.name}`;
  const eventEmoji = getEventEmoji(card.event_name);
  const eventTag = card.event_name ? ` (${card.event_name})` : "";
  return `${tierEmoji}${eventEmoji} ${card.name}${eventTag}`;
}

export function getTierValue(tier: string): number {
  const map: Record<string, number> = {
    T1: 1,
    T2: 2,
    T3: 3,
    T4: 4,
    T5: 5,
    T6: 6,
    TS: 7,
    TX: 8,
    TZ: 9,
  };
  return map[tier] || 0;
}

export const IMAGE_TIERS = new Set(["T1", "T2", "T3", "T4", "T5"]);
export const VIDEO_TIERS = new Set(["T6", "TS", "TX", "TZ"]);

export function getRandomCard(cards: any[]): any {
  if (cards.length === 0) return null;
  return cards[Math.floor(Math.random() * cards.length)];
}

export function getWeightedRandomCard(cards: any[]): any {
  if (cards.length === 0) return null;

  // TX and TZ can NEVER spawn — they are summon-only.
  // Event cards (is_event: 1) can NEVER spawn normally either — they only come from event games.
  const spawnableCards = cards.filter(
    (c) => c.tier !== "TX" && c.tier !== "TZ" && c.is_event !== 1 && c.is_event !== true
  );
  if (spawnableCards.length === 0) return null;

  // Rarity weights (higher = more common):
  // TS & T6: both very very rare (blue moon tier) — TS slightly rarer than T6
  // T5: rare, but noticeably more common than T6
  // T4 and below: normal spawn pool
  const weights: Record<string, number> = {
    T1: 400, T2: 200, T3: 100, T4: 40, T5: 10, T6: 2, TS: 1,
  };

  let totalWeight = 0;
  const cardWeights = spawnableCards.map((c) => {
    const w = weights[c.tier] ?? 10;
    totalWeight += w;
    return { card: c, w };
  });

  let rand = Math.random() * totalWeight;
  for (const { card, w } of cardWeights) {
    rand -= w;
    if (rand <= 0) return card;
  }
  return spawnableCards[spawnableCards.length - 1];
}

export function coinFlip(): "heads" | "tails" {
  return Math.random() < 0.5 ? "heads" : "tails";
}

export function rollDice(): number {
  return Math.floor(Math.random() * 6) + 1;
}

export function spin(): string {
  const symbols = ["🍒", "🍋", "🍊", "🍇", "⭐", "💎", "7️⃣"];
  const result = Array.from({ length: 3 }, () => symbols[Math.floor(Math.random() * symbols.length)]);
  return result.join(" | ");
}

export function checkSlotWin(result: string): number {
  const parts = result.split(" | ");
  if (parts[0] === parts[1] && parts[1] === parts[2]) {
    return 3;
  }
  if (parts[0] === parts[1] || parts[1] === parts[2] || parts[0] === parts[2]) {
    return 2;
  }
  return -1;
}

export function getRouletteColor(number: number): string {
  if (number === 0) return "green";
  const reds = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  return reds.includes(number) ? "red" : "black";
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function getWebsiteUrl(path: string = ""): string {
  const base = (process.env["WEBSITE_URL"] || "https://requiem-order.onrender.com").replace(/\/+$/, "");
  const cleanPath = path ? `/${path.replace(/^\/+/, "")}` : "";
  return `${base}${cleanPath}`;
}

export function mentionTag(jid: string): string {
  const num = parseJid(jid);
  return `@${num}`;
}

export function isValidTier(tier: string): boolean {
  return ["T1","T2","T3","T4","T5","T6","TS","TX","TZ"].includes(tier.toUpperCase());
}

/** Returns true when the buffer contains a GIF (magic bytes 47 49 46 38 = "GIF8"). */
export function isGifBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x47 && // G
    buf[1] === 0x49 && // I
    buf[2] === 0x46 && // F
    buf[3] === 0x38    // 8
  );
}

export function normalizeId(id: string): string {
  if (!id.includes("@")) {
    return id.includes("-") ? `${id}@g.us` : `${id}@s.whatsapp.net`;
  }
  return id;
}

/**
 * Maps the trailing tier token on a card-search command (e.g. the "4" in
 * ".ci ame 4") to a real tier code, and strips it from the search terms.
 * Accepts bare numbers (1-6), letter shorthand (s/x/z), full tier codes
 * (t4, ts, tx), and the old rarity-letter aliases (c/r/sr/ssr/ur) that
 * existed before the tier system was renamed, so old muscle memory still
 * works.
 */
const CARD_SEARCH_TIER_MAP: Record<string, string> = {
  "1": "T1", "2": "T2", "3": "T3", "4": "T4", "5": "T5", "6": "T6",
  "s": "TS", "x": "TX", "z": "TZ",
  "t1": "T1", "t2": "T2", "t3": "T3", "t4": "T4", "t5": "T5", "t6": "T6",
  "ts": "TS", "tx": "TX", "tz": "TZ",
  "c": "T2", "r": "T4", "sr": "T5", "ssr": "T6", "ur": "TS",
};

export function parseCardSearchArgs(args: string[]): { nameQuery: string; tier: string | null } {
  if (args.length === 0) return { nameQuery: "", tier: null };
  const lastArg = args[args.length - 1].toLowerCase();
  const mappedTier = CARD_SEARCH_TIER_MAP[lastArg];
  if (mappedTier && args.length > 1) {
    return { nameQuery: args.slice(0, -1).join(" ").trim(), tier: mappedTier };
  }
  return { nameQuery: args.join(" ").trim(), tier: null };
}

/**
 * Strict, exact (case-insensitive) name match — the FULL card name must
 * equal the search term exactly, not just contain it as a substring or
 * word. ".ci ame 4" only matches a card whose name is exactly "Ame", not
 * "Ame & KAngel" or "Yuki, Hana, and Ame" or "Anzu Ame". This intentionally
 * trades recall for precision: card names are shown in full in search
 * results and via .ci/.summon output (including the card ID), so a user
 * who wants a partial/fuzzy match can always search a shorter/simpler
 * query and see the ID of the specific card they actually want, then
 * target that ID directly with the tools that support it.
 */
export function strictCardMatch(cardName: string, query: string): boolean {
  return cardName.trim().toLowerCase() === query.trim().toLowerCase();
}

/** Finds every card whose name exactly matches the query (and tier, if given). */
export function findCardsStrict(cards: any[], nameQuery: string, tier: string | null): any[] {
  return cards.filter((c) => strictCardMatch(c.name || "", nameQuery) && (tier ? c.tier === tier : true));
}
