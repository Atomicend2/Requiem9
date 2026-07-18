import type { CommandContext } from "./index.js";
import { sendText } from "../connection.js";
import { logger } from "../../lib/logger.js";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { FFMPEG_PATH } from "../../lib/ffmpeg-path.js";
import https from "node:https";

/**
 * Search for images using Bing image search (no API key required).
 * Returns up to `count` direct image URLs.
 */
async function searchImages(query: string, count: number = 6): Promise<string[]> {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(query);
    const url = `https://www.bing.com/images/async?q=${encoded}&count=${count * 3}&first=1&adlt=moderate`;
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          // Bing embeds image URLs in "murl":"<url>" JSON-like fragments
          const matches = [...data.matchAll(/"murl":"([^"]+)"/g)];
          const urls = matches
            .map((m) => m[1])
            .filter((u) => /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)/i.test(u))
            .slice(0, count);
          resolve(urls);
        } catch {
          resolve([]);
        }
      });
    });
    req.on("error", () => resolve([]));
    req.setTimeout(10000, () => { req.destroy(); resolve([]); });
  });
}

const DEFAULT_STICKER_NAME = "Requiem Order"; // fallback only when we can't resolve a sender name at all
const DEFAULT_STICKER_PACK = "Requiem Order";

/**
 * Best-effort resolution of "the sender's actual WhatsApp name" for sticker
 * authorship — prefers the WhatsApp push name (what shows in their profile/
 * chats), falling back to their phone number if push name isn't available
 * (e.g. very first message from a number Baileys hasn't cached a name for
 * yet), and finally to a generic label if neither is present.
 */
function resolveSenderDisplayName(ctx: CommandContext): string {
  const pushName = ctx.msg?.pushName;
  if (pushName && pushName.trim()) return pushName.trim();
  const phone = ctx.sender?.split("@")[0];
  return phone || "Requiem Order";
}

export async function handleConverter(ctx: CommandContext): Promise<void> {
  const { from, sender, args, command: cmd, msg, sock } = ctx;

  if (cmd === "sticker" || cmd === "s") {
    const context = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = context?.quotedMessage;
    const hasQuotedImage = !!(quotedMsg?.imageMessage || quotedMsg?.stickerMessage);
    const hasQuotedVideo = !!(quotedMsg?.videoMessage);
    const hasDirect = !!(msg.message?.imageMessage || msg.message?.videoMessage);

    if (!hasQuotedImage && !hasQuotedVideo && !hasDirect) {
      await sendText(from, "❌ Reply to an image or video, or send media with .s caption.");
      return;
    }

    try {
      const isVideo = !!(hasQuotedVideo || msg.message?.videoMessage);
      let target: any;
      if (hasQuotedImage || hasQuotedVideo) {
        target = {
          key: {
            remoteJid: from,
            fromMe: false,
            id: context?.stanzaId || "",
            participant: context?.participant,
          },
          message: quotedMsg,
        };
      } else {
        target = msg;
      }

      const downloaded = await downloadMediaMessage(target as any, "buffer", {}, { reuploadRequest: (sock as any).updateMediaMessage } as any);
      const input = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as any);
      let webp: Buffer;

      if (quotedMsg?.stickerMessage && !isVideo) {
        // Previously this branch re-sent the sticker's bytes completely
        // unmodified (only re-tagging EXIF), with no size/dimension
        // validation at all. If the source sticker was already close to
        // WhatsApp's real limits, animated, or subtly malformed, appending
        // a new EXIF chunk could push it over the edge or fail to send —
        // this is the most likely cause of the reported "can't share this
        // file" error when re-stickering an existing sticker. Detect
        // whether it's animated (VP8X chunk's ANIM bit) and route through
        // the same validated re-encode path used for fresh image/video
        // conversions, so every .s output meets real WhatsApp constraints
        // regardless of what the source sticker looked like.
        webp = isAnimatedWebp(input)
          ? await reencodeAnimatedWebpSticker(input)
          : await convertToStickerWebp(input);
      } else if (isVideo) {
        webp = await convertVideoToStickerWebp(input);
      } else {
        webp = await convertToStickerWebp(input);
      }

      const stickerDisplayName = resolveSenderDisplayName(ctx);
      const buf = addWebpExif(webp, DEFAULT_STICKER_PACK, stickerDisplayName);
      // Do NOT pass mimetype for sticker messages — Baileys sets it
      // automatically and an explicit "image/webp" can cause send failures
      // in certain Baileys versions by conflicting with its internal typing.
      await sock.sendMessage(from, { sticker: buf });
    } catch (err) {
      logger.error({ err }, "Failed to create sticker");
      await sendText(from, "❌ Failed to create sticker.");
    }
    return;
  }

  if (cmd === "speech") {
    const text = args.join(" ");
    if (!text) {
      await sendText(from, "❌ Usage: .speech [text] — reply to a sticker or image");
      return;
    }
    const context = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = context?.quotedMessage;
    if (!quotedMsg?.stickerMessage && !quotedMsg?.imageMessage) {
      await sendText(from, "❌ Reply to a sticker or image with .speech [text]");
      return;
    }
    try {
      const target = {
        key: {
          remoteJid: from,
          fromMe: false,
          id: context?.stanzaId || "",
          participant: context?.participant,
        },
        message: quotedMsg,
      };
      const downloaded = await downloadMediaMessage(target as any, "buffer", {}, { reuploadRequest: (sock as any).updateMediaMessage } as any);
      const input = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as any);
      const imgBuf = await sharp(input).png().toBuffer();
      const meta = await sharp(imgBuf).metadata();
      const w = meta.width || 512;
      const h = meta.height || 512;
      const fontSize = Math.max(18, Math.floor(w / 18));
      const barH = Math.max(48, Math.floor(h * 0.20));
      const displayText = text.length > 55 ? text.substring(0, 52) + "..." : text;
      const escapedText = displayText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${barH}">
        <rect width="${w}" height="${barH}" rx="0" fill="rgba(0,0,0,0.72)"/>
        <text x="${w / 2}" y="${barH / 2}" dominant-baseline="middle" text-anchor="middle"
          font-family="'DejaVu Sans', Arial, Helvetica, sans-serif" font-size="${fontSize}" fill="white" font-weight="bold">
          ${escapedText}
        </text>
      </svg>`;
      const result = await sharp(imgBuf)
        .composite([{ input: Buffer.from(svg), gravity: "south" }])
        .jpeg({ quality: 88 })
        .toBuffer();
      await sock.sendMessage(from, { image: result, caption: `💬 "${text}"` });
    } catch (err) {
      logger.error({ err }, "Speech command failed");
      await sendText(from, "❌ Failed to create speech bubble.");
    }
    return;
  }

  if (cmd === "toimg" || cmd === "turnimg") {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted?.stickerMessage) {
      await sendText(from, "❌ Reply to a sticker with .toimg to convert it.");
      return;
    }
    try {
      const target = {
        key: {
          remoteJid: from,
          fromMe: false,
          id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId || "",
          participant: msg.message?.extendedTextMessage?.contextInfo?.participant,
        },
        message: quoted,
      };
      const downloaded = await downloadMediaMessage(target as any, "buffer", {}, { reuploadRequest: (sock as any).updateMediaMessage } as any);
      const buf = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as any);
      await sock.sendMessage(from, { image: buf, caption: "Here's your image! 🖼️" });
    } catch {
      await sendText(from, "❌ Failed to convert sticker.");
    }
    return;
  }

  if (cmd === "take") {
    const parts = args.join(" ").split(",").map((s) => s.trim()).filter(Boolean);
    const packName = parts[0] || DEFAULT_STICKER_PACK;
    // Bare ".take" (no args at all) — use the sender's own WhatsApp name as
    // the sticker author, per requested behavior, rather than a generic
    // fallback name.
    const stickerName = parts[1] || (parts.length === 0 ? resolveSenderDisplayName(ctx) : DEFAULT_STICKER_NAME);
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted?.stickerMessage) {
      await sendText(from, "❌ Reply to a sticker with .take <pack>, <name>");
      return;
    }
    try {
      const context = msg.message?.extendedTextMessage?.contextInfo;
      const target = {
        key: {
          remoteJid: from,
          fromMe: false,
          id: context?.stanzaId || "",
          participant: context?.participant,
        },
        message: quoted,
      };
      const downloaded = await downloadMediaMessage(target as any, "buffer", {}, { reuploadRequest: (sock as any).updateMediaMessage } as any);
      const input = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as any);
      // Re-encode animated stickers before EXIF-renaming — same as the .s path.
      // Sending raw animated WebP bytes with just a new EXIF chunk produces a
      // sticker that WhatsApp rejects with "cannot be shared media" when saved
      // to favourites, because the EXIF patch changes the file size without
      // fixing internal offsets. Re-encoding rebuilds clean WebP frames first.
      const webp = isAnimatedWebp(input) ? await reencodeAnimatedWebpSticker(input) : input;
      const renamed = addWebpExif(webp, packName, stickerName);
      await sock.sendMessage(from, { sticker: renamed });
    } catch (err) {
      logger.error({ err }, "Failed to rename sticker");
      await sendText(from, "❌ Failed to rename sticker.");
    }
    return;
  }

  if (cmd === "mood") {
    const tag = args[0];
    if (!tag) { await sendText(from, "❌ Usage: .mood <tag>"); return; }
    await sendText(from, `🎭 Mood sticker for "#${tag}" — Mood sticker feature coming soon!`);
    return;
  }

  if (cmd === "pint" || cmd === "pintimg") {
    const query = args.join(" ");
    if (!query) { await sendText(from, "❌ Usage: .pint <search query>\n_Example: .pint anime sunset_"); return; }
    await sendText(from, `🔎 Searching images for: *${query}*`);
    try {
      const urls = await searchImages(query, 6);
      if (urls.length === 0) { await sendText(from, `❌ No images found for *"${query}"*. Try a different search.`); return; }
      await sendText(from, `🖼️ Found *${urls.length}* images for *"${query}"*:`);
      for (const url of urls) {
        try {
          await sock.sendMessage(from, { image: { url } });
        } catch {
          // skip broken image URLs silently
        }
      }
    } catch (err) {
      logger.error({ err }, "Image search failed");
      await sendText(from, "❌ Image search failed. Try again later.");
    }
    return;
  }

  if (cmd === "play") {
    const song = args.join(" ");
    if (!song) { await sendText(from, "❌ Usage: .play <song name>"); return; }
    await sendText(from, `🔎 Searching YouTube for: *${song}*`);
    try {
      const play = await import("play-dl");
      const results = await play.search(song, { limit: 1 });
      const video = results[0];
      if (!video?.url) {
        await sendText(from, "❌ Song not found on YouTube.");
        return;
      }
      const title = video.title || song;
      const duration = video.durationRaw || "Unknown";
      // Use optional chaining for every channel property — play-dl may return
      // a partial channel object whose `browseId` is undefined, causing an
      // uncaught TypeError deep inside the library when it tries to
      // read `.toString()` on undefined. We never access browseId ourselves,
      // but safe access here prevents the cascade.
      const channel = (video as any)?.channel?.name || "Unknown channel";
      const thumbnail = video.thumbnails?.[0]?.url;
      const info = `🎵 *${title}*\n\n👤 Channel: ${channel}\n⏱️ Duration: ${duration}\n🔗 ${video.url}\n\n⬇️ Converting to audio...`;
      if (thumbnail) {
        await sock.sendMessage(from, { image: { url: thumbnail }, caption: info });
      } else {
        await sendText(from, info);
      }
      let mp3: Buffer;
      try {
        const streamInfo = await play.stream(video.url, { quality: 2 });
        const sourceBuffer = await readStream(streamInfo.stream as any);
        mp3 = await convertToMp3(sourceBuffer);
      } catch (streamErr) {
        logger.warn({ err: streamErr, url: video.url }, "play-dl stream failed; trying yt-dlp fallback");
        try {
          mp3 = await downloadAudioWithYtDlp(video.url);
        } catch (ytdlpErr: any) {
          // Both play-dl and yt-dlp hit YouTube directly and can both be
          // blocked by the same "Sign in to confirm you're not a bot"
          // challenge, which isn't something a retry defeats. Invidious
          // (a public, privacy-respecting YouTube frontend) makes the
          // actual request to YouTube on ITS OWN server, not ours — so
          // audio format URLs it returns aren't subject to this server's
          // specific IP/session being flagged. This is a last-resort
          // fallback, tried only after both direct methods fail, since
          // public instances are less reliable/slower than yt-dlp when
          // yt-dlp actually works.
          const ytdlpMsg: string = ytdlpErr?.message || "";
          if (/sign in to confirm/i.test(ytdlpMsg)) {
            logger.warn({ url: video.url }, "yt-dlp also blocked by bot-detection; trying Invidious fallback");
            const invidiousBuffer = await downloadAudioViaInvidious(video.url).catch((invErr) => {
              logger.warn({ err: invErr, url: video.url }, "Invidious fallback also failed");
              return null;
            });
            if (invidiousBuffer) {
              mp3 = await convertToMp3(invidiousBuffer);
            } else {
              throw ytdlpErr;
            }
          } else {
            throw ytdlpErr;
          }
        }
      }
      await sock.sendMessage(from, {
        audio: mp3,
        mimetype: "audio/mpeg",
        fileName: `${sanitizeFileName(title)}.mp3`,
      });
    } catch (err: any) {
      logger.error({ err, song }, "Failed to play YouTube audio");
      const rawMsg: string = err?.message || "YouTube request failed";
      // "Sign in to confirm you're not a bot" is YouTube's own IP/session
      // fingerprinting challenge — it isn't something a retry or a code
      // change on our end can reliably clear (we already try an Android
      // client spoof first; this is what's left when even that gets
      // flagged). Give the user/admin something actionable instead of the
      // raw yt-dlp stderr dump, which just looks like a crash.
      const friendly = /sign in to confirm/i.test(rawMsg)
        ? "YouTube is asking this server to verify it's not a bot for this particular video. This is a YouTube-side restriction (often temporary, or tied to this server's IP) rather than a bug — try a different song, or try again in a bit. If it persists for everything, the bot admin can supply cookies via YTDLP_COOKIES_FILE."
        : rawMsg;
      await sendText(from, `❌ Failed to fetch audio: ${friendly}`);
    }
    return;
  }
}

/**
 * Detects an animated WebP by checking the VP8X chunk's ANIM feature bit
 * (bit 1 of the flags byte), per the WebP container spec. Falls back to
 * false (treat as static) for anything that doesn't parse as a valid
 * RIFF/WEBP/VP8X container, since that's the safer default for the
 * static-image re-encode path.
 */
function isAnimatedWebp(webp: Buffer): boolean {
  if (webp.length < 21 || webp.toString("ascii", 0, 4) !== "RIFF" || webp.toString("ascii", 8, 12) !== "WEBP") {
    return false;
  }
  if (webp.toString("ascii", 12, 16) !== "VP8X") return false;
  const flags = webp[20];
  return !!(flags & 0x02); // ANIM bit
}

/**
 * Re-encode an existing animated WebP sticker through ffmpeg into fresh,
 * WhatsApp-safe animated sticker bytes — same output constraints as
 * convertVideoToStickerWebp (512x512, capped duration/size), so a sticker
 * that's already borderline (near the size ceiling, non-standard
 * dimensions, odd frame timing) gets normalized instead of being re-sent
 * as-is with just a new EXIF chunk tacked on.
 */
async function reencodeAnimatedWebpSticker(input: Buffer): Promise<Buffer> {
  const dir = path.join(process.cwd(), "data", "tmp");
  await fs.mkdir(dir, { recursive: true });
  const id = randomUUID();
  const inputPath = path.join(dir, `${id}.webp`);
  const outputPath = path.join(dir, `${id}_out.webp`);
  await fs.writeFile(inputPath, input);
  try {
    await runFfmpeg([
      "-y",
      "-i", inputPath,
      "-t", "7",
      "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=12",
      "-loop", "0",
      "-lossless", "0",
      "-quality", "75",
      "-compression_level", "6",
      "-preset", "default",
      "-an",
      outputPath,
    ]);
    const buf = await fs.readFile(outputPath);
    if (buf.length > 1000 * 1024) {
      throw new Error("Sticker too large after re-encode (max ~1MB).");
    }
    return buf;
  } finally {
    await fs.rm(inputPath, { force: true }).catch(() => {});
    await fs.rm(outputPath, { force: true }).catch(() => {});
  }
}

async function convertToStickerWebp(input: Buffer): Promise<Buffer> {
  const MAX_SIZE = 95 * 1024;
  let quality = 80;
  let result: Buffer;
  do {
    result = await sharp(input, { animated: false })
      .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality, effort: 6, lossless: false, smartSubsample: true })
      .toBuffer();
    quality -= 10;
  } while (result.length > MAX_SIZE && quality > 10);
  return result;
}

async function convertVideoToStickerWebp(input: Buffer): Promise<Buffer> {
  const dir = path.join(process.cwd(), "data", "tmp");
  await fs.mkdir(dir, { recursive: true });
  const id = randomUUID();
  const inputPath = path.join(dir, `${id}.input`);
  const outputPath = path.join(dir, `${id}.webp`);
  await fs.writeFile(inputPath, input);
  try {
    await runFfmpeg([
      "-y",
      "-i", inputPath,
      "-t", "7",
      "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=12",
      "-loop", "0",
      "-lossless", "0",
      "-quality", "75",
      "-compression_level", "6",
      "-preset", "default",
      "-an",
      outputPath,
    ]);
    const buf = await fs.readFile(outputPath);
    if (buf.length > 1000 * 1024) {
      throw new Error("Video too large to convert to sticker (max ~1MB).");
    }
    return buf;
  } finally {
    await fs.rm(inputPath, { force: true }).catch(() => {});
    await fs.rm(outputPath, { force: true }).catch(() => {});
  }
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function convertToMp3(input: Buffer): Promise<Buffer> {
  const dir = path.join(process.cwd(), "data", "tmp");
  await fs.mkdir(dir, { recursive: true });
  const id = randomUUID();
  const inputPath = path.join(dir, `${id}.input`);
  const outputPath = path.join(dir, `${id}.mp3`);
  await fs.writeFile(inputPath, input);
  try {
    await runFfmpeg(["-y", "-i", inputPath, "-vn", "-ar", "44100", "-ac", "2", "-b:a", "128k", outputPath]);
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(inputPath, { force: true }).catch(() => {});
    await fs.rm(outputPath, { force: true }).catch(() => {});
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-500) || `ffmpeg exited with ${code}`));
    });
  });
}

// Resolve the yt-dlp binary: prefer the system PATH, fall back to the local
// bundled binary. That binary is normally downloaded during the Render
// buildCommand (see render.yaml) — but if that step failed (transient
// GitHub-releases hiccup, network blip during build) there was previously
// no recovery path at all: the old error message referenced "the server
// will automatically download it on next restart via start.sh", but
// start.sh is NOT what Render actually runs (startCommand invokes node
// directly), so that promise could never be kept. This self-heals instead:
// attempt a one-time download right here on first use, cache the result so
// we don't retry a hopeless download on every single .play call, and only
// throw if the download itself fails.
let ytDlpDownloadAttempted = false;
async function tryDownloadYtDlp(localBin: string): Promise<boolean> {
  if (ytDlpDownloadAttempted) return false;
  ytDlpDownloadAttempted = true;
  try {
    await fs.mkdir(path.dirname(localBin), { recursive: true });
    await runCommand("curl", ["-sL", "--max-time", "30", "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp", "-o", localBin]);
    await fs.chmod(localBin, 0o755);
    const check = spawnSync(localBin, ["--version"], { timeout: 5000, encoding: "utf8" });
    return check.status === 0;
  } catch (err) {
    logger.warn({ err }, "yt-dlp self-heal download failed");
    return false;
  }
}

async function resolveYtDlpBin(): Promise<string> {
  // 1. Shell-based 'which' — most reliable; uses the shell's full PATH
  //    resolution including Nix store paths, login profile, and aliases.
  //    This catches environments where the node process env has PATH but
  //    spawnSync's exec path isn't resolving it through Nix correctly.
  try {
    const { execSync } = await import("node:child_process");
    const found = execSync("which yt-dlp 2>/dev/null || true", {
      encoding: "utf8",
      timeout: 3000,
      shell: "/bin/sh",
    }).trim();
    if (found) {
      const check = spawnSync(found, ["--version"], { timeout: 5000, encoding: "utf8" });
      if (check.status === 0) return found;
    }
  } catch { /* fall through */ }

  // 2. Direct spawnSync path-resolution (inherits process.env.PATH)
  const localBin = path.join(process.cwd(), "bin", "yt-dlp");
  for (const candidate of ["yt-dlp", localBin]) {
    try {
      const result = spawnSync(candidate, ["--version"], { timeout: 5000, encoding: "utf8" });
      if (result.status === 0) return candidate;
    } catch { /* try next */ }
  }

  // 3. Self-heal: download from GitHub Releases as a last resort
  if (await tryDownloadYtDlp(localBin)) return localBin;

  throw new Error(
    "yt-dlp could not be found on this server. " +
    "The .play command requires yt-dlp to be installed (it is normally available " +
    "via the Nix configuration). Contact the admin to verify the Nix packages include yt-dlp."
  );
}

// Resolve the deno binary the same defensive way as yt-dlp above: prefer
// PATH, then the bundled copy placed at build time (see render.yaml). yt-dlp
// has required an external JS runtime for full YouTube support since late
// 2025 (for the player-response cipher/"nsig" decryption) — without one,
// it prints "Only deno is enabled by default..." and some/all formats
// become unavailable, which surfaced as ".play" failing outright on some
// videos. Passing --js-runtimes explicitly means this doesn't silently
// depend on PATH being inherited correctly by the spawned child process.
async function resolveDenoBin(): Promise<string | null> {
  try {
    const { execSync } = await import("node:child_process");
    const found = execSync("which deno 2>/dev/null || true", {
      encoding: "utf8",
      timeout: 3000,
      shell: "/bin/sh",
    }).trim();
    if (found) {
      const check = spawnSync(found, ["--version"], { timeout: 5000, encoding: "utf8" });
      if (check.status === 0) return found;
    }
  } catch { /* fall through */ }

  const localBin = path.join(process.cwd(), "bin", "deno");
  for (const candidate of ["deno", localBin]) {
    try {
      const result = spawnSync(candidate, ["--version"], { timeout: 5000, encoding: "utf8" });
      if (result.status === 0) return candidate;
    } catch { /* try next */ }
  }
  return null;
}

async function downloadAudioWithYtDlp(url: string): Promise<Buffer> {
  const ytDlpBin = await resolveYtDlpBin();
  const denoBin = await resolveDenoBin();
  const dir = path.join(process.cwd(), "data", "tmp");
  await fs.mkdir(dir, { recursive: true });
  const id = randomUUID();
  const outputPath = path.join(dir, `${id}.mp3`);
  // YouTube's "Sign in to confirm you're not a bot" challenge is triggered
  // per-IP/per-session by YouTube itself and can't be reliably defeated
  // from a headless server — the only real fixes are (a) spoofing a client
  // type that's checked less aggressively (the Android client historically
  // gets flagged far less often than the default web client) and/or
  // (b) supplying real logged-in cookies. We try (a) unconditionally since
  // it's free and has no downside; (b) only if the operator has opted in
  // by setting YTDLP_COOKIES_FILE to a cookies.txt they exported and
  // uploaded themselves — we never attempt to read cookies from a browser
  // profile on the server, since there isn't a logged-in browser there.
  const cookiesFile = process.env["YTDLP_COOKIES_FILE"];
  // Try multiple player clients in order — some videos are blocked on android
  // but not on tv_embedded/mweb, and the OAuth error ("Login with OAuth is no
  // longer supported") appears when yt-dlp finds a stale OAuth token in its
  // cache or when the android client demands auth for a video. --no-cache-dir
  // ensures no cached credentials are loaded, and trying multiple clients
  // means we almost always hit one that works without auth.
  const CLIENT_TRIES = ["android", "tv_embedded", "mweb", "web"];
  let lastErr: Error | null = null;
  for (const client of CLIENT_TRIES) {
    const tryOut = outputPath.replace(".mp3", `_${client}.mp3`);
    try {
      await runCommand(ytDlpBin, [
        "--no-playlist",
        "--no-cache-dir",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "128K",
        "--extractor-args", `youtube:player_client=${client}`,
        ...(denoBin ? ["--js-runtimes", `deno:${denoBin}`] : []),
        ...(cookiesFile ? ["--cookies", cookiesFile] : []),
        "-o", tryOut,
        url,
      ]);
      const buf = await fs.readFile(tryOut);
      await fs.rm(tryOut, { force: true }).catch(() => {});
      return buf;
    } catch (err: any) {
      lastErr = err;
      await fs.rm(tryOut, { force: true }).catch(() => {});
      // OAuth error or sign-in wall — try next client
      const msg: string = err?.message || "";
      if (/oauth|sign in|login required/i.test(msg)) continue;
      // For non-auth errors (network, format) just throw immediately — retrying
      // a different client won't help and wastes time.
      throw err;
    }
  }
  throw lastErr || new Error("All yt-dlp player clients failed");
}

// Public Invidious instances — a privacy-respecting YouTube frontend that
// fetches video/audio streams from YouTube on ITS OWN server, not ours.
// This is the actual mechanism that makes it useful as a fallback: when
// YouTube's bot-detection challenge is tied to THIS server's IP/session
// (which both play-dl and yt-dlp hit directly and can't get around), a
// request routed through a public Invidious instance isn't subject to
// that same block, because the request YouTube sees comes from the
// instance's IP, not ours.
// List kept short and limited to instances that publish uptime/stability
// per the official Invidious instance requirements (docs.invidious.io/
// instances) — public instances come and go, so this is tried in order
// with automatic failover, not relied on as a single point of failure.
const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://invidious.tiekoetter.com",
];

function extractYoutubeVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/);
  return match ? match[1] : null;
}

async function downloadAudioViaInvidious(url: string): Promise<Buffer> {
  const videoId = extractYoutubeVideoId(url);
  if (!videoId) throw new Error("Could not extract a YouTube video ID from the URL for the Invidious fallback.");

  let lastErr: Error | null = null;
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(`${instance}/api/v1/videos/${videoId}`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`${instance} returned HTTP ${res.status}`);
      const data: any = await res.json();
      // Prefer an audio-only adaptive format (smaller, no video to discard)
      // over formatStreams (which are muxed audio+video and larger to fetch
      // than necessary for an audio-only command).
      const audioFormats: any[] = (data.adaptiveFormats || []).filter((f: any) =>
        typeof f.type === "string" && f.type.startsWith("audio/")
      );
      const best = audioFormats.sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0))[0]
        || (data.formatStreams || [])[0];
      if (!best?.url) throw new Error(`${instance} returned no usable audio stream`);

      const audioController = new AbortController();
      const audioTimeout = setTimeout(() => audioController.abort(), 30_000);
      const audioRes = await fetch(best.url, { signal: audioController.signal });
      clearTimeout(audioTimeout);
      if (!audioRes.ok) throw new Error(`${instance} audio stream fetch returned HTTP ${audioRes.status}`);
      const arrayBuf = await audioRes.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (err: any) {
      lastErr = err;
      logger.warn({ err, instance, videoId }, "Invidious instance failed, trying next");
      continue;
    }
  }
  throw lastErr || new Error("All Invidious instances failed");
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-800) || `${command} exited with ${code}`));
    });
  });
}

function addWebpExif(webp: Buffer, packName: string, stickerName: string): Buffer {
  if (webp.length < 12 || webp.toString("ascii", 0, 4) !== "RIFF" || webp.toString("ascii", 8, 12) !== "WEBP") {
    return webp;
  }
  const exif = buildStickerExif(packName, stickerName);
  const exifSize = Buffer.alloc(4);
  exifSize.writeUInt32LE(exif.length, 0);
  const padByte = exif.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  const exifChunk = Buffer.concat([
    Buffer.from("EXIF", "ascii"),
    exifSize,
    exif,
    padByte,
  ]);

  // Walk the existing chunk list, stripping any pre-existing VP8X/EXIF
  // chunks (VP8X gets rebuilt below with correct flags; EXIF is replaced).
  // Also record whatever's needed to build a valid VP8X: canvas dimensions
  // (from VP8/VP8L/an existing VP8X) and whether an alpha or animation
  // chunk is present, so the rebuilt VP8X's feature-flag byte is accurate.
  const otherChunks: Buffer[] = [];
  let hasAlpha = false;
  let hasAnim = false;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let offset = 12;
  while (offset + 8 <= webp.length) {
    const type = webp.toString("ascii", offset, offset + 4);
    const size = webp.readUInt32LE(offset + 4);
    const padded = size + (size % 2);
    const end = offset + 8 + padded;
    if (end > webp.length) break;
    const chunkBuf = webp.subarray(offset, end);
    const dataStart = offset + 8;

    if (type === "VP8X") {
      // Existing extended header — pull its flags/dimensions, then discard
      // it; we rebuild it fresh below so the EXIF bit is guaranteed set.
      if (size >= 10) {
        const flags = webp[dataStart];
        hasAlpha = hasAlpha || !!(flags & 0x10);
        hasAnim = hasAnim || !!(flags & 0x02);
        const w = webp.readUIntLE(dataStart + 4, 3) + 1;
        const h = webp.readUIntLE(dataStart + 7, 3) + 1;
        canvasWidth = canvasWidth || w;
        canvasHeight = canvasHeight || h;
      }
    } else if (type === "ALPH") {
      hasAlpha = true;
      otherChunks.push(chunkBuf);
    } else if (type === "ANIM" || type === "ANMF") {
      hasAnim = true;
      otherChunks.push(chunkBuf);
    } else if (type === "VP8 " && size >= 10) {
      // Lossy bitstream: 14-bit width/height sit at a fixed offset in the
      // frame header, after a 3-byte start code.
      const w = webp.readUInt16LE(dataStart + 6) & 0x3fff;
      const h = webp.readUInt16LE(dataStart + 8) & 0x3fff;
      canvasWidth = canvasWidth || w;
      canvasHeight = canvasHeight || h;
      otherChunks.push(chunkBuf);
    } else if (type === "VP8L" && size >= 5) {
      // Lossless bitstream: signature byte (0x2F) then 14-bit width-1 /
      // height-1 packed across the next 4 bytes, plus an alpha-used bit.
      const b0 = webp[dataStart + 1];
      const b1 = webp[dataStart + 2];
      const b2 = webp[dataStart + 3];
      const b3 = webp[dataStart + 4];
      const w = 1 + (((b1 & 0x3f) << 8) | b0);
      const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      canvasWidth = canvasWidth || w;
      canvasHeight = canvasHeight || h;
      hasAlpha = hasAlpha || !!(b3 & 0x10);
      otherChunks.push(chunkBuf);
    } else if (type !== "EXIF") {
      otherChunks.push(chunkBuf);
    }
    offset = end;
  }

  // Per the WebP container spec, a file carrying a metadata/"unknown"
  // chunk (EXIF, XMP, ICCP) — or alpha/animation — MUST use the extended
  // format, signalled by a VP8X chunk as the very first chunk in the file.
  // The previous implementation appended a bare "EXIF" chunk after a plain
  // "VP8 "/"VP8L" chunk with no VP8X wrapper at all, which is not a
  // spec-valid WebP: normal sending was lenient enough to let it through,
  // but re-validation when a sticker is saved to WhatsApp's favorites/tray
  // rejected it, surfacing as "this media cannot be shared". Always
  // (re)build a correct VP8X header with the EXIF flag bit set.
  if (!canvasWidth || !canvasHeight) {
    // Couldn't determine dimensions (unexpected/corrupt bitstream) — fall
    // back to the sticker's expected 512x512 rather than emit a VP8X with
    // a bogus zero size.
    canvasWidth = canvasWidth || 512;
    canvasHeight = canvasHeight || 512;
  }

  const vp8xData = Buffer.alloc(10);
  let flags = 0x08; // EXIF bit (0x08) is always set now that we attach EXIF
  if (hasAlpha) flags |= 0x10;
  if (hasAnim) flags |= 0x02;
  vp8xData[0] = flags;
  // bytes 1-3 reserved (0)
  vp8xData.writeUIntLE(canvasWidth - 1, 4, 3);
  vp8xData.writeUIntLE(canvasHeight - 1, 7, 3);
  const vp8xSize = Buffer.alloc(4);
  vp8xSize.writeUInt32LE(10, 0);
  const vp8xChunk = Buffer.concat([Buffer.from("VP8X", "ascii"), vp8xSize, vp8xData]);

  const body = Buffer.concat([vp8xChunk, ...otherChunks, exifChunk]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(4 + body.length, 0); // "WEBP" + body
  return Buffer.concat([Buffer.from("RIFF"), riffSize, Buffer.from("WEBP"), body]);
}

function buildStickerExif(packName: string, stickerName: string): Buffer {
  // JSON payload for WhatsApp sticker metadata
  const json = Buffer.from(
    JSON.stringify({
      "sticker-pack-id": "requiem-order",
      "sticker-pack-name": packName,
      "sticker-pack-publisher": "Requiem Order",
      "sticker-name": stickerName,
      emojis: ["✨"],
    }),
    "utf-8"
  );

  // Correct TIFF/little-endian EXIF structure:
  // [0-1]   "II" (little-endian marker)
  // [2-3]   42  (TIFF magic)
  // [4-7]   8   (offset to first IFD)
  // --- IFD at offset 8 ---
  // [8-9]   1   (number of directory entries)
  // --- Entry 0 (12 bytes) ---
  // [10-11] 0x5741 tag ("WA")
  // [12-13] 0x0007 type UNDEFINED
  // [14-17] json.length  (count)
  // [18-21] 26  (value offset — after IFD entry + next-IFD pointer)
  // --- next-IFD pointer (4 bytes) ---
  // [22-25] 0   (no next IFD)
  // --- JSON data starts at offset 26 ---
  const exif = Buffer.alloc(26 + json.length);
  exif[0] = 0x49; exif[1] = 0x49;                  // "II"
  exif[2] = 0x2a; exif[3] = 0x00;                  // magic 42
  exif.writeUInt32LE(8, 4);                         // IFD offset
  exif.writeUInt16LE(1, 8);                         // 1 entry
  exif.writeUInt16LE(0x5741, 10);                   // tag WA
  exif.writeUInt16LE(0x0007, 12);                   // type UNDEFINED
  exif.writeUInt32LE(json.length, 14);              // count
  exif.writeUInt32LE(26, 18);                       // value offset
  exif.writeUInt32LE(0, 22);                        // next IFD = none
  json.copy(exif, 26);
  return exif;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "").slice(0, 80) || "audio";
}
