import type { CommandContext } from "./index.js";
import { sendText } from "../connection.js";
import { setAfk, removeAfk, getAfk, getMentionName, getStaff, getUser, setBotSetting, getBotSetting, deleteBotSetting } from "../db/queries.js";
import { timeAgo, mentionTag } from "../utils.js";
import { isOwnerPhone } from "../connection.js";
import { downloadMediaMessage } from "@whiskeysockets/baileys";

// ── AFK sticker key helper ────────────────────────────────────────────────────
// Premium users, mods, guardians, and the owner can set a custom sticker as
// their AFK auto-reply by replying ".afk" to a sticker message. When someone
// tags them while they're AFK, the bot replies with that sticker instead of a
// text message. A plain ".afk reason" still works as normal. The sticker is
// cleared when they return from AFK or go AFK again without attaching a sticker.
function afkStickerKey(phone: string): string {
  return `afk_sticker:${phone}`;
}

async function canUseAfkSticker(sender: string): Promise<boolean> {
  const phone = sender.split("@")[0].split(":")[0].replace(/\D/g, "");
  if (isOwnerPhone(phone)) return true;
  const staff = await getStaff(phone);
  if (staff?.role === "mod" || staff?.role === "guardian" || staff?.role === "owner") return true;
  const user = await getUser(phone);
  if (!user?.premium) return false;
  const expiry = Number(user.premium_expiry || 0);
  return expiry === 0 || expiry > Math.floor(Date.now() / 1000);
}

export async function handleAfk(ctx: CommandContext): Promise<void> {
  const { from, sender, args, msg, sock } = ctx;
  const phone = sender.split("@")[0].split(":")[0].replace(/\D/g, "");

  // .afk clear — removes AFK status AND the saved sticker (explicit clear only)
  if (args[0]?.toLowerCase() === "clear") {
    const wasAfk = await getAfk(sender);
    if (!wasAfk) {
      await sendText(from, `You're not AFK.`);
      return;
    }
    await removeAfk(sender);
    await deleteBotSetting(afkStickerKey(phone)).catch(() => {});
    await sendText(from, `✅ AFK cleared — sticker removed too.`);
    return;
  }

  // Check if this is a reply to a sticker (premium AFK sticker feature)
  const quoted = (msg.message as any)?.extendedTextMessage?.contextInfo?.quotedMessage;
  const quotedSticker = quoted?.stickerMessage;

  if (quotedSticker && await canUseAfkSticker(sender)) {
    // Download and store the sticker buffer in bot_settings
    try {
      // Use the quoted message's own key (stanzaId + participant), not the
      // .afk command message's key. Using msg.key caused Baileys to look up
      // the wrong message for reupload requests, making the download fail or
      // return empty/incorrect bytes silently.
      const contextInfo = (msg.message as any)?.extendedTextMessage?.contextInfo;
      const quotedKey = {
        remoteJid: from,
        fromMe: false,
        id: contextInfo?.stanzaId || "",
        participant: contextInfo?.participant,
      };
      const buf = await downloadMediaMessage(
        { message: { stickerMessage: quotedSticker }, key: quotedKey } as any,
        "buffer",
        { reuploadRequest: (sock as any).updateMediaMessage } as any
      );
      const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf as any);
      await setBotSetting(afkStickerKey(phone), buffer);
      const reason = args.join(" ") || "AFK";
      await setAfk(sender, reason);
      await sendText(from, `You are now AFK: ${reason}`);
    } catch {
      await sendText(from, `❌ Couldn't save that sticker. Try again.`);
    }
    return;
  }

  // Normal AFK — sticker is intentionally NOT cleared here.
  // The sticker persists across AFK sessions until the user runs `.afk clear`.
  // This lets regulars set a sticker once and keep using it session-to-session.
  const reason = args.join(" ") || "AFK";
  await setAfk(sender, reason);
  await sendText(from, `You are now AFK: ${reason}`);
}

export async function checkSenderReturnedFromAfk(
  from: string,
  sender: string,
  sock: any,
  msg?: any
): Promise<void> {
  const senderAfk = await getAfk(sender);
  if (!senderAfk) return;
  await removeAfk(sender);

  // Sticker is intentionally NOT cleared on return — only `.afk clear` does that.
  const phone = sender.split("@")[0].split(":")[0].replace(/\D/g, "");

  const elapsed = timeAgo(senderAfk.started_at);
  // Use mentionTag (phone digits) so WhatsApp renders a tappable @-mention.
  // getMentionName returns the display name, which combined with the JID in
  // the mentions array does NOT create a real clickable tag — only the digit
  // form does.
  const msgOpts: any = {
    text: `Welcome back, ${mentionTag(sender)} Senpai! 🌸\nYou were AFK for ${elapsed}\n\nReason: ${senderAfk.reason}`,
    mentions: [sender],
  };
  if (msg) msgOpts.quoted = msg;
  await sock.sendMessage(from, msgOpts);
}

export async function checkAfkMention(
  from: string,
  sender: string,
  mentioned: string[],
  sock: any,
  quotedMsg?: any
): Promise<void> {
  for (const m of mentioned) {
    if (m === sender) continue;
    const afk = await getAfk(m);
    if (!afk) continue;

    // If the AFK user has a custom sticker set, send that instead of text
    const phone = m.split("@")[0].split(":")[0].replace(/\D/g, "");
    const stickerBuf = await getBotSetting(afkStickerKey(phone));
    if (stickerBuf) {
      try {
        const sendOpts: any = { sticker: stickerBuf };
        if (quotedMsg) sendOpts.quoted = quotedMsg;
        await sock.sendMessage(from, sendOpts);
        continue;
      } catch {
        // fallthrough to text reply if sticker fails
      }
    }

    // Structured AFK reply — player name + reason + duration on separate lines.
    const displayName = await getMentionName(m).catch(() => m.split("@")[0].split(":")[0]);
    await sock.sendMessage(from, {
      text: `${mentionTag(m)}\n*${displayName}* is currently AFK\nReason: ${afk.reason}\nAway: ${timeAgo(afk.started_at)}`,
      mentions: [m],
    });
  }
}
