/**
 * cards-loader.ts
 * Reads unified_cards.jsonl (or cards.json as fallback) and syncs all cards
 * into MongoDB using a unified schema — no shoob/mazoku distinction.
 *
 * JSONL is processed line-by-line (readline), so we never load the whole
 * file into memory at once.  This prevents the OOM crash on 512 MB instances.
 */
import fs from "fs";
import readline from "readline";
import path from "path";
import { fileURLToPath } from "url";
import { randomBytes, createHash } from "crypto";
import { col } from "./db/mongo.js";
import { invalidateCardsCache } from "./db/queries.js";
import { logger } from "../lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── Resolve file path ─────────────────────────────────────────────────── */
function resolveFile(names: string[]): string | null {
  const roots = [
    path.resolve(__dirname, "../../../"),
    path.resolve(__dirname, "../../../../"),
    process.cwd(),
    path.resolve(process.cwd(), "../../"),
  ];
  for (const name of names) {
    for (const root of roots) {
      const p = path.join(root, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/* ── Tiny ID generator ─────────────────────────────────────────────────── */
const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/* ── Content fingerprint — used instead of raw byte size for the fast-skip
 * check below. Byte size alone is a weak signal: two different regenerated
 * versions of unified_cards.jsonl (e.g. one built before mazoku_cards.json
 * was wired in, one after) can easily land on a coincidentally similar or
 * even identical size, which would make the fast-skip silently keep serving
 * a stale/incomplete import forever. A SHA-256 over the full file content
 * makes "unchanged" mean what it says. Streamed so we still never load the
 * whole file into memory at once. ── */
async function fileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function genId(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const c = Array.from(randomBytes(8) as Uint8Array)
      .map((b: number) => ID_CHARS[b % ID_CHARS.length]).join("");
    if (!await col("cards").findOne({ _id: c as any }, { projection: { _id: 1 } })) return c;
  }
  return "C" + Date.now().toString(36).toUpperCase();
}

/* ── Stream JSONL file, yield one card per line ─────────────────────────── */
async function* streamJsonl(filePath: string): AsyncGenerator<any> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      yield JSON.parse(trimmed);
    } catch {
      // skip malformed lines
    }
  }
}

/* ── Stream cards.json (legacy) without loading the whole array ─────────── */
async function* streamCardsJson(filePath: string): AsyncGenerator<any> {
  // For legacy cards.json we load the whole file because it uses a JSON array.
  // This is the FALLBACK path; prefer unified_cards.jsonl when available.
  logger.warn("Falling back to cards.json (consider running merge_cards.js)");
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  const cards: any[] = data.cards || [];
  for (const c of cards) yield c;
}

/* ── Normalise a raw card from either source ───────────────────────────── */
const MAZOKU_TIER: Record<string, string> = { C: "T2", R: "T4", SR: "T5", SSR: "T6", UR: "TS" };
const ANIMATED    = new Set(["T6", "TS", "TX", "TZ"]);

function normaliseCard(raw: any, isJsonl: boolean): any | null {
  // unified_cards.jsonl cards already have normalized fields
  if (isJsonl) {
    const id = String(raw.shoob_id || raw.mazoku_id || raw.id || "").trim();
    if (!id) return null;
    const isAnimated = raw.is_animated === true || raw.is_animated === 1 || ANIMATED.has(raw.tier || "");
    const isEvent    = raw.is_event === true || raw.is_event === 1;
    return {
      name:        raw.name   || "Unknown",
      series:      raw.series || "General",
      tier:        raw.tier   || "T1",
      is_animated: isAnimated ? 1 : 0,
      is_event:    isEvent ? 1 : 0,
      event_name:  raw.event_name || null,
      shoob_id:    raw.shoob_id  || null,
      mazoku_id:   raw.mazoku_id || null,
      image_url:   raw.image_url || null,
      webm_url:    raw.webm_url  || null,
      gif_url:     raw.gif_url   || null,
      has_webm:    raw.has_webm  ? 1 : 0,
      has_webp:    raw.has_webp  ? 1 : 0,
      file_hash:   raw.file_hash || null,
      slug:        raw.slug      || null,
      source:      raw.source    || "shoob",
      _primaryId:  id,
    };
  }

  // Legacy cards.json format (shoob only)
  const shoobId = String(raw.shoob_id || "").trim();
  if (!shoobId) return null;
  const hasWebm    = raw.has_webm === true || raw.has_webm === 1;
  const isAnimated = raw.is_animated === true || raw.is_animated === 1 || ANIMATED.has(raw.tier || "");
  return {
    name:        raw.name   || "Unknown",
    series:      raw.series || "General",
    tier:        raw.tier   || "T1",
    is_animated: isAnimated ? 1 : 0,
    shoob_id:    shoobId,
    mazoku_id:   null,
    image_url:   `https://api.shoob.gg/site/api/cardr/${shoobId}?size=400`,
    webm_url:    hasWebm ? `https://api.shoob.gg/site/api/cardr/${shoobId}?type=webm` : null,
    gif_url:     null,
    has_webm:    hasWebm ? 1 : 0,
    has_webp:    raw.has_webp ? 1 : 0,
    file_hash:   raw.file_hash || null,
    slug:        raw.slug      || null,
    source:      "shoob",
    _primaryId:  shoobId,
  };
}

/* ── Main export ───────────────────────────────────────────────────────── */
/* ── Sync state — single source of truth for "is a sync currently running"
 * and live progress. This is what makes concurrent syncs impossible: if a
 * sync is already in flight (whether triggered at boot or by an admin
 * pressing the button, possibly more than once because the first request
 * looked like it hung), a second call returns the in-progress state instead
 * of starting a second, fully independent pass against the same
 * collection. Two unguarded syncs racing against each other — each running
 * its own duplicate-cleanup pass and its own import snapshot at a different
 * moment — is what produced wildly inconsistent partial counts and
 * documents getting tagged inconsistently when this didn't exist. ── */
export type SyncState = {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  processed: number;
  total: number;
  lastResult: { imported: number; updated: number; skipped: number; fileNotFound?: boolean; resolvedPath?: string } | null;
  lastError: string | null;
};

const syncState: SyncState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  processed: 0,
  total: 0,
  lastResult: null,
  lastError: null,
};

export function getSyncState(): SyncState {
  return { ...syncState };
}

export async function loadCardsFromRepo(opts: { force?: boolean } = {}): Promise<{ imported: number; updated: number; skipped: number; fileNotFound?: boolean; resolvedPath?: string }> {
  if (syncState.running) {
    logger.warn("loadCardsFromRepo called while a sync is already running — ignoring this call and returning the existing run's state");
    return syncState.lastResult || { imported: 0, updated: 0, skipped: 0 };
  }
  syncState.running = true;
  syncState.startedAt = Date.now();
  syncState.finishedAt = null;
  syncState.processed = 0;
  syncState.total = 0;
  syncState.lastError = null;
  try {
    const result = await loadCardsFromRepoInner(opts);
    syncState.lastResult = result;
    return result;
  } catch (e: any) {
    syncState.lastError = e?.message || String(e);
    throw e;
  } finally {
    syncState.running = false;
    syncState.finishedAt = Date.now();
    // A sync just potentially changed the cards collection (new/updated
    // cards, tier changes, event tags, etc) — drop the in-memory cache so
    // the next getAllCards() call reflects it immediately instead of
    // serving stale data for up to CARDS_CACHE_TTL_MS.
    invalidateCardsCache();
  }
}

async function loadCardsFromRepoInner(opts: { force?: boolean } = {}): Promise<{ imported: number; updated: number; skipped: number; fileNotFound?: boolean; resolvedPath?: string }> {
  const stats: { imported: number; updated: number; skipped: number; fileNotFound?: boolean; resolvedPath?: string } = { imported: 0, updated: 0, skipped: 0 };

  // Prefer unified JSONL; fall back to legacy cards.json
  const jsonlPath = resolveFile(["unified_cards.jsonl"]);
  const jsonPath  = resolveFile(["cards.json"]);
  const filePath  = jsonlPath || jsonPath;
  const isJsonl   = !!jsonlPath;

  if (!filePath) {
    logger.warn(
      { triedRoots: [path.resolve(__dirname, "../../../"), path.resolve(__dirname, "../../../../"), process.cwd(), path.resolve(process.cwd(), "../../")] },
      "Neither unified_cards.jsonl nor cards.json found — skipping card loader"
    );
    stats.fileNotFound = true;
    return stats;
  }
  stats.resolvedPath = filePath;

  const metaKey = isJsonl ? "unified_jsonl" : "shoob_json";
  logger.info({ filePath, isJsonl, force: !!opts.force }, "Card loader starting");

  /* Fast-skip: file unchanged and DB already populated. This only applies
   * to the automatic boot-time sync — its entire purpose is to avoid
   * redoing a full pass on every restart when nothing changed. An explicit
   * manual re-sync (opts.force) must NEVER hit this shortcut: matching file
   * size is a weak signal on its own (two different file contents can land
   * on the same byte count, and more importantly, an admin pressing "sync
   * now" is explicitly asking to verify and reconcile state regardless of
   * what the last recorded size was — silently no-op'ing on that request
   * is exactly what made the sync button look broken). */
  let fileSize = 0;
  try { fileSize = fs.statSync(filePath).size; } catch {}
  // Rough estimate for progress reporting only — average observed line
  // length in unified_cards.jsonl is ~430 bytes. Exact precision doesn't
  // matter here, this just gives the admin panel something to show a
  // percentage against instead of leaving "processed" with no context.
  syncState.total = fileSize > 0 ? Math.round(fileSize / 430) : 0;

  // Content hash, not byte size — see fileHash() comment for why. Computed
  // unconditionally (even when opts.force is set) since we log/store it
  // either way for the next cold start's comparison.
  let contentHash = "";
  try { contentHash = await fileHash(filePath); } catch {}

  if (!opts.force && fileSize > 0 && contentHash) {
    const meta = await col("sync_meta").findOne({ _id: metaKey as any }).catch(() => null);
    const hashMatches = meta && meta.file_hash === contentHash;
    // Belt-and-suspenders: even if the file hash matches what we last
    // recorded, don't trust that as "fully synced" if this is a JSONL file
    // that contains mazoku cards but the `cards` collection currently has
    // none — that combination can only mean a previous run imported an
    // older/incomplete file under a hash we no longer have a record
    // matching, or a partial import got interrupted. Re-running the sync
    // in that case is cheap (it's an idempotent upsert) and guarantees we
    // never get stuck silently serving a shoob-only catalog forever.
    if (hashMatches && meta.imported_count > 0) {
      const mazokuInDb = await col("cards").countDocuments({ mazoku_id: { $ne: null } }).catch(() => 0);
      if (mazokuInDb > 0 || !isJsonl) {
        logger.info({ importedCount: meta.imported_count }, "Card file unchanged — skipping sync");
        return stats;
      }
      logger.warn(
        { mazokuInDb },
        "Card file hash matches last sync, but DB has zero mazoku cards — forcing a real sync instead of trusting the fast-skip"
      );
    }
  }

  /* ── One-time cleanup: collapse any EXISTING duplicate documents that
   * already share the same shoob_id or mazoku_id. These are leftovers from
   * the old insert logic (random _id per insert, dedup tracked in a
   * separate, non-atomically-written collection) — a crash mid-sync could
   * leave the same card inserted twice under different local ids. The
   * upsert-by-shoob_id/mazoku_id added above prevents NEW duplicates, but
   * does nothing to clean up ones that already exist, since updateOne only
   * ever touches the first match. This pass finds and merges them down to
   * one document each, going forward. ── */
  if (opts.force) {
    try {
      const dupGroups = await col("cards").aggregate([
        { $match: { shoob_id: { $ne: null } } },
        { $group: { _id: "$shoob_id", ids: { $push: "$_id" }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ]).toArray().catch(() => [] as any[]);

      const mazokuDupGroups = await col("cards").aggregate([
        { $match: { mazoku_id: { $ne: null } } },
        { $group: { _id: "$mazoku_id", ids: { $push: "$_id" }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ]).toArray().catch(() => [] as any[]);

      const allDupGroups = [...dupGroups, ...mazokuDupGroups];
      if (allDupGroups.length > 0) {
      const allDupIds = allDupGroups.flatMap((g: any) => g.ids);
      const ownedIds = new Set(
        (await col("user_cards").find(
          { card_id: { $in: allDupIds } },
          { projection: { card_id: 1 } }
        ).toArray()).map((d: any) => d.card_id)
      );

      const toDelete: any[] = [];
      for (const g of allDupGroups) {
        const ids: any[] = g.ids;
        // Prefer to keep a copy that's owned by a player; otherwise keep the
        // first (oldest-inserted) copy. Delete the rest.
        const ownedCopy = ids.find((id) => ownedIds.has(id));
        const keepId = ownedCopy ?? ids[0];
        for (const id of ids) {
          if (id !== keepId) toDelete.push(id);
        }
      }
      if (toDelete.length > 0) {
        await col("cards").deleteMany({ _id: { $in: toDelete } });
        logger.info(
          { duplicateGroups: allDupGroups.length, documentsRemoved: toDelete.length },
          "Card sync: collapsed pre-existing duplicate documents sharing the same shoob_id/mazoku_id"
        );
      }
    }
    } catch (e: any) {
      logger.warn({ e: e.message }, "Pre-existing duplicate cleanup failed (non-fatal)");
    }
  }

  /* Collect already-imported primary IDs (shoob_id OR mazoku_id) directly
   * from the cards collection itself — this is the single source of truth.
   * (Previously this read from separate shoob_imported_ids/mazoku_imported_ids
   * tracking collections, which could silently fall out of sync with `cards`
   * if the process crashed between the two writes, causing the same card to
   * be re-imported as a brand-new duplicate document on the next sync.) */
  const existingCardIdDocs = await col("cards")
    .find({}, { projection: { shoob_id: 1, mazoku_id: 1 } })
    .toArray()
    .catch(() => [] as any[]);
  const importedIds = new Set<string>();
  for (const d of existingCardIdDocs) {
    if (d.shoob_id)  importedIds.add(d.shoob_id);
    if (d.mazoku_id) importedIds.add(d.mazoku_id);
  }

  const stream = isJsonl ? streamJsonl(filePath) : streamCardsJson(filePath);

  const BATCH = 500;
  let batch: any[] = [];

  const processBatch = async () => {
    const cardOps: any[] = [];

    for (const raw of batch) {
      const card = normaliseCard(raw, isJsonl);
      if (!card) { stats.skipped++; continue; }

      const pid = card._primaryId;
      delete card._primaryId;

      // Upsert keyed on the card's own shoob_id/mazoku_id (NOT a randomly
      // generated local id, and NOT a separate tracking collection). This is
      // what makes the sync crash-safe: if the process dies mid-batch (e.g.
      // an unhandled rejection elsewhere takes down the whole instance) and
      // the same batch gets reprocessed on the next run, this upsert can
      // only ever touch the ONE document that already has this shoob_id/
      // mazoku_id — it can never insert a second document for the same
      // card. The old design generated a brand-new random _id on every
      // insert and relied on a separate, non-atomically-written tracking
      // collection to remember "already imported" — a crash between the two
      // writes could desync them, and the next sync would then insert the
      // same card again under a new id. That's how true duplicates (absent
      // from the source JSON entirely) accumulated in Mongo over time.
      const field = card.shoob_id ? "shoob_id" : "mazoku_id";
      if (importedIds.has(pid)) {
        cardOps.push({
          updateOne: { filter: { [field]: pid }, update: { $set: card } },
        });
        stats.updated++;
      } else {
        const localId = await genId();
        cardOps.push({
          updateOne: {
            filter: { [field]: pid },
            update: {
              $set: card,
              // random_key: a random float 0..1 fixed once per card, used
              // by /from-json's default (no explicit sort) view to serve a
              // different rotating mix on every page reload — see the
              // comment above that route for the full explanation.
              $setOnInsert: { _id: localId as any, created_at: Math.floor(Date.now() / 1000), random_key: Math.random() },
            },
            upsert: true,
          },
        });
        importedIds.add(pid);
        stats.imported++;
      }
    }

    try {
      if (cardOps.length) await col("cards").bulkWrite(cardOps, { ordered: false });
    } catch (e: any) { logger.warn({ e: e.message }, "Card bulk write partial error"); }

    batch = [];
  };

  let totalSeen = 0;
  for await (const raw of stream) {
    totalSeen++;
    syncState.processed = totalSeen;
    batch.push(raw);
    if (batch.length >= BATCH) await processBatch();
  }
  if (batch.length > 0) await processBatch();

  // Backfill random_key on any card that predates this field (all cards
  // synced before this feature shipped). Cheap one-time pass: only touches
  // documents missing the field, in small batches so it never holds a huge
  // bulkWrite in memory even on a 50k+ card collection.
  try {
    const BACKFILL_BATCH = 1000;
    let backfilled = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const missing = await col("cards")
        .find({ random_key: { $exists: false } }, { projection: { _id: 1 } })
        .limit(BACKFILL_BATCH)
        .toArray();
      if (missing.length === 0) break;
      const ops = missing.map((d: any) => ({
        updateOne: { filter: { _id: d._id }, update: { $set: { random_key: Math.random() } } },
      }));
      await col("cards").bulkWrite(ops, { ordered: false });
      backfilled += missing.length;
      if (missing.length < BACKFILL_BATCH) break;
    }
    if (backfilled > 0) logger.info({ backfilled }, "Backfilled random_key on pre-existing cards");
  } catch (e: any) {
    logger.warn({ e: e.message }, "random_key backfill failed (non-fatal)");
  }

  // Persist metadata for fast-skip on future cold starts
  await col("sync_meta").updateOne(
    { _id: metaKey as any },
    { $set: { file_size: fileSize, file_hash: contentHash, imported_count: totalSeen, synced_at: Math.floor(Date.now() / 1000) } },
    { upsert: true }
  ).catch(() => {});

  logger.info({ ...stats, totalSeen, isJsonl }, "✅ Card sync complete");
  return stats;
}
