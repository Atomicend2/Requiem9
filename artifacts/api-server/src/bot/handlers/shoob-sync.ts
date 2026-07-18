import type { CommandContext } from "../commands/index.js";
import { sendText } from "../connection.js";
import { getStaff } from "../db/queries.js";
import { col } from "../db/mongo.js";
import { logger } from "../../lib/logger.js";
import sharp from "sharp";

const SHOOB_API_BASE       = "https://api.shoob.gg";
const SHOOB_IMAGE_BASE     = `${SHOOB_API_BASE}/site/api/cardr`;
const SHOOB_CARDS_ENDPOINT = `${SHOOB_API_BASE}/site/api/cards`;
const SHOOB_PAGE_SIZE      = 15;

const VALID_SHOOB_TIERS = ["T1","T2","T3","T4","T5","T6","TS","TX","TZ"];

function normaliseTier(raw: string | number | undefined | null): string {
  if (raw === null || raw === undefined) return "T1";
  const s = String(raw).trim().toUpperCase();
  if (s.startsWith("T") && VALID_SHOOB_TIERS.includes(s)) return s;
  if (/^\d$/.test(s)) return `T${s}`;
  if (s === "S") return "TS";
  if (s === "X") return "TX";
  if (s === "Z") return "TZ";
  return "T1";
}

function extractSeries(card: any): string {
  if (Array.isArray(card.category) && card.category.length > 0) {
    return (card.category[0] as string).trim() || "Shoob";
  }
  return (card.series || card.anime || "Shoob").trim() || "Shoob";
}

function isAnimatedCard(card: any): boolean {
  const file = String(card.file || "").toLowerCase();
  return (
    file.endsWith(".gif") ||
    file.endsWith(".webm") ||
    card.has_webp === true ||
    card.has_webm === true ||
    card.is_animated === true ||
    card.animated === true ||
    card.patched === true
  );
}

function shoobMediaUrl(card: any): { url: string; isVideo: boolean; isGif: boolean } {
  const id   = card._id || card.id;
  const file = String(card.file || "").toLowerCase();
  const isGif  = file.endsWith(".gif");
  const isWebm = card.has_webm === true;

  if (isWebm) {
    return { url: `${SHOOB_IMAGE_BASE}/${id}?type=webm`, isVideo: true, isGif: false };
  }
  return { url: `${SHOOB_IMAGE_BASE}/${id}?size=400`, isVideo: false, isGif };
}

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

async function isModOrAbove(ctx: CommandContext): Promise<boolean> {
  if (ctx.isOwner) return true;
  const staff = await getStaff(ctx.sender);
  return !!staff && ["owner", "guardian", "mod"].includes(staff.role);
}

async function genCardId(): Promise<string> {
  const { randomBytes } = await import("crypto");
  for (let attempt = 0; attempt < 50; attempt++) {
    const bytes = randomBytes(8);
    const candidate = Array.from(bytes as unknown as number[])
      .map((b: number) => ID_CHARS[b % ID_CHARS.length])
      .join("");
    if (!(await col("cards").findOne({ _id: candidate }))) return candidate;
  }
  return "C" + Date.now().toString(36).toUpperCase();
}

async function downloadImage(url: string, isGif: boolean, isVideo: boolean): Promise<{ buffer: Buffer; isVideo: boolean } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RequiemOrderBot/1.0)" },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const raw = Buffer.from(await res.arrayBuffer());

    if (isGif || isVideo) return { buffer: raw, isVideo: isVideo || isGif };

    try {
      const processed = await sharp(raw)
        .resize(800, 1100, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 92 })
        .toBuffer();
      return { buffer: processed, isVideo: false };
    } catch {
      return { buffer: raw, isVideo: false };
    }
  } catch {
    return null;
  }
}

async function fetchShoobPage(page: number): Promise<any[]> {
  const url = `${SHOOB_CARDS_ENDPOINT}?page=${page}`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; RequiemOrderBot/1.0)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Shoob API HTTP ${res.status} on page ${page}`);
  const data: any = await res.json();
  if (Array.isArray(data)) return data;
  return data.cards || data.data || data.results || [];
}

async function runShoobImport(
  syncOnly: boolean,
  uploader: string,
  progressCb: (msg: string) => Promise<void>,
): Promise<{ imported: number; updated: number; skipped: number; errors: number; totalSeen: number; durationMs: number }> {
  const startTime = Date.now();
  let imported = 0, updated = 0, skipped = 0, errors = 0, totalSeen = 0;
  let page = 1;

  while (true) {
    let pageCards: any[];
    try {
      pageCards = await fetchShoobPage(page);
    } catch (err: any) {
      logger.warn({ err, page }, "Shoob page fetch failed");
      break;
    }
    if (!pageCards.length) break;

    totalSeen += pageCards.length;

    for (const card of pageCards) {
      const shoobId: string = String(card._id || card.id || "").trim();
      if (!shoobId) { skipped++; continue; }

      if (syncOnly) {
        const alreadyRow = await col("shoob_imported_ids").findOne({ shoob_id: shoobId });
        if (alreadyRow) { skipped++; continue; }
      }

      const cardName: string = (card.name || card.slug || shoobId).trim().replace(/_/g, " ");
      const tier     = normaliseTier(card.tier);
      const series   = extractSeries(card);
      const animated = isAnimatedCard(card) ? 1 : 0;
      const { url: mediaUrl, isVideo, isGif } = shoobMediaUrl(card);

      const existingByShoobId = await col("cards").findOne({ shoob_id: shoobId });

      if (existingByShoobId && syncOnly) {
        await col("cards").updateOne(
          { _id: existingByShoobId._id },
          { $set: { name: cardName, tier, series, is_animated: animated, source: "shoob" } }
        );
        await col("shoob_imported_ids").updateOne(
          { shoob_id: shoobId },
          { $setOnInsert: { shoob_id: shoobId, local_card_id: existingByShoobId._id } },
          { upsert: true }
        );
        updated++;
        continue;
      }

      if (existingByShoobId && !syncOnly) {
        let imageData: Buffer | null = null;
        if (mediaUrl) {
          const dl = await downloadImage(mediaUrl, isGif, isVideo).catch(() => null);
          if (dl) imageData = dl.buffer;
          await new Promise(r => setTimeout(r, 120));
        }
        const updateSet: any = { name: cardName, tier, series, is_animated: animated, source: "shoob" };
        if (imageData) updateSet.image_data = imageData;
        await col("cards").updateOne({ _id: existingByShoobId._id }, { $set: updateSet });
        await col("shoob_imported_ids").updateOne(
          { shoob_id: shoobId },
          { $setOnInsert: { shoob_id: shoobId, local_card_id: existingByShoobId._id } },
          { upsert: true }
        );
        updated++;
        continue;
      }

      let imageData: Buffer | null = null;
      if (mediaUrl) {
        try {
          const dl = await downloadImage(mediaUrl, isGif, isVideo);
          if (dl) imageData = dl.buffer;
        } catch {
          errors++;
        }
        await new Promise(r => setTimeout(r, 120));
      }

      const localId = await genCardId();
      try {
        await col("cards").insertOne({
          _id: localId, name: cardName, series, tier,
          image_data: imageData,
          is_animated: animated,
          uploaded_by: uploader,
          source: "shoob",
          shoob_id: shoobId,
        });
        await col("shoob_imported_ids").insertOne({ shoob_id: shoobId, local_card_id: localId });
        imported++;
      } catch (err: any) {
        logger.warn({ err, shoobId }, "Failed to insert Shoob card");
        errors++;
      }
    }

    if (page % 5 === 0) {
      await progressCb(
        `⏳ Progress: page ${page} | +${imported} imported | ${updated} updated | ${skipped} skipped…`
      ).catch(() => {});
    }

    if (pageCards.length < SHOOB_PAGE_SIZE) break;
    page++;
  }

  return { imported, updated, skipped, errors, totalSeen, durationMs: Date.now() - startTime };
}

export async function handlePullCards(ctx: CommandContext): Promise<void> {
  const { from, sender } = ctx;

  if (!(await isModOrAbove(ctx))) {
    await sendText(from, "❌ Only mods, guardians, and owner can use .pullcards.");
    return;
  }

  await sendText(from,
    `🌐 *Starting full Shoob import…*\n\n` +
    `_Playwright browser will scrape React state from shoob.gg/cards,\n` +
    `downloading all media by card._id. ~2932 pages, ~43 980 cards._\n` +
    `_Progress updates every 5 pages._`
  );

  const uploader = sender.split("@")[0].split(":")[0];

  let stats: { imported: number; updated: number; skipped: number; errors: number; totalSeen: number; durationMs: number };

  let usedPlaywright = false;
  try {
    const { runPlaywrightScraper } = await import("../../scraper/shoob-playwright.js");
    stats = await runPlaywrightScraper({
      syncOnly: false,
      uploader,
      onProgress: async (msg) => { await sendText(from, msg); },
    });
    usedPlaywright = true;
  } catch (pwErr: any) {
    logger.warn({ pwErr }, "Playwright scraper unavailable — falling back to REST API");
    await sendText(from, `⚠️ Playwright unavailable (${pwErr?.message?.slice(0, 80)}…)\n_Falling back to REST API…_`);
    try {
      stats = await runShoobImport(false, uploader, async (msg) => { await sendText(from, msg); });
    } catch (err: any) {
      await sendText(from, `❌ Full import failed: ${err?.message || "Unknown error"}`);
      return;
    }
  }

  const dur = stats.durationMs >= 60000
    ? `${Math.floor(stats.durationMs / 60000)}m ${Math.floor((stats.durationMs % 60000) / 1000)}s`
    : `${Math.floor(stats.durationMs / 1000)}s`;

  await sendText(from,
    `✅ *Full Shoob import complete!*\n\n` +
    `🎴 Imported: *${stats.imported}* new cards\n` +
    `🔄 Updated:  *${stats.updated}* existing\n` +
    `⏭️ Skipped:  *${stats.skipped}*\n` +
    `⚠️ Errors:   *${stats.errors}*\n` +
    `📊 Total seen: *${stats.totalSeen}*\n` +
    `⏱️ Duration:  *${dur}*\n` +
    `🛠️ Method: ${usedPlaywright ? "Playwright (React state)" : "REST API fallback"}\n\n` +
    `_Run .cardlogs to see sync history._`
  );
}

export async function handleSyncCards(ctx: CommandContext): Promise<void> {
  const { from, sender } = ctx;

  if (!(await isModOrAbove(ctx))) {
    await sendText(from, "❌ Only mods, guardians, and owner can use .synccards.");
    return;
  }

  await sendText(from,
    `🔄 *Starting incremental Shoob sync…*\n\n` +
    `_Playwright scrapes React state from shoob.gg/cards.\n` +
    `Only new cards (not yet in DB by _id) will be downloaded._`
  );

  const uploader = sender.split("@")[0].split(":")[0];

  let stats: { imported: number; updated: number; skipped: number; errors: number; totalSeen: number; durationMs: number };

  let usedPlaywright = false;
  try {
    const { runPlaywrightScraper } = await import("../../scraper/shoob-playwright.js");
    stats = await runPlaywrightScraper({
      syncOnly: true,
      uploader,
      onProgress: async (msg) => { await sendText(from, msg); },
    });
    usedPlaywright = true;
  } catch (pwErr: any) {
    logger.warn({ pwErr }, "Playwright unavailable — falling back to REST API");
    await sendText(from, `⚠️ Playwright unavailable — using REST API fallback…`);
    try {
      stats = await runShoobImport(true, uploader, async (msg) => { await sendText(from, msg); });
    } catch (err: any) {
      await sendText(from, `❌ Sync failed: ${err?.message || "Unknown error"}`);
      return;
    }
  }

  const dur = stats.durationMs >= 60000
    ? `${Math.floor(stats.durationMs / 60000)}m ${Math.floor((stats.durationMs % 60000) / 1000)}s`
    : `${Math.floor(stats.durationMs / 1000)}s`;

  await sendText(from,
    `✅ *Sync complete!*\n\n` +
    `🎴 New cards imported: *${stats.imported}*\n` +
    `🔄 Metadata updated:   *${stats.updated}*\n` +
    `⏭️ Already had:        *${stats.skipped}*\n` +
    `⚠️ Errors:             *${stats.errors}*\n` +
    `📊 Total scanned:      *${stats.totalSeen}*\n` +
    `⏱️ Duration:           *${dur}*\n` +
    `🛠️ Method: ${usedPlaywright ? "Playwright (React state)" : "REST API fallback"}\n\n` +
    `_Run .pullcards for a full re-import with media re-download._`
  );
}

export async function handleCardLogs(ctx: CommandContext): Promise<void> {
  const { from } = ctx;

  if (!(await isModOrAbove(ctx))) {
    await sendText(from, "❌ Only mods, guardians, and owner can view .cardlogs.");
    return;
  }

  const [logs, totalCards, shoobCards, trackedIds] = await Promise.all([
    col("shoob_sync_log").find({}).sort({ ran_at: -1 }).limit(10).toArray(),
    col("cards").countDocuments({}),
    col("cards").countDocuments({ source: "shoob" }),
    col("shoob_imported_ids").countDocuments({}),
  ]);

  if (!logs.length) {
    await sendText(from,
      `📊 *Card Sync Logs*\n\n` +
      `No sync runs yet.\n\n` +
      `🎴 Total cards in DB: *${totalCards}*\n` +
      `🌐 From Shoob: *${shoobCards}*\n\n` +
      `Run *.pullcards* for a full import or *.synccards* for incremental.`
    );
    return;
  }

  const fmtTs  = (ts: number) => new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const fmtDur = (ms: number) => ms >= 60000
    ? `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
    : `${Math.floor(ms / 1000)}s`;

  const rows = logs.map((r: any) => {
    const typeEmoji = r.run_type === "full" ? "📦" : "🔄";
    return (
      `   │✑ ${typeEmoji} *${r.run_type}* — ${fmtTs(r.ran_at)}\n` +
      `   │    +${r.imported} new · ${r.updated} upd · ${r.skipped} skip · ${r.errors} err · ${fmtDur(r.duration_ms)}`
    );
  }).join("\n");

  const header = `┌─❖\n│「 𝗥𝗘𝗤𝗨𝗜𝗘𝗠 」\n└┬❖ 「 📊 𝗖𝗮𝗿𝗱 𝗦𝘆𝗻𝗰 𝗟𝗼𝗴𝘀 」\n`;
  const body   =
    `   │ 🎴 Total cards: *${totalCards}* (${shoobCards} from Shoob)\n` +
    `   │ 🔗 Tracked Shoob IDs: *${trackedIds}*\n` +
    `   ├────────────┈ ⳹\n` +
    `   │ Last ${logs.length} runs:\n` +
    rows + `\n` +
    `   └────────────┈ ⳹`;

  await sendText(from, header + body);
}
