/**
 * ffmpeg-path.ts
 *
 * Every animated-media code path (GIF/WebM → MP4 transcoding for card
 * sends, sticker re-encoding, audio extraction) previously spawned a bare
 * "ffmpeg" and relied on it being present on the OS PATH. That's true on a
 * typical dev machine, but NOT guaranteed on every hosting provider/runtime
 * — Render's Node native runtime, for example, has been reported both ways
 * (ffmpeg preinstalled vs. "ffmpeg: not found") depending on the image in
 * use at any given time, and nothing in this repo's build step ever
 * installed it explicitly. When the binary silently isn't there,
 * execFile("ffmpeg", ...) rejects immediately, every caller's designed
 * fallback kicks in (flatten to a static frame, or send the raw
 * untranscoded bytes) — which is exactly the "gif still doesn't load / not
 * converting" symptom: the code LOOKS like it's handling GIFs correctly,
 * but the actual transcode never ran.
 *
 * Fix: depend on the `ffmpeg-static` npm package, which ships a real
 * prebuilt ffmpeg binary as part of `node_modules` (no OS package manager,
 * no PATH assumptions, works identically across hosts). Resolve it once
 * at import time, log clearly which binary is in use (or that neither is
 * available, so a broken deploy is loud instead of silently degrading),
 * and fall back to a bare "ffmpeg" (PATH lookup) if the static binary
 * couldn't be resolved for some reason (e.g. an unsupported platform).
 */
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

function resolveFfmpegPath(): string {
  try {
    // require() rather than a static import — this package ships a path
    // string as its default export, and resolving it dynamically lets us
    // safely fall back if it's missing/broken on a given platform without
    // an unhandled import-time crash.
    const staticPath = require("ffmpeg-static") as unknown as string;
    if (staticPath && existsSync(staticPath)) {
      return staticPath;
    }
    logger.warn({ staticPath }, "ffmpeg-static resolved but binary missing at that path — falling back to PATH lookup");
  } catch (err) {
    logger.warn({ err }, "ffmpeg-static not available — falling back to a bare \"ffmpeg\" on PATH (transcoding will fail if it isn't installed)");
  }
  return "ffmpeg";
}

export const FFMPEG_PATH = resolveFfmpegPath();

let verified = false;
let verifyPromise: Promise<boolean> | null = null;

/**
 * Confirms the resolved ffmpeg binary actually runs, once, and logs the
 * result clearly. Callers don't need to await this before using
 * FFMPEG_PATH — it's a diagnostic/early-warning check, not a gate — but
 * calling it once at startup (see index.ts) turns a silent per-command
 * failure into one clear boot-time log line.
 */
export async function verifyFfmpegAvailable(): Promise<boolean> {
  if (verifyPromise) return verifyPromise;
  verifyPromise = (async () => {
    try {
      await execFileAsync(FFMPEG_PATH, ["-version"], { timeout: 10000 });
      verified = true;
      logger.info({ ffmpegPath: FFMPEG_PATH }, "ffmpeg binary verified — GIF/WebM/audio transcoding available");
      return true;
    } catch (err) {
      verified = false;
      logger.error(
        { err, ffmpegPath: FFMPEG_PATH },
        "ffmpeg binary is NOT runnable — animated cards, sticker video/GIF conversion, and audio extraction will fall back to degraded/static output until this is fixed. Ensure the \"ffmpeg-static\" dependency is installed."
      );
      return false;
    }
  })();
  return verifyPromise;
}

export function isFfmpegVerified(): boolean {
  return verified;
}
