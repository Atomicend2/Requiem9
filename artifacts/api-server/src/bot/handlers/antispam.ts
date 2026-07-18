import type { WASocket } from "@whiskeysockets/baileys";
import { getGroup } from "../db/queries.js";
import { addWarning } from "../db/queries.js";
import { sendText } from "../connection.js";
import { logger } from "../../lib/logger.js";

const messageCache: Map<string, { count: number; lastTime: number }> = new Map();
const SPAM_LIMIT = 5;
const SPAM_WINDOW = 5000;

export async function checkAntispam(
  sock: WASocket,
  groupId: string,
  senderId: string,
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin) return false;
  const group = await getGroup(groupId);
  if (!group || group.antispam !== "on") return false;
  const key = `${groupId}:${senderId}`;
  const now = Date.now();
  const entry = messageCache.get(key) || { count: 0, lastTime: now };

  if (now - entry.lastTime > SPAM_WINDOW) {
    entry.count = 1;
    entry.lastTime = now;
  } else {
    entry.count++;
  }

  messageCache.set(key, entry);

  if (entry.count >= SPAM_LIMIT) {
    messageCache.delete(key);
    try {
      await sock.groupParticipantsUpdate(groupId, [senderId], "remove");
      await sendText(groupId, `⚡ @${senderId.split("@")[0]} was removed for spamming.`, [senderId]);
    } catch (err) {
      logger.error({ err }, "Failed to remove spammer");
    }
    return true;
  }

  return false;
}

export async function checkAntilink(
  sock: WASocket,
  groupId: string,
  senderId: string,
  text: string,
  msgKey: any,
  isAdmin: boolean
): Promise<boolean> {
  const group = await getGroup(groupId);
  // Only enforce when EXPLICITLY set to "on" — null / "" / "off" all mean disabled
  if (!group || group.antilink !== "on") return false;
  if (isAdmin) return false;

  const linkPatterns = [
    /https?:\/\//i,
    /wa\.me\//i,
    /chat\.whatsapp\.com\//i,
    /t\.me\//i,
    /discord\.gg\//i,
    /bit\.ly\//i,
    /tinyurl\.com\//i,
    /youtu\.be\//i,
    /whatsapp\.com\//i,
  ];

  const hasLink = linkPatterns.some((p) => p.test(text));
  if (!hasLink) return false;

  const action = group.antilink_action || "delete";

  // Always attempt to delete the offending message first
  try {
    await sock.sendMessage(groupId, { delete: msgKey });
  } catch (err) {
    logger.warn({ err }, "antilink: could not delete message (bot may not be admin)");
  }

  if (action === "warn") {
    const warns = await addWarning(senderId, groupId, "Sent a link", "Anti-Link System");
    const count = warns.length;
    await sendText(
      groupId,
      `┌─❖\n│「 ⚠️ 𝗪𝗔𝗥𝗡𝗜𝗡𝗚 」\n└┬❖ 「 @${senderId.split("@")[0]} 」\n│✑ 𝗥𝗘𝗔𝗦𝗢𝗡: Sent a link\n│✑ 𝗟𝗜𝗠𝗜𝗧: ${count} / 5\n└────────────┈ ⳹`,
      [senderId]
    );
    if (count >= 5) {
      await sock.groupParticipantsUpdate(groupId, [senderId], "remove").catch(() => {});
    }
  } else if (action === "kick") {
    await sock.groupParticipantsUpdate(groupId, [senderId], "remove").catch(() => {});
    await sendText(groupId, `🔗 @${senderId.split("@")[0]} was removed for sending a link.`, [senderId]);
  } else {
    // action === "delete" — message already deleted above, just notify
    await sendText(groupId, `🔗 @${senderId.split("@")[0]}, links are not allowed here.`, [senderId]);
  }

  return true;
}

export async function checkBlacklist(
  sock: WASocket,
  groupId: string,
  senderId: string,
  text: string,
  msgKey: any,
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin) return false;
  const group = await getGroup(groupId);
  if (!group) return false;

  let blacklist: string[] = [];
  try {
    blacklist = JSON.parse(group.blacklist || "[]");
  } catch {
    blacklist = [];
  }

  if (blacklist.length === 0) return false;

  const senderPhone = senderId.split("@")[0].split(":")[0];
  const lower = text.toLowerCase();

  // Check if the sender's phone number is blacklisted
  const isNumberBlacklisted = blacklist.some((entry: string) =>
    /^\d+$/.test(entry) && senderPhone.endsWith(entry)
  );
  if (isNumberBlacklisted) {
    try {
      await sock.groupParticipantsUpdate(groupId, [senderId], "remove");
      await sendText(groupId, `🚫 @${senderPhone} has been removed — blacklisted number.`, [senderId]);
    } catch {}
    return true;
  }

  // Check if the message contains a blacklisted word
  const found = blacklist.find((w: string) => !/^\d+$/.test(w) && lower.includes(w.toLowerCase()));
  if (!found) return false;

  try {
    await sock.sendMessage(groupId, { delete: msgKey });
    await sendText(
      groupId,
      `🚫 Message from @${senderPhone} deleted — contains blacklisted word: "${found}"`,
      [senderId]
    );
  } catch {}

  return true;
}

/** Check if a joining participant is in the group's phone-number blacklist */
export async function checkBlacklistedJoin(
  sock: WASocket,
  groupId: string,
  participant: string
): Promise<boolean> {
  const group = await getGroup(groupId);
  if (!group) return false;

  let blacklist: string[] = [];
  try {
    blacklist = JSON.parse(group.blacklist || "[]");
  } catch {
    blacklist = [];
  }

  const phone = participant.split("@")[0].split(":")[0];
  const isBlocked = blacklist.some((entry: string) =>
    /^\d+$/.test(entry) && phone.endsWith(entry)
  );

  if (isBlocked) {
    try {
      await sock.groupParticipantsUpdate(groupId, [participant], "remove");
      await sendText(groupId, `🚫 A blacklisted number attempted to join and was removed.`);
    } catch {}
    return true;
  }

  return false;
}
