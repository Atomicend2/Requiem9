/**
 * group-meta-cache.ts
 *
 * ROOT CAUSE of the reported "bot replying slow" (e.g. `.dig` took
 * 29974ms in production logs): `message.ts` called `sock.groupMetadata(from)`
 * directly and unconditionally on every single group message, to determine
 * admin status for command permission checks. `groupMetadata()` is a LIVE
 * network round-trip to WhatsApp's servers — it is not free, and any
 * transient slowness/backpressure on that call directly stalls every
 * command in that group, including completely unrelated, cheap ones like
 * `.dig`.
 *
 * bot-manager.ts and connection.ts each already maintain their own
 * `groupMetaCache` Map and correctly refresh it on `groups.update` /
 * `group-participants.update` — but that cache is only ever consulted by
 * Baileys ITSELF via the `cachedGroupMetadata` socket option, which only
 * serves Baileys' own internal logic (e.g. message-send retry paths). It
 * is not consulted when application code calls `sock.groupMetadata()`
 * directly, which is exactly what message.ts was doing — so all that
 * caching work never actually saved a single network call on the hot path
 * that mattered most.
 *
 * Fix: a shared, application-level cache keyed by `sock` (since multiple
 * bot sockets run concurrently) that message.ts reads through directly,
 * with the existing per-socket caches in bot-manager.ts/connection.ts
 * writing into this same shared store instead of (or alongside) their own
 * private Maps — so a fetch anywhere warms the cache everywhere it's read.
 */

interface CacheEntry {
  data: any;
  ts: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — matches the existing per-socket caches

// Keyed by sock (WeakMap so entries are GC'd when a bot socket is torn down),
// each holding a Map<groupJid, CacheEntry>.
const perSockCache = new WeakMap<object, Map<string, CacheEntry>>();

function getSockCache(sock: object): Map<string, CacheEntry> {
  let cache = perSockCache.get(sock);
  if (!cache) {
    cache = new Map();
    perSockCache.set(sock, cache);
  }
  return cache;
}

/** Write fresh metadata into the shared cache for this sock+group. Call this
 *  anywhere metadata is freshly fetched (groups.update, group-participants.update,
 *  or a cache-miss fetch), so every reader benefits from it. */
export function setCachedGroupMetadata(sock: object, groupJid: string, data: any): void {
  getSockCache(sock).set(groupJid, { data, ts: Date.now() });
}

/** Invalidate a single group's cached entry (e.g. on group-participants.update
 *  if you'd rather force a re-fetch than trust the update payload). */
export function invalidateCachedGroupMetadata(sock: object, groupJid: string): void {
  getSockCache(sock).delete(groupJid);
}

/**
 * Read-through group metadata fetch: returns the cached copy if it's fresh
 * (< 5 min old), otherwise fetches from WhatsApp and caches the result.
 * This is the function message.ts (and anything else on the hot per-message
 * path) should call instead of `sock.groupMetadata(jid)` directly.
 */
export async function getCachedGroupMetadata(sock: any, groupJid: string): Promise<any> {
  const cache = getSockCache(sock);
  const cached = cache.get(groupJid);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }
  const fresh = await sock.groupMetadata(groupJid);
  cache.set(groupJid, { data: fresh, ts: Date.now() });
  return fresh;
}
