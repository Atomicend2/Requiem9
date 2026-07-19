// Must run before `sharp` is imported — libvips/librsvg can initialize its
// fontconfig instance on first touch, and setting FONTCONFIG_PATH after
// that point is too late on some platforms. See font-setup.ts for why this
// exists (fixes boxed-hex-codepoint / unrendered-emoji text in generated
// profile/welcome/card images).
import "./font-setup.js";
import sharp from "sharp";

// ─────────────────────────────────────────────────────────────────────────────
//  Global sharp/libvips memory configuration — MUST run before any other
//  code touches sharp (hence being the very first thing in the entry point).
//
//  sharp is imported in 11 different files across this codebase, but
//  Node's module cache means they all share the same underlying native
//  libvips instance — so this only needs to be set once, here, for the
//  whole process.
//
//  This is a well-documented, well-known memory issue, not a guess:
//  libvips keeps an internal operation cache (up to 50MB / 100 items by
//  default) to speed up repeated transforms of the SAME image, which is
//  useless for a bot that processes a different card image on every call
//  and just adds pure overhead. Worse, on glibc-based Linux (which this
//  container runs), libvips' default per-operation multi-threading
//  (one thread per CPU core) is documented to fragment the heap under
//  sustained small-allocation-per-request workloads like this one — RSS
//  climbs steadily call after call and is never fully returned to the OS,
//  even though each individual call's buffers are well within any
//  explicit size cap in the code. This is exactly the "no crash on the
//  first .ci, but the server OOMs after a handful of card lookups over
//  ~30 seconds" pattern seen in production logs — the code has no memory
//  leak in the JS sense, but libvips' native memory footprint keeps
//  growing underneath it across calls.
//
//  cache(false) disables that useless-for-us cache entirely, and
//  concurrency(1) keeps each image operation single-threaded — slightly
//  slower per-image, but bounded and predictable memory use, which is far
//  more important than raw speed on a 512 MB instance running alongside
//  ffmpeg and a live WhatsApp socket.
sharp.cache(false);
sharp.concurrency(1);

// ─────────────────────────────────────────────────────────────────────────────
//  Suppress @whiskeysockets/baileys' bundled libsignal session-store debug
//  spam — MUST run before Baileys (or anything that imports it) is loaded.
//
//  Baileys 7.0.0-rc13's internal signal session store calls
//  `console.log("Closing session:", session)` / `console.trace(...)`
//  directly on every session rotation/close, completely bypassing the
//  `logger`/`silentLogger` option passed to makeWASocket() in
//  bot/connection.ts. Each call synchronously stringifies a full
//  SessionEntry object — nested chain keys, root keys, ephemeral key
//  Buffers, the works — which is real CPU/IO cost, not just noise, and in
//  production this fires dozens of times per reconnect/session-rotation
//  cycle (visible as large multi-line Buffer dumps flooding the Render
//  log). This directly eats into the same single CPU core that serves
//  every WhatsApp command and every web API request, so it's a genuine
//  contributor to the ".ci/.ss slow" and "admin API stalls during bot
//  activity" symptoms, not just log clutter.
//
//  We can't fix this at the source (it's inside the dependency, and this
//  environment has no network access to patch/upgrade the package), so we
//  intercept at the console level instead — narrowly, by matching only
//  known literal message prefixes, so no other legitimate console output
//  anywhere else in the app or any other dependency is affected.
//
//  CORRECTED (2026-07-19): the previous version of this fix intercepted
//  console.log/console.trace with the prefixes "Closing session:" /
//  "Closing sessions for" and suppressed nothing in production — verified
//  by reading the actual installed dependency source
//  (node_modules/libsignal@6.0.0/src/session_record.js), which calls
//  console.info (not console.log/trace) with messages including
//  "Removing old closed session:", "Closing session:", "Opening session:",
//  and via console.warn: "Session already closed", "Session already open",
//  "Decrypted message with closed session." — several of these dump a
//  full SessionEntry (nested chain keys, root keys, ephemeral key Buffers)
//  on every session rotation. This is what actually produced the
//  dozens-of-lines-per-reconnect flood seen in production logs, and the
//  synchronous JSON-like stringification of those Buffers is real,
//  measurable CPU time stolen from the same event loop that serves every
//  WhatsApp command and web API request — worst right after a Render
//  cold-start, when many sessions rotate back-to-back while requests are
//  also arriving.
const originalConsoleLog   = console.log.bind(console);
const originalConsoleInfo  = console.info.bind(console);
const originalConsoleWarn  = console.warn.bind(console);
const originalConsoleTrace = console.trace.bind(console);
const SUPPRESSED_LOG_PREFIXES = [
  "Closing session:",
  "Closing sessions for",
  "Removing old closed session:",
  "Opening session:",
  "Session already closed",
  "Session already open",
  "Decrypted message with closed session.",
];
function isSuppressedLog(args: unknown[]): boolean {
  const first = args[0];
  return typeof first === "string" && SUPPRESSED_LOG_PREFIXES.some((p) => first.startsWith(p));
}
console.log = (...args: unknown[]) => {
  if (isSuppressedLog(args)) return;
  originalConsoleLog(...args);
};
console.info = (...args: unknown[]) => {
  if (isSuppressedLog(args)) return;
  originalConsoleInfo(...args);
};
console.warn = (...args: unknown[]) => {
  if (isSuppressedLog(args)) return;
  originalConsoleWarn(...args);
};
console.trace = (...args: unknown[]) => {
  if (isSuppressedLog(args)) return;
  originalConsoleTrace(...args);
};

import app from "./app";
import { logger } from "./lib/logger";
import { connectToWhatsApp, gracefulShutdown } from "./bot/connection.js";
import { initDb } from "./bot/db/database.js";
import { seedDefaultFrames, seedTensuraFrames } from "./bot/frames.js";
import { loadCardsFromRepo } from "./bot/cards-loader.js";
import { loadMazokuCards } from "./bot/mazoku-cards-loader.js";
import { initManagedBots } from "./bot/bot-manager.js";
import { verifyFfmpegAvailable } from "./lib/ffmpeg-path.js";
import { col } from "./bot/db/mongo.js";

const rawPort = process.env["PORT"] || "5000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown initiated");
  try {
    await gracefulShutdown();
  } catch {}
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

/**
 * Global safety nets. Without these, Node terminates the whole process
 * (often with exit code 134 / SIGABRT) the moment any promise rejects
 * without a .catch() anywhere in the chain — e.g. a stray fire-and-forget
 * call inside a Baileys event listener, a background timer, etc. This is
 * the most likely cause of "bot stops responding after one card command
 * and the instance restarts" — a single unhandled rejection took down the
 * entire server, not just that one command.
 *
 * These handlers must never themselves throw or exit; they only log.
 */
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — process kept alive");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — process kept alive");
});

// ── Memory monitor ──────────────────────────────────────────────────────────
// Logs a full memory snapshot every 30 s. At ≥ 80% heap, emits a WARN so we
// can detect pre-OOM conditions in Render logs before a SIGKILL occurs.
import { getHeapStatistics } from "v8";
setInterval(() => {
  const heap  = getHeapStatistics();
  const mem   = process.memoryUsage();
  const usedMb    = Math.round(heap.used_heap_size  / 1024 / 1024);
  const totalMb   = Math.round(heap.total_heap_size / 1024 / 1024);
  const limitMb   = Math.round(heap.heap_size_limit / 1024 / 1024);
  const rssMb     = Math.round(mem.rss            / 1024 / 1024);
  const extMb     = Math.round(mem.external       / 1024 / 1024);
  const pct       = Math.round((heap.used_heap_size / heap.heap_size_limit) * 100);
  const logFn     = pct >= 80 ? logger.warn.bind(logger) : logger.debug.bind(logger);
  logFn(
    { heapUsedMb: usedMb, heapTotalMb: totalMb, heapLimitMb: limitMb, rssMb, externalMb: extMb, heapPct: pct },
    pct >= 80
      ? `⚠️  High heap: ${usedMb}/${limitMb} MB (${pct}%) — approaching OOM threshold`
      : `Memory: heap ${usedMb}/${limitMb} MB (${pct}%), RSS ${rssMb} MB, ext ${extMb} MB`
  );
}, 30_000).unref();

/** Retry MongoDB + bot init in the background — never crash the HTTP server */
async function initDbWithRetry(maxAttempts = 10, delayMs = 5000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await initDb();
      logger.info("MongoDB initialized");
      return;
    } catch (err) {
      logger.error({ err, attempt, maxAttempts }, "MongoDB connection failed — retrying...");
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  logger.error("MongoDB failed after all retries — bot features unavailable but HTTP server is still running");
}

async function main() {
  // Start HTTP server FIRST so Render's health check passes immediately.
  const server = app.listen(port, "0.0.0.0", (err?: Error) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
    server.keepAliveTimeout = 120000;
    server.headersTimeout   = 125000;
  });

  // Connect to MongoDB + start bot in background — failures won't kill the server.
  setImmediate(async () => {
    await initDbWithRetry();

    // Runs once, logs clearly either way. GIF/WebM→MP4 card transcoding,
    // sticker animated re-encoding, and audio extraction all silently fall
    // back to degraded output if ffmpeg isn't actually runnable — this
    // turns that into a loud boot-time log line instead of a mystery
    // reported later as "gifs don't load".
    verifyFfmpegAvailable().catch(() => {});

    await seedDefaultFrames().catch((err) => {
      logger.error({ err }, "Failed to seed default frames");
    });

    await seedTensuraFrames().catch((err) => {
      logger.error({ err }, "Failed to seed Tensura community frames");
    });

    loadCardsFromRepo().then((stats) => {
      logger.info(stats, "unified_cards.jsonl → MongoDB sync done");
    }).catch((err) => {
      logger.warn({ err }, "unified card loader failed (non-fatal)");
    });

    // Auto-start any managed bots that were previously connected (session restore).
    // This ensures paired bots reconnect without needing to re-pair.
    try {
      logger.info("Restoring managed bot sessions...");
      await initManagedBots();
    } catch (botErr) {
      logger.error({ botErr }, "Failed to restore managed bot sessions");
    }

    // Only start the primary/legacy single-bot connection if there are no
    // managed bots configured yet. Previously this ran unconditionally —
    // once Reze and Euphemia (managed bots) were set up, this primary
    // connection had no paired session and nothing would ever scan its QR
    // code, so it retried forever ("QR refs attempts ended", attempt
    // counts climbing past 50+ in production). Because it never reached a
    // stable "connected" state, its own reconnect backoff never got the
    // chance to reset, so it kept hammering reconnects indefinitely in the
    // background — this was the dominant remaining cause of the JS heap
    // OOM crashes even after fixing socket cleanup on reconnect. It only
    // needs to run for the initial setup case where no bot has been paired
    // through the Admin Panel yet.
    const existingBotCount = await col("bots").countDocuments({});
    if (existingBotCount === 0) {
      const phone = process.env["BOT_PHONE_NUMBER"];
      try {
        logger.info("No managed bots configured yet — starting WhatsApp primary connection...");
        await connectToWhatsApp(phone || undefined, { promptForPhone: false });
      } catch (botErr) {
        logger.error({ botErr }, "Failed to start bot (will retry automatically)");
      }
    } else {
      logger.info({ existingBotCount }, "Managed bots already configured — skipping primary connection");
    }
  });
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
