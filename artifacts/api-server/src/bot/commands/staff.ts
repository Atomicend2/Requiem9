import type { CommandContext } from "./index.js";
import { sendText, getAnySock } from "../connection.js";
import { logger } from "../../lib/logger.js";
import { col } from "../db/mongo.js";
import {
  getAllGroups,
  getStaff, getStaffList, extractNumberFromJid, getMentionName,
  getUser, updateUser, addToInventory, addBan, removeBan, getBanList,
  updateGroup, getGroup, resetUserBalance, resetUserProfile, deleteUserProfile, getAllCards,
  setBotSetting, deleteBotSetting, getActiveSpawn, expireActiveSpawn,
  searchCardsByName, getCardFullById,
} from "../db/queries.js";
import { getAllBotsStatus, getAnyConnectedManagedSock } from "../bot-manager.js";
import { spawnCard } from "../handlers/cardspawn.js";
import { escapeRegex, parseCardSearchArgs, findCardsStrict, isValidTier } from "../utils.js";

// WhatsApp enforces its own server-side rate limit on group joins per
// account — accepting invites too quickly returns "account_reachout_
// restricted" even with perfectly valid code/flow (this isn't something
// fixable client-side; groupAcceptInvite is already the correct call —
// see the comment at the .join handler below). Community reports place
// the limit around 3 joins per rolling ~10 minutes. Track recent joins
// per-bot-socket here and warn proactively before even attempting a call
// that WhatsApp is going to reject anyway, rather than letting every mod
// discover the limit independently by hitting the error.
const JOIN_WINDOW_MS = 10 * 60 * 1000;
const JOIN_LIMIT = 3;
const recentJoinTimestamps = new WeakMap<object, number[]>();

function recordAndCheckJoinRateLimit(sock: object): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const existing = (recentJoinTimestamps.get(sock) || []).filter((t) => now - t < JOIN_WINDOW_MS);
  if (existing.length >= JOIN_LIMIT) {
    const oldest = existing[0];
    recentJoinTimestamps.set(sock, existing);
    return { allowed: false, retryAfterMs: JOIN_WINDOW_MS - (now - oldest) };
  }
  existing.push(now);
  recentJoinTimestamps.set(sock, existing);
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * True for the bot owner, or anyone with a "staff" role of owner/guardian/mod.
 * This checks BOT-LEVEL staff status — entirely separate from WhatsApp group
 * admin status (ctx.isAdmin/isGroupAdmin), which only reflects whether
 * WhatsApp itself made someone an admin of a particular group chat.
 *
 * These are two intentionally different permission systems:
 *   - Bot staff (owner/guardian/mod, this function) — assigned via .addmod/
 *     .addguardian or the web panel, global across the whole bot, used for
 *     bot-specific commands (staff card tools, broadcasts, etc).
 *   - WhatsApp group admin (ctx.isAdmin) — assigned by WhatsApp itself,
 *     scoped to one group only, used for basic moderation in THAT group
 *     (kick/mute/tagall) so any group's own admins can moderate their own
 *     chat without needing to be added as bot staff.
 *
 * A command should use isModOrAbove() when it's a bot-wide capability
 * (spawning cards, managing roles, editing bot settings) and ctx.isAdmin
 * (or both, OR'd together) when it's ordinary in-group moderation that any
 * WhatsApp admin of that specific group should reasonably be able to do.
 * Mixing these up is what caused commands to inconsistently accept/reject
 * the same person depending on which check a given command happened to use.
 */
export async function isModOrAbove(ctx: CommandContext): Promise<boolean> {
  if (ctx.isOwner) return true;
  // ctx.sender can arrive as an unresolved @lid JID (newer WhatsApp clients).
  // extractNumberFromJid() on a @lid then yields the LID's own numeric part,
  // not the staff member's real phone number their `staff` record is keyed
  // by — so looking up staff by ctx.sender alone silently misses real admins.
  // ctx.lidFallbackPhone (resolved elsewhere in the dispatcher) is the real
  // phone number for exactly this case; always check both.
  const staff = await getStaff(ctx.sender) || (ctx.lidFallbackPhone ? await getStaff(ctx.lidFallbackPhone) : null);
  return !!staff && ["owner", "guardian", "mod"].includes((staff as any).role);
}

export async function isOwnerOrGuardian(ctx: CommandContext): Promise<boolean> {
  if (ctx.isOwner) return true;
  const staff = await getStaff(ctx.sender) || (ctx.lidFallbackPhone ? await getStaff(ctx.lidFallbackPhone) : null);
  return !!staff && ["owner", "guardian"].includes((staff as any).role);
}

export async function handleStaff(ctx: CommandContext): Promise<void> {
  const { from, sender, args, command: cmd, sock } = ctx;

  if (cmd === "bots") {
    const bots = await getAllBotsStatus();
    if (!bots || bots.length === 0) { await sendText(from, "🤖 No bots are configured."); return; }
    const statusEmoji: Record<string, string> = { connected:"🟢", connecting:"🟡", pairing:"🟠", disconnected:"🔴" };
    const statusLabel: Record<string, string> = { connected:"Online", connecting:"Connecting…", pairing:"Pairing…", disconnected:"Offline" };
    const connectedCount = bots.filter((b: any) => b.status === "connected").length;
    const lines = bots.map((b: any) => {
      const st = b.status || "disconnected";
      return `   │✑  ${statusEmoji[st] ?? "🔴"} *${b.name || b.id}*${b.isPrimary ? " ⭐" : ""} — ${statusLabel[st] ?? "Offline"}${b.phone ? ` (${b.phone})` : ""}`;
    });
    const msg = `┌─❖\n│「 𝗥𝗘𝗤𝗨𝗜𝗘𝗠 」\n└┬❖ 「 𝗕𝗢𝗧𝗦 」\n   │  ${connectedCount}/${bots.length} online\n` + lines.join("\n") + `\n   └────────────┈ ⳹`;
    await sendText(from, msg);
    return;
  }

  if (cmd === "modlist" || cmd === "mods" || cmd === "modslist" || cmd === "cardmakers") {
    const allStaff = await getStaffList();
    if ((allStaff as any[]).length === 0) { await sendText(from, "📋 No staff are registered."); return; }
    const grouped: Record<string, any[]> = { owner: [], guardian: [], mod: [], recruit: [] };
    for (const s of allStaff as any[]) { const key = s.role in grouped ? s.role : "mod"; grouped[key].push(s); }
    const allMentionJids: string[] = [];
    const formatSection = (role: string, label: string, emoji: string) => {
      const list = grouped[role]; if (!list || list.length === 0) return "";
      const rows = list.map((s: any) => { const jid = `${s.user_id}@s.whatsapp.net`; allMentionJids.push(jid); return `┃ ❖ @${s.user_id}`; }).join("\n");
      return `\n┏━ ${emoji} ${label} ━┓\n${rows}\n┗━━━━━━━━━━━━━━━━━━┛\n`;
    };
    let body = `╭━━━━━━━━━━━━━━━━━━━╮\n┃ ✠ 𝗥𝗘𝗤𝗨𝗜𝗘𝗠 ✠ ┃\n「👑 Imperial Staff」\n╰━━━━━━━━━━━━━━━━━━━╯\n`;
    body += formatSection("owner","OWNER","👑") + formatSection("mod","MODERATORS","⚔️") + formatSection("guardian","GUARDIANS","🛡️") + formatSection("recruit","RECRUITS","🌱");
    body += `\n╭━ ⚠️ IMPERIAL DECREE ━╮\n┃ Abuse of this command\n┃ will result in an\n┃ immediate community ban.\n╰━━━━━━━━━━━━━━━━━━━━━━╯`;
    await sock.sendMessage(from, { text: body, mentions: allMentionJids });
    return;
  }

  if (cmd === "addmod") {
    // Any mod or above can promote someone to mod level
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods, guardians, and owner can add mods."); return; }
    const targetPhone = args[0]?.replace(/\D/g, "");
    if (!targetPhone) { await sendText(from, `❌ Usage: *.addmod* [phone_number]`); return; }
    const existing = await col("staff").findOne({ _id: targetPhone as any });
    if (existing?.role === "mod") { await sendText(from, `❌ +${targetPhone} is already a mod.`); return; }
    await col("staff").updateOne({ _id: targetPhone as any }, { $set: { _id: targetPhone, user_id: targetPhone, role: "mod", added_by: extractNumberFromJid(sender), added_at: Math.floor(Date.now()/1000) } }, { upsert: true });
    await sendText(from, `✅ +${targetPhone} is now a *mod*.`);
    return;
  }

  if (cmd === "addguardian") {
    // Guardians outrank mods — only owner or another guardian can promote to guardian
    if (!(await isOwnerOrGuardian(ctx))) { await sendText(from, "❌ Only guardians and the owner can add guardians."); return; }
    const targetPhone = args[0]?.replace(/\D/g, "");
    if (!targetPhone) { await sendText(from, `❌ Usage: *.addguardian* [phone_number]`); return; }
    const existing = await col("staff").findOne({ _id: targetPhone as any });
    if (existing?.role === "guardian") { await sendText(from, `❌ +${targetPhone} is already a guardian.`); return; }
    await col("staff").updateOne({ _id: targetPhone as any }, { $set: { _id: targetPhone, user_id: targetPhone, role: "guardian", added_by: extractNumberFromJid(sender), added_at: Math.floor(Date.now()/1000) } }, { upsert: true });
    await sendText(from, `✅ +${targetPhone} is now a *guardian*.`);
    return;
  }

  if (cmd === "removemod") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods, guardians, and owner can remove mods."); return; }
    const targetPhone = args[0]?.replace(/\D/g, "");
    if (!targetPhone) { await sendText(from, `❌ Usage: *.removemod* [phone_number]`); return; }
    const existing = await col("staff").findOne({ _id: targetPhone as any });
    if (!existing) { await sendText(from, `❌ +${targetPhone} is not in the staff list.`); return; }
    if (existing.role === "owner" || existing.role === "guardian") { await sendText(from, `❌ Cannot remove an owner or guardian with this command. Use *.removeguardian* for guardians.`); return; }
    await col("staff").deleteOne({ _id: targetPhone as any });
    await sendText(from, `✅ +${targetPhone} has been removed from staff.`);
    return;
  }

  if (cmd === "removeguardian") {
    // Only owner or guardian can remove a guardian
    if (!(await isOwnerOrGuardian(ctx))) { await sendText(from, "❌ Only guardians and the owner can remove guardians."); return; }
    const targetPhone = args[0]?.replace(/\D/g, "");
    if (!targetPhone) { await sendText(from, `❌ Usage: *.removeguardian* [phone_number]`); return; }
    const existing = await col("staff").findOne({ _id: targetPhone as any });
    if (!existing) { await sendText(from, `❌ +${targetPhone} is not in the staff list.`); return; }
    if (existing.role === "owner") { await sendText(from, `❌ Cannot remove an owner from staff.`); return; }
    await col("staff").deleteOne({ _id: targetPhone as any });
    await sendText(from, `✅ +${targetPhone} has been removed from staff.`);
    return;
  }

  if (cmd === "recruit") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods, guardians, and owner can recruit."); return; }
    const targetPhone = args[0]?.replace(/\D/g, "");
    if (!targetPhone) { await sendText(from, "❌ Usage: *.recruit* [phone_number]"); return; }
    await col("staff").updateOne({ _id: targetPhone as any }, { $set: { _id: targetPhone, user_id: targetPhone, role: "recruit", added_by: extractNumberFromJid(sender), added_at: Math.floor(Date.now()/1000) } }, { upsert: true });
    await sendText(from, `✅ +${targetPhone} has been recruited to Requiem Order staff.`);
    return;
  }

  if (cmd === "addpremium") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods, guardians, and owner can grant premium."); return; }
    const targetPhone = args[0]?.replace(/\D/g, "");
    const days = parseInt(args[1] || "30", 10);
    if (!targetPhone) { await sendText(from, "❌ Usage: *.addpremium* [phone_number] [days=30]"); return; }
    const expiry = Math.floor(Date.now() / 1000) + days * 86400;
    await updateUser(targetPhone, { premium: 1, premium_expiry: expiry });
    await sendText(from, `✅ +${targetPhone} now has *Premium* for ${days} day(s).\n🌟 Expires: ${new Date(expiry * 1000).toDateString()}`);
    return;
  }

  if (cmd === "removepremium") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods, guardians, and owner can remove premium."); return; }
    const targetPhone = args[0]?.replace(/\D/g, "");
    if (!targetPhone) { await sendText(from, "❌ Usage: *.removepremium* [phone_number]"); return; }
    await updateUser(targetPhone, { premium: 0, premium_expiry: 0 });
    await sendText(from, `✅ Premium removed from +${targetPhone}.`);
    return;
  }

  if (cmd === "ban") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods, guardians, and owner can ban users."); return; }
    const targetPhone = args[0]?.replace(/\D/g, "");
    const reason = args.slice(1).join(" ") || "Banned by staff";
    if (!targetPhone) { await sendText(from, "❌ Usage: *.ban* [phone_number] [reason]"); return; }
    await addBan("user", targetPhone, `+${targetPhone}`, reason, sender);
    await sendText(from, `🔨 +${targetPhone} has been *banned*.\n📋 Reason: ${reason}`);
    return;
  }

  if (cmd === "unban") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods, guardians, and owner can unban users."); return; }
    const targetPhone = args[0]?.replace(/\D/g, "");
    if (!targetPhone) { await sendText(from, "❌ Usage: *.unban* [phone_number]"); return; }
    await removeBan("user", targetPhone);
    await sendText(from, `✅ +${targetPhone} has been *unbanned*.`);
    return;
  }

  if (cmd === "banlist") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods and above can view the ban list."); return; }
    const banned = (await getBanList()).filter((b: any) => b.type === "user");
    if (!banned || banned.length === 0) { await sendText(from, "📋 No users are currently banned."); return; }
    const lines = banned.map((b: any) => `• +${b.target} — ${b.reason || "No reason"}`);
    await sendText(from, `🔨 *Banned Users* (${banned.length})\n\n${lines.join("\n")}`);
    return;
  }

  if (cmd === "addrole") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods, guardians, and owner can manage roles."); return; }
    const targetPhone = args[0]?.replace(/\D/g, "");
    const role = args[1]?.toLowerCase();
    if (!targetPhone || !role || !["mod","guardian"].includes(role)) { await sendText(from, "❌ Usage: .addrole [phone_number] [mod|guardian]"); return; }
    await col("staff").updateOne({ _id: targetPhone as any }, { $set: { _id: targetPhone, user_id: targetPhone, role, added_by: extractNumberFromJid(sender), added_at: Math.floor(Date.now()/1000) } }, { upsert: true });
    await sendText(from, `✅ +${targetPhone} is now a ${role}.`);
    return;
  }

  if (cmd === "post") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods, guardians, and owner can post announcements."); return; }
    const message = ctx.body.slice(ctx.prefix.length + cmd.length).trim();
    if (!message) { await sendText(from, "❌ Usage: *.post* [message]"); return; }
    const anySock = (await getAnyConnectedManagedSock()) || getAnySock();
    if (!anySock) { await sendText(from, "❌ Bot socket not available."); return; }
    const allGroups = await getAllGroups();
    const announcement = `📢 *ANNOUNCEMENT — Requiem Order 反逆*\n\n${message}`;
    let sent = 0, failed = 0;
    await sendText(from, `📡 Broadcasting to *${(allGroups as any[]).length}* groups…`);
    for (const group of allGroups as any[]) {
      try {
        let mentions: string[] = [];
        try { const meta = await anySock.groupMetadata(group.id || group._id); mentions = meta.participants.map((p: any) => p.id); } catch {}
        await anySock.sendMessage(group.id || group._id, { text: announcement, mentions });
        sent++;
      } catch { failed++; }
      await new Promise((r) => setTimeout(r, 500));
    }
    await sendText(from, `✅ Broadcast complete!\n📤 Sent: *${sent}* groups\n❌ Failed: *${failed}* groups`);
    return;
  }

  if (cmd === "join") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods, guardians, and owner can make the bot join groups."); return; }
    const inviteLink = args[0];
    if (!inviteLink) { await sendText(from, "❌ Usage: *.join* [invite_code_or_link]\n\nExamples:\n• .join ABC123XYZ\n• .join https://chat.whatsapp.com/ABC123XYZ"); return; }
    // Accept either a bare code or a full https://chat.whatsapp.com/<code>[?...] URL
    const code = inviteLink.replace(/https?:\/\/chat\.whatsapp\.com\//i, "").split("?")[0].trim();
    if (!code || code.length < 8) { await sendText(from, "❌ Invalid invite code. Pass just the code (e.g. `ABC123XYZ`) or the full link."); return; }
    const rateCheck = recordAndCheckJoinRateLimit(sock as object);
    if (!rateCheck.allowed) {
      const minutes = Math.ceil(rateCheck.retryAfterMs / 60000);
      await sendText(from, `❌ This bot has joined the maximum number of groups WhatsApp allows in a short window. Please wait ~${minutes} more minute${minutes === 1 ? "" : "s"} and try again.`);
      return;
    }
    try {
      // Fetch invite metadata first so we can check if already a member and show
      // the group name on success. If that lookup fails, go straight to join.
      let groupName = "the group";
      let alreadyMember = false;
      try {
        const inviteInfo = await sock.groupGetInviteInfo(code);
        if (inviteInfo?.id) {
          groupName = inviteInfo.subject || groupName;
          const existing = await sock.groupMetadata(inviteInfo.id).catch(() => null);
          if (existing) { alreadyMember = true; groupName = existing.subject || groupName; }
        }
      } catch { /* metadata lookup optional — proceed to join anyway */ }
      if (alreadyMember) { await sendText(from, `✅ Bot is already in *${groupName}*.`); return; }
      // Always use the simple groupAcceptInvite path (code only).
      // groupAcceptInviteV4 requires the JID of the person who invited you
      // (the chat JID of the inviter), NOT the current group JID — passing
      // the wrong JID caused "account_reachout_restricted" errors even when
      // WhatsApp wasn't actually restricting anything.
      await sock.groupAcceptInvite(code);
      await sendText(from, `✅ Bot has joined *${groupName}*.`);
    } catch (err: any) {
      const errMsg = err?.message || "Unknown error";
      // account_reachout_restricted (with the correct groupAcceptInvite
      // call already in use above) is WhatsApp's own server-side rate
      // limit on group joins for an account — not a bug we can code
      // around. It clears on its own after the account's join count drops
      // back under WhatsApp's rolling window; the retry message below is
      // accurate rather than implying anything is actually broken.
      if (/account_reachout_restricted/i.test(errMsg)) {
        await sendText(from, "❌ WhatsApp is blocking this join attempt at the account level (`account_reachout_restricted`). This can happen on newly-linked accounts, accounts flagged by WhatsApp, or after several joins in a short window — it is not a code bug. It clears on its own; try again in 10–30 minutes, or add the bot to the group directly as a participant instead.");
        return;
      }
      // Show the raw error so other issues stay visible and diagnosable.
      // Previous mapping to a generic "WhatsApp is blocking" message hid
      // real errors (wrong code, expired link, bot not in correct state, etc.)
      await sendText(from, `❌ Failed to join: ${errMsg}\n\n_If the link is valid and the bot is connected, try adding the bot directly as a participant._`);
    }
    return;
  }

  if (cmd === "exit") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods and above can make the bot leave."); return; }
    if (!from.endsWith("@g.us")) { await sendText(from, "❌ Must be used in a group."); return; }
    await sendText(from, "👋 Goodbye! The bot is leaving this group.");
    await sock.groupLeave(from).catch(() => {});
    return;
  }

  if (cmd === "show") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods and above can use this command."); return; }
    const anySock = (await getAnyConnectedManagedSock()) || getAnySock();
    if (!anySock) { await sendText(from, "❌ Bot not connected."); return; }
    const user = anySock.user;
    const bots = await getAllBotsStatus();
    const online = bots.filter((b: any) => b.connected).length;
    await sendText(from, `🤖 *Bot Info*\n\n📛 Name: ${user?.name || "Unknown"}\n📱 ID: ${user?.id || "Unknown"}\n🟢 Online Bots: ${online}/${bots.length}`);
    return;
  }

  if (cmd === "dc" || cmd === "ac" || cmd === "rc") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods and above can change card settings."); return; }
    if (!from.endsWith("@g.us")) { await sendText(from, "❌ Must be used in a group."); return; }
    if (cmd === "dc") {
      await updateGroup(from, { cards_enabled: "off", spawn_enabled: "off" });
      await sendText(from, "🃏 Card spawning *disabled* in this group.");
    } else if (cmd === "ac") {
      // .ac [activity|time]
      // activity mode (default): cards only spawn when group is ≥30% active
      // time mode: cards spawn on the timer regardless of group activity
      const modeArg = (args[0] || "").toLowerCase();
      const mode = modeArg === "time" ? "time" : "activity";
      await updateGroup(from, { cards_enabled: "on", spawn_enabled: "on", spawn_mode: mode });
      if (mode === "time") {
        await sendText(from,
          `🃏 Card spawning *enabled* (⏱️ *time mode*) — cards spawn on the auto-timer regardless of group activity.\n\n` +
          `_Use *.ac activity* to switch to activity-gated mode, or *.dc* to disable._`
        );
      } else {
        await sendText(from,
          `🃏 Card spawning *enabled* (📊 *activity mode*) — cards spawn when the group is active.\n\n` +
          `_Use *.ac time* to spawn without requiring activity, or *.dc* to disable._`
        );
      }
    } else {
      await updateGroup(from, { spawn_enabled: "off" });
      await sendText(from, "🃏 Auto card spawning *restricted* — manual spawning still works.");
    }
    return;
  }

  if (cmd === "upload") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only staff can upload cards."); return; }
    const rawArgs = args.join(" ");
    const tierMatch = rawArgs.match(/^(T[A-Z0-9]+)\s+(.+)$/i);
    if (!tierMatch) { await sendText(from, "❌ Usage: *.upload [Tier] [Name], [Series]*\nExample: .upload T5 Gojo, Jujutsu Kaisen\n\nReply to an image when using this command."); return; }
    const tier = tierMatch[1].toUpperCase();
    const rest = tierMatch[2];
    const commaIdx = rest.indexOf(",");
    if (commaIdx === -1) { await sendText(from, "❌ Usage: *.upload [Tier] [Name], [Series]*"); return; }
    const cardName = rest.slice(0, commaIdx).trim();
    const series = rest.slice(commaIdx + 1).trim();
    if (!cardName || !series) { await sendText(from, "❌ Both card name and series are required."); return; }
    const quotedMsg = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const directImg = ctx.msg.message?.imageMessage;
    const quotedImg = quotedMsg?.imageMessage;
    const imgMsg = directImg ?? quotedImg;
    const ANIMATED_TIERS_SET = new Set(["T6","TS","TX","TZ"]);
    const isAnimatedTier = ANIMATED_TIERS_SET.has(tier);
    const quotedVideo = quotedMsg?.videoMessage;
    const directVideo = ctx.msg.message?.videoMessage;
    const videoMsg = directVideo ?? quotedVideo;
    const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
    let imageBuffer: Buffer;
    let isAnimated = 0;
    if (isAnimatedTier && videoMsg) {
      const vStream = await downloadContentFromMessage(videoMsg, "video");
      const vChunks: Buffer[] = [];
      for await (const chunk of vStream) vChunks.push(chunk as Buffer);
      imageBuffer = Buffer.concat(vChunks); isAnimated = 1;
    } else if (imgMsg) {
      const stream = await downloadContentFromMessage(imgMsg, "image");
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      imageBuffer = Buffer.concat(chunks); isAnimated = 0;
    } else {
      await sendText(from, `❌ Please reply to an image${isAnimatedTier ? " or video" : ""} or send it with this command.`); return;
    }
    const VALID_TIERS = ["T1","T2","T3","T4","T5","T6","TS","TX","TZ"];
    if (!VALID_TIERS.includes(tier)) { await sendText(from, `❌ Invalid tier *${tier}*. Valid: ${VALID_TIERS.join(", ")}`); return; }
    const existingByName = await col("cards").findOne({ name: { $regex: `^${escapeRegex(cardName)}$`, $options: "i" } });
    if (existingByName) { await sendText(from, `❌ A card named *${cardName}* already exists (ID: ${existingByName._id}).`); return; }
    const { generateUniqueCardId } = await import("../utils.js");
    const existingIds = new Set((await col("cards").distinct("_id")));
    const newCardId = generateUniqueCardId(existingIds as Set<any>);
    await col("cards").insertOne({ _id: newCardId as any, id: newCardId, name: cardName, series, tier, image_data: imageBuffer.toString("base64"), is_animated: isAnimated, uploaded_by: sender.split("@")[0], source: "upload", created_at: Math.floor(Date.now()/1000) });
    await sendText(from, `✅ Card uploaded successfully!\n\n🎴 *${cardName}* — *${tier}*\n📚 Series: *${series}*\n🆔 Card ID: *${newCardId}*`);
    return;
  }

  if (cmd === "rules") {
    if (!from.endsWith("@g.us")) { await sendText(from, "❌ Must be used in a group."); return; }
    const group = await getGroup(from);
    const rules = (group as any)?.rules || null;
    if (rules) {
      await sendText(from, `📋 *Group Rules*\n\n${rules}`);
      return;
    }
    // Default rules shown until staff sets custom ones with .setrules. Not
    // meant to be exhaustive legalese — just a real, readable baseline so
    // new members actually know what's expected before they get warned or
    // banned for something nobody told them was off-limits.
    await sendText(
      from,
      `🌸━━━『 反逆 』━━━🌸\n\n` +
      `✦ 𝗖𝗢𝗠𝗠𝗨𝗡𝗜𝗧𝗬 𝗥𝗨𝗟𝗘𝗦 ✦\n\n` +
      `❀━━━━━━━━━━━━━━❀\n` +
      `        🤝 𝗥𝗘𝗦𝗣𝗘𝗖𝗧\n` +
      `❀━━━━━━━━━━━━━━❀\n` +
      `➺ No harassment, hate speech, or targeted insults — banter is fine, cruelty isn't\n` +
      `➺ No spam, flooding, or excessive tagging (@everyone, .tagall abuse, etc)\n` +
      `➺ No NSFW, gore, or graphic content — this includes profile pictures and stickers\n` +
      `➺ Keep spoilers tagged/warned for at least a few days after release\n\n` +
      `❀━━━━━━━━━━━━━━❀\n` +
      `      💰 𝗘𝗖𝗢𝗡𝗢𝗠𝗬 & 𝗖𝗔𝗥𝗗𝗦\n` +
      `❀━━━━━━━━━━━━━━❀\n` +
      `➺ No exploiting bugs for coins, cards, or items — report them instead, don't abuse them\n` +
      `➺ No alt/multi-accounting to farm daily rewards, gambling, or auctions\n` +
      `➺ Trades and auctions are final once confirmed — scamming other players gets you banned\n` +
      `➺ Gambling commands are for fun, not for draining other members — keep it reasonable\n\n` +
      `❀━━━━━━━━━━━━━━❀\n` +
      `        ⚔️ 𝗠𝗢𝗗𝗘𝗥𝗔𝗧𝗜𝗢𝗡\n` +
      `❀━━━━━━━━━━━━━━❀\n` +
      `➺ Follow staff instructions — mods, guardians, and the owner have final say\n` +
      `➺ Warnings stack — 5 warnings results in an automatic kick\n` +
      `➺ Repeated or severe violations skip straight to a ban, staff's discretion\n` +
      `➺ Disagree with a decision? DM staff privately, don't argue it out in the GC\n\n` +
      `❀━━━━━━━━━━━━━━❀\n` +
      `_Use *.setrules* to customize these for your group._`
    );
    return;
  }

  if (cmd === "resetbal") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods and above can reset balances."); return; }
    const targetPhone = args[0]?.replace(/\D/g, "");
    if (!targetPhone) { await sendText(from, "❌ Usage: *.resetbal* [phone_number]"); return; }
    await resetUserBalance(targetPhone);
    await sendText(from, `✅ Balance reset for +${targetPhone}.`);
    return;
  }

  if (cmd === "reset") {
    if (!ctx.isOwner) { await sendText(from, "❌ Only the owner can fully reset user profiles."); return; }
    const targetPhone = args[0]?.replace(/\D/g, "");
    if (!targetPhone) { await sendText(from, "❌ Usage: *.reset* [phone_number]"); return; }
    await resetUserProfile(targetPhone);
    await sendText(from, `✅ Profile fully reset for +${targetPhone}.`);
    return;
  }

  // ── .deleteplayer — TRUE account deletion ─────────────────────────────────
  // Unlike .reset (which wipes and immediately recreates the user), this
  // removes the player entirely. They only reappear once they message the
  // bot again, which re-registers them from scratch via ensureUser.
  if (cmd === "deleteplayer") {
    if (!ctx.isOwner) { await sendText(from, "❌ Only the owner can permanently delete a player."); return; }
    const targetPhone = args[0]?.replace(/\D/g, "");
    if (!targetPhone) { await sendText(from, "❌ Usage: *.deleteplayer* [phone_number]"); return; }
    await deleteUserProfile(targetPhone);
    await sendText(from, `✅ Player +${targetPhone} has been permanently deleted — all their data (cards, balance, RPG, inventory, staff role, etc.) is gone. They'll be treated as brand new if they message the bot again.`);
    return;
  }

  if (cmd === "addinv") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods and above can add inventory items."); return; }
    const targetPhone = args[0]?.replace(/\D/g, "");
    const item = args.slice(1).join(" ");
    if (!targetPhone || !item) { await sendText(from, "❌ Usage: *.addinv* [phone_number] [item name]"); return; }
    await addToInventory(targetPhone, item);
    await sendText(from, `✅ Added *${item}* to +${targetPhone}'s inventory.`);
    return;
  }

  if (cmd === "setms") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods and above can set milestone messages."); return; }
    const msText = args.join(" ");
    if (!msText) { await sendText(from, "❌ Usage: *.setms* [message]"); return; }
    if (from.endsWith("@g.us")) { await updateGroup(from, { milestone_msg: msText }); }
    else { await setBotSetting("global_milestone_msg", msText); }
    await sendText(from, `✅ Milestone message set:\n\n_${msText}_`);
    return;
  }

  if (cmd === "delms") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods and above can delete milestone messages."); return; }
    if (from.endsWith("@g.us")) { await updateGroup(from, { milestone_msg: null }); }
    else { await deleteBotSetting("global_milestone_msg"); }
    await sendText(from, "✅ Milestone message deleted.");
    return;
  }

  if (cmd === "fetchcards") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods and above can import cards."); return; }
    const SHOOB_API = "https://api.shoob.gg";
    const VALID_TIERS_FETCH = ["T1","T2","T3","T4","T5","T6","TS","TX","TZ"];
    const ANIMATED_TIERS_FETCH = new Set(["T6","TS","TX","TZ"]);
    function normTier(raw: string | number | undefined): string {
      if (raw === null || raw === undefined) return "T1";
      const s = String(raw).trim().toUpperCase();
      if (s.startsWith("T") && VALID_TIERS_FETCH.includes(s)) return s;
      if (/^\d$/.test(s)) return `T${s}`;
      if (s === "S") return "TS"; if (s === "X") return "TX"; if (s === "Z") return "TZ";
      return "T1";
    }
    const firstArg = (args[0] || "").toUpperCase();
    let filterTier = "";
    let limit = 20;
    if (firstArg && VALID_TIERS_FETCH.includes(firstArg)) { filterTier = firstArg; limit = Math.min(parseInt(args[1] || "20", 10) || 20, 200); }
    else if (firstArg && /^\d+$/.test(firstArg)) { limit = Math.min(parseInt(firstArg, 10) || 20, 200); }
    else if (firstArg) { await sendText(from, `❌ Invalid option. Usage: *.fetchcards [tier] [limit]*`); return; }
    await sendText(from, `🌐 Fetching cards from Shoob.gg...\n_Tier: ${filterTier || "any"} | Limit: ${limit}_`);
    try {
      const collected: any[] = [];
      let page = 1;
      while (collected.length < limit) {
        const apiRes = await fetch(`${SHOOB_API}/site/api/cards?page=${page}&limit=50`, { headers: { "Accept":"application/json","User-Agent":"Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
        if (!apiRes.ok) { await sendText(from, `❌ Shoob API returned HTTP ${apiRes.status}.`); return; }
        const apiData: any = await apiRes.json();
        const pageCards: any[] = Array.isArray(apiData) ? apiData : (apiData.cards || apiData.data || apiData.results || []);
        if (!pageCards.length) break;
        for (const c of pageCards) {
          const cardTier = normTier(c.tier);
          if (filterTier && cardTier !== filterTier) continue;
          collected.push(c);
          if (collected.length >= limit) break;
        }
        if (pageCards.length < 50) break;
        page++;
      }
      if (!collected.length) { await sendText(from, filterTier ? `❌ No ${filterTier} cards found on Shoob.` : `❌ No cards returned from Shoob.`); return; }
      const { generateUniqueCardId } = await import("../utils.js");
      const existingIds = new Set(await col("cards").distinct("_id"));
      let imported = 0, skipped = 0;
      const errors: string[] = [];
      const uploaderPhone = sender.split("@")[0].split(":")[0];
      for (const sc of collected) {
        const shoobId: string = String(sc._id || sc.id || "").trim();
        const cardName: string = (sc.name || sc.slug || shoobId).trim().replace(/_/g, " ");
        if (!cardName || cardName.length < 2) { skipped++; continue; }
        const existsByShoobId = shoobId ? await col("cards").findOne({ shoob_id: shoobId }) : null;
        const existsByName = await col("cards").findOne({ name: { $regex: `^${escapeRegex(cardName)}$`, $options: "i" } });
        if (existsByShoobId || existsByName) { skipped++; continue; }
        const cardTier = normTier(sc.tier);
        const cardSeries: string = Array.isArray(sc.category) && sc.category[0] ? String(sc.category[0]).trim() : (sc.series || sc.anime || "Shoob");
        const imageUrl = shoobId ? `${SHOOB_API}/site/api/cardr/${shoobId}?size=400` : "";
        const cardIsAnimated = ANIMATED_TIERS_FETCH.has(cardTier) ? 1 : 0;
        let imageBase64: string | null = null;
        if (imageUrl) {
          try {
            const mediaRes = await fetch(imageUrl, { headers: { "User-Agent":"Mozilla/5.0" }, signal: AbortSignal.timeout(25000) });
            if (mediaRes.ok) {
              const buf = Buffer.from(await mediaRes.arrayBuffer());
              if (!cardIsAnimated) { try { const sharp = (await import("sharp")).default; imageBase64 = (await sharp(buf).resize(800,1100,{fit:"inside",withoutEnlargement:true}).jpeg({quality:92}).toBuffer()).toString("base64"); } catch { imageBase64 = buf.toString("base64"); } }
              else { imageBase64 = buf.toString("base64"); }
            }
          } catch (e: any) { errors.push(`${cardName}: ${e?.message || "fetch failed"}`); }
          await new Promise((r) => setTimeout(r, 110));
        }
        const newCardId = generateUniqueCardId(existingIds as Set<any>);
        existingIds.add(newCardId);
        await col("cards").insertOne({ _id: newCardId as any, id: newCardId, name: cardName, series: cardSeries, tier: cardTier, image_data: imageBase64, is_animated: cardIsAnimated, uploaded_by: uploaderPhone, source: "shoob", shoob_id: shoobId || null, created_at: Math.floor(Date.now()/1000) });
        imported++;
      }
      let summary = `✅ *Import Done!*\n\n🎴 Imported: *${imported}* cards\n⏭️ Skipped: *${skipped}*\n📊 Total: *${collected.length}*${filterTier ? `\n⭐ Tier: *${filterTier}*` : ""}`;
      if (errors.length > 0) summary += `\n\n⚠️ Errors (${errors.length}): ${errors.slice(0, 3).join(", ")}${errors.length > 3 ? ` …and ${errors.length - 3} more` : ""}`;
      await sendText(from, summary);
    } catch (err: any) { await sendText(from, `❌ Card import failed: ${err?.message || "Unknown error"}`); }
    return;
  }

  if (cmd === "website") {
    const websiteUrl = process.env["WEBSITE_URL"] || "";
    if (!websiteUrl) { await sendText(from, "❌ Website URL not configured."); return; }
    await sendText(from, `🌐 *Requiem Order Website*\n\n${websiteUrl}`);
    return;
  }

  if (cmd === "summon") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods, guardians and the owner can summon cards."); return; }
    if (!from.endsWith("@g.us")) { await sendText(from, "❌ Must be used in a group."); return; }
    if (args.length === 0) { await sendText(from, "❌ Usage:\n*.summon <tier>* — e.g. .summon TX\n*.summon <name> [tier]* — e.g. .summon Lelouch 5\n*.summon id:<CardID>*\n\nAdd *force* at the end to replace a currently-active unclaimed spawn."); return; }

    const forceIdx = args.findIndex((a) => a.toLowerCase() === "force");
    const force = forceIdx !== -1;
    const searchArgs = force ? [...args.slice(0, forceIdx), ...args.slice(forceIdx + 1)] : args;

    // A previous spawn (natural or manual) that's still active and
    // unclaimed silently blocks any new spawn — this is exactly why
    // .summon would say "✨ Summoning..." and then nothing would actually
    // appear, with no error at all. Tell the mod plainly instead of
    // failing silently, and let them force it if that's what they want.
    const existing = await getActiveSpawn(from);
    if (existing && !force) {
      await sendText(from, `⚠️ There's already an unclaimed card spawn active in this group — it needs to be claimed or expire first.\n\nAdd *force* to the end of your command to replace it: e.g. *.summon ${args.join(" ")} force*`);
      return;
    }
    if (existing && force) {
      await expireActiveSpawn(from);
    }

    const idArg = searchArgs.find((a) => /^id:/i.test(a));

    // ── ID lookup — direct DB fetch, no full card load ─────────────────────
    if (idArg) {
      const targetId = idArg.slice(3);
      const card = await getCardFullById(targetId);
      if (!card) { await sendText(from, `❌ No card found with ID *${targetId}*.`); return; }
      await sendText(from, `✨ Summoning *${card.name}* (${card.tier})…`);
      await spawnCard(sock, from, String(card.id));
      return;
    }

    const { nameQuery, tier: searchTier } = parseCardSearchArgs(searchArgs);

    // ── Tier-only summon — load just that tier from DB, not all 51k cards ──
    if (!searchTier && isValidTier(nameQuery.toUpperCase())) {
      const tier = nameQuery.toUpperCase();
      const tierCards = await getAllCards(tier);
      if ((tierCards as any[]).length === 0) { await sendText(from, `❌ No cards found for tier *${tier}*.`); return; }
      const card = (tierCards as any[])[Math.floor(Math.random() * (tierCards as any[]).length)];
      await sendText(from, `✨ Summoning *${card.name}* (${card.tier})…`);
      await spawnCard(sock, from, String(card.id));
      return;
    }

    // ── Name search — use targeted MongoDB regex query, not full card load ──
    if (!nameQuery) { await sendText(from, "❌ Usage: .summon <name> [tier] — search is exact, so check spelling."); return; }
    const nameMatches = await searchCardsByName(nameQuery, searchTier);
    if ((nameMatches as any[]).length === 0) { await sendText(from, `❌ No card found named exactly *"${nameQuery}"*${searchTier ? ` (tier ${searchTier})` : ""}.\n_Search is exact — check spelling, or use .summon id:<CardID>._`); return; }
    if ((nameMatches as any[]).length > 1) {
      const list = (nameMatches as any[]).slice(0, 10).map((c: any) => `• ${c.name} (${c.tier}, ${c.series || "General"}) — ID: ${c.id}`).join("\n");
      await sendText(from, `⚠️ Found ${(nameMatches as any[]).length} different cards named *"${nameQuery}"*${searchTier ? ` in tier ${searchTier}` : ""}:\n\n${list}${(nameMatches as any[]).length > 10 ? `\n_...and ${(nameMatches as any[]).length - 10} more_` : ""}\n\nUse *.summon id:<CardID>* to pick a specific one.`);
      return;
    }
    const card = (nameMatches as any[])[0];
    await sendText(from, `✨ Summoning *${card.name}* (${card.tier})…`);
    await spawnCard(sock, from, String(card.id));
    return;
  }

  if (cmd === "restart") {
    if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods and above can restart the bot."); return; }
    await sendText(from, "♻️ *Restarting bot…* Give it 15–30 seconds.");
    setTimeout(async () => {
      try { const { connectToWhatsApp, gracefulShutdown } = await import("../connection.js"); await gracefulShutdown(); await connectToWhatsApp(undefined, { promptForPhone: false }); }
      catch (err) { logger.error({ err }, ".restart failed"); }
    }, 1500);
    return;
  }

  // ── .mergenumber — account migration when a user changes their phone ─────────
  // Usage: .mergenumber <old_phone> <new_phone>
  // Transfers all user data from the old number to the new one: balance, inventory,
  // cards, RPG, staff roles, etc. Old phone records are deleted after migration.
  if (cmd === "mergenumber") {
    if (!(await isOwnerOrGuardian(ctx))) { await sendText(from, "❌ Only guardians and the owner can migrate accounts."); return; }
    const oldPhone = args[0]?.replace(/\D/g, "");
    const newPhone = args[1]?.replace(/\D/g, "");
    if (!oldPhone || !newPhone) { await sendText(from, "❌ Usage: *.mergenumber* [old_phone] [new_phone]"); return; }
    if (oldPhone === newPhone) { await sendText(from, "❌ Old and new phone numbers are the same."); return; }
    if (!/^\d{7,15}$/.test(oldPhone) || !/^\d{7,15}$/.test(newPhone)) { await sendText(from, "❌ Invalid phone number format. Use digits only, 7–15 digits."); return; }
    await sendText(from, `⏳ Migrating +${oldPhone} → +${newPhone}…`);
    try {
      const { col } = await import("../db/mongo.js");
      const now = Math.floor(Date.now() / 1000);
      let migrated = 0, skipped = 0;

      // Determine which collections exist and migrate each one
      const MIGRATIONS: Array<{ coll: string; idField: string; isPhoneId?: boolean }> = [
        { coll: "users",           idField: "_id", isPhoneId: true },
        { coll: "rpg_characters",  idField: "_id", isPhoneId: true },
        { coll: "afk_users",       idField: "_id", isPhoneId: true },
        { coll: "staff",           idField: "_id", isPhoneId: true },
        { coll: "inventory",       idField: "user_id" },
        { coll: "user_cards",      idField: "user_id" },
        { coll: "message_counts",  idField: "user_id" },
        { coll: "lottery_entries", idField: "user_id" },
        { coll: "guild_members",   idField: "user_id" },
        { coll: "achievements",    idField: "user_id" },
        { coll: "web_achievements",idField: "user_id" },
      ];

      for (const m of MIGRATIONS) {
        try {
          if (m.isPhoneId) {
            // These collections use phone as _id
            const oldDoc = await col(m.coll).findOne({ _id: oldPhone as any });
            if (!oldDoc) { skipped++; continue; }
            const existNew = await col(m.coll).findOne({ _id: newPhone as any });
            if (existNew) {
              // Merge: update the new record preserving existing data, then delete old
              const { _id, ...rest } = oldDoc as any;
              await col(m.coll).updateOne({ _id: newPhone as any }, { $set: rest });
            } else {
              // Simple rename: insert under new ID, delete old
              const { _id, ...rest } = oldDoc as any;
              await col(m.coll).insertOne({ _id: newPhone as any, ...rest, user_id: newPhone });
            }
            await col(m.coll).deleteOne({ _id: oldPhone as any });
            migrated++;
          } else {
            // These collections use user_id as a field; update bulk
            const result = await col(m.coll).updateMany({ [m.idField]: oldPhone }, { $set: { [m.idField]: newPhone } });
            if (result.matchedCount > 0) migrated++;
          }
        } catch (innerErr) {
          logger.warn({ err: innerErr, coll: m.coll }, "mergenumber: partial failure on collection");
          skipped++;
        }
      }

      // Update the web sessions / auth tokens if any reference the old phone
      await col("web_sessions").updateMany({ phone: oldPhone }, { $set: { phone: newPhone } }).catch(() => {});
      await col("users").updateOne({ _id: newPhone as any }, { $set: { merged_from: oldPhone, merged_at: now } }).catch(() => {});

      await sendText(from,
        `✅ *Account Migration Complete*\n\n` +
        `📱 +${oldPhone} → +${newPhone}\n` +
        `📦 Collections updated: *${migrated}*\n` +
        `⚠️ Skipped (empty/error): *${skipped}*\n\n` +
        `_The user should re-register with their new number if their old session is broken._`
      );
    } catch (err: any) {
      logger.error({ err }, "mergenumber failed");
      await sendText(from, `❌ Migration failed: ${err?.message || "Unknown error"}. Check logs.`);
    }
    return;
  }

  await sendText(from, `❌ Unknown staff command: *.${cmd}*\n\nAvailable: bots, modlist, addmod, addguardian, removeguardian, removemod, recruit, addpremium, removepremium, ban, unban, banlist, addrole, mergenumber, post, join, exit, show, dc, ac, rc, upload, rules, resetbal, reset, deleteplayer, addinv, setms, delms, fetchcards, website, summon, restart`);
}
