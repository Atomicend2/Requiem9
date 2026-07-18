#!/usr/bin/env node
/**
 * merge_cards.js
 * Combines cards.json + mazoku_cards.json into a single unified_cards.jsonl
 * (JSONL: one JSON object per line — stream-readable, no giant JSON.parse on server)
 *
 * shoob and mazoku are separate art sources. A card with the same name,
 * series, and tier on both sources is still TWO different cards (different
 * artwork) — they are NEVER merged into one entry, even if everything but
 * the art matches.
 *
 * Dedup rules (in priority order) — these only remove TRUE duplicates,
 * never different-source art:
 *   1. Same shoob_id  within shoob.json    →  duplicate (skip repeat)
 *   2. Same mazoku_id within mazoku_cards.json → duplicate (skip repeat)
 *   3. Same name + series + tier + file_hash, both from shoob → the exact
 *      same image re-scraped under a different shoob_id (skip repeat)
 *
 * Characters can have multiple valid cards (different tiers / series, or
 * the same tier on both shoob and mazoku) — those are NOT dupes and are
 * both kept.
 *
 * IMPORTANT — unified_cards.jsonl is a GENERATED file, not the source of truth.
 * Any manual edit made directly to unified_cards.jsonl (tier fixes, duplicate
 * removal, is_event tagging, etc.) will be silently overwritten the next time
 * this script runs. Always make corrections in cards.json / mazoku_cards.json
 * first, then run this script to regenerate unified_cards.jsonl from them —
 * never the other way around.
 *
 * Run:  node merge_cards.js
 * Output: ./unified_cards.jsonl
 */

const fs   = require("fs");

const MAZOKU_TIER = { C: "T2", R: "T4", SR: "T5", SSR: "T6", UR: "TS" };

function mapTier(t) { return MAZOKU_TIER[t] || t; }

function normKey(name, series, tier) {
  return `${(name||"").trim().toLowerCase()}|${(series||"").trim().toLowerCase()}|${(tier||"").trim().toLowerCase()}`;
}

/* ── Load both files ───────────────────────────────────────────────────── */
process.stdout.write("Loading cards.json …");
const shoobRaw  = JSON.parse(fs.readFileSync("./cards.json",        "utf8"));
const shoobList = shoobRaw.cards || [];
console.log(` ${shoobList.length.toLocaleString()} cards`);

process.stdout.write("Loading mazoku_cards.json …");
const mazokuRaw  = JSON.parse(fs.readFileSync("./mazoku_cards.json", "utf8"));
const mazokuList = mazokuRaw.cards || [];
console.log(` ${mazokuList.length.toLocaleString()} cards`);

/* ── Build unified list ────────────────────────────────────────────────── */
const unified = [];
const seenShoobIds  = new Set();
const seenMazokuIds = new Set();
const seenContentHash = new Map(); // "name|series|tier|file_hash" → first shoob_id seen

let dupShoob   = 0;
let dupMazoku  = 0;
let dupContent = 0; // same name+series+tier+file_hash imported under a different shoob_id

// 1. Shoob cards (primary source — they always win on NST collision)
for (const c of shoobList) {
  const shoobId = String(c.shoob_id || "").trim();
  if (!shoobId) { dupShoob++; continue; }
  if (seenShoobIds.has(shoobId)) { dupShoob++; continue; }
  seenShoobIds.add(shoobId);

  const tier   = c.tier   || "T1";
  const name   = (c.name  || "Unknown").trim();
  const series = (c.series|| "General").trim();
  const key    = normKey(name, series, tier);

  // Catch true duplicates: same name+series+tier AND identical underlying
  // image content (file_hash), just re-scraped under a different shoob_id.
  // These don't get caught by the shoob_id check above since the ID differs,
  // but they're the same card — keep only the first one seen.
  if (c.file_hash) {
    const hashKey = `${key}|${c.file_hash}`;
    if (seenContentHash.has(hashKey)) { dupContent++; continue; }
    seenContentHash.set(hashKey, shoobId);
  }

  const hasWebm = c.has_webm === true || c.has_webm === 1;
  const card = {
    id:          shoobId,
    name,
    series,
    tier,
    is_animated: c.is_animated === true || c.is_animated === 1,
    is_event:    c.is_event === true || c.is_event === 1,
    event_name:  c.event_name || null,
    shoob_id:    shoobId,
    mazoku_id:   null,
    image_url:   `https://api.shoob.gg/site/api/cardr/${shoobId}?size=400`,
    webm_url:    hasWebm ? `https://api.shoob.gg/site/api/cardr/${shoobId}?type=webm` : null,
    gif_url:     null,
    has_webm:    hasWebm,
    has_webp:    c.has_webp === true || c.has_webp === 1,
    file_hash:   c.file_hash || null,
    slug:        c.slug      || null,
    source:      "shoob",
  };

  unified.push(card);
}

// 2. Mazoku cards (merge or append)
for (const c of mazokuList) {
  const mazokuId = String(c.id || "").trim();
  if (!mazokuId) { dupMazoku++; continue; }
  if (seenMazokuIds.has(mazokuId)) { dupMazoku++; continue; }
  seenMazokuIds.add(mazokuId);

  const tier   = mapTier(c.tier || "C");
  const name   = (c.name  || "Unknown").trim();
  const series = (c.series|| "General").trim();

  // NOTE: shoob and mazoku cards for the same character are DIFFERENT
  // artwork from different sources — they are intentionally kept as
  // separate entries, never merged, even when name+series+tier match.

  const imageUrl = c.image_url || c.webp_url || `https://cdn7.mazoku.cc/cards/${mazokuId}.webp`;
  const card = {
    id:          mazokuId,
    name,
    series,
    tier,
    is_animated: c.is_animated === true || c.is_animated === 1,
    is_event:    c.is_event === true || c.is_event === 1,
    event_name:  c.event_name || null,
    shoob_id:    null,
    mazoku_id:   mazokuId,
    image_url:   imageUrl,
    webm_url:    c.webm_url || null,
    gif_url:     c.gif_url  || null,
    has_webm:    !!c.webm_url,
    has_webp:    !!(c.webp_url || c.image_url),
    file_hash:   null,
    slug:        null,
    source:      "mazoku",
  };

  unified.push(card);
}

/* ── Write JSONL ───────────────────────────────────────────────────────── */
const out = fs.createWriteStream("./unified_cards.jsonl");
let written = 0;
for (const card of unified) {
  out.write(JSON.stringify(card) + "\n");
  written++;
}
out.end();

out.on("finish", () => {
  const stat = fs.statSync("./unified_cards.jsonl");
  const mb   = (stat.size / 1024 / 1024).toFixed(1);

  console.log("\n── Merge complete ─────────────────────────────────────────");
  console.log(`  Total cards written : ${written.toLocaleString()}`);
  console.log(`  Shoob only          : ${unified.filter(c => c.source === "shoob" ).length.toLocaleString()}`);
  console.log(`  Mazoku only         : ${unified.filter(c => c.source === "mazoku").length.toLocaleString()}`);
  console.log(`  Shoob dupes skipped : ${dupShoob.toLocaleString()}`);
  console.log(`  Content dupes (same art, different ID) skipped : ${dupContent.toLocaleString()}`);
  console.log(`  Output file         : ./unified_cards.jsonl  (${mb} MB)`);
  console.log("─────────────────────────────────────────────────────────── ");
});
