import type { WASocket } from "@whiskeysockets/baileys";
import {
  getAllCards, getActiveSpawn, getActiveSpawnByToken, claimSpawn, spawnCardInGroup, giveCard, getCard,
  ensureUser, getUser, updateUser, getGroup, ensureGroup, getUserCards,
  getTodaySpawnCount, recordSpawnForGroup, getNextSpawnTime, setNextSpawnTime,
  getGroupActivity, getLastSpawnedCardId, getRecentSpawnedCardIds, recordRecentSpawnedCard, getCardOwnerCount, getCardOwnerCounts,
} from "../db/queries.js";
import { sendText, sendImage, animatedToMp4, withMediaSlot } from "../connection.js";
import { getTierEmoji, getWeightedRandomCard, formatNumber, VIDEO_TIERS, isGifBuffer } from "../utils.js";
import { logger } from "../../lib/logger.js";
import { getCardImageBuffer as resolveCardImageBuffer } from "../media-cache.js";
import sharp from "sharp";

/**
 * Returns a real, playable MP4 buffer, or null if transcoding genuinely
 * failed. Callers MUST check for null and fall back to sending the card as
 * a static image (sendImage) instead of sending the raw GIF/WebM bytes as
 * if they were MP4 — WhatsApp will either reject that outright or decode
 * only a single frame, which is exactly the "doesn't load" / "loads but
 * frozen" behavior reported in production for some spawned animated cards.
 */
async function ensureMp4(buf: Buffer, cardId?: string | number): Promise<Buffer | null> {
  const isMp4 = buf.length > 8 && buf.slice(4, 8).toString("ascii") === "ftyp";
  if (isMp4) return buf;

  const isGif = isGifBuffer(buf);
  // WebM files start with the EBML magic bytes (1A 45 DF A3).
  // If the buffer is neither GIF nor WebM, it's a static image (JPEG/PNG)
  // from a CDN fallback. Skip the ffmpeg slot entirely instead of wasting
  // 5-30 s on a guaranteed failed conversion — callers treat null as "use
  // static image", so the end result is the same but much faster.
  const isWebm = !isGif && buf.length > 4
    && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  if (!isGif && !isWebm) {
    logger.debug({ cardId, bufLen: buf.length }, "ensureMp4: buffer is static image — skipping ffmpeg");
    return null;
  }

  const mp4 = await animatedToMp4(buf, isGif ? "gif" : "webm");
  if (mp4) return mp4;

  logger.warn({ cardId }, "ensureMp4: ffmpeg conversion failed — caller should fall back to static image");
  return null;
}

const MEDIA_SEND_TIMEOUT_MS = 25_000;

/** Wraps a promise with a timeout — rejects if the operation takes longer than ms. */
async function withSendTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Media send timed out after ${ms}ms`)), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/** Send an animated card, falling back to a static image if MP4 transcoding fails. */
async function sendAnimatedCard(sockOrGroup: any, groupId: string, buf: Buffer, cardId: string | number | undefined, caption: string, card: any) {
  const mp4Buf = await ensureMp4(buf, cardId);
  if (mp4Buf) {
    await withSendTimeout(
      sockOrGroup.sendMessage(groupId, { video: mp4Buf, gifPlayback: true, mimetype: "video/mp4", caption }),
      MEDIA_SEND_TIMEOUT_MS
    );
  } else {
    // Real transcode failure. We already have real card art in `buf` (just
    // not as playable video) — sending it as a static image is a much
    // better fallback than a generic SVG placeholder. sendImage() also
    // handles the case where `buf` itself turns out to be GIF-encoded by
    // flattening it to a real static frame first.
    await sendImage(groupId, buf, caption);
  }
}

const MAX_SPAWNS_PER_DAY = 5;
const SPAWN_MIN_SECS = 3600;
const SPAWN_MAX_SECS = 28800;
const ACTIVITY_REQUIRED = 30;
const CARD_EXPIRY_MIN_SECS = 240;
const CARD_EXPIRY_MAX_SECS = 300;

export const TIER_PRICES: Record<string, number> = {
  T1: 3500, T2: 12000, T3: 27500, T4: 52500, T5: 62500, T6: 112000, TS: 250000, TX: 350000, TZ: 500000,
};

function randomSpawnDelay(): number {
  return SPAWN_MIN_SECS + Math.floor(Math.random() * (SPAWN_MAX_SECS - SPAWN_MIN_SECS));
}

export async function checkAutoSpawn(sock: WASocket, groupId: string): Promise<void> {
  try {
    await ensureGroup(groupId);
    const group = await getGroup(groupId);
    if (!group) return;

    if ((group.cards_enabled || "on") !== "on") return;
    if ((group.spawn_enabled || "on") !== "on") return;

    const now = Math.floor(Date.now() / 1000);
    let nextSpawn = await getNextSpawnTime(groupId);

    if (nextSpawn === 0) {
      const delay = randomSpawnDelay();
      await setNextSpawnTime(groupId, now + delay);
      return;
    }

    if (now < nextSpawn) return;

    // spawn_mode: "activity" (default) gates on group activity;
    // "time" spawns on the clock regardless of how busy the group is.
    const spawnMode = (group.spawn_mode || "activity") as string;
    if (spawnMode !== "time") {
      const activity = await getGroupActivity(groupId);
      if (activity.percentage < ACTIVITY_REQUIRED) {
        await setNextSpawnTime(groupId, now + randomSpawnDelay());
        return;
      }
    }

    const todayCount = await getTodaySpawnCount(groupId);
    if (todayCount >= MAX_SPAWNS_PER_DAY) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      await setNextSpawnTime(groupId, Math.floor(tomorrow.getTime() / 1000) + SPAWN_MIN_SECS + Math.floor(Math.random() * 14400));
      return;
    }

    await setNextSpawnTime(groupId, now + randomSpawnDelay());
    await spawnCard(sock, groupId);
  } catch (err) {
    logger.error({ err }, "Error in checkAutoSpawn");
  }
}

const HIGH_TIER_MAX_ISSUES = 3;
const NORMAL_MAX_ISSUES = 2;

export function getMaxIssues(tier: string): number {
  if (tier === "TX" || tier === "TZ") return 1;
  if (tier === "T5" || tier === "T6" || tier === "TS") return HIGH_TIER_MAX_ISSUES;
  return NORMAL_MAX_ISSUES;
}

export async function spawnCard(sock: WASocket, groupId: string, specific?: string): Promise<void> {
  const existing = await getActiveSpawn(groupId);
  if (existing) return;

  const allCards = await getAllCards();
  if (allCards.length === 0) {
    logger.warn({ groupId }, "Cannot spawn card — database is empty.");
    return;
  }

  let card: any;
  if (specific) {
    card = allCards.find((c) => String(c.id) === String(specific));
    if (!card) card = getWeightedRandomCard(allCards);
  } else {
    const recentIds = await getRecentSpawnedCardIds(groupId);
    const spawnableCards = allCards.filter((c) => c.tier !== "TX" && c.tier !== "TZ");
    const nonRecentCards = spawnableCards.filter((c) => !recentIds.includes(c.id));
    const pool = nonRecentCards.length > 0 ? nonRecentCards : spawnableCards;
    card = getWeightedRandomCard(pool);
  }
  if (!card) return;

  const maxIssues = getMaxIssues(card.tier);
  const ownerCount = await getCardOwnerCount(card.id);
  const issueNum = ownerCount + 1;

  if (issueNum > maxIssues) {
    const eligibleCards = allCards.filter((c) => c.tier !== "TX" && c.tier !== "TZ");
    const ownerCounts = await getCardOwnerCounts(eligibleCards.map((c) => String(c.id)));
    const fallbackPool = eligibleCards.filter((c) => (ownerCounts[String(c.id)] || 0) < getMaxIssues(c.tier));
    if (fallbackPool.length === 0) return;
    card = getWeightedRandomCard(fallbackPool);
    if (!card) return;
  }

  const currentIssue = (await getCardOwnerCount(card.id)) + 1;
  const maxIssuesFinal = getMaxIssues(card.tier);

  const claimChars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const token = Array.from({ length: 6 }, () => claimChars[Math.floor(Math.random() * claimChars.length)]).join("");

  const expiryOffset = CARD_EXPIRY_MIN_SECS + Math.floor(Math.random() * (CARD_EXPIRY_MAX_SECS - CARD_EXPIRY_MIN_SECS));
  const expiresAt = Math.floor(Date.now() / 1000) + expiryOffset;
  const expiryMins = Math.ceil(expiryOffset / 60);

  await spawnCardInGroup(groupId, card.id, token, undefined, expiresAt);
  await recordSpawnForGroup(groupId);
  await recordRecentSpawnedCard(groupId, card.id);

  const tierPrice = TIER_PRICES[card.tier] || 500;

  const caption =
    `✨ *A card has appeared!*\n\n` +
    `*🎴 Name:* ${card.name}\n` +
    `*🃏 Series:* ${card.series || "General"}\n` +
    `*⭐ Tier:* ${card.tier}\n` +
    `*📋 Issue:* ${currentIssue}\n` +
    `*🏷️ Price:* $${formatNumber(tierPrice)}\n\n` +
    `> Type \`.claim ${token}\` to claim!\n` +
    `> ⏳ Expires in *${expiryMins} minutes* — claim fast!`;

  // Hard cap on the entire media-send section: CDN fetch + ffmpeg queue wait
  // + ffmpeg encode + Baileys upload. Previously only the Baileys upload step
  // had a 25 s timeout, meaning CDN fetch (≤20 s) + ffmpeg queue wait
  // (unbounded when another transcode was in progress) could push the total
  // well past a minute while holding the card's video buffer in memory —
  // exactly the OOM scenario seen in production (.spawncard took 256 990 ms).
  // 75 s covers the worst-case legitimate path with headroom to spare:
  //   20 s CDN fetch + 60 s ffmpeg slot wait/execution + 25 s Baileys send
  //   = 105 s theoretical max, but the ffmpeg slot now also has its own
  //   90 s timeout (withFfmpegSlot), so we keep this slightly tighter to
  //   fail the whole operation before the fallback placeholder send adds
  //   yet more memory pressure on an already-stressed instance.
  const OVERALL_SPAWN_TIMEOUT_MS = 75_000;

  try {
    // Wrap the entire media operation in the process-wide media semaphore
    // (max 2 concurrent animated ops). Each holds 20-60 MB; without this
    // 3+ concurrent spawns would OOM-kill the whole process.
    await withMediaSlot(() => withSendTimeout(
      (async () => {
        if (VIDEO_TIERS.has(card.tier)) {
          const { getAnySock, isSocketConnected } = await import("../connection.js");
          const { getAnyConnectedManagedSock } = await import("../bot-manager.js");
          const activeSock = (await getAnyConnectedManagedSock()) || getAnySock();

          // If no connected socket is available, skip the animated path
          // entirely rather than downloading a large video buffer that can't
          // be sent — fall through to the plain static-image send below.
          if (!activeSock || !isSocketConnected()) {
            const buf = await getCardImageBuffer(card);
            await sendImage(groupId, buf, caption);
          } else if (!card.image_data) {
            let mediaUrl: string | null = card.media_url || null;
            if (!mediaUrl && card.raw_data) {
              try {
                const raw = typeof card.raw_data === "string" ? JSON.parse(card.raw_data) : card.raw_data;
                mediaUrl = raw?.media_url || null;
              } catch {}
            }
            if (!mediaUrl && card.mazoku_id) {
              mediaUrl = card.image_url || card.webp_url || `https://cdn7.mazoku.cc/cards/${card.mazoku_id}.webp`;
            }
            if (!mediaUrl && card.shoob_id) {
              const hasWebm = card.has_webm === 1 || card.has_webm === true;
              mediaUrl = hasWebm
                ? `https://api.shoob.gg/site/api/cardr/${card.shoob_id}?type=webm`
                : `https://api.shoob.gg/site/api/cardr/${card.shoob_id}?size=400`;
            }
            // Fetch the animated source (falling back to getCardImageBuffer's
            // own CDN logic on network failure), then always route through
            // sendAnimatedCard so a real ffmpeg failure falls back to a static
            // image instead of sending unplayable bytes as if they were a
            // valid MP4 — see ensureMp4/sendAnimatedCard above.
            let buf: Buffer;
            if (mediaUrl) {
              try {
                const res = await fetch(mediaUrl, {
                  headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
                  signal: AbortSignal.timeout(20000),
                });
                buf = res.ok ? Buffer.from(await res.arrayBuffer()) : await getCardImageBuffer(card);
              } catch {
                buf = await getCardImageBuffer(card);
              }
            } else {
              buf = await getCardImageBuffer(card);
            }
            await sendAnimatedCard(activeSock, groupId, buf, card.id, caption, card);
          } else {
            const buf = await getCardImageBuffer(card);
            await sendAnimatedCard(activeSock, groupId, buf, card.id, caption, card);
          }
        } else {
          const buf = await getCardImageBuffer(card);
          await sendImage(groupId, buf, caption);
        }
      })(),
      OVERALL_SPAWN_TIMEOUT_MS,
    ));
    logger.info({ cardId: card.id, cardName: card.name, tier: card.tier, groupId }, "Card spawned successfully");
  } catch (err) {
    logger.error({ err, cardId: card.id, cardName: card.name }, "Error spawning card image — using placeholder");
    const fallback = await makeCardPlaceholder(card);
    await sendImage(groupId, fallback, caption).catch(() => {});
  }
}

export async function handleGetCard(
  sock: WASocket,
  groupId: string,
  senderId: string,
  cardId: string
): Promise<void> {
  const spawn = await getActiveSpawnByToken(groupId, cardId);
  if (!spawn) {
    const anySpawn = await getActiveSpawn(groupId);
    if (!anySpawn) {
      await sendText(groupId, "❌ There's no active card spawn right now.");
    } else {
      await sendText(groupId, "❌ Wrong card ID. Check the spawn message for the correct code!");
    }
    return;
  }

  await ensureUser(senderId);

  const userCards = await getUserCards(senderId);
  const alreadyOwned = userCards.some((c: any) => c.id === spawn.card_id);
  if (alreadyOwned) {
    await sendText(groupId, "❌ You already own this card! Each card can only be claimed once per user.");
    return;
  }

  const card = await getCard(spawn.card_id);
  const maxIssues = getMaxIssues(card?.tier || "T1");
  const currentOwners = await getCardOwnerCount(spawn.card_id);

  if (currentOwners >= maxIssues) {
    await sendText(groupId, `❌ This card has reached its maximum issues (${maxIssues}/${maxIssues}).`);
    return;
  }

  const tierPrice = TIER_PRICES[card?.tier || "T1"] || 500;
  const claimerUser = await getUser(senderId);
  const claimerBalance = claimerUser?.balance ?? 0;
  if (claimerBalance < tierPrice) {
    await sendText(groupId,
      `❌ Not enough coins to claim *${card?.name || "this card"}* (${card?.tier || "T?"}).\n\n` +
      `💰 Cost: $${formatNumber(tierPrice)}\n` +
      `👛 Your balance: $${formatNumber(claimerBalance)}\n\n` +
      `_Earn more coins with .daily, .work, .adventure, or dungeon runs._`
    );
    return;
  }

  await claimSpawn(spawn.id, senderId);
  await giveCard(senderId, spawn.card_id);
  void updateUser(senderId, { balance: claimerBalance - tierPrice });

  const issueNum = currentOwners + 1;
  const senderDisplay = senderId.split("@")[0].split(":")[0];
  await sendText(
    groupId,
    `🎉 @${senderDisplay} claimed the card!\n\n` +
    `*🎴 Name:* ${card?.name || spawn.card_id}\n` +
    `*⭐ Tier:* ${card?.tier || "T?"}\n` +
    `*📋 Issue:* #${issueNum}\n` +
    `*🏷️ Price:* $${formatNumber(tierPrice)}`,
    [senderId]
  );
  logger.info({ userId: senderId, cardId: spawn.card_id, cardName: card?.name }, "Card claimed successfully");
}

async function getCardImageBuffer(card: any): Promise<Buffer> {
  // Delegates to the shared, cached resolver in media-cache.ts so spawn
  // claims and .ci/.ss lookups (commands/cards.ts) share one in-memory
  // LRU/TTL cache instead of each re-fetching + re-encoding the same
  // popular cards' artwork from the CDN on every single call.
  return resolveCardImageBuffer(card);
}

async function makeCardPlaceholder(card: any): Promise<Buffer> {
  const name = escapeSvg(card.name || "Unknown Card");
  const series = escapeSvg(card.series || "General");
  const tier = escapeSvg(card.tier || "T?");
  const svg = `<svg width="900" height="1260" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#111827"/>
        <stop offset="55%" stop-color="#312e81"/>
        <stop offset="100%" stop-color="#020617"/>
      </linearGradient>
    </defs>
    <rect width="900" height="1260" rx="42" fill="url(#bg)"/>
    <rect x="54" y="54" width="792" height="1152" rx="32" fill="none" stroke="#eab308" stroke-width="10"/>
    <text x="450" y="210" fill="#f8fafc" font-size="64" font-family="'DejaVu Sans', Arial" font-weight="700" text-anchor="middle">ALPHA CARD</text>
    <text x="450" y="560" fill="#fde68a" font-size="82" font-family="'DejaVu Sans', Arial" font-weight="700" text-anchor="middle">${name}</text>
    <text x="450" y="680" fill="#dbeafe" font-size="48" font-family="'DejaVu Sans', Arial" text-anchor="middle">${series}</text>
    <text x="450" y="930" fill="#f8fafc" font-size="72" font-family="'DejaVu Sans', Arial" font-weight="700" text-anchor="middle">${tier}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function escapeSvg(value: string): string {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]!));
}
