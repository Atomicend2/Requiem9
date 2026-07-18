import { Router } from "express";
import { randomBytes, createHmac, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { col } from "../../bot/db/mongo.js";
import { getAnySock } from "../../bot/connection.js";
import { getAnyConnectedManagedSock } from "../../bot/bot-manager.js";
import { logger } from "../../lib/logger.js";

const SESSION_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "requiem-default-secret-change-me";
const SESSION_DAYS   = 30;

const scrypt = promisify(scryptCb);

// ── Password hashing (scrypt, no external deps) ───────────────────────────
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const storedBuf = Buffer.from(hashHex, "hex");
  if (derived.length !== storedBuf.length) return false;
  return timingSafeEqual(derived, storedBuf);
}

export function createSessionToken(userId: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600;
  const nonce     = randomBytes(8).toString("hex");
  const payload   = Buffer.from(`${userId}:${expiresAt}:${nonce}`).toString("base64url");
  const sig       = createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string): { userId: string; expiresAt: number } | null {
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const expected = createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
    if (expected !== sig) return null;
    const [userId, expiresAtStr] = Buffer.from(payload, "base64url").toString().split(":");
    const expiresAt = Number(expiresAtStr);
    if (!userId || !expiresAt || Math.floor(Date.now() / 1000) > expiresAt) return null;
    return { userId, expiresAt };
  } catch {
    return null;
  }
}

const router = Router();
const OTP_EXPIRY_SECONDS = 300;

function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/\D/g, "");
  if (cleaned.length < 7 || cleaned.length > 15) return null;
  return cleaned;
}

async function getUserByPhone(phone: string): Promise<any> {
  const doc = await col("users").findOne({
    $or: [{ _id: phone as any }, { phone }, { lid: phone }],
  });
  return doc ? { ...doc, id: doc._id } : null;
}

// ── /otp/send — PASSWORD RESET ONLY ────────────────────────────────────────
// OTP is no longer part of normal login. This endpoint exists solely to let
// an already-registered user recover access by resetting their password.
router.post("/otp/send", async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) { res.status(400).json({ success: false, message: "Phone number is required" }); return; }

  const normalized = normalizePhone(phone);
  if (!normalized) { res.status(400).json({ success: false, message: "Invalid phone number format" }); return; }

  const user = await getUserByPhone(normalized);

  if (!user || !user.registered) {
    res.status(404).json({
      success: false,
      message: "Phone number not found. Please register on the website first.",
      registerRedirect: true,
    });
    return;
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Math.floor(Date.now() / 1000) + OTP_EXPIRY_SECONDS;
  await col("web_otps").replaceOne(
    { _id: normalized as any },
    { _id: normalized, code, expires_at: expiresAt },
    { upsert: true }
  );

  // Previously used getAnySock(), which returns connection.ts's
  // overrideSock — "whichever bot connected most recently", not
  // "whichever bot is actually connected right now". If that bot had since
  // dropped (e.g. mid-reconnect, which the logs showed happening
  // frequently) this call would either throw or silently attempt to send
  // through a dead socket, while a perfectly healthy second bot sat
  // unused — this is what caused "OTP said sent but never arrived" and
  // "only one bot can send OTP". Check actual live status first.
  const activeSock = (await getAnyConnectedManagedSock()) || getAnySock();
  if (!activeSock) {
    logger.warn("No socket available, cannot send password-reset OTP DM");
    res.status(500).json({ success: false, message: "Bot is not initialized. Please try again shortly." });
    return;
  }

  const targetJid = `${normalized}@s.whatsapp.net`;

  // sendMessage() not throwing is not the same as the message actually
  // reaching the recipient — if the JID isn't a real/reachable WhatsApp
  // account (wrong number, or an account only reachable via a different
  // JID form), Baileys can still resolve the call without an error while
  // the DM never lands. That's the exact "said sent, never arrived"
  // symptom reported. Verify the number exists on WhatsApp first so a bad
  // number gets a real error instead of a false "OTP sent".
  try {
    const [check] = await activeSock.onWhatsApp(targetJid);
    if (!check?.exists) {
      logger.warn({ phone: normalized }, "Password-reset OTP target not found on WhatsApp");
      res.status(400).json({ success: false, message: "This phone number doesn't appear to be on WhatsApp. Double-check the number and try again." });
      return;
    }
  } catch (err) {
    // If the existence check itself fails (rate limit, transient), don't
    // block the OTP on it — fall through and attempt the send normally.
    logger.debug({ err, phone: normalized }, "onWhatsApp check failed, proceeding with send anyway");
  }

  let sendErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await activeSock.sendMessage(targetJid, {
        text: `*Requiem Order 反逆* — Password reset code:\n\n*${code}*\n\nThis code expires in 5 minutes. Do not share it with anyone. If you didn't request this, ignore this message.`,
      });
      sendErr = null;
      break;
    } catch (err) {
      sendErr = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (sendErr) {
    logger.error({ err: sendErr }, "Failed to send password-reset OTP via WhatsApp");
    res.status(500).json({ success: false, message: "Failed to send OTP. The bot may be reconnecting — please try again in a few seconds." });
    return;
  }
  logger.info({ phone: normalized }, "Password-reset OTP sent via WhatsApp");

  res.json({ success: true, message: "OTP sent to your WhatsApp" });
});

// ── /register — phone + name + password, NO OTP ────────────────────────────
// Creates the account and logs the user in immediately with a session token.
// If this phone was already seen via a WhatsApp interaction (ghost row from
// .reg/.link before web signup), that row is claimed and upgraded in place
// so `.reg <phone>` on WhatsApp still finds and links the same account.
router.post("/register", async (req, res) => {
  const { phone, name, password } = req.body as { phone?: string; name?: string; password?: string };
  if (!phone || !name || !password) { res.status(400).json({ success: false, message: "Phone number, name and password are required" }); return; }

  const normalized = normalizePhone(phone);
  if (!normalized) { res.status(400).json({ success: false, message: "Invalid phone number format" }); return; }

  const trimmedName = name.trim();
  if (trimmedName.length < 2) { res.status(400).json({ success: false, message: "Name must be at least 2 characters" }); return; }
  if (password.length < 6) { res.status(400).json({ success: false, message: "Password must be at least 6 characters" }); return; }

  const now = Math.floor(Date.now() / 1000);
  const existing = await getUserByPhone(normalized);

  if (existing && existing.registered) {
    res.status(409).json({ success: false, message: "This number is already registered. Please log in instead.", loginRedirect: true });
    return;
  }

  const passwordHash = await hashPassword(password);

  if (!existing) {
    await col("users").insertOne({
      _id: normalized as any,
      name: trimmedName,
      phone: normalized,
      lid: null,
      password: passwordHash,
      registered: 1,
      registered_at: now,
      created_at: now,
      balance: 45000,
    });
  } else {
    // Ghost row already exists under this exact phone (e.g. bot-side .link
    // attempt) — claim it rather than creating a duplicate.
    await col("users").updateOne(
      { _id: normalized as any },
      { $set: { name: trimmedName, phone: normalized, password: passwordHash, registered: 1, registered_at: now, balance: existing.balance || 45000 } }
    );
  }

  const token = createSessionToken(normalized);
  const user = await getUserByPhone(normalized);

  res.json({
    success: true,
    token,
    user: {
      id: normalized,
      name: user.name || trimmedName,
      phone: normalized,
      balance: user.balance ?? 45000,
      bank: user.bank || 0,
      premium: user.premium || 0,
      bio: user.bio || "",
      registeredAt: user.created_at || now,
      isMod: false,
      isOwner: false,
    },
  });
});

// ── /login — phone + password ───────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { phone, password } = req.body as { phone?: string; password?: string };
  if (!phone || !password) { res.status(400).json({ success: false, message: "Phone number and password are required" }); return; }

  const normalized = normalizePhone(phone);
  if (!normalized) { res.status(400).json({ success: false, message: "Invalid phone number format" }); return; }

  const user = await getUserByPhone(normalized);
  if (!user || !user.registered) {
    res.status(404).json({ success: false, message: "This number isn't registered yet. Please create an account first.", registerRedirect: true });
    return;
  }

  if (!user.password) {
    res.status(401).json({ success: false, message: "This account has no password set. Use 'Forgot password' to set one via WhatsApp." });
    return;
  }

  const valid = await verifyPassword(password, user.password);
  if (!valid) {
    res.status(401).json({ success: false, message: "Incorrect phone number or password." });
    return;
  }

  const token = createSessionToken(normalized);

  const ownerPhone = (process.env["BOT_OWNER_PHONE"] || "2348144550593").replace(/\D/g, "");
  const ownerLid   = (process.env["BOT_OWNER_LID"]   || "101014040526896").replace(/\D/g, "");
  const userLid    = (user.lid || "").replace(/\D/g, "");
  const isOwner = normalized === ownerPhone || (ownerLid && userLid && userLid === ownerLid);

  const staffRow = await col("staff").findOne({ user_id: normalized });
  const isMod = isOwner || !!staffRow ? 1 : 0;

  res.json({
    success: true,
    token,
    user: {
      id: normalized,
      name: user.name || "Shadow",
      phone: normalized,
      level: user.level || 1,
      xp: user.xp || 0,
      balance: user.balance || 0,
      bank: user.bank || 0,
      premium: user.premium || 0,
      bio: user.bio || "",
      registeredAt: user.created_at || 0,
      isMod,
      isOwner,
    },
  });
});

// ── /otp/verify — PASSWORD RESET completion ─────────────────────────────────
// Confirms the reset code and sets newPassword as the account's password,
// then logs the user in.
router.post("/otp/verify", async (req, res) => {
  const { phone, code, newPassword } = req.body as { phone?: string; code?: string; newPassword?: string };
  if (!phone || !code || !newPassword) { res.status(400).json({ success: false, message: "Phone, code and new password are required" }); return; }
  if (newPassword.length < 6) { res.status(400).json({ success: false, message: "Password must be at least 6 characters" }); return; }

  const normalized = normalizePhone(phone);
  if (!normalized) { res.status(400).json({ success: false, message: "Invalid phone number" }); return; }

  const now = Math.floor(Date.now() / 1000);
  const otp = await col("web_otps").findOne({ _id: normalized as any });

  if (!otp) { res.status(401).json({ success: false, message: "No OTP found. Please request a new code." }); return; }
  if (otp.expires_at < now) {
    await col("web_otps").deleteOne({ _id: normalized as any });
    res.status(401).json({ success: false, message: "OTP has expired. Please request a new code." });
    return;
  }
  if (otp.code !== code.trim()) { res.status(401).json({ success: false, message: "Incorrect code. Please try again." }); return; }

  await col("web_otps").deleteOne({ _id: normalized as any });

  const user = await getUserByPhone(normalized);
  if (!user) { res.status(404).json({ success: false, message: "User not found." }); return; }

  const passwordHash = await hashPassword(newPassword);
  await col("users").updateOne({ _id: normalized as any }, { $set: { password: passwordHash, phone: normalized } });

  const token = createSessionToken(normalized);

  const ownerPhone = (process.env["BOT_OWNER_PHONE"] || "2348144550593").replace(/\D/g, "");
  const ownerLid   = (process.env["BOT_OWNER_LID"]   || "101014040526896").replace(/\D/g, "");
  const userLid    = (user.lid || "").replace(/\D/g, "");
  const isOwner = normalized === ownerPhone || (ownerLid && userLid && userLid === ownerLid);

  const staffRow = await col("staff").findOne({ user_id: normalized });
  const isMod = isOwner || !!staffRow ? 1 : 0;

  res.json({
    success: true,
    token,
    user: {
      id: normalized,
      name: user.name || "Shadow",
      phone: normalized,
      level: user.level || 1,
      xp: user.xp || 0,
      balance: user.balance || 0,
      bank: user.bank || 0,
      premium: user.premium || 0,
      bio: user.bio || "",
      registeredAt: user.created_at || 0,
      isMod,
      isOwner,
    },
  });
});

export { router as authRouter };
