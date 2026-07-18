/**
 * shoob-playwright.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Playwright-based Shoob.gg card scraper.
 *
 * Architecture (exactly as specified):
 *
 *   Shoob.gg
 *   ↓
 *   Playwright Browser
 *   ↓
 *   React State Extraction  ← the ONLY correct method (no DOM scraping, no REST)
 *   ↓
 *   Card Objects (raw, untransformed)
 *   ↓
 *   Media Downloader  ← by card._id, never by name/slug
 *   ↓
 *   MongoDB Database
 *   ↓
 *   Web Dashboard  +  WhatsApp Bot  (both read from DB, never scrape Shoob)
 *
 * React state extraction (from user-confirmed browser console method):
 *
 *   let f = Object.values(document.querySelector('.card-main'))
 *     .find(x => x?.return);
 *   while (f && !f.stateNode?.state?.cards)
 *     f = f.return;
 *   return f.stateNode.state.cards;
 *
 * Media URLs:
 *   Static PNG:   https://api.shoob.gg/site/api/cardr/{_id}?size=400
 *   WebM video:   https://api.shoob.gg/site/api/cardr/{_id}?type=webm   (has_webm=true)
 *   GIF:          https://api.shoob.gg/site/api/cardr/{_id}?size=400    (file ends .gif)
 *
 * Supported media types (stored as-is, never converted):
 *   png, jpg, jpeg, gif, webp, webm
 *
 * Pages: 1 → 2932 (15 cards per page, ~43 980 total)
 */

import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";
import { col } from "../bot/db/mongo.js";
import { logger } from "../lib/logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const SHOOB_CARDS_URL  = "https://shoob.gg/cards";
const SHOOB_CARDR_BASE = "https://api.shoob.gg/site/api/cardr";

/** Shoob returns exactly 15 cards per page. */
const SHOOB_PAGE_SIZE  = 15;

/** Max pages to scrape (2932 at time of writing). Override via SHOOB_MAX_PAGES env. */
const MAX_PAGES = parseInt(process.env.SHOOB_MAX_PAGES || "9999", 10);

/** Starting page (useful for resuming a stopped run). */
const START_PAGE = parseInt(process.env.SHOOB_START_PAGE || "1", 10);

/** Delay between pages (ms) to avoid rate-limiting. */
const PAGE_DELAY_MS = parseInt(process.env.SHOOB_PAGE_DELAY || "800", 10);

/** Delay between media downloads (ms). */
const MEDIA_DELAY_MS = parseInt(process.env.SHOOB_MEDIA_DELAY || "120", 10);

/** Timeout for page navigation (ms). */
const NAV_TIMEOUT_MS = 30000;

/** Timeout for React state to appear (ms). */
const REACT_TIMEOUT_MS = 20000;

/** Download timeout per media file (ms). */
const DOWNLOAD_TIMEOUT_MS = 30000;

// ── Type: raw Shoob card shape ────────────────────────────────────────────────

export interface ShoobCard {
  _id: string;
  id?: string;
  name: string;
  tier: string;
  slug: string;
  slugged?: string;
  file: string;
  has_webp: boolean;
  has_webm: boolean;
  patched?: boolean;
  authors?: any[];
  category?: string[];
  ability?: boolean;
  ability_desc?: string;
  ability_gif?: string;
  ability_name?: string;
  claim_count?: number;
  attributes?: any[];
  partners?: any[];
  server_id?: string | null;
  __v?: number;
}

// ── React state extraction script ─────────────────────────────────────────────

/**
 * This is the exact extraction logic the user confirmed works in the browser console.
 * It reads directly from React's internal fiber tree — no DOM scraping, no REST calls.
 */
const REACT_EXTRACT_SCRIPT = `
  (() => {
    try {
      const el = document.querySelector('.card-main');
      if (!el) return { error: 'no .card-main element found' };
      
      // Walk React fiber to find the component holding card state
      let f = Object.values(el).find(x => x?.return);
      if (!f) return { error: 'no React fiber found on .card-main' };
      
      while (f && !f.stateNode?.state?.cards) {
        f = f.return;
      }
      
      if (!f || !f.stateNode?.state?.cards) {
        return { error: 'card state not found in fiber tree' };
      }
      
      const cards = f.stateNode.state.cards;
      if (!Array.isArray(cards)) return { error: 'cards is not an array' };
      return { cards };
    } catch (e) {
      return { error: String(e) };
    }
  })()
`;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise Shoob tier to bot T-prefix format.
 * Shoob: "1"–"6", "S", "X", "Z"  →  Bot: "T1"–"T6", "TS", "TX", "TZ"
 */
function normaliseTier(raw: string | number | undefined | null): string {
  if (raw === null || raw === undefined) return "T1";
  const s = String(raw).trim().toUpperCase();
  const VALID = ["T1","T2","T3","T4","T5","T6","TS","TX","TZ"];
  if (s.startsWith("T") && VALID.includes(s)) return s;
  if (/^\d$/.test(s)) return `T${s}`;
  if (s === "S") return "TS";
  if (s === "X") return "TX";
  if (s === "Z") return "TZ";
  return "T1";
}

/** Extract the series/anime from Shoob's category array. */
function extractSeries(card: ShoobCard): string {
  if (Array.isArray(card.category) && card.category.length > 0) {
    return (card.category[0] as string).trim() || "Shoob";
  }
  return "Shoob";
}

/**
 * Determine if a card has animated media.
 * Checks: file extension, has_webm, has_webp, patched flag.
 */
function isAnimatedCard(card: ShoobCard): boolean {
  const file = String(card.file || "").toLowerCase();
  return (
    file.endsWith(".gif") ||
    file.endsWith(".webm") ||
    card.has_webp === true ||
    card.has_webm === true ||
    card.patched === true
  );
}

/**
 * Build the best download URL for a card's media.
 * Primary key used: card._id (never name, slug, or file hash alone).
 *
 * has_webm=true → download WebM (best quality for animated)
 * file ends .gif → download via cardr endpoint (returns original GIF)
 * otherwise      → download static image via cardr endpoint
 */
function buildMediaUrl(card: ShoobCard): { url: string; isWebm: boolean; isGif: boolean } {
  const id   = card._id || card.id!;
  const file = String(card.file || "").toLowerCase();
  const isGif  = file.endsWith(".gif");
  const isWebm = card.has_webm === true;

  if (isWebm) {
    return {
      url: `${SHOOB_CARDR_BASE}/${id}?type=webm`,
      isWebm: true,
      isGif: false,
    };
  }
  return {
    url: `${SHOOB_CARDR_BASE}/${id}?size=400`,
    isWebm: false,
    isGif,
  };
}

/** Generate a unique local card ID (MongoDB-safe). */
async function genCardId(): Promise<string> {
  const { randomBytes } = await import("crypto");
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 100; i++) {
    const bytes = randomBytes(8);
    const candidate = Array.from(bytes as unknown as number[])
      .map((b: number) => CHARS[b % CHARS.length])
      .join("");
    if (!(await col("cards").findOne({ _id: candidate }))) return candidate;
  }
  return "C" + Date.now().toString(36).toUpperCase();
}

/**
 * Download media for a card.
 * - WebM/GIF: stored as-is (never converted)
 * - PNG/JPG:  resized via sharp for consistent dimensions
 * Returns { buffer, isVideo } or null on failure.
 */
async function downloadMedia(
  url: string,
  isWebm: boolean,
  isGif: boolean,
): Promise<{ buffer: Buffer; isVideo: boolean } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "image/*, video/*, */*",
        "Referer": "https://shoob.gg/",
      },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });

    if (!res.ok) {
      logger.warn({ status: res.status, url }, "Media download failed");
      return null;
    }

    const raw = Buffer.from(await res.arrayBuffer());

    if (isWebm || isGif) {
      // Animated media: store the original bytes without any processing
      return { buffer: raw, isVideo: true };
    }

    // Static image: normalise dimensions
    try {
      const processed = await sharp(raw)
        .resize(800, 1100, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 92 })
        .toBuffer();
      return { buffer: processed, isVideo: false };
    } catch {
      // sharp failed (e.g. already optimised) — keep raw
      return { buffer: raw, isVideo: false };
    }
  } catch (err: any) {
    logger.warn({ err, url }, "Media download exception");
    return null;
  }
}

// ── Core: process one page of cards ─────────────────────────────────────────

async function processCards(
  cards: ShoobCard[],
  syncOnly: boolean,
  uploader: string,
  stats: { imported: number; updated: number; skipped: number; errors: number },
): Promise<void> {
  for (const card of cards) {
    // ── Primary key: always _id, never name/slug ──────────────────────────
    const shoobId = String(card._id || card.id || "").trim();
    if (!shoobId) {
      logger.warn({ card }, "Card has no _id — skipping");
      stats.skipped++;
      continue;
    }

    // ── Incremental mode: skip already-imported cards ─────────────────────
    if (syncOnly) {
      const existing = await col("shoob_imported_ids").findOne({ shoob_id: shoobId });
      if (existing) {
        stats.skipped++;
        continue;
      }
    }

    // ── Derive display fields (minimally transformed for bot display) ──────
    const cardName   = (card.name || card.slug || shoobId).trim().replace(/_/g, " ");
    const tier       = normaliseTier(card.tier);
    const series     = extractSeries(card);
    const animated   = isAnimatedCard(card) ? 1 : 0;

    // ── Store raw Shoob card object exactly as returned ────────────────────
    const rawJson    = JSON.stringify(card);
    const fileHash   = card.file || "";
    const hasWebm    = card.has_webm ? 1 : 0;
    const hasWebp    = card.has_webp ? 1 : 0;
    const slug       = card.slug || "";

    const { url: mediaUrl, isWebm, isGif } = buildMediaUrl(card);

    // ── Check if already in DB by shoob_id ────────────────────────────────
    const existingRow = await col("cards").findOne({ shoob_id: shoobId });

    if (existingRow) {
      // Update metadata + raw_data. Re-download media only in full-pull mode.
      let imageData: Buffer | null = null;
      if (!syncOnly && mediaUrl) {
        const dl = await downloadMedia(mediaUrl, isWebm, isGif).catch(() => null);
        if (dl) imageData = dl.buffer;
        await new Promise(r => setTimeout(r, MEDIA_DELAY_MS));
      }

      const updateSet: any = {
        name: cardName, tier, series, is_animated: animated,
        raw_data: rawJson, file_hash: fileHash,
        has_webm: hasWebm, has_webp: hasWebp, slug,
        source: "shoob",
      };
      if (!syncOnly && imageData) updateSet.image_data = imageData;

      await col("cards").updateOne({ _id: existingRow._id }, { $set: updateSet });
      await col("shoob_imported_ids").updateOne(
        { shoob_id: shoobId },
        { $setOnInsert: { shoob_id: shoobId, local_card_id: existingRow._id } },
        { upsert: true }
      );

      stats.updated++;
      continue;
    }

    // ── New card: download media then insert ───────────────────────────────
    let imageData: Buffer | null = null;
    if (mediaUrl) {
      try {
        const dl = await downloadMedia(mediaUrl, isWebm, isGif);
        if (dl) imageData = dl.buffer;
      } catch {
        stats.errors++;
      }
      await new Promise(r => setTimeout(r, MEDIA_DELAY_MS));
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
        raw_data: rawJson,
        file_hash: fileHash,
        has_webm: hasWebm,
        has_webp: hasWebp,
        slug,
      });

      await col("shoob_imported_ids").insertOne({ shoob_id: shoobId, local_card_id: localId });

      stats.imported++;
    } catch (err: any) {
      logger.warn({ err, shoobId }, "DB insert failed");
      stats.errors++;
    }
  }
}

// ── Playwright scraper ───────────────────────────────────────────────────────

export interface ScraperOptions {
  /** true = skip cards already in shoob_imported_ids */
  syncOnly?: boolean;
  /** Bot phone / user identifier stored on new cards */
  uploader?: string;
  /** Called every 5 pages with a progress string */
  onProgress?: ((msg: string) => Promise<void> | void) | undefined;
  /** If set, start from this page (useful for resuming) */
  startPage?: number;
  /** If set, stop after this page */
  maxPage?: number;
}

export interface ScraperResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
  totalSeen: number;
  pagesScraped: number;
  durationMs: number;
}

/**
 * Main scraper entry point.
 *
 * Launches Playwright, navigates through every page of shoob.gg/cards,
 * extracts card data from React state, downloads media, and persists to MongoDB.
 */
export async function runPlaywrightScraper(opts: ScraperOptions = {}): Promise<ScraperResult> {
  const {
    syncOnly  = false,
    uploader  = "system",
    onProgress,
    startPage = START_PAGE,
    maxPage   = MAX_PAGES,
  } = opts;

  const startTime = Date.now();
  const stats     = { imported: 0, updated: 0, skipped: 0, errors: 0, totalSeen: 0, pagesScraped: 0 };

  let browser: Browser | null = null;
  let page: Page   | null = null;

  try {
    logger.info({ syncOnly, startPage, maxPage }, "Launching Playwright browser for Shoob scrape");

    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-web-security",
      ],
    });

    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
    });

    page = await ctx.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    page.setDefaultTimeout(REACT_TIMEOUT_MS);

    // ── Iterate through all pages ─────────────────────────────────────────
    for (let pageNum = startPage; pageNum <= maxPage; pageNum++) {
      const url = `${SHOOB_CARDS_URL}?page=${pageNum}`;
      logger.info({ pageNum, url }, "Navigating to Shoob page");

      try {
        await page.goto(url, { waitUntil: "networkidle" });
      } catch (navErr: any) {
        logger.warn({ navErr, pageNum }, "Navigation failed — retrying once");
        try {
          await page.goto(url, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(3000);
        } catch {
          logger.error({ pageNum }, "Page navigation failed twice — stopping");
          break;
        }
      }

      // ── Wait for React to render .card-main ──────────────────────────────
      try {
        await page.waitForSelector(".card-main", { timeout: REACT_TIMEOUT_MS });
      } catch {
        logger.warn({ pageNum }, ".card-main not found — may be last page or error");
      }

      // ── Execute React state extraction ────────────────────────────────────
      const result = await page.evaluate(REACT_EXTRACT_SCRIPT) as { cards?: ShoobCard[]; error?: string };

      if (result.error) {
        logger.warn({ pageNum, error: result.error }, "React extraction error");
        if (pageNum === startPage) {
          throw new Error(`React extraction failed on page ${pageNum}: ${result.error}`);
        }
        logger.info({ pageNum }, "Assuming end of cards — stopping");
        break;
      }

      const cards = result.cards || [];
      if (cards.length === 0) {
        logger.info({ pageNum }, "No cards on page — end of catalogue");
        break;
      }

      stats.totalSeen += cards.length;
      stats.pagesScraped++;

      logger.info({ pageNum, cardCount: cards.length }, "Extracted cards from React state");

      // ── Process and persist cards ─────────────────────────────────────────
      await processCards(cards, syncOnly, uploader, stats);

      // ── Progress update every 5 pages ────────────────────────────────────
      if (pageNum % 5 === 0 && onProgress) {
        await onProgress(
          `⏳ Page ${pageNum} | +${stats.imported} new | ${stats.updated} updated | ${stats.skipped} skipped`
        );
      }

      // ── Stop if this was a partial page (last page) ───────────────────────
      if (cards.length < SHOOB_PAGE_SIZE) {
        logger.info({ pageNum, cards: cards.length }, "Partial page — reached end of Shoob catalogue");
        break;
      }

      // ── Rate-limit delay between pages ────────────────────────────────────
      if (pageNum < maxPage) {
        await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
      }
    }

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  const durationMs = Date.now() - startTime;

  // ── Log this run to shoob_sync_log ────────────────────────────────────────
  try {
    await col("shoob_sync_log").insertOne({
      run_type: syncOnly ? "playwright-incremental" : "playwright-full",
      started_by: uploader,
      imported: stats.imported,
      updated: stats.updated,
      skipped: stats.skipped,
      errors: stats.errors,
      total_seen: stats.totalSeen,
      duration_ms: durationMs,
      ran_at: Math.floor(Date.now() / 1000),
    });
  } catch (logErr) {
    logger.warn({ logErr }, "Failed to write sync log");
  }

  logger.info({ ...stats, durationMs }, "Playwright scraper complete");
  return { ...stats, durationMs };
}

// ── CLI entry point (node src/scraper/shoob-playwright.js) ──────────────────

if (process.argv[1]?.endsWith("shoob-playwright.js") || process.argv[1]?.endsWith("shoob-playwright.ts")) {
  const mode = process.argv[2] || "incremental";
  const isSync = mode === "incremental" || mode === "sync";

  console.log(`\n🌐 Shoob Playwright Scraper — mode: ${isSync ? "incremental" : "full"}`);
  console.log(`   Start page: ${START_PAGE} | Max pages: ${MAX_PAGES}`);
  console.log(`   Page delay: ${PAGE_DELAY_MS}ms | Media delay: ${MEDIA_DELAY_MS}ms\n`);

  runPlaywrightScraper({
    syncOnly: isSync,
    uploader: "cli",
    onProgress: (msg) => console.log(msg),
  }).then((result) => {
    const dur = result.durationMs >= 60000
      ? `${Math.floor(result.durationMs / 60000)}m ${Math.floor((result.durationMs % 60000) / 1000)}s`
      : `${Math.floor(result.durationMs / 1000)}s`;
    console.log(`\n✅ Done!`);
    console.log(`   Imported: ${result.imported} | Updated: ${result.updated} | Skipped: ${result.skipped} | Errors: ${result.errors}`);
    console.log(`   Total seen: ${result.totalSeen} | Pages: ${result.pagesScraped} | Duration: ${dur}\n`);
  }).catch((err) => {
    console.error(`\n❌ Scraper failed: ${err?.message}\n`);
    process.exit(1);
  });
}
