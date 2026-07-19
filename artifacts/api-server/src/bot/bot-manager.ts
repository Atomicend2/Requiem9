import {
  makeWASocket,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { col } from "./db/mongo.js";
import { useMongoAuthState } from "./db/mongo-auth.js";
import { logger } from "../lib/logger.js";
import { setActiveSock, enqueueForChat } from "./connection.js";
import { handleMessage } from "./handlers/message.js";
import { handleGroupUpdate, handleGroupParticipantsUpdate } from "./handlers/group.js";
import { DEFAULT_PERSONA, isValidPersona, type PersonaKey } from "./commands/personas.js";
import Pino from "pino";
import { setCachedGroupMetadata } from "./group-meta-cache.js";

export interface BotStatusInfo {
  id: string;
  name: string;
  phone: string;
  status: "disconnected" | "connecting" | "pairing" | "connected";
  pairingCode: string | null;
  isPrimary: boolean;
  imageUrl: string;
  persona: PersonaKey;
  roles: string[];
  menuImageUrl: string;
}

interface LiveInstance {
  sock: any;
  status: BotStatusInfo["status"];
  pairingCode: string | null;
}

const live = new Map<string, LiveInstance>();
const sockBotIds = new WeakMap<object, string>();

export async function startBot(botId: string): Promise<void> {
  const existing = live.get(botId);
  if (existing && (existing.status === "connected" || existing.status === "connecting" || existing.status === "pairing")) {
    return;
  }

  // On every non-logout disconnect, the "connection.update" handler below
  // schedules startBot(botId) again after 8s. That previously spun up a
  // brand-new makeWASocket() (with its own fresh sock.ev listeners, WS
  // connection, and keepalive timers) while the OLD socket from the
  // previous attempt was simply left behind — never had its listeners
  // removed or its underlying WebSocket closed. Baileys' internal timers
  // and the WS connection itself kept the old socket (and everything its
  // closures reference) alive in memory. Across the reconnect storms visible
  // in the logs (attempts climbing past 10+), this accumulated until the
  // process hit its heap ceiling — surfacing to users as ".ci"/".ss"
  // "restarting the server" seemingly at random, regardless of which
  // command happened to be running at the time. Explicitly tear down the
  // previous socket before creating a new one.
  if (existing?.sock) {
    try {
      existing.sock.ev.removeAllListeners();
      existing.sock.ws?.close?.();
      existing.sock.end?.(undefined);
    } catch (err) {
      logger.debug({ err, botId }, "Error tearing down previous socket (non-fatal)");
    }
  }

  const row = await col("bots").findOne({ _id: botId as any });
  if (!row) throw new Error(`Bot ${botId} not found`);

  const { state, saveCreds } = await useMongoAuthState(botId);
  let version: any;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch (err) {
    logger.warn({ err, botId }, "Could not fetch latest Baileys version, using fallback");
    version = [2, 3000, 1015901307];
  }
  const silent = Pino({ level: "silent" }) as any;

  // Per-bot group metadata cache. Baileys recommends this for group event
  // reliability (join/leave and metadata-refresh handling); it was
  // previously only set up on the legacy single-bot connection.ts socket,
  // not here — every managed bot (which is what's actually in use) was
  // missing it entirely.
  const groupMetaCache = new Map<string, { data: any; ts: number }>();
  const GROUP_CACHE_TTL_MS = 5 * 60 * 1000;

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, silent),
    },
    printQRInTerminal: false,
    logger: silent,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    retryRequestDelayMs: 1000,
    maxMsgRetryCount: 5,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    browser: ["Ubuntu", "Chrome", "22.04.4"],
    cachedGroupMetadata: async (jid) => {
      const cached = groupMetaCache.get(jid);
      if (cached && Date.now() - cached.ts < GROUP_CACHE_TTL_MS) return cached.data;
      return undefined;
    },
  });

  const inst: LiveInstance = { sock, status: "connecting", pairingCode: null };
  live.set(botId, inst);
  sockBotIds.set(sock, botId);
  await col("bots").updateOne({ _id: botId as any }, { $set: { status: "connecting" } });

  sock.ws?.on?.("error", (err: any) => {
    logger.warn({ err, botId }, "Managed bot socket error (handled)");
  });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update: any) => {
    if (update.pairingCode) {
      inst.pairingCode = update.pairingCode;
      inst.status = "pairing";
      await col("bots").updateOne({ _id: botId as any }, { $set: { status: "pairing" } });
      logger.info({ botId, code: update.pairingCode }, "Pairing code ready for managed bot");
    }

    if (update.connection === "open") {
      inst.status = "connected";
      inst.pairingCode = null;
      const phone = sock.user?.id?.split("@")[0]?.split(":")[0] || row.phone;
      await col("bots").updateOne({ _id: botId as any }, { $set: { status: "connected", phone } });
      logger.info({ botId, name: row.name }, "Managed bot connected");
      setActiveSock(sock, true);
      // Bust the admin stats cache so botConnected flips immediately
      try { const adm = await import("../routes/v1/admin.js"); adm.invalidateStatsCache?.(); } catch {}
    }

    if (update.connection === "close") {
      const code = (update.lastDisconnect?.error as any)?.output?.statusCode;
      inst.status = "disconnected";
      await col("bots").updateOne({ _id: botId as any }, { $set: { status: "disconnected" } });
      logger.info({ botId, code }, "Managed bot disconnected");
      setActiveSock(null, false);
      try { const adm = await import("../routes/v1/admin.js"); adm.invalidateStatsCache?.(); } catch {}
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(() => startBot(botId).catch(() => {}), 8000);
      } else {
        live.delete(botId);
      }
    }
  });

  sock.ev.on("messages.upsert", async (m: any) => {
    if (m.type !== "notify") return;
    for (const msg of m.messages) {
      if (!msg.message) continue;
      if (msg.key.fromMe) continue;
      const chatId = msg.key.remoteJid || "unknown";
      const senderId = msg.key.participant || msg.key.remoteJid || "unknown";
      enqueueForChat(botId, chatId, async () => {
        try {
          await handleMessage(sock, msg);
        } catch (err) {
          logger.error({ err, botId }, "Managed bot error handling message");
        }
      }, senderId);
    }
  });

  sock.ev.on("group-participants.update", async (update: any) => {
    try {
      const meta = await sock.groupMetadata(update.id).catch(() => null);
      if (meta) {
        groupMetaCache.set(update.id, { data: meta, ts: Date.now() });
        setCachedGroupMetadata(sock, update.id, meta);
      }
      await handleGroupParticipantsUpdate(sock, update as any);
    } catch (err) {
      logger.error({ err, botId }, "Managed bot error handling group participants update");
    }
  });

  sock.ev.on("groups.update", async (updates: any) => {
    try {
      for (const u of updates as any[]) {
        if (!u.id) continue;
        const meta = await sock.groupMetadata(u.id).catch(() => null);
        if (meta) {
          groupMetaCache.set(u.id, { data: meta, ts: Date.now() });
          setCachedGroupMetadata(sock, u.id, meta);
        }
      }
      await handleGroupUpdate(sock, updates);
    } catch (err) {
      logger.error({ err, botId }, "Managed bot error handling groups update");
    }
  });

  if (!state.creds.registered && row.phone) {
    try {
      await new Promise((r) => setTimeout(r, 3000));
      const phoneDigits = row.phone.replace(/\D/g, "");
      if (phoneDigits.length >= 7) {
        const code = await sock.requestPairingCode(phoneDigits);
        inst.pairingCode = code;
        inst.status = "pairing";
        await col("bots").updateOne({ _id: botId as any }, { $set: { status: "pairing" } });
        logger.info({ botId, code }, "Pairing code generated");
      }
    } catch (err) {
      logger.warn({ err, botId }, "Could not get pairing code for managed bot");
    }
  }
}

export async function stopBot(botId: string): Promise<void> {
  const inst = live.get(botId);
  if (!inst) return;
  try { await inst.sock?.logout(); } catch {}
  inst.status = "disconnected";
  live.delete(botId);
  await col("bots").updateOne({ _id: botId as any }, { $set: { status: "disconnected" } });
}

export async function disconnectBot(botId: string): Promise<void> {
  const inst = live.get(botId);
  if (!inst) return;
  try { inst.sock?.end(undefined); } catch {}
  inst.status = "disconnected";
  live.delete(botId);
  await col("bots").updateOne({ _id: botId as any }, { $set: { status: "disconnected" } });
}

export async function getAllBotsStatus(): Promise<BotStatusInfo[]> {
  const rows = await col("bots").find({}).sort({ is_primary: -1, created_at: 1 }).toArray();
  return rows.map((row) => {
    const inst = live.get(row._id as string);
    const roles: string[] = Array.isArray(row.roles) ? row.roles : [];
    return {
      id: row._id as string,
      name: row.name,
      phone: row.phone || "",
      status: (inst?.status || row.status || "disconnected") as BotStatusInfo["status"],
      pairingCode: inst?.pairingCode || null,
      isPrimary: !!row.is_primary,
      imageUrl: row.menu_image_url || row.image_url || "",
      menuImageUrl: row.menu_image_url || "",
      persona: isValidPersona(row.persona) ? row.persona : DEFAULT_PERSONA,
      roles,
    };
  });
}

export async function getBotStatusInfo(botId: string): Promise<BotStatusInfo | null> {
  const row = await col("bots").findOne({ _id: botId as any });
  if (!row) return null;
  const inst = live.get(botId);
  const roles: string[] = Array.isArray(row.roles) ? row.roles : [];
  return {
    id: row._id as string,
    name: row.name,
    phone: row.phone || "",
    status: (inst?.status || row.status || "disconnected") as BotStatusInfo["status"],
    pairingCode: inst?.pairingCode || null,
    isPrimary: !!row.is_primary,
    imageUrl: row.menu_image_url || row.image_url || "",
    menuImageUrl: row.menu_image_url || "",
    persona: isValidPersona(row.persona) ? row.persona : DEFAULT_PERSONA,
    roles,
  };
}

export async function setBotPersona(botId: string, persona: PersonaKey): Promise<void> {
  await col("bots").updateOne({ _id: botId as any }, { $set: { persona } });
}

/** Returns the managed bot's Mongo _id for a given active socket, or null for
 * the single-instance/primary bot (e.g. running via connectToWhatsApp directly
 * rather than through the multi-bot manager). Used to key per-bot settings
 * like the menu image so each linked number can show its own artwork. */
export function getBotIdForSock(sock: any): string | null {
  return sockBotIds.get(sock) || null;
}

/**
 * Returns any managed bot's socket that is CURRENTLY connected, checked
 * against `live`'s actual per-bot status (not connection.ts's overrideSock,
 * which is just "whichever bot connected most recently" and can point at a
 * bot that has since disconnected while a different bot is fine). Used for
 * system-initiated sends that aren't tied to an in-flight WhatsApp message
 * (e.g. password-reset OTP triggered from the website) where there's no
 * "this message's own socket" to use instead. Prefers the primary bot if
 * it's connected, otherwise returns the first connected managed bot found.
 */
export async function getAnyConnectedManagedSock(): Promise<any | null> {
  const primary = await col("bots").findOne({ is_primary: 1 }, { projection: { _id: 1 } });
  if (primary) {
    const primaryInst = live.get(toStrId(primary._id));
    if (primaryInst?.status === "connected" && primaryInst.sock) return primaryInst.sock;
  }
  for (const inst of live.values()) {
    if (inst.status === "connected" && inst.sock) return inst.sock;
  }
  return null;
}

function toStrId(id: any): string {
  return typeof id === "string" ? id : String(id);
}

export async function getPersonaForSock(sock: any): Promise<PersonaKey> {
  const botId = sockBotIds.get(sock);
  if (botId) {
    const row = await col("bots").findOne({ _id: botId as any }, { projection: { persona: 1 } });
    if (row && isValidPersona(row.persona)) return row.persona;
  }
  const primary = await col("bots").findOne({ is_primary: 1 }, { projection: { persona: 1 } });
  if (primary && isValidPersona(primary.persona)) return primary.persona;
  return DEFAULT_PERSONA;
}

export async function requestBotPairingCode(botId: string, phone: string): Promise<string> {
  const row = await col("bots").findOne({ _id: botId as any });
  if (!row) throw new Error(`Bot ${botId} not found`);

  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 7) throw new Error("Invalid phone number");

  await col("bots").updateOne({ _id: botId as any }, { $set: { phone: phoneDigits } });

  const inst = live.get(botId);
  if (!inst || !inst.sock) {
    await startBot(botId);
    await new Promise((r) => setTimeout(r, 4000));
    const updated = live.get(botId);
    if (updated?.pairingCode) return updated.pairingCode;
    throw new Error("Bot starting — check status in a few seconds for the pairing code");
  }

  try {
    const code = await inst.sock.requestPairingCode(phoneDigits);
    inst.pairingCode = code;
    inst.status = "pairing";
    await col("bots").updateOne({ _id: botId as any }, { $set: { status: "pairing" } });
    return code;
  } catch (err: any) {
    throw new Error(err?.message || "Failed to request pairing code");
  }
}

export async function setPrimaryBot(botId: string): Promise<void> {
  await col("bots").updateMany({}, { $set: { is_primary: 0 } });
  await col("bots").updateOne({ _id: botId as any }, { $set: { is_primary: 1 } });
}

export async function initManagedBots(): Promise<void> {
  const rows = await col("bots").find({}).toArray();
  for (const row of rows) {
    if (row.is_primary || row.status === "connected") {
      startBot(row._id as string).catch((err) =>
        logger.warn({ err, id: row._id }, "Failed to auto-start managed bot")
      );
    }
  }
}
