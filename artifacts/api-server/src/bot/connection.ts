import {
  makeWASocket,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers,
  generateLinkPreviewIfRequired,
  type WASocket,
  type BaileysEventMap,
} from "@whiskeysockets/baileys";
import { useMongoAuthState } from "./db/mongo-auth.js";
import { col } from "./db/mongo.js";
import { Boom } from "@hapi/boom";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "../lib/logger.js";
import { FFMPEG_PATH } from "../lib/ffmpeg-path.js";
import { handleMessage } from "./handlers/message.js";
import { handleGroupUpdate, handleGroupParticipantsUpdate } from "./handlers/group.js";
import { isGifBuffer } from "./utils.js";

// DATA_DIR env var lets you point auth + DB at a persistent mount (e.g. Render Disk at /data).
// MUST match the DATA_DIR value in database.ts — both must point to the same persistent disk.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");
const AUTH_DIR = path.join(DATA_DIR, "auth");
// Store pairing number outside AUTH_DIR so it survives a logout/wipe
const PAIRING_PHONE_PATH = path.join(DATA_DIR, "paired-phone.txt");

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// Migrate paired-phone.txt from old location (inside auth/) to data/ if needed
const OLD_PAIRING_PHONE_PATH = path.join(AUTH_DIR, "paired-phone.txt");
if (!fs.existsSync(PAIRING_PHONE_PATH) && fs.existsSync(OLD_PAIRING_PHONE_PATH)) {
  try {
    fs.copyFileSync(OLD_PAIRING_PHONE_PATH, PAIRING_PHONE_PATH);
    fs.rmSync(OLD_PAIRING_PHONE_PATH, { force: true });
  } catch { /* ignore */ }
}

// ─── Owner Identity ───────────────────────────────────────────────────────────
//
// PHONE vs LID — these are two completely different things:
//
//   PHONE  →  the real phone number, e.g. 2348144550593
//             Used as the primary DB key (users.id / users.phone).
//             Used to SEND WhatsApp messages (phone@s.whatsapp.net).
//
//   LID    →  WhatsApp's internal numeric identifier, e.g. 101014040526896
//             Assigned by WhatsApp servers; NOT derived from the phone number.
//             Stored in users.lid column for cross-reference only.
//             You must NEVER use a LID where a phone number is expected.
//
// BOT_OWNER_PHONE  →  set this in .env to your plain phone number (digits only).
// BOT_OWNER_LID    →  set this in .env to your WhatsApp LID (digits only).
//                     Used only for LID-based lookups (not for sending or DB keys).
//
// Both default to the values below if not set in .env.

export const BOT_OWNER_PHONE = (process.env["BOT_OWNER_PHONE"] || "2347056705430").replace(/\D/g, "");
export const BOT_OWNER_LID   = (process.env["BOT_OWNER_LID"]   || "166761483776248").replace(/\D/g, "");

// Normalize a phone-like string to digits only (E.164 without +)
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

// All owner phone numbers from env + the hardcoded default
export function getOwnerNumbers(): string[] {
  const envOwners = (process.env["OWNER_NUMBERS"] || "")
    .split(",")
    .map((n) => normalizePhone(n.trim()))
    .filter(Boolean);
  const defaultOwner = normalizePhone(BOT_OWNER_PHONE);
  const all = new Set([defaultOwner, ...envOwners]);
  return [...all].filter(Boolean);
}

// Returns true when the given plain phone number belongs to an owner
export function isOwnerPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  return getOwnerNumbers().includes(normalized);
}

// Returns true when the given LID (digits only or @lid JID) belongs to the owner
export function isOwnerLid(lid: string): boolean {
  const lidNum = lid.split("@")[0].replace(/\D/g, "");
  return lidNum === BOT_OWNER_LID;
}

export const PREFIX = ".";

let sock: WASocket | null = null;
let overrideSock: WASocket | null = null; // set by bot-manager when a managed bot is active
let overrideConnected = false;
let isConnected = false;
let isConnecting = false;
let pairingCode: string | null = null;
let reconnectAttempts = 0;
let connectionGeneration = 0;
let isShuttingDown = false;
const MAX_RECONNECT_DELAY = 30000;
const STABLE_CONNECTION_MS = 30000;
// Tracks whether the socket currently attempting to connect actually has
// paired credentials (state.creds.registered). An unpaired bot with no QR
// scanned yet was previously retried on the exact same fast
// exponential-backoff schedule as a bot whose real session just dropped —
// this produced the "QR refs attempts ended" / reconnect / repeat loop seen
// every ~30s in production for bots nobody had paired yet, burning CPU and
// flooding logs for no benefit (there's nothing to reconnect to — no admin
// has scanned a code). See the branch in the "close" handler below.
let currentAttemptIsRegistered = false;

// Per-(bot, chat) message processing queues — see enqueueForChat below.
const chatMessageQueues = new Map<string, Promise<void>>();

/**
 * Runs `task` after any previously-enqueued task for the same (botId, chatId)
 * pair has settled, without blocking tasks for any OTHER bot or chat.
 *
 * Previously, both connection.ts's primary-bot `messages.upsert` handler and
 * bot-manager.ts's managed-bot handler awaited handleMessage() sequentially
 * for literally every incoming message across the whole process — one slow
 * command (e.g. a .ci fetching a large TX/TZ animated card, observed taking
 * 40+ seconds) blocked every other message, in every other chat, on every
 * other bot, from even starting until it finished. This was the confirmed
 * root cause of ".ping took 19773ms" in production (.ping does no I/O of its
 * own — it was purely queued behind an unrelated slow .ci elsewhere). With 5
 * bots eventually running concurrently, sequential-everything would only get
 * worse, since the bottleneck is process-wide, not per-bot.
 *
 * Ordering is preserved only where it actually matters: within the same chat
 * on the same bot, so two commands from one user in one group still can't
 * race each other and corrupt shared state (economy balances, card
 * inventory, etc). Everything else — different chats, different bots — now
 * runs fully concurrently.
 */
export function enqueueForChat(botId: string, chatId: string, task: () => Promise<void>, senderId?: string): void {
  // Queue per (bot, chat, sender) so different users in the same chat run
  // concurrently instead of blocking each other. The same user's commands
  // remain serialized to prevent balance/state races on their own records.
  const key = senderId ? `${botId}:${chatId}:${senderId}` : `${botId}:${chatId}`;
  const prev = chatMessageQueues.get(key) || Promise.resolve();
  const next = prev.then(task, task); // run task regardless of whether the previous one threw
  chatMessageQueues.set(key, next);
  // Don't let the queue map grow forever for idle chats — once this task
  // finishes and it's still the latest entry for this key, clear it.
  next.finally(() => {
    if (chatMessageQueues.get(key) === next) chatMessageQueues.delete(key);
  }).catch(() => {});
}

const replyContext = new AsyncLocalStorage<any>();
// Tracks which bot's socket actually received the message currently being
// handled. Needed because with multiple managed bots connected at once,
// `getActiveSock()`/`sock`/`overrideSock` is a single global slot that gets
// overwritten by whichever bot last fired setActiveSock() — so a reply sent
// via sendText()/sendTextWithPreview()/etc. from bot B's message handler
// could silently go out through bot A's socket instead (or fail if bot A
// happens to be mid-reconnect). runWithReplyContext() now also stashes the
// correct per-message socket here so getActiveSock() can prefer it over the
// global fallback. This is what caused "reacts (via ctx.sock) but the text
// reply never arrives (via sendText -> wrong bot's socket)" on the second
// connected bot, and the same root cause behind unreliable/wrong-bot OTP
// delivery.
const activeSockContext = new AsyncLocalStorage<WASocket>();

/** Called by bot-manager when a managed bot connects/disconnects. */
export function setActiveSock(s: WASocket | null, connected = false): void {
  overrideSock = s;
  overrideConnected = connected;
}

function getActiveSock(): WASocket {
  const contextSock = activeSockContext.getStore();
  const active = contextSock || overrideSock || sock;
  if (!active) throw new Error("Socket not initialized");
  return active;
}

type ConnectOptions = {
  promptForPhone?: boolean;
};

export function getSocket(): WASocket | null {
  return sock;
}

export function getAnySock(): WASocket | null {
  return activeSockContext.getStore() || overrideSock || sock;
}

export function isSocketConnected(): boolean {
  return overrideConnected || isConnected;
}

export function isSocketConnecting(): boolean {
  return isConnecting;
}

export function getPairingCode(): string | null {
  return pairingCode;
}

export async function gracefulShutdown(): Promise<void> {
  isShuttingDown = true;
  connectionGeneration++; // prevent any pending reconnect timers from firing
  if (sock) {
    try {
      await sock.end(undefined);
    } catch { /* ignore */ }
    sock = null;
  }
  isConnected = false;
  isConnecting = false;
}

export function getBotName(): string {
  // Previously read the raw global `sock` var, which only ever reflects the
  // single "primary" bot connection — with multiple managed bots running,
  // every bot's replies (.ping, .menu, etc) showed the SAME name regardless
  // of which bot's number actually received the message. getAnySock()
  // resolves the socket that's actually handling the current message via
  // AsyncLocalStorage (see activeSockContext above), same mechanism already
  // used correctly elsewhere for per-bot reply routing.
  const active = getAnySock();
  return active?.user?.name || "Requiem Order";
}

export function getBotPhone(): string {
  const active = getAnySock();
  return active?.user?.id?.split("@")[0]?.split(":")[0] || "";
}

export async function runWithReplyContext<T>(msg: any, fn: () => Promise<T>, msgSock?: WASocket): Promise<T> {
  if (msgSock) {
    return activeSockContext.run(msgSock, () => replyContext.run(msg, fn));
  }
  return replyContext.run(msg, fn);
}

function withReplyOptions(options?: any) {
  const quoted = replyContext.getStore();
  if (!quoted) return options;
  return { quoted, ...(options || {}) };
}

function normalizePhoneNumber(phoneNumber?: string): string | undefined {
  const normalized = phoneNumber?.replace(/\D/g, "");
  return normalized || undefined;
}

export function rememberPairingPhoneNumber(phoneNumber?: string): string | undefined {
  const normalized = normalizePhoneNumber(phoneNumber);
  if (!normalized) return undefined;
  fs.writeFileSync(PAIRING_PHONE_PATH, normalized, "utf8");
  return normalized;
}

function getRememberedPairingPhoneNumber(): string | undefined {
  try {
    return normalizePhoneNumber(fs.readFileSync(PAIRING_PHONE_PATH, "utf8"));
  } catch {
    return undefined;
  }
}


export async function connectToWhatsApp(phoneNumber?: string, options: ConnectOptions = {}): Promise<WASocket> {
  if (sock && (isConnected || isConnecting)) {
    return sock;
  }
  // Every reconnect (see the "connection.update" -> close -> setTimeout(...,
  // connectToWhatsApp) path above) previously replaced the module-level
  // `sock` with a brand-new makeWASocket() while leaving the old socket's
  // event listeners, WebSocket connection, and keepalive timers attached
  // and unreferenced-but-not-collectible. Across the reconnect storms in
  // production (WhatsApp intermittently returning 408 "QR refs attempts
  // ended"), this piled up and was the real cause of the JS heap OOM
  // crashes — not any single command. Explicitly tear down the previous
  // socket first.
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.ws?.close?.();
      sock.end?.(undefined);
    } catch (err) {
      logger.debug({ err }, "Error tearing down previous primary socket (non-fatal)");
    }
  }
  isConnecting = true;
  const generation = ++connectionGeneration;
  const { state, saveCreds } = await useMongoAuthState("primary");
  const { version, isLatest } = await fetchLatestBaileysVersion();
  const browser = Browsers.ubuntu("Chrome");
  logger.info({ version, isLatest, browser }, "Using WhatsApp Web pairing identity");

  const silentLogger = {
    level: "silent" as const,
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => silentLogger,
  };

  // Simple in-memory group metadata cache so welcome/leave messages
  // can fetch participant lists without an extra network round-trip.
  const groupMetaCache = new Map<string, { data: any; ts: number }>();
  const GROUP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  function cacheGroupMeta(jid: string, data: any) {
    groupMetaCache.set(jid, { data, ts: Date.now() });
  }

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
    },
    printQRInTerminal: false,
    logger: silentLogger,
    browser,
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    retryRequestDelayMs: 1000,
    maxMsgRetryCount: 5,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    cachedGroupMetadata: async (jid) => {
      const cached = groupMetaCache.get(jid);
      if (cached && Date.now() - cached.ts < GROUP_CACHE_TTL_MS) return cached.data;
      return undefined;
    },
  });

  if (!state.creds.registered) {
    logger.info("Bot not registered — pair via Admin Panel > Bot Manager");
  }
  currentAttemptIsRegistered = !!state.creds.registered;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      if (generation !== connectionGeneration) return;
      isConnected = false;
      isConnecting = false;
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const reason = (lastDisconnect?.error as any)?.message || (lastDisconnect?.error as Boom)?.output?.payload?.message || "unknown";
      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        reconnectAttempts++;

        if (!currentAttemptIsRegistered) {
          // Never-paired bot: there is no real session to recover, and
          // WhatsApp will keep timing out unattended QR generation attempts
          // (statusCode 408, "QR refs attempts ended") indefinitely. Retrying
          // every ~30s here bought nothing but log spam and CPU burn — per
          // the stabilization blueprint, an unpaired bot should sit idle and
          // wait for an admin to actually pair it, not hammer WhatsApp.
          // Log only the first few idle attempts, then go quiet entirely
          // aside from a periodic heartbeat every 10th attempt.
          const IDLE_RETRY_MS = 5 * 60_000; // 5 minutes between idle pairing attempts
          if (reconnectAttempts <= 3 || reconnectAttempts % 10 === 0) {
            logger.info({ attempt: reconnectAttempts, nextRetryMin: 5 }, "Bot still unpaired — idling; pair via Admin Panel > Bot Manager");
          }
          setTimeout(() => {
            if (generation === connectionGeneration && !isConnected && !isConnecting) {
              connectToWhatsApp(undefined, { promptForPhone: false });
            }
          }, IDLE_RETRY_MS);
          return;
        }

        // After many consecutive failures with no stable connection, switch to
        // a much longer interval to avoid log spam and CPU waste while waiting
        // for WhatsApp to come back or the admin to intervene.
        const MAX_ATTEMPTS_BEFORE_SLOW = 12; // ~4.5 min of exponential backoff
        const delay = reconnectAttempts > MAX_ATTEMPTS_BEFORE_SLOW
          ? 10 * 60_000 // 10-minute interval once we've backed off long enough
          : Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
        logger.warn({ delay: Math.round(delay / 1000) + "s", attempt: reconnectAttempts, statusCode, reason }, "WhatsApp connection closed; reconnecting");
        setTimeout(() => {
          if (generation === connectionGeneration && !isConnected && !isConnecting) {
            connectToWhatsApp(undefined, { promptForPhone: false });
          }
        }, delay);
      } else {
        // If we're shutting down intentionally, don't wipe auth — preserve creds for next startup
        if (isShuttingDown) {
          logger.info("Shutting down — skipping auth wipe");
          return;
        }
        logger.info("Logged out from WhatsApp — clearing auth");
        pairingCode = null;
        col("wa_auth").deleteMany({ bot_id: "primary" }).catch(() => {});
        // After a clean logout, do NOT immediately reconnect — the bot has no
        // credentials to use and will spin forever generating QR → "QR refs
        // attempts ended" → reconnect → repeat.  Instead, wait 5 minutes before
        // a single retry, giving the admin time to pair via Admin Panel > Bot
        // Manager.  The managed-bot path (bot-manager.ts) has its own pairing
        // flow; this primary-connection path is only used during initial setup.
        setTimeout(() => {
          if (generation === connectionGeneration && !isConnected && !isConnecting) {
            logger.info("Attempting primary reconnect after logout pause — pair via Admin Panel if this fails");
            connectToWhatsApp();
          }
        }, 5 * 60_000); // 5-minute pause
      }
    } else if (connection === "open") {
      if (generation !== connectionGeneration) return;
      isConnected = true;
      isConnecting = false;
      pairingCode = null;
      logger.info("Connected to WhatsApp successfully");
      // Sync owner phone numbers to staff table.
      // We do NOT insert into users here — the owner gets a users row naturally
      // when they send their first WhatsApp message. Inserting here would
      // show unregistered owners in member counts and leaderboards.
      try {
        const { addStaff, getStaff, updateUser } = await import("./db/queries.js");
        for (const phone of getOwnerNumbers()) {
          const existing = await getStaff(phone);
          if (!existing) {
            await addStaff(phone, "owner", "system");
          }
          if (BOT_OWNER_LID) {
            await updateUser(phone, { lid: BOT_OWNER_LID }).catch(() => {});
          }
        }
        logger.info({ owners: getOwnerNumbers(), ownerLid: BOT_OWNER_LID }, "Owner numbers synced to staff");
      } catch (err) {
        logger.warn({ err }, "Failed to sync owner numbers");
      }
      setTimeout(() => {
        if (generation === connectionGeneration && isConnected) {
          reconnectAttempts = 0;
        }
      }, STABLE_CONNECTION_MS);
    } else if (connection === "connecting") {
      if (generation !== connectionGeneration) return;
      isConnecting = true;
      logger.info("Connecting to WhatsApp...");
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    if (m.type !== "notify") return;
    for (const msg of m.messages) {
      if (!msg.message) continue;
      if (msg.key.fromMe) continue;
      const chatId = msg.key.remoteJid || "unknown";
      const senderId = msg.key.participant || msg.key.remoteJid || "unknown";
      enqueueForChat("primary", chatId, async () => {
        try {
          await handleMessage(sock!, msg);
        } catch (err) {
          logger.error({ err }, "Error handling message");
        }
      }, senderId);
    }
  });

  sock.ev.on("group-participants.update", async (update) => {
    try {
      // Invalidate cached metadata so welcome/leave handlers see fresh participants
      groupMetaCache.delete(update.id);
      await handleGroupParticipantsUpdate(sock!, update as any);
    } catch (err) {
      logger.error({ err }, "Error handling group participants update");
    }
  });

  sock.ev.on("groups.update", async (updates) => {
    try {
      // Keep cache fresh when group info changes (name, description, etc.)
      for (const u of updates) {
        if (u.id) groupMetaCache.delete(u.id);
      }
      await handleGroupUpdate(sock!, updates);
    } catch (err) {
      logger.error({ err }, "Error handling groups update");
    }
  });

  // Warm the group metadata cache whenever Baileys delivers a full metadata object
  sock.ev.on("messaging-history.set", ({ chats }) => {
    for (const chat of chats) {
      if (chat.id?.endsWith("@g.us") && (chat as any).metadata) {
        cacheGroupMeta(chat.id, (chat as any).metadata);
      }
    }
  });

  return sock;
}

async function sendWithRetry(fn: () => Promise<any>, retries = 4): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRateLimit =
        err?.message?.includes("rate-overlimit") ||
        err?.output?.payload?.message?.includes("rate-overlimit") ||
        err?.data === 429;
      if (isRateLimit && attempt < retries) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 30000);
        logger.warn({ attempt, delay, jid: err?.jid }, "Rate-overlimit hit, retrying after delay");
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

export async function sendMessage(jid: string, content: any, options?: any) {
  const s = getActiveSock();
  return sendWithRetry(() => s.sendMessage(jid, content, withReplyOptions(options)));
}

export async function sendText(jid: string, text: string, mentions?: string[]) {
  const s = getActiveSock();
  // Auto-detect @phonenumber patterns in text and ensure they are in the mentions
  // array. WhatsApp ONLY renders tappable blue mentions when the JID is in the
  // mentions array — the @number in the text string alone is never enough.
  const autoMentions = [...text.matchAll(/@(\d{7,15})\b/g)]
    .map(m => `${m[1]}@s.whatsapp.net`);
  const allMentions = [...new Set([...(mentions ?? []), ...autoMentions])];
  return sendWithRetry(() => s.sendMessage(jid, { text, mentions: allMentions }, withReplyOptions()));
}

/**
 * Send a text message with WhatsApp's rich link-preview card attached to the
 * first URL found in the text (title/description/thumbnail), instead of a
 * bare link. This is the same treatment .community/.website use, now shared
 * by every command that sends a link (.gcl, .shop, RPG-group-disabled
 * fallback, etc.) so link previews are consistent bot-wide.
 *
 * Falls back to a plain sendText if no URL is found or preview generation
 * fails (e.g. transient network error) — a missing preview should never
 * block the message itself from going out.
 */
/**
 * Fetches OpenGraph metadata for a URL via link-preview-js and shapes it into
 * Baileys' WAUrlInfo. Used as the getUrlInfo callback for
 * generateLinkPreviewIfRequired below.
 */
async function fetchUrlInfo(url: string): Promise<any> {
  const { getLinkPreview } = await import("link-preview-js");
  const data: any = await getLinkPreview(url, { timeout: 5000 });
  const image = Array.isArray(data.images) && data.images.length > 0 ? data.images[0] : undefined;
  let jpegThumbnail: Buffer | undefined;
  if (image) {
    try {
      const resp = await fetch(image);
      if (resp.ok) jpegThumbnail = Buffer.from(await resp.arrayBuffer());
    } catch {}
  }
  return {
    "matched-text": url,
    "canonical-url": data.url || url,
    title: data.title || "",
    description: data.description || "",
    ...(jpegThumbnail ? { jpegThumbnail } : {}),
  };
}

export async function sendTextWithPreview(jid: string, text: string, mentions?: string[]) {
  const s = getActiveSock();
  const urlMatch = text.match(/https?:\/\/\S+/);
  if (!urlMatch) return sendText(jid, text, mentions);

  const autoMentions = [...text.matchAll(/@(\d{7,15})\b/g)].map(m => `${m[1]}@s.whatsapp.net`);
  const allMentions = [...new Set([...(mentions ?? []), ...autoMentions])];

  try {
    const linkPreview = await generateLinkPreviewIfRequired(text, fetchUrlInfo, logger as any);
    return sendWithRetry(() =>
      s.sendMessage(jid, { text, mentions: allMentions, linkPreview }, withReplyOptions())
    );
  } catch (err) {
    logger.debug({ err }, "Link preview generation failed — sending without preview");
    return sendText(jid, text, mentions);
  }
}

export async function sendImage(jid: string, imageBuffer: Buffer, caption?: string, mentions?: string[]) {
  const s = getActiveSock();
  // Image-tier cards (T1-T5) must always render as a real static image.
  // Some source media for these cards is itself GIF-encoded (a handful of
  // scraped/legacy cards) — sending that buffer through WhatsApp's `image`
  // field doesn't animate it and doesn't show a clean static image either;
  // it shows up broken/unplayable ("Eyes Valentine" / Ais Wallenstein T5).
  // Flatten it to a single real static frame (PNG) first.
  let outBuffer = imageBuffer;
  if (isGifBuffer(imageBuffer)) {
    const flattened = await flattenGifToStaticImage(imageBuffer);
    if (flattened) {
      outBuffer = flattened;
    } else {
      logger.warn("GIF→static flatten failed, sending original buffer as last resort");
    }
  }
  return sendWithRetry(() => s.sendMessage(jid, { image: outBuffer, caption: caption || "", mentions }, withReplyOptions()));
}

/**
 * Send a static image directly from its CDN URL, streaming — per Baileys'
 * media docs, passing { url } means Baileys never loads the whole file into
 * Node's memory; it streams-and-encrypts on the fly. Use this only when the
 * source is already a known-good static image format (no gif-flatten or
 * animated→mp4 transcode needed), since both of those require buffering
 * the bytes to inspect/transform them regardless of how they arrived.
 */
export async function sendImageFromUrl(jid: string, url: string, caption?: string, mentions?: string[]) {
  const s = getActiveSock();
  return sendWithRetry(() => s.sendMessage(jid, { image: { url }, caption: caption || "", mentions }, withReplyOptions()));
}

export async function sendVideo(jid: string, videoBuffer: Buffer, caption?: string) {
  const s = getActiveSock();
  return sendWithRetry(() => s.sendMessage(jid, { video: videoBuffer, gifPlayback: true, mimetype: "video/mp4", caption: caption || "" }, withReplyOptions()));
}

const execFileAsync = promisify(execFile);

// Only ONE ffmpeg transcode runs at a time across the whole bot process.
// Per-invocation memory caps (see the -threads/-x264opts flags below) keep
// a SINGLE ffmpeg process's footprint small, but if two different users
// trigger animated-card sends within the same few seconds, two ffmpeg
// processes running concurrently would still double the memory pressure —
// on a 512 MB instance that's enough to OOM-kill the whole bot even though
// neither transcode alone would have. This queue serializes them; a short
// wait for the second transcode is a much better outcome than the whole
// process crashing and every in-flight command failing.
let ffmpegQueue: Promise<void> = Promise.resolve();
function withFfmpegSlot<T>(fn: () => Promise<T>): Promise<T> {
  const run = ffmpegQueue.then(fn, fn);
  ffmpegQueue = run.then(() => {}, () => {});
  return run;
}

/**
 * Convert an animated buffer (GIF or WebM) to H.264 MP4 using ffmpeg.
 * WhatsApp requires MP4 for all video/gif messages.
 * Returns null if ffmpeg fails or is unavailable.
 *
 * IMPORTANT: this MUST stay async (execFile, not execFileSync/spawnSync).
 * The previous synchronous version blocked the entire Node.js event loop
 * for as long as ffmpeg took to run (up to the full 60s timeout) — during
 * that window the process couldn't answer health checks, WhatsApp
 * keepalives, or any other request, which is what made the whole server
 * look hung/crashed and get restarted every time someone ran a card
 * command that touched an animated (T5/T6/TS/TX) card.
 */
export async function animatedToMp4(buf: Buffer, srcExt: "gif" | "webm"): Promise<Buffer | null> {
  const uid = Date.now();
  const tmpIn  = path.join("/tmp", `wa_anim_${uid}.${srcExt}`);
  const tmpOut = path.join("/tmp", `wa_anim_${uid}.mp4`);
  try {
    await fs.promises.writeFile(tmpIn, buf);

    // For GIFs: force 15 fps so variable-delay frames are all preserved.
    // For WebM: let ffmpeg infer the fps from the source.
    const gifArgs = srcExt === "gif" ? ["-r", "15"] : [];

    // WebM files usually carry Opus/Vorbis audio — convert to AAC.
    // Even for silent sources (GIF/WebM with no audio), WhatsApp on some
    // endpoints requires an active audio track, so inject a silent one.
    const audioArgs = [
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-c:a", "aac", "-b:a", "128k",
      "-shortest",
    ];

    await withFfmpegSlot(() => execFileAsync(FFMPEG_PATH, [
      "-y",
      ...(srcExt === "gif" ? ["-f", "gif"] : []),
      "-i", tmpIn,
      ...gifArgs,
      ...audioArgs,
      // Cap output resolution — card art is always small, but this is a
      // hard safety net against an unexpectedly large source blowing up
      // memory use. 640px is comfortably larger than any card artwork.
      "-vf", "scale='min(640,iw)':'min(640,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", "-preset", "veryfast",
      // Memory footprint controls — this is what actually matters on a
      // 512 MB instance. ffmpeg is a SEPARATE OS process from Node, so
      // Node's own V8 heap cap (~250 MB here) doesn't limit it at all;
      // ffmpeg's RSS competes directly with Node's for the same physical
      // RAM. libx264's default encoder lookahead/thread settings can use
      // well over 100 MB even for small clips, which was enough to push
      // combined (Node + ffmpeg) memory past the container's real limit
      // and get the whole process OOM-killed — this is what was still
      // crashing the server on animated .ci lookups even after the
      // spawnSync→execFile fix (that fix solved the event-loop-blocking
      // problem, but not this separate memory-ceiling problem).
      "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1",
      "-x264opts", "rc-lookahead=5:bframes=1:ref=1",
      tmpOut,
    ], { timeout: 60000, maxBuffer: 20 * 1024 * 1024 }));

    const mp4 = await fs.promises.readFile(tmpOut);
    return mp4;
  } catch (err: any) {
    logger.warn({ err: err?.message || err, srcExt }, "ffmpeg animated→MP4 failed");
    return null;
  } finally {
    await fs.promises.unlink(tmpIn).catch(() => {});
    await fs.promises.unlink(tmpOut).catch(() => {});
  }
}

/**
 * Extract a single static frame from a GIF or WebM and encode it as PNG.
 * Used two ways:
 *   1. For image-tier cards (T1-T5) whose source media is a GIF but must
 *      render as a real static image — WhatsApp's `image` field cannot
 *      animate GIF bytes and shows a broken result instead.
 *   2. As sendMedia's last-resort fallback when GIF/WebM→MP4 transcoding
 *      itself fails (a source file ffmpeg's -c:v libx264 pass rejects but
 *      can still decode a frame from) — see sendFlattenedAnimatedFrame
 *      below. This replaced silently sending the raw, untranscoded
 *      animated bytes tagged as an image, which WhatsApp doesn't render.
 * Shares the same withFfmpegSlot concurrency queue as animatedToMp4 so a
 * burst of these can't stack ffmpeg processes and repeat the OOM problem
 * that queue was built to prevent.
 */
async function flattenAnimatedToStaticImage(buf: Buffer, srcExt: "gif" | "webm"): Promise<Buffer | null> {
  const tmpIn = path.join("/tmp", `animimg-in-${Date.now()}-${Math.random().toString(36).slice(2)}.${srcExt}`);
  const tmpOut = tmpIn.replace(new RegExp(`\\.${srcExt}$`), ".png");
  try {
    await fs.promises.writeFile(tmpIn, buf);
    await withFfmpegSlot(() => execFileAsync(FFMPEG_PATH, [
      "-y",
      ...(srcExt === "gif" ? ["-f", "gif"] : []),
      "-i", tmpIn,
      "-frames:v", "1",
      "-threads", "1", "-filter_threads", "1",
      tmpOut,
    ], { timeout: 30000, maxBuffer: 20 * 1024 * 1024 }));
    return await fs.promises.readFile(tmpOut);
  } catch (err: any) {
    logger.warn({ err: err?.message || err, srcExt }, "ffmpeg animated→static flatten failed");
    return null;
  } finally {
    await fs.promises.unlink(tmpIn).catch(() => {});
    await fs.promises.unlink(tmpOut).catch(() => {});
  }
}

/** Backwards-compatible name for the GIF-only call site further up (image-tier cards). */
async function flattenGifToStaticImage(buf: Buffer): Promise<Buffer | null> {
  return flattenAnimatedToStaticImage(buf, "gif");
}

/**
 * sendMedia's fallback when GIF/WebM→MP4 transcoding fails outright: try to
 * pull one real static frame instead of ever sending raw, untranscoded
 * animated bytes tagged as an image (which WhatsApp silently fails to
 * render/send — see the comments at both sendMedia call sites above). If
 * even single-frame extraction fails, fall back to sendImage with the raw
 * buffer as an absolute last resort (sendImage's own GIF-detection may
 * still salvage a GIF source; for webm at that point there's nothing left
 * to try).
 */
async function sendFlattenedAnimatedFrame(jid: string, buffer: Buffer, srcExt: "gif" | "webm", caption?: string, mentions?: string[]) {
  const frame = await flattenAnimatedToStaticImage(buffer, srcExt);
  if (frame) {
    return sendImage(jid, frame, caption, mentions);
  }
  logger.warn({ srcExt }, "Single-frame flatten also failed — sending raw buffer as last resort");
  return sendImage(jid, buffer, caption, mentions);
}

export async function sendMedia(jid: string, buffer: Buffer, isAnimated: boolean, caption?: string, mentions?: string[]) {
  if (!isAnimated) return sendImage(jid, buffer, caption, mentions);

  const s = getActiveSock();

  // Detect format by magic bytes
  const isGif  = buffer.length >= 4
    && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46; // "GIF"

  const isWebm = buffer.length >= 4
    && buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3;

  const isMp4  = buffer.length > 8
    && buffer.slice(4, 8).toString("ascii") === "ftyp";

  // GIF — must convert to MP4 (WhatsApp rejects .gif entirely)
  if (isGif) {
    const mp4 = await animatedToMp4(buffer, "gif");
    if (mp4) {
      return sendWithRetry(() =>
        s.sendMessage(jid, { video: mp4, gifPlayback: true, mimetype: "video/mp4", caption: caption || "", mentions }, withReplyOptions())
      );
    }
    logger.warn("GIF→MP4 failed, falling back to a static flattened frame");
    return sendFlattenedAnimatedFrame(jid, buffer, "gif", caption, mentions);
  }

  // WebM — convert to MP4 for maximum WhatsApp compatibility
  if (isWebm) {
    const mp4 = await animatedToMp4(buffer, "webm");
    if (mp4) {
      return sendWithRetry(() =>
        s.sendMessage(jid, { video: mp4, gifPlayback: true, mimetype: "video/mp4", caption: caption || "", mentions }, withReplyOptions())
      );
    }
    // Previously fell back to sendImage(jid, buffer, ...) with the RAW,
    // UNTRANSCODED webm bytes — sendImage has no webm handling at all (only
    // a GIF-specific flatten path), so WhatsApp received raw Matroska
    // binary tagged as an image and silently failed to send/render. This
    // is the confirmed cause of some shoob.gg T6 cards (observed: Saitama,
    // Zero Two) "not loading at all" — their webm apparently fails this
    // ffmpeg build's transcode, and the old fallback sent garbage instead
    // of a real image.
    logger.warn("WebM→MP4 failed, falling back to a static flattened frame");
    return sendFlattenedAnimatedFrame(jid, buffer, "webm", caption, mentions);
  }

  // Already MP4 (or unknown animated format) — send directly
  return sendWithRetry(() =>
    s.sendMessage(jid, { video: buffer, gifPlayback: true, mimetype: "video/mp4", caption: caption || "", mentions }, withReplyOptions())
  );
}

export async function sendReact(jid: string, msgKey: any, emoji: string) {
  const s = getActiveSock();
  return s.sendMessage(jid, { react: { text: emoji, key: msgKey } });
}

// ─── Media concurrency semaphore ─────────────────────────────────────────────
// Limits simultaneous animated-card sends (CDN fetch + ffmpeg transcode +
// Baileys upload) to MAX_MEDIA_SLOTS concurrent operations. Each animated card
// can hold 20–60 MB in memory during the pipeline; without this cap, 3+
// concurrent spawns race toward the process heap limit and OOM-kill the server.
const MAX_MEDIA_SLOTS = 2;
let _mediaSlotCount = 0;
const _mediaSlotQueue: Array<() => void> = [];

export async function withMediaSlot<T>(fn: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => {
    if (_mediaSlotCount < MAX_MEDIA_SLOTS) {
      _mediaSlotCount++;
      resolve();
    } else {
      _mediaSlotQueue.push(resolve);
    }
  });
  try {
    return await fn();
  } finally {
    _mediaSlotCount--;
    const next = _mediaSlotQueue.shift();
    if (next) { _mediaSlotCount++; next(); }
  }
}

function getMessageTimestampMs(msg: any): number {
  const raw = msg.messageTimestamp;
  const seconds =
    typeof raw === "number"
      ? raw
      : typeof raw === "bigint"
        ? Number(raw)
        : Number(raw?.low || raw || 0);
  return seconds > 0 ? seconds * 1000 : 0;
}
