#!/usr/bin/env node
/**
 * fix_false_event_tags.js
 *
 * cards.json (Shoob source) has 99 cards with is_event:true / event_name set.
 * Investigation showed every single one is a false positive: the tag was set
 * by matching a season/holiday keyword against the card's NAME or SERIES
 * text (e.g. "Special Week" -> "special event", "Springer" -> "spring",
 * "Summertime Render" -> "summer", "Mai Valentine" -> "valentines"), not
 * because the card is actually limited-time event-exclusive artwork.
 *
 * Shoob's own raw scraped payload (`raw.category`) carries no event/season
 * metadata at all, so there is no legitimate signal to preserve here — these
 * are all just ordinary cards whose name/series happens to contain a
 * calendar word.
 *
 * Mazoku's is_event tags (mazoku_cards.json) are NOT touched — those are
 * real (dates line up with actual Christmas/Halloween drops, no name/series
 * keyword-coincidence pattern).
 *
 * This script only edits cards.json. Run merge_cards.js afterward to
 * regenerate unified_cards.jsonl.
 */
const fs = require("fs");

const path = "./cards.json";
const raw = JSON.parse(fs.readFileSync(path, "utf8"));
const list = raw.cards || [];

let cleared = 0;
const clearedLog = [];

for (const c of list) {
  if (c.is_event) {
    clearedLog.push({ name: c.name, series: c.series, event_name: c.event_name });
    delete c.is_event;
    delete c.event_name;
    cleared++;
  }
}

fs.writeFileSync(path, JSON.stringify(raw, null, 0));

console.log(`Cleared false is_event/event_name tags from ${cleared} Shoob cards.`);
console.log("These cards remain in the collection as normal (non-event) cards — nothing was deleted, only the incorrect event tag.");
fs.writeFileSync("./cleared_event_tags_log.json", JSON.stringify(clearedLog, null, 2));
console.log("Full list of affected cards written to cleared_event_tags_log.json for review.");
