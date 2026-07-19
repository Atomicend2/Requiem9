import { MongoClient, Db, ObjectId, Collection } from "mongodb";
export { ObjectId };

let _client: MongoClient | null = null;
let _db: Db | null = null;

export async function connectMongo(): Promise<void> {
  if (_db) return;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI environment variable is not set");
  _client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    // Keep the connection alive on Atlas M0, which terminates idle TCP sockets
    // after ~60 s. Without these, the first query after a quiet period pays a
    // ~15 s reconnect penalty (seen in production: every .ping, .afk, .web
    // etc. after a lull took 7–15 s even though the command itself is trivial).
    heartbeatFrequencyMS: 10_000,   // driver pings the server every 10 s
    connectTimeoutMS:     10_000,
    socketTimeoutMS:      45_000,   // abort any operation hanging > 45 s
    minPoolSize:          2,        // keep a couple of warm connections at all times
    // Atlas M0's actual documented limit is 500 concurrent connections
    // (see MongoDB Atlas free-cluster limits), NOT a small number — the
    // previous maxPoolSize: 5 was based on an overly conservative
    // assumption and, in production with several bots running
    // concurrently plus several DB round-trips per command (getUser,
    // ensureUser, group-metadata cache writes, the command's own
    // reads/writes), became a real bottleneck: once 5 operations were
    // in flight at once, every 6th+ operation queued waiting for a
    // pooled connection to free up — compounding with reconnect/
    // handshake latency to produce multi-second-to-tens-of-seconds
    // delays on commands that do almost no work of their own (.ping,
    // .dig). Raised well within Atlas M0's real ceiling.
    maxPoolSize:          40,
  });
  await _client.connect();
  _db = _client.db();
  await ensureIndexes(_db);
  console.log("[MongoDB] Connected successfully");
}

export function getMongoDb(): Db {
  if (!_db) throw new Error("MongoDB not initialized — call connectMongo() first");
  return _db;
}

export function col(name: string): Collection {
  return getMongoDb().collection(name);
}

async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    // ── Users ────────────────────────────────────────────────────────────────
    db.collection("users").createIndex({ lid: 1 }, { sparse: true }),
    db.collection("users").createIndex({ display_id: 1 }, { sparse: true }),
    db.collection("users").createIndex({ level: -1, xp: -1 }),
    db.collection("users").createIndex({ balance: -1 }),
    // Admin stats: countDocuments({registered:1, is_bot:{$ne:1}})
    db.collection("users").createIndex({ registered: 1, is_bot: 1 }),
    // ── Groups / guilds ──────────────────────────────────────────────────────
    db.collection("groups").createIndex({ name: 1 }, { sparse: true }),
    db.collection("guilds").createIndex({ leader_id: 1 }),
    // ── Cards ────────────────────────────────────────────────────────────────
    db.collection("user_cards").createIndex({ user_id: 1 }),
    db.collection("user_cards").createIndex({ card_id: 1 }),
    db.collection("user_cards").createIndex({ copy_id: 1 }, { unique: true }),
    db.collection("card_deck").createIndex({ user_id: 1, slot: 1 }),
    db.collection("card_spawns").createIndex({ group_id: 1 }),
    // cards.tier for getAllCards(tier) filtered queries
    db.collection("cards").createIndex({ tier: 1 }),
    // ── Inventory ────────────────────────────────────────────────────────────
    // compound index covers both getInventory(userId) and duplicate-tool checks
    db.collection("inventory").createIndex({ user_id: 1, item: 1 }),
    // PERF/FIX (2026-07-19): getBankCapExtra() in economy.ts (called on
    // every .bal/.balance and .deposit/.dep, both high-traffic commands)
    // does a $lookup from inventory into shop_items matching on
    // { $toLower: "$name" } === { $toLower: "$item" }. This collection had
    // NO index on `name` at all, and a plain index wouldn't have helped
    // anyway — a $toLower expression can't use a standard index. Every
    // call was a full collection scan of shop_items. Under concurrent
    // load (multiple economy commands firing close together, seen in
    // production logs overlapping in time) on a resource-constrained
    // Atlas M0 cluster, this is a strong match for the extreme, highly
    // variable latency spikes observed on .dep/.bal specifically (78s,
    // 153s) versus other economy commands that don't call this function.
    // A collation-based index with strength:2 lets MongoDB serve
    // case-insensitive equality on `name` directly from the index instead
    // of scanning + computing $toLower per document.
    db.collection("shop_items").createIndex(
      { name: 1 },
      { collation: { locale: "en", strength: 2 } }
    ),
    // ── Economy / auctions / lottery ─────────────────────────────────────────
    db.collection("auctions").createIndex({ active: 1, created_at: -1 }),
    db.collection("message_counts").createIndex({ group_id: 1 }),
    db.collection("lotteries").createIndex({ active: 1 }),
    // lottery_entries.lottery_id is an ObjectId — must be indexed for web view
    db.collection("lottery_entries").createIndex({ lottery_id: 1 }),
    db.collection("lottery_entries").createIndex({ user_id: 1 }),
    // ── Staff / admin ────────────────────────────────────────────────────────
    db.collection("banned_entities").createIndex({ type: 1 }),
    db.collection("muted_users").createIndex({ group_id: 1 }),
    db.collection("mods").createIndex({ group_id: 1 }),
    db.collection("staff").createIndex({ role: 1 }),
    // staff.user_id — needed for the join in admin stats and .mods lookups
    db.collection("staff").createIndex({ user_id: 1 }, { unique: true, sparse: true }),
    db.collection("frames").createIndex({ name: 1 }),
    db.collection("wa_auth").createIndex({ bot_id: 1 }),
    // ── Bot settings ─────────────────────────────────────────────────────────
    // bot_settings._id is the key — already the primary key, no extra index needed
    // ── AFK ──────────────────────────────────────────────────────────────────
    db.collection("afk_users").createIndex({ group_id: 1 }),
    // ── World / events ───────────────────────────────────────────────────────
    db.collection("shoob_imported_ids").createIndex({ imported_at: -1 }),
    db.collection("world_events").createIndex({ created_at: -1 }),
    db.collection("world_events").createIndex({ type: 1 }),
    db.collection("world_history").createIndex({ created_at: -1 }),
    db.collection("rumors").createIndex({ created_at: -1, credibility: 1 }),
    db.collection("territories").createIndex({ controller: 1 }),
    // cards_text_search is handled separately below via migrateTextIndex()
    // so we can drop+recreate it when the weights change without a startup warning.
    // Supports /from-json's default randomized-mix view (sort + range query
    // on random_key). See cards-loader.ts for how random_key is assigned.
    db.collection("cards").createIndex({ random_key: 1 }, { name: "cards_random_key" }),
    // ── RPG / guilds ──────────────────────────────────────────────────────────
    // Leaderboard by dungeon floor (replaces the XP rank sort)
    db.collection("rpg_characters").createIndex({ dungeon_floor: -1 }),
    // Guild member contribution sort + guild lookup
    db.collection("guild_members").createIndex({ guild_id: 1, contribution: -1 }),
    db.collection("guild_members").createIndex({ user_id: 1 }),
    // user_cards by acquisition time (profile card history, recent additions)
    db.collection("user_cards").createIndex({ user_id: 1, obtained_at: -1 }),
  ]).catch((e) => {
    console.warn("[MongoDB] Index setup warning:", e?.message || e);
  });

  // Prevent duplicate card entries from concurrent sync runs.
  //
  // IMPORTANT: these must be PARTIAL indexes, not sparse. `sparse: true`
  // only excludes documents where the field is entirely ABSENT — it does
  // NOT exclude documents where the field is explicitly set to `null`.
  // cards-loader.ts's normaliseCard() always writes both shoob_id and
  // mazoku_id on every card (setting the one that doesn't apply to `null`
  // rather than omitting it), so with a sparse index every shoob card's
  // `mazoku_id: null` and every mazoku card's `shoob_id: null` still got
  // indexed — and a unique index only allows ONE document total with
  // value `null`. That silently capped one side of the catalog and caused
  // upserts for the rest of those cards to collide with each other. A
  // partial index with an explicit $type filter only indexes documents
  // where the field is a real string, so any number of documents can have
  // it `null` or absent.
  //
  // Migration is idempotent: only drop+recreate an index if it doesn't
  // already have the correct partialFilterExpression, so this is a no-op
  // (one quick listIndexes call) on every boot after the first.
  // Deduplicate rpg_characters before creating the unique index — if a user_id
  // appears more than once (can happen from a race condition on first .rpg),
  // keep the document with the highest dungeon_floor (most progress) and
  // delete the rest. Without this step createIndex throws E11000 on every boot.
  try {
    const rpgDups = await db.collection("rpg_characters").aggregate([
      { $group: { _id: "$user_id", ids: { $push: "$_id" }, floors: { $push: "$dungeon_floor" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();
    for (const dup of rpgDups) {
      // Sort: highest floor first — keep that one, delete the rest
      const pairs: Array<{ id: any; floor: number }> = (dup.ids as any[]).map((id: any, i: number) => ({
        id,
        floor: (dup.floors as number[])[i] ?? 0,
      }));
      pairs.sort((a, b) => b.floor - a.floor);
      const toDelete = pairs.slice(1).map((p) => p.id);
      await db.collection("rpg_characters").deleteMany({ _id: { $in: toDelete } });
      console.warn(`[MongoDB] Deduped rpg_characters for user_id ${dup._id}: removed ${toDelete.length} duplicate(s)`);
    }
  } catch (e) {
    console.warn("[MongoDB] rpg_characters dedup warning:", (e as any)?.message || e);
  }
  await db.collection("rpg_characters")
    .createIndex({ user_id: 1 }, { unique: true, sparse: true })
    .catch((e) => console.warn("[MongoDB] rpg_characters unique index warning:", e?.message || e));

  await migrateToPartialUniqueIndex(db, "cards", "cards_shoob_id_unique", { shoob_id: 1 }, { shoob_id: { $type: "string" } });
  await migrateToPartialUniqueIndex(db, "cards", "cards_mazoku_id_unique", { mazoku_id: 1 }, { mazoku_id: { $type: "string" } });

  // Text search index on cards.name + series with name weighted 2× so name
  // matches rank above series matches for the same query string. MongoDB
  // doesn't support changing weights on an existing text index — we must
  // drop and recreate. This migration is idempotent: a quick listIndexes
  // check on every boot avoids the drop+recreate when already correct.
  await migrateTextIndex(
    db, "cards", "cards_text_search",
    { name: "text", series: "text" },
    { weights: { name: 2, series: 1 } },
  );

  // One-time cleanup: staff.user_id should always be a plain phone number
  // (see /players/:id/role in admin.ts, which now validates this on every
  // new write) — but some records were created before that validation
  // existed and may hold a raw Mongo ObjectId or other garbage instead,
  // which made .mods display an unreadable ID rather than the real
  // person's number and broke the associated permission checks. These
  // records are unrecoverable (there's no way to derive the real phone
  // number from a stray ObjectId after the fact), so the safest fix is to
  // remove them — the affected person just needs their role reassigned
  // once, correctly, after this cleanup runs.
  try {
    const removed = await db.collection("staff").deleteMany({ user_id: { $not: /^\d{7,15}$/ } });
    if (removed.deletedCount > 0) {
      console.warn(`[MongoDB] Removed ${removed.deletedCount} staff record(s) with an invalid user_id (not a phone number) — affected roles need reassigning.`);
    }
  } catch (e: any) {
    console.warn("[MongoDB] Staff cleanup warning:", e?.message || e);
  }
}

/**
 * Drop and recreate a text index when its weights differ from what's in the
 * DB. MongoDB silently ignores createIndex() when a same-named text index
 * already exists with different weights instead of updating it — so on every
 * boot we'd log a "different options" warning and the old (wrong) weights
 * would stay in place. This migration detects the mismatch and fixes it.
 */
async function migrateTextIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  keyPattern: Record<string, "text">,
  options: { weights: Record<string, number> },
): Promise<void> {
  const coll = db.collection(collectionName);
  try {
    const existing = await coll.listIndexes().toArray();
    const current = existing.find((i: any) => i.name === indexName);

    if (current) {
      // Compare stored weights with desired weights.
      const storedWeights: Record<string, number> = current.weights ?? {};
      const desired = options.weights;
      const alreadyCorrect = Object.keys(desired).every(
        (k) => storedWeights[k] === desired[k],
      );
      if (alreadyCorrect) return; // no-op: index already has the right weights
      // Weights differ — drop the stale index and fall through to recreate.
      await coll.dropIndex(indexName).catch(() => {});
    }

    await coll.createIndex(keyPattern as any, { name: indexName, ...options });
    console.log(`[MongoDB] Text index '${indexName}' created/updated on '${collectionName}'.`);
  } catch (e: any) {
    console.warn(`[MongoDB] Text index migration warning for ${indexName}:`, e?.message || e);
  }
}

async function migrateToPartialUniqueIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  keyPattern: Record<string, 1 | -1>,
  partialFilterExpression: Record<string, unknown>
): Promise<void> {
  const coll = db.collection(collectionName);
  try {
    const existing = await coll.listIndexes().toArray();
    const current = existing.find((i: any) => i.name === indexName);
    const alreadyCorrect =
      current &&
      current.unique === true &&
      JSON.stringify(current.partialFilterExpression || null) === JSON.stringify(partialFilterExpression);
    if (alreadyCorrect) return;
    if (current) {
      await coll.dropIndex(indexName).catch(() => {});
    }
    await coll.createIndex(keyPattern, { unique: true, name: indexName, partialFilterExpression });
  } catch (e: any) {
    console.warn(`[MongoDB] Index migration warning for ${indexName}:`, e?.message || e);
  }
}
