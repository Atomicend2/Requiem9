/**
 * scraper-runner.mjs
 * Scrapes Shoob.gg card METADATA only — no images downloaded.
 * Images are fetched on demand by the bot from Shoob's CDN.
 * This keeps the repo small and pushes fast.
 *
 * Output: cards.json at repo root
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SYNC_ONLY    = process.env.SHOOB_SYNC_ONLY === "true";
const CARDS_OUT    = path.resolve(__dirname, process.env.CARDS_OUTPUT || "../../cards.json");
const REPO_ROOT    = path.resolve(__dirname, "../../");
const COMMIT_EVERY = 100; // commit every 100 pages (~1500 cards)
const PAGE_DELAY   = 800;
const SHOOB_PAGE_SIZE  = 15;
const SHOOB_CARDS_URL  = "https://shoob.gg/cards";
const SHOOB_CARDR_BASE = "https://api.shoob.gg/site/api/cardr";

const REACT_EXTRACT_SCRIPT = `
  (() => {
    try {
      const el = document.querySelector('.card-main');
      if (!el) return { error: 'no .card-main element found' };
      let f = Object.values(el).find(x => x?.return);
      if (!f) return { error: 'no React fiber found on .card-main' };
      while (f && !f.stateNode?.state?.cards) { f = f.return; }
      if (!f || !f.stateNode?.state?.cards) return { error: 'card state not found in fiber tree' };
      const cards = f.stateNode.state.cards;
      if (!Array.isArray(cards)) return { error: 'cards is not an array' };
      return { cards };
    } catch (e) { return { error: String(e) }; }
  })()
`;

function normaliseTier(raw) {
  if (raw == null) return "T1";
  const s = String(raw).trim().toUpperCase();
  const VALID = ["T1","T2","T3","T4","T5","T6","TS","TX","TZ"];
  if (s.startsWith("T") && VALID.includes(s)) return s;
  if (/^\d$/.test(s)) return `T${s}`;
  if (s === "S") return "TS";
  if (s === "X") return "TX";
  if (s === "Z") return "TZ";
  return "T1";
}

function extractSeries(card) {
  if (Array.isArray(card.category) && card.category.length > 0) {
    return (card.category[0] || "Shoob").trim() || "Shoob";
  }
  return "Shoob";
}

function isAnimated(card) {
  const file = String(card.file || "").toLowerCase();
  return file.endsWith(".gif") || file.endsWith(".webm") ||
    card.has_webp === true || card.has_webm === true || card.patched === true;
}

function getMediaUrl(card) {
  const id = card._id || card.id;
  if (card.has_webm) return `${SHOOB_CARDR_BASE}/${id}?type=webm`;
  return `${SHOOB_CARDR_BASE}/${id}?size=400`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadExistingCards() {
  try {
    if (fs.existsSync(CARDS_OUT)) {
      const data = JSON.parse(fs.readFileSync(CARDS_OUT, "utf8"));
      const map = new Map();
      for (const c of (data.cards || [])) map.set(c.shoob_id, c);
      return map;
    }
  } catch {}
  return new Map();
}

function gitPush(pageNum, totalCards) {
  try {
    execSync(`git -C "${REPO_ROOT}" add cards.json`, { stdio: "pipe" });
    const diff = execSync(`git -C "${REPO_ROOT}" diff --staged --name-only`, { stdio: "pipe" }).toString().trim();
    if (!diff) {
      console.log(`  [git] Nothing new at page ${pageNum}`);
      return true;
    }
    execSync(`git -C "${REPO_ROOT}" commit -m "chore: cards at page ${pageNum} (${totalCards} total) [skip ci]"`, { stdio: "pipe" });

    for (let i = 1; i <= 5; i++) {
      try {
        // Pull with rebase first to avoid diverged branch conflicts
        try {
          execSync(`git -C "${REPO_ROOT}" pull --rebase origin HEAD`, { stdio: "pipe" });
        } catch {
          // If pull fails (e.g. nothing to pull), continue anyway
        }
        execSync(`git -C "${REPO_ROOT}" push origin HEAD`, { stdio: "pipe" });
        console.log(`  [git] ✓ Pushed at page ${pageNum} (${totalCards} cards)`);
        return true;
      } catch (pushErr) {
        console.warn(`  [git] Push attempt ${i} failed: ${pushErr.message?.slice(0, 100)}, waiting 15s...`);
        execSync("sleep 15");
      }
    }
    console.warn(`  [git] All push attempts failed at page ${pageNum} — will retry next batch`);
    return false;
  } catch (e) {
    console.warn(`  [git] Error: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log(`\n🚀 Shoob scraper — metadata only, no images`);
  console.log(`   Output      : ${CARDS_OUT}`);
  console.log(`   Sync only   : ${SYNC_ONLY}`);
  console.log(`   Commit every: ${COMMIT_EVERY} pages\n`);

  // Git config
  try {
    execSync(`git -C "${REPO_ROOT}" config user.name "github-actions[bot]"`, { stdio: "pipe" });
    execSync(`git -C "${REPO_ROOT}" config user.email "github-actions[bot]@users.noreply.github.com"`, { stdio: "pipe" });
    // If GITHUB_TOKEN is available, set authenticated remote URL for push
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
      const remoteUrl = `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`;
      execSync(`git -C "${REPO_ROOT}" remote set-url origin "${remoteUrl}"`, { stdio: "pipe" });
    }
  } catch {}

  const existingCards = loadExistingCards();
  console.log(`   Existing cards: ${existingCards.size}`);

  const allCards = new Map(existingCards);
  const stats = { imported: 0, updated: 0, skipped: 0, errors: 0, totalSeen: 0 };
  const startTime = Date.now();

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu"],
  });

  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });

  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(30000);
  page.setDefaultTimeout(20000);

  let pageNum = 1;

  try {
    while (true) {
      const url = `${SHOOB_CARDS_URL}?page=${pageNum}`;
      console.log(`[Page ${pageNum}] Navigating...`);

      try {
        await page.goto(url, { waitUntil: "networkidle" });
      } catch {
        try {
          await page.goto(url, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(3000);
        } catch (e) {
          console.warn(`  ⚠ Navigation failed: ${e.message}`);
          break;
        }
      }

      try {
        await page.waitForSelector(".card-main", { timeout: 20000 });
      } catch {
        console.log(`  No more cards at page ${pageNum} — done`);
        break;
      }

      const result = await page.evaluate(REACT_EXTRACT_SCRIPT);

      if (result.error) {
        if (pageNum === 1) throw new Error(`React extraction failed: ${result.error}`);
        console.log(`  End of catalogue at page ${pageNum}`);
        break;
      }

      const cards = result.cards || [];
      if (cards.length === 0) {
        console.log(`  No cards at page ${pageNum} — done`);
        break;
      }

      stats.totalSeen += cards.length;
      console.log(`  Got ${cards.length} cards`);

      for (const card of cards) {
        const shoobId = String(card._id || card.id || "").trim();
        if (!shoobId) { stats.skipped++; continue; }

        const alreadyHave = existingCards.has(shoobId);

        if (SYNC_ONLY && alreadyHave) {
          // Update metadata in case it changed
          const existing = allCards.get(shoobId);
          if (existing) {
            existing.name      = (card.name || card.slug || shoobId).replace(/_/g, " ");
            existing.tier      = normaliseTier(card.tier);
            existing.series    = extractSeries(card);
            existing.media_url = getMediaUrl(card);
            existing.raw       = card;
          }
          stats.skipped++;
          continue;
        }

        // Metadata only — no images, no raw field (keeps cards.json small)
        const record = {
          shoob_id   : shoobId,
          name       : (card.name || card.slug || shoobId).trim().replace(/_/g, " "),
          tier       : normaliseTier(card.tier),
          series     : extractSeries(card),
          is_animated: isAnimated(card),
          media_url  : getMediaUrl(card),
          has_webm   : card.has_webm === true,
          has_webp   : card.has_webp === true,
          slug       : card.slug || "",
          file_hash  : card.file || "",
          scraped_at : Math.floor(Date.now() / 1000),
        };

        allCards.set(shoobId, record);
        alreadyHave ? stats.updated++ : stats.imported++;
      }

      // Save cards.json after every page
      const output = {
        version    : 1,
        total      : allCards.size,
        updated_at : new Date().toISOString(),
        cards      : [...allCards.values()],
      };
      fs.writeFileSync(CARDS_OUT, JSON.stringify(output, null, 2));

      // Commit every COMMIT_EVERY pages
      if (pageNum % COMMIT_EVERY === 0) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`\n📊 Page ${pageNum}: seen=${stats.totalSeen} imported=${stats.imported} skipped=${stats.skipped} (${elapsed}s)`);
        gitPush(pageNum, allCards.size);
        console.log();
      }

      if (cards.length < SHOOB_PAGE_SIZE) {
        console.log(`  Last page (only ${cards.length} cards)`);
        break;
      }

      pageNum++;
      await sleep(PAGE_DELAY);
    }
  } finally {
    await browser.close();
  }

  // Final commit
  console.log(`\n📦 Final commit...`);
  gitPush(pageNum, allCards.size);

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n✅ Done! total=${allCards.size} imported=${stats.imported} updated=${stats.updated} errors=${stats.errors} time=${duration}s pages=${pageNum}\n`);
}

main().catch(err => {
  console.error("❌ Scraper failed:", err);
  process.exit(1);
});
