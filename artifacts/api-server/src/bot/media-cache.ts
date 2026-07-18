/**
 * media-cache.ts
 *
 * Single source of truth for resolving a card's image/animation buffer.
 *
 * BEFORE this file existed, commands/cards.ts and handlers/cardspawn.ts each
 * had their own copy of getCardImageBuffer(). Neither cached anything, so
 * every single .ci / .ss / .card / spawn-claim call re-fetched the card's
 * artwork from an external CDN (cdn7.mazoku.cc or api.shoob.gg) and, for
 * static images, re-ran it through sharp's JPEG encoder — synchronously,
 * on the one CPU core this whole process (bot + web API) shares.
 *
 * Production logs showed:
 *   .ci marin kitagawa 4   -> 14267ms, Δheap +25MB
 *   .ss darling            -> 6020ms
 * ...and web API requests (including /api/v1/admin/stats) stalling or
 * aborting whenever a heavy card command ran concurrently — consistent
 * with the CDN fetch + sharp encode blocking the event loop.
 *
 * Fix: cache the resolved buffer per card ID, in memory, with a TTL and a
 * hard byte-size ceiling on total cache footprint (this is a 512MB-RAM
 * instance — see render.yaml). Popular cards (the ones people .ci/.ss/spawn
 * over and over) become effectively free after the first fetch.
 *
 * Per the stabilization blueprint's caching rules: this caches lightweight
 * *resolved media* for hot cards, not the full 51k-card catalog, and never
 * grows unbounded — entries are evicted by both TTL and total-size budget.
 */
import sharp from "sharp";
import { logger } from "../lib/logger.js";
import { isGifBuffer, VIDEO_TIERS } from "./utils.js";

const TTL_MS = 30 * 60_000; // 30 minutes — plenty for a "hot" card during active play
const MAX_CACHE_BYTES = 40 * 1024 * 1024; // 40MB budget, generous but bounded on a 512MB box
const MAX_SINGLE_ENTRY_BYTES = 8 * 1024 * 1024; // don't cache oversized outliers (e.g. big webm) — still fetch/send them, just don't hold them in the LRU
const FETCH_TIMEOUT_MS = 12_000; // static images (mazoku webp, shoob jpg)
const FETCH_TIMEOUT_MS_ANIMATED = 10_000; // TX/TZ and other animated webm/video.
                                            // NOTE: this was previously 20s to match
                                            // spawnCard's timeout, but .ci can fetch up to
                                            // 3 matching cards SEQUENTIALLY (see cards.ts) —
                                            // 3 x 20s worst-case is exactly the 41-49s total
                                            // command times seen in production once the shoob.gg
                                            // CDN was slow/unresponsive for a given card. 10s
                                            // caps the worst case at ~30s for 3 matches while
                                            // still giving a slow-but-working CDN response a real
                                            // chance; the bigger fix (parallel fetching, see
                                            // .ci below) matters more than this number itself.
const MAX_MEDIA_BYTES_STATIC = 20 * 1024 * 1024; // static images should never legitimately be this big
const MAX_MEDIA_BYTES_ANIMATED = 60 * 1024 * 1024; // TX/TZ webm can genuinely run larger than 20MB.
                                            // spawnCard's animated path (cardspawn.ts) has NO size cap at
                                            // all and has always worked in production for these same
                                            // cards — the previous flat 20MB cap here (applied to every
                                            // card, animated or not) was silently discarding oversized
                                            // TX/TZ fetches and falling through to the placeholder. This
                                            // is very likely the actual root cause of "TX shows SVG
                                            // instead of real artwork," separate from the timeout fix
                                            // above. Still capped (unlike spawnCard) since this cache
                                            // holds results in memory longer-term; 60MB is generous
                                            // headroom over any observed card size while still protecting
                                            // the 512MB instance from a truly pathological file.

export interface ResolvedCardMedia {
  buf: Buffer;
  source: string;
  /** True for gif/webm/video/mp4 results — callers should send these as { video, gifPlayback: true }. */
  isAnimated: boolean;
  /**
   * The original CDN URL, set only when the fetched bytes are already a
   * WhatsApp-safe static format (or animated gif/webm/video) that needs no
   * re-encoding. We still fetch the bytes once ourselves to sniff format —
   * that part isn't avoidable, since we have to tell gif/webm/video apart
   * from static images and catch CDN responses that lie about their
   * content-type. What sourceUrl buys is: (1) skipping the CPU-bound sharp
   * JPEG re-encode entirely for the common static-image case, and (2)
   * letting Baileys stream-and-encrypt straight from the CDN URL when
   * relaying to WhatsApp instead of us handing it an in-memory Buffer —
   * per Baileys' media docs, { url } sends never fully load the file into
   * Node's memory on that leg of the transfer.
   */
  sourceUrl: string | null;
}

interface CacheEntry {
  media: ResolvedCardMedia;
  size: number;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>(); // insertion order == LRU order (Map preserves it; re-set moves to end)
let cacheBytes = 0;

function touch(key: string, entry: CacheEntry) {
  // Re-inserting moves the key to the end of Map's iteration order,
  // giving us LRU eviction for free without extra bookkeeping.
  cache.delete(key);
  cache.set(key, entry);
}

function evictIfNeeded() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt < now) {
      cache.delete(key);
      cacheBytes -= entry.size;
    }
  }
  // Evict oldest (front of Map) until under budget.
  while (cacheBytes > MAX_CACHE_BYTES && cache.size > 0) {
    const oldestKey = cache.keys().next().value as string;
    const entry = cache.get(oldestKey)!;
    cache.delete(oldestKey);
    cacheBytes -= entry.size;
  }
}

function cacheGet(key: string): ResolvedCardMedia | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    cacheBytes -= entry.size;
    return null;
  }
  touch(key, entry);
  return entry.media;
}

function cacheSet(key: string, media: ResolvedCardMedia) {
  if (media.buf.length > MAX_SINGLE_ENTRY_BYTES) return; // too big to be worth caching
  const entry: CacheEntry = { media, size: media.buf.length, expiresAt: Date.now() + TTL_MS };
  cacheBytes += entry.size;
  touch(key, entry);
  evictIfNeeded();
}

/** Exposed for logging/ops visibility (e.g. a future /admin/cache-stats route). */
export function getMediaCacheStats() {
  return { entries: cache.size, bytes: cacheBytes, maxBytes: MAX_CACHE_BYTES };
}

/** Call when a card's artwork is intentionally changed/re-uploaded (admin edit). */
export function invalidateCardImageCache(cardId: string) {
  const entry = cache.get(cardId);
  if (entry) { cache.delete(cardId); cacheBytes -= entry.size; }
}

function resolveMediaUrl(card: any): string | null {
  let mediaUrl: string | null = card.media_url || null;
  if (!mediaUrl && card.raw_data) {
    try {
      const raw = typeof card.raw_data === "string" ? JSON.parse(card.raw_data) : card.raw_data;
      mediaUrl = raw?.media_url || null;
    } catch {
      // malformed raw_data — fall through to other sources
    }
  }
  if (!mediaUrl && card.mazoku_id) {
    mediaUrl = card.image_url || card.webp_url || `https://cdn7.mazoku.cc/cards/${card.mazoku_id}.webp`;
  }
  if (!mediaUrl && card.shoob_id) {
    const hasWebm = card.has_webm === 1 || card.has_webm === true;
    const isAnimatedCard = VIDEO_TIERS.has(card.tier) || card.is_animated === 1 || card.is_animated === true;
    mediaUrl = (isAnimatedCard && hasWebm)
      ? `https://api.shoob.gg/site/api/cardr/${card.shoob_id}?type=webm`
      : `https://api.shoob.gg/site/api/cardr/${card.shoob_id}?size=400`;
  }
  return mediaUrl;
}

function makePlaceholderSvg(card: any): string {
  const esc = (v: string) => String(v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]!));
  const name = esc(card.name || "Unknown Card");
  const series = esc(card.series || "General");
  const tier = esc(card.tier || "T?");
  return `<svg width="900" height="1260" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#111827"/><stop offset="55%" stop-color="#312e81"/><stop offset="100%" stop-color="#020617"/></linearGradient></defs><rect width="900" height="1260" rx="42" fill="url(#bg)"/><rect x="54" y="54" width="792" height="1152" rx="32" fill="none" stroke="#eab308" stroke-width="10"/><text x="450" y="560" fill="#fde68a" font-size="82" font-family="'DejaVu Sans', Arial" font-weight="700" text-anchor="middle">${name}</text><text x="450" y="680" fill="#dbeafe" font-size="48" font-family="'DejaVu Sans', Arial" text-anchor="middle">${series}</text><text x="450" y="930" fill="#f8fafc" font-size="72" font-family="'DejaVu Sans', Arial" font-weight="700" text-anchor="middle">${tier}</text></svg>`;
}

/**
 * Resolve a card's displayable media.
 * `fetchFull` lets callers plug in their own "fetch the full DB doc by ID"
 * helper (cards.ts and cardspawn.ts each have a slightly different one
 * already wired to their query layer) without this module depending on
 * either directly.
 */
export async function getCardImageBuffer(
  card: any,
  opts?: { fetchFull?: (id: string) => Promise<any | null> }
): Promise<Buffer> {
  const resolved = await resolveCardMedia(card, opts);
  return resolved.buf;
}

/**
 * Full resolver, returning enough info for callers to stream-by-URL to
 * Baileys instead of always buffering. Prefer this over getCardImageBuffer
 * in new code; getCardImageBuffer is kept for the two existing call sites
 * that only ever wanted a Buffer.
 */
export async function resolveCardMedia(
  card: any,
  opts?: { fetchFull?: (id: string) => Promise<any | null> }
): Promise<ResolvedCardMedia> {
  const cacheKey = card.id ? String(card.id) : null;
  if (cacheKey) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const t0 = Date.now();

  // Some callers pass a slim projection missing image_data/media_url — hydrate
  // once from the full document rather than ever re-loading the whole catalog.
  if (opts?.fetchFull && !card.image_data && !card.media_url && !card.mazoku_id && !card.shoob_id && !card.raw_data && card.id) {
    const full = await opts.fetchFull(card.id);
    if (full) card = { ...card, ...full };
  }

  let result: Buffer | null = null;
  let source = "unknown";
  let isAnimated = VIDEO_TIERS.has(card.tier) || card.is_animated === 1 || card.is_animated === true;
  let sourceUrl: string | null = null;

  if (card.image_data) {
    const buf = Buffer.isBuffer(card.image_data) ? card.image_data : (typeof card.image_data === "string" ? Buffer.from(card.image_data, "base64") : null);
    if (buf) {
      result = buf;
      source = "image_data";
      // A card imported as GIF (e.g. shoob ?size=400 returns animated GIF)
      // won't have VIDEO_TIERS OR is_animated flag set correctly if the flag
      // was missed at import time. Detect GIF bytes here so sendAnimatedCard
      // gets called instead of sendImage (which would flatten to a still frame).
      if (!isAnimated && isGifBuffer(buf)) isAnimated = true;
    }
  }

  if (!result) {
    const mediaUrl = resolveMediaUrl(card);
    if (mediaUrl) {
      // Animated cards (TX/TZ and other webm-backed tiers) can be
      // significantly larger than static card art. The old flat 12s
      // timeout was cutting these off early on slower CDN responses,
      // silently falling through to the SVG placeholder — this is why
      // some TX cards showed the placeholder instead of real artwork
      // even though the same card's webm loaded fine via .summon
      // (which already used a 20s timeout for its animated path).
      const timeoutMs = isAnimated ? FETCH_TIMEOUT_MS_ANIMATED : FETCH_TIMEOUT_MS;
      const maxBytes = isAnimated ? MAX_MEDIA_BYTES_ANIMATED : MAX_MEDIA_BYTES_STATIC;
      try {
        const res = await fetch(mediaUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          const contentType = res.headers.get("content-type") || "";
          const contentLength = Number(res.headers.get("content-length") || 0);
          if (contentLength <= maxBytes) {
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length <= maxBytes) {
              if (contentType.includes("gif") || contentType.includes("webm") || contentType.includes("video") || isGifBuffer(buf)) {
                result = buf;
                source = "cdn-raw";
                isAnimated = true;
                sourceUrl = mediaUrl;
              } else if (contentType.includes("jpeg") || contentType.includes("jpg") || contentType.includes("png")) {
                // Already a WhatsApp-safe static format straight from the
                // CDN — no re-encode needed. Skip buffering into sharp
                // entirely and let the caller stream by URL instead
                // (Baileys never loads a { url } media file fully into
                // Node's memory), which is the actual perf win this cache
                // exists to deliver for the common T1-T5 static-card case.
                // isGifBuffer() was already checked above, so a card whose
                // CDN response lies about its content-type (claims jpeg/png
                // but is actually GIF bytes — the exact issue sendImage's
                // flatten-to-static logic exists to catch) is excluded from
                // this fast path and falls through to the sharp re-encode
                // below instead, which normalizes it to a real static frame.
                result = buf;
                source = "cdn-raw-static";
                isAnimated = false;
                sourceUrl = mediaUrl;
              } else {
                try {
                  result = await sharp(buf).jpeg({ quality: 88 }).toBuffer();
                  source = "cdn-encoded";
                  isAnimated = false;
                  // Re-encoded, so the buffer (not the original URL) is the artifact to send/cache.
                } catch {
                  // malformed/unsupported image — fall through to placeholder
                }
              }
            }
          }
        } else {
          logger.warn({ cardId: card.id, status: res.status, mediaUrl }, "Card CDN returned non-OK response");
        }
      } catch (err) {
        logger.warn({ err, cardId: card.id, mediaUrl, timeoutMs }, "Card CDN fetch failed");
      }
    }
  }

  const isPlaceholder = !result;
  if (!result) {
    result = await sharp(Buffer.from(makePlaceholderSvg(card))).jpeg({ quality: 90 }).toBuffer();
    source = "placeholder";
    isAnimated = false;
    sourceUrl = null;
  }

  const elapsed = Date.now() - t0;
  if (elapsed > 1500) {
    logger.warn({ cardId: card.id, source, elapsedMs: elapsed }, "Slow card media resolve");
  }

  const resolved: ResolvedCardMedia = { buf: result, source, isAnimated, sourceUrl };

  // Never cache placeholder fallbacks. A single transient CDN hiccup (network
  // blip, timeout, 5xx) would otherwise poison the cache for this card for
  // the full 30-minute TTL, showing every user the SVG placeholder instead
  // of real artwork until it happened to expire. Only cache successful
  // resolutions from real image_data or the CDN.
  if (cacheKey && !isPlaceholder) cacheSet(cacheKey, resolved);
  return resolved;
}
