import type { WASocket } from "@whiskeysockets/baileys";
import type { CommandContext } from "./index.js";
import {
  ensureGroup, getGroup, updateGroup, getWarnings, addWarning, resetWarnings,
  getActiveMembers, getInactiveMembers, getMods, addMod, isMod, getGroupActivity,
  muteUser, unmuteUser, getCardStats, getStaff, getMentionName, getUserByLid,
} from "../db/queries.js";
import { sendText, sendTextWithPreview } from "../connection.js";
import { formatNumber, mentionTag, normalizeId } from "../utils.js";
import { resolveMentionedJidAsync } from "../utils/identity.js";
import { mark } from "../cmd-trace.js";
import { logger } from "../../lib/logger.js";
import { execSync } from "node:child_process";
import os from "node:os";

export async function handleAdmin(ctx: CommandContext): Promise<void> {
  const { sock, msg, from, sender, args, isAdmin, isBotAdmin, isOwner, isGroupAdmin, groupMeta, prefix, resolvedMentions, groupMetaFetchFailed } = ctx;
  const cmd = ctx.command;

  // ── Server management commands (work in DMs and groups) ─────────────────────
  if (cmd === "restartserv") {
    if (!isOwner) return noPerms(from);
    await sendText(from, "🔄 *Restarting server...* \n\n_Bot will be back online in a few seconds._");
    setTimeout(() => process.exit(0), 800);
    return;
  }

  if (cmd === "git") {
    const staffRec = ctx.senderStaffRecord;
    const isModAbove = isOwner || (staffRec && ["owner", "guardian", "mod"].includes((staffRec as any).role));
    if (!isModAbove) return noPerms(from);
    try {
      const commitHash   = execSync("git log -1 --format=%H",   { encoding: "utf8" }).trim();
      const commitShort  = commitHash.slice(0, 7);
      const commitMsg    = execSync("git log -1 --format=%s",   { encoding: "utf8" }).trim();
      const commitAuthor = execSync("git log -1 --format=%an",  { encoding: "utf8" }).trim();
      const commitDate   = execSync("git log -1 --format=%ar",  { encoding: "utf8" }).trim();
      const branch       = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
      let remoteUrl = "";
      try { remoteUrl = execSync("git remote get-url origin", { encoding: "utf8" }).trim(); } catch {}
      // Sanitise any embedded credentials from the URL
      remoteUrl = remoteUrl.replace(/\/\/[^@]+@/, "//");
      const totalCommits = execSync("git rev-list --count HEAD", { encoding: "utf8" }).trim();
      const text =
        `╔═ ❰ 🌿 𝗚𝗜𝗧 𝗜𝗡𝗙𝗢 ❱ ═╗\n` +
        `║ 🌿 𝗕𝗿𝗮𝗻𝗰𝗵: ${branch}\n` +
        `║ 📦 𝗖𝗼𝗺𝗺𝗶𝘁𝘀: ${totalCommits}\n║\n` +
        `║ 🔖 𝗟𝗮𝘁𝗲𝘀𝘁 𝗖𝗼𝗺𝗺𝗶𝘁\n` +
        `║   ${commitShort} — ${commitMsg}\n` +
        `║   👤 ${commitAuthor}  •  🕒 ${commitDate}\n` +
        (remoteUrl ? `║\n║ 🔗 𝗥𝗲𝗺𝗼𝘁𝗲: ${remoteUrl}\n` : "") +
        `╚══════════════════╝`;
      await sendText(from, text);
    } catch (e) {
      await sendText(from, "❌ Could not read git info. Make sure this is a git repository.");
    }
    return;
  }

  if (cmd === "servstats") {
    const staffRec = ctx.senderStaffRecord;
    const isModAbove = isOwner || (staffRec && ["owner", "guardian", "mod"].includes((staffRec as any).role));
    if (!isModAbove) return noPerms(from);
    const totalMem   = os.totalmem();
    const freeMem    = os.freemem();
    const usedMem    = totalMem - freeMem;
    const memPct     = ((usedMem / totalMem) * 100).toFixed(1);
    const heapUsed   = process.memoryUsage().heapUsed;
    const loadAvg    = os.loadavg();
    const cpuCount   = os.cpus().length;
    const uptimeSec  = Math.floor(os.uptime());
    const procUpSec  = Math.floor(process.uptime());

    const fmtBytes = (b: number) => {
      if (b >= 1073741824) return (b / 1073741824).toFixed(1) + " GB";
      return (b / 1048576).toFixed(1) + " MB";
    };
    const fmtUptime = (s: number) => {
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
    };
    const cpuBar = (load: number) => {
      const pct = Math.min(100, (load / cpuCount) * 100);
      const filled = Math.round(pct / 10);
      return "█".repeat(filled) + "░".repeat(10 - filled) + ` ${pct.toFixed(1)}%`;
    };

    const platform = os.platform();
    const arch     = os.arch();
    const hostname = os.hostname();

    const text =
      `╔═ ❰ 📊 𝗦𝗘𝗥𝗩𝗘𝗥 𝗦𝗧𝗔𝗧𝗦 ❱ ═╗\n` +
      `║ 🖥️ 𝗛𝗼𝘀𝘁: ${hostname}\n` +
      `║ 💻 𝗣𝗹𝗮𝘁𝗳𝗼𝗿𝗺: ${platform} (${arch})\n` +
      `║ ⚙️ 𝗖𝗣𝗨𝘀: ${cpuCount} cores\n║\n` +
      `║ 📈 𝗖𝗣𝗨 𝗟𝗼𝗮𝗱 𝗔𝘃𝗴\n` +
      `║   1m:  ${cpuBar(loadAvg[0])}\n` +
      `║   5m:  ${cpuBar(loadAvg[1])}\n` +
      `║   15m: ${cpuBar(loadAvg[2])}\n║\n` +
      `║ 🧠 𝗥𝗔𝗠\n` +
      `║   Used: ${fmtBytes(usedMem)} / ${fmtBytes(totalMem)} (${memPct}%)\n` +
      `║   Bot heap: ${fmtBytes(heapUsed)}\n║\n` +
      `║ ⏱️ 𝗨𝗽𝘁𝗶𝗺𝗲\n` +
      `║   System: ${fmtUptime(uptimeSec)}\n` +
      `║   Process: ${fmtUptime(procUpSec)}\n` +
      `╚══════════════════╝`;
    await sendText(from, text);
    return;
  }

  if (!from.endsWith("@g.us")) {
    await sendText(from, "❌ This command can only be used in groups.");
    return;
  }

  const group = await getGroup(from) || {};
  const isModUser = await isMod(sender, from);
  const canUse = isAdmin || isModUser || isOwner;
  // If we couldn't fetch group metadata this turn (rate limit, transient
  // disconnect), isAdmin defaults to false and looks identical to "not an
  // admin" — that previously caused confirmed WhatsApp admins to get a flat
  // "no permission" denial during connection hiccups. Tell the truth instead:
  // ask them to retry rather than implying they lack the role.
  if (!canUse && groupMetaFetchFailed) {
    await sendText(from, "⚠️ Couldn't verify your admin status just now (connection hiccup) — please try again in a moment.");
    return;
  }

  if (cmd === "kick") {
    if (!canUse) return noPerms(from);
    if (!isBotAdmin) return botNoAdmin(from);
    const info = msg.message?.extendedTextMessage?.contextInfo;
    const rawMentioned = resolvedMentions[0]
      || info?.participant
      || (args[0] ? `${args[0].replace(/\D/g, "")}@s.whatsapp.net` : null);
    if (!rawMentioned) {
      await sendText(from, "❌ Please mention someone to kick or reply to their message with .kick.");
      return;
    }
    const mentioned = rawMentioned;
    const mentionedName = await getMentionName(mentioned);
    await sock.groupParticipantsUpdate(from, [mentioned], "remove");
    await sock.sendMessage(from, {
      text: `🚫 @${mentionedName} has been kicked successfully.`,
      mentions: [mentioned],
    });
    return;
  }

  if (cmd === "delete" || cmd === "del" || cmd === "d") {
    if (!canUse) return noPerms(from);
    const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = ctxInfo?.stanzaId;
    if (!quoted) {
      await sendText(from, "❌ Reply to a message to delete it.");
      return;
    }
    const quotedParticipant = ctxInfo?.participant || "";
    const botJid: string = (sock as any)?.user?.id || "";
    const botPhone = botJid.split("@")[0].split(":")[0];
    const quotedPhone = quotedParticipant.split("@")[0].split(":")[0];
    const fromMe = !!botPhone && quotedPhone === botPhone;
    const key = {
      remoteJid: from,
      fromMe,
      id: quoted,
      participant: quotedParticipant || undefined,
    };
    await sock.sendMessage(from, { delete: key as any });
    return;
  }

  if (cmd === "warn") {
    if (!canUse) return noPerms(from);
    const rawMentioned = resolvedMentions[0];
    if (!rawMentioned) {
      await sendText(from, "❌ Please mention someone to warn.");
      return;
    }
    const mentioned = await resolveMentionedJidAsync(rawMentioned, groupMeta, getUserByLid);
    const reason = args.slice(1).join(" ") || "No reason provided";
    const warns = await addWarning(mentioned, from, reason, sender);
    const count = warns.length;
    const mentionedName = await getMentionName(mentioned);
    await sendText(
      from,
      `┌─❖\n│「 ⚠️ 𝗪𝗔𝗥𝗡𝗜𝗡𝗚 」\n└┬❖ 「 @${mentionedName} 」\n│✑ 𝗥𝗘𝗔𝗦𝗢𝗡: ${reason}\n│✑ 𝗗𝗲𝘃𝗶𝗰𝗲: WhatsApp\n│✑ 𝗟𝗜𝗠𝗜𝗧: ${count} / 5\n└────────────┈ ⳹`,
      [mentioned]
    );
    if (count >= 5) {
      if (isBotAdmin) {
        await sock.groupParticipantsUpdate(from, [mentioned], "remove");
        await sendText(from, `🚫 @${mentionedName} reached 5 warnings and was removed.`, [mentioned]);
      }
    }
    return;
  }

  if (cmd === "resetwarn") {
    if (!canUse) return noPerms(from);
    const rawMentioned = resolvedMentions[0];
    if (!rawMentioned) {
      await sendText(from, "❌ Please mention someone.");
      return;
    }
    const mentioned = await resolveMentionedJidAsync(rawMentioned, groupMeta, getUserByLid);
    await resetWarnings(mentioned, from);
    const mentionedName = await getMentionName(mentioned);
    await sendText(from, `✅ Warnings reset for @${mentionedName}.`, [mentioned]);
    return;
  }

  if (cmd === "antilink") {
    if (!canUse) return noPerms(from);
    const action = args[0]?.toLowerCase();
    if (!action || action === "on") {
      void updateGroup(from, { antilink: "on", antilink_action: args[1] || "delete" });
      await sendText(from, `🔗 Anti-Link enabled (action: ${args[1] || "delete"})`);
    } else if (action === "off") {
      void updateGroup(from, { antilink: "off" });
      await sendText(from, "🔗 Anti-Link disabled.");
    } else if (action === "set") {
      const a = args[1]?.toLowerCase();
      if (!["delete","warn","kick"].includes(a)) {
        await sendText(from, "Valid actions: delete, warn, kick");
        return;
      }
      void updateGroup(from, { antilink: "on", antilink_action: a });
      await sendText(from, `🔗 Anti-Link action set to: ${a}`);
    }
    return;
  }

  if (cmd === "antism") {
    if (!canUse) return noPerms(from);
    const val = args[0]?.toLowerCase();
    if (val === "on") {
      void updateGroup(from, { antispam: "on" });
      await sendText(from, "🚫 Anti-Spam enabled.");
    } else {
      void updateGroup(from, { antispam: "off" });
      await sendText(from, "🚫 Anti-Spam disabled.");
    }
    return;
  }

  if (cmd === "welcome") {
    if (!canUse) return noPerms(from);
    const val = args[0]?.toLowerCase();
    // Previously `void updateGroup(...)` — fire-and-forget. If the write
    // failed (or just hadn't landed yet) the user still saw a success
    // message, since nothing awaited or checked it. That's the exact
    // "preview/confirmation works but the setting doesn't actually take"
    // symptom reported. Await it and report failure honestly.
    try {
      await updateGroup(from, { welcome: val === "on" ? "on" : "off" });
    } catch (err) {
      logger.error({ err, from }, "Failed to update welcome setting");
      await sendText(from, "❌ Failed to save that setting — please try again.");
      return;
    }
    await sendText(from, `✉️ Welcome messages ${val === "on" ? "enabled" : "disabled"}.`);
    return;
  }

  if (cmd === "setwelcome") {
    if (!canUse) return noPerms(from);
    // Use raw body to preserve newlines and spacing the user typed
    const msg_text = ctx.body.slice(ctx.prefix.length + cmd.length).trim();
    if (!msg_text) {
      await sendText(from, "❌ Usage: .setwelcome <message>\nUse @user where the new member should be tagged.\nExample: .setwelcome @user, welcome to Requiem Order 反逆!");
      return;
    }
    try {
      await updateGroup(from, { welcome_msg: msg_text, welcome: "on" });
    } catch (err) {
      logger.error({ err, from }, "Failed to save welcome message");
      await sendText(from, "❌ Failed to save the welcome message — please try again.");
      return;
    }
    const preview = msg_text.replace(/@user/gi, mentionTag(sender)).replace(/@mention/gi, mentionTag(sender));
    await sendText(
      from,
      `✅ Welcome message set & enabled!\n\nPreview:\n${preview}\n\n_Welcome is now ON. Use .welcome off to disable._`,
      (/@user/i.test(msg_text) || /@mention/i.test(msg_text)) ? [sender] : []
    );
    return;
  }

  if (cmd === "leave") {
    if (!canUse) return noPerms(from);
    const val = args[0]?.toLowerCase();
    try {
      await updateGroup(from, { leave: val === "on" ? "on" : "off" });
    } catch (err) {
      logger.error({ err, from }, "Failed to update leave setting");
      await sendText(from, "❌ Failed to save that setting — please try again.");
      return;
    }
    await sendText(from, `🚪 Leave messages ${val === "on" ? "enabled" : "disabled"}.`);
    return;
  }

  if (cmd === "setleave") {
    if (!canUse) return noPerms(from);
    const msg_text = ctx.body.slice(ctx.prefix.length + cmd.length).trim();
    if (!msg_text) {
      await sendText(from, "❌ Usage: .setleave <message>\nUse @user as placeholder.\nExample: .setleave @user has left Requiem Order 反逆. Goodbye!");
      return;
    }
    try {
      await updateGroup(from, { leave_msg: msg_text, leave: "on" });
    } catch (err) {
      logger.error({ err, from }, "Failed to save leave message");
      await sendText(from, "❌ Failed to save the leave message — please try again.");
      return;
    }
    const preview = msg_text.replace(/@user/gi, mentionTag(sender)).replace(/@mention/gi, mentionTag(sender));
    await sendText(
      from,
      `✅ Leave message set & enabled!\n\nPreview:\n${preview}\n\n_Leave is now ON. Use .leave off to disable._`,
      (/@user/i.test(msg_text) || /@mention/i.test(msg_text)) ? [sender] : []
    );
    return;
  }

  if (cmd === "promote") {
    if (!canUse) return noPerms(from);
    if (!isBotAdmin) return botNoAdmin(from);
    const rawMentioned = resolvedMentions[0]
      || msg.message?.extendedTextMessage?.contextInfo?.participant;
    if (!rawMentioned) {
      await sendText(from, "❌ Please mention someone.");
      return;
    }
    const mentioned = await resolveMentionedJidAsync(rawMentioned, groupMeta, getUserByLid);
    const mentionedName = await getMentionName(mentioned);
    await sock.groupParticipantsUpdate(from, [mentioned], "promote");
    await sock.sendMessage(from, {
      text: `@${mentionedName} is now an admin`,
      mentions: [mentioned],
    });
    return;
  }

  if (cmd === "demote") {
    if (!canUse) return noPerms(from);
    if (!isBotAdmin) return botNoAdmin(from);
    const rawMentioned = resolvedMentions[0]
      || msg.message?.extendedTextMessage?.contextInfo?.participant;
    if (!rawMentioned) {
      await sendText(from, "❌ Please mention someone.");
      return;
    }
    const mentioned = await resolveMentionedJidAsync(rawMentioned, groupMeta, getUserByLid);
    const mentionedName = await getMentionName(mentioned);
    await sock.groupParticipantsUpdate(from, [mentioned], "demote");
    await sock.sendMessage(from, {
      text: `@${mentionedName} is no longer an admin`,
      mentions: [mentioned],
    });
    return;
  }

  if (cmd === "pm") {
    // .pm — mod-level self-promote or promote a mentioned user to group admin.
    // Available to mods, guardians, and owner only.
    const staffRole = await getStaff(sender);
    const canPromote = isOwner || staffRole?.role === "mod" || staffRole?.role === "guardian";
    if (!canPromote) return noPerms(from);
    if (!isBotAdmin) return botNoAdmin(from);
    const rawMentioned = resolvedMentions[0]
      || msg.message?.extendedTextMessage?.contextInfo?.participant;
    // If no mention provided, promote the sender themselves
    const targetRaw = rawMentioned || sender;
    const mentioned = await resolveMentionedJidAsync(targetRaw, groupMeta, getUserByLid);
    await sock.groupParticipantsUpdate(from, [mentioned], "promote");
    await sock.sendMessage(from, { text: `✅ Done.`, mentions: [mentioned] });
    return;
  }

  if (cmd === "dm") {
    // .dm — mod-level self-demote or demote a mentioned user from group admin.
    // Available to mods, guardians, and owner only.
    const staffRole = await getStaff(sender);
    const canDemote = isOwner || staffRole?.role === "mod" || staffRole?.role === "guardian";
    if (!canDemote) return noPerms(from);
    if (!isBotAdmin) return botNoAdmin(from);
    const rawMentioned = resolvedMentions[0]
      || msg.message?.extendedTextMessage?.contextInfo?.participant;
    // If no mention provided, demote the sender themselves
    const targetRaw = rawMentioned || sender;
    const mentioned = await resolveMentionedJidAsync(targetRaw, groupMeta, getUserByLid);
    await sock.groupParticipantsUpdate(from, [mentioned], "demote");
    await sock.sendMessage(from, { text: `✅ Done.`, mentions: [mentioned] });
    return;
  }

  if (cmd === "mute") {
    if (!canUse) return noPerms(from);
    if (!isBotAdmin) return botNoAdmin(from);
    const info = msg.message?.extendedTextMessage?.contextInfo;
    const rawTarget = resolvedMentions[0] || info?.participant || null;
    if (rawTarget) {
      const target = await resolveMentionedJidAsync(rawTarget, groupMeta, getUserByLid);
      const durationText = info?.mentionedJid?.[0] ? args[1] : args[0];
      const durationSeconds = parseDuration(durationText || "1h");
      if (!durationSeconds) {
        await sendText(from, "❌ Usage: .mute @user <time>\nExamples: .mute @user 1m, or reply with .mute 1h");
        return;
      }
      const expiresAt = Math.floor(Date.now() / 1000) + durationSeconds;
      void muteUser(target, from, sender, expiresAt);
      const targetName = await getMentionName(target);
      await sendText(from, `🔇 @${targetName} muted for ${formatDuration(durationSeconds)}.`, [target]);
      return;
    }
    await sock.groupSettingUpdate(from, "announcement");
    void updateGroup(from, { muted: 1 });
    await sendText(from, "🔇 Group muted. Only admins can send messages.");
    return;
  }

  if (cmd === "unmute") {
    if (!canUse) return noPerms(from);
    if (!isBotAdmin) return botNoAdmin(from);
    const info = msg.message?.extendedTextMessage?.contextInfo;
    const rawTarget = resolvedMentions[0] || info?.participant || null;
    if (rawTarget) {
      const target = await resolveMentionedJidAsync(rawTarget, groupMeta, getUserByLid);
      void unmuteUser(target, from);
      await sendText(from, `🔊 ${mentionTag(target)} unmuted.`, [target]);
      return;
    }
    await sock.groupSettingUpdate(from, "not_announcement");
    void updateGroup(from, { muted: 0 });
    await sendText(from, "🔊 Group unmuted.");
    return;
  }

  if (cmd === "open") {
    if (!canUse) return noPerms(from);
    if (!isBotAdmin) return botNoAdmin(from);
    await sock.groupSettingUpdate(from, "not_announcement");
    await sendText(from, "🔓 Group opened.");
    return;
  }

  if (cmd === "close") {
    if (!canUse) return noPerms(from);
    if (!isBotAdmin) return botNoAdmin(from);
    await sock.groupSettingUpdate(from, "announcement");
    await sendText(from, "🔒 Group closed. Only admins can send messages.");
    return;
  }

  if (cmd === "hidetag") {
    if (!canUse) return noPerms(from);
    if (groupMetaFetchFailed) {
      await sendText(from, "⚠️ Couldn't load the member list just now (connection hiccup) — please try again in a moment.");
      return;
    }
    const participants = groupMeta?.participants || [];
    // Previously excluded every @lid participant from mentions entirely —
    // on groups where most members only appear as @lid, this silently
    // pinged nobody. Include everyone; mentions[] works with either JID form.
    const all = participants
      .map((p: any) => p.id as string || "")
      .filter((id: string) => !!id);
    const text = ctx.body.slice(ctx.prefix.length + cmd.length).trim() || "📢 Announcement";
    await sock.sendMessage(from, { delete: msg.key! }).catch(() => {});
    await sock.sendMessage(from, { text, mentions: all });
    return;
  }

  if (cmd === "tagall") {
    if (!canUse) return noPerms(from);
    if (groupMetaFetchFailed) {
      await sendText(from, "⚠️ Couldn't load the member list just now (connection hiccup) — please try again in a moment.");
      return;
    }
    const participants = groupMeta?.participants || [];
    const seenIds = new Set<string>();
    const rawIds: string[] = [];
    for (const p of participants) {
      const id = p.id as string;
      if (id && !seenIds.has(id)) { seenIds.add(id); rawIds.push(id); }
    }
    // Resolve each participant to a real phone JID before building display
    // text. Previously this either excluded @lid participants entirely
    // (empty tag list) or displayed the raw @lid number as the visible tag
    // (a meaningless long number, not anyone's real phone number). Using
    // resolveMentionedJidAsync gives us the actual phone number to show,
    // while the mentions[] array below still uses whatever JID form
    // WhatsApp needs to correctly notify that participant.
    const resolvedIds = await Promise.all(
      rawIds.map((id) => resolveMentionedJidAsync(id, groupMeta, getUserByLid))
    );
    const announcement = ctx.body.slice(ctx.prefix.length + cmd.length).trim() || "📢 Attention everyone!";
    let memberLines = "";
    for (let i = 0; i < rawIds.length; i++) {
      memberLines += `│  ➤ ${mentionTag(resolvedIds[i])}\n`;
    }
    const allMentions = seenIds.has(sender) ? [...rawIds] : [...rawIds, sender];
    const text =
      `╭─❰ 👥 ᴛᴀɢ ᴀʟʟ ɴᴏᴛɪɢʏ ❱─╮\n` +
      `│ 📢 Message: ${announcement}\n` +
      `│ 👤 From: ${mentionTag(sender)}\n` +
      `│\n` +
      `├─ 📌 ᴛᴀɢ ʟɪsᴛ\n` +
      `${memberLines}` +
      `╰────────────── ───╯`;
    await sock.sendMessage(from, { text, mentions: allMentions });
    return;
  }

  if (cmd === "activity") {
    const activity = await getGroupActivity(from);
    const isActive = activity.percentage >= 30;
    const statusLine = isActive
      ? `📌 𝗦𝘁𝗮𝘁𝘂𝘀: ✅ 𝗔𝗰𝘁𝗶𝘃𝗲`
      : `📌 𝗦𝘁𝗮𝘁𝘂𝘀: ❌ 𝗜𝗻𝗮𝗰𝘁𝗶𝘃𝗲`;
    const footer = isActive
      ? `> *✅ This group has enough activity for cards to be enabled 🎴*`
      : `> *⚠️ This group needs to reach 30% in order for a mod/guardian to enable cards 🎴*`;
    const text =
      `📊 𝗚𝗥𝗢𝗨𝗣 𝗔𝗖𝗧𝗜𝗩𝗜𝗧𝗬 𝗥𝗘𝗣𝗢𝗥𝗧\n\n` +
      `💬 𝗠𝗲𝘀𝘀𝗮𝗴𝗲𝘀 (20𝗺): ${activity.count}\n` +
      `📈 𝗣𝗲𝗿𝗰𝗲𝗻𝘁𝗮𝗴𝗲: ${activity.percentage}%\n` +
      `${statusLine}\n\n` +
      `${footer}`;
    await sendText(from, text);
    return;
  }

  if (cmd === "active" || cmd === "inactive") {
    if (!canUse) return noPerms(from);
    if (groupMetaFetchFailed) {
      await sendText(from, "⚠️ Couldn't load the member list just now (connection hiccup) — please try again in a moment.");
      return;
    }
    const activeRaw = await getActiveMembers(from);
    mark("active:getActiveMembers");
    // Some message_counts rows were written back when a user's lid hadn't
    // yet been linked to their phone (a "ghost" row keyed by raw lid digits
    // instead of their real number). Displaying m.user_id directly for
    // those rows printed a meaningless long lid number instead of a real,
    // taggable phone number. Resolve each one before dedup/display.
    const activeResolved = await Promise.all(
      activeRaw.map(async (m: any) => ({
        ...m,
        user_id: m.user_id?.endsWith("@lid")
          ? await resolveMentionedJidAsync(m.user_id, groupMeta, getUserByLid)
          : m.user_id,
      }))
    );
    mark("active:resolveActive");
    // Deduplicate by phone number — message_counts may have multiple rows
    // for the same user if they were ever recorded under different JIDs.
    const activeSeen = new Set<string>();
    const active = activeResolved.filter((m: any) => {
      const phone = (m.user_id || "").split("@")[0].split(":")[0].replace(/\D/g, "");
      if (!phone || activeSeen.has(phone)) return false;
      activeSeen.add(phone);
      return true;
    });

    // Build inactive list from group participants NOT in the active set.
    // This is more reliable than querying message_counts for inactive rows,
    // which can duplicate (same phone in multiple message_count rows) and
    // can include users who have since left the group.
    // PERF (2026-07-19): previously a sequential for-loop awaiting
    // resolveMentionedJidAsync() once per participant — a real N+1 DB
    // round-trip pattern for every @lid participant not already covered
    // by cached group metadata. In a 100+ member group this fully
    // explains a 60+ second .active command with otherwise-empty traced
    // stages (this loop had no mark() calls, and it's exactly where the
    // unaccounted time was going). Parallelized the same way
    // activeResolved already is a few lines above — no ordering
    // dependency between participants.
    const inactiveSeen = new Set<string>();
    const inactive: any[] = [];
    const participantsResolved = await Promise.all(
      ((groupMeta?.participants || []) as any[]).map(async (p) => {
        const resolvedId = (p.id as string)?.endsWith("@lid")
          ? await resolveMentionedJidAsync(p.id as string, groupMeta, getUserByLid)
          : (p.id as string);
        return resolvedId;
      })
    );
    mark("active:resolveParticipants");
    for (const resolvedId of participantsResolved) {
      const phone = resolvedId?.split("@")[0]?.split(":")?.[0]?.replace(/\D/g, "") || "";
      if (!phone || activeSeen.has(phone) || inactiveSeen.has(phone)) continue;
      inactiveSeen.add(phone);
      inactive.push({ user_id: resolvedId, count: 0 });
    }

    let text = `╔═ ❰ 👥 𝗠𝗘𝗠𝗕𝗘𝗥 𝗦𝗧𝗔𝗧𝗦 ❱ ═╗\n`;
    text += `║ 🟢 Active Members: ${active.length}\n`;
    text += `║ 🔴 Inactive Members (≤ 5 msgs in 7d): ${inactive.length}\n║\n`;

    if (cmd !== "inactive") {
      text += `╠═ 🟢 𝗔𝗖𝗧𝗜𝗩𝗘\n`;
      for (const m of active) {
        // mentionTag uses digit form — required for WhatsApp to render a
        // tappable @-mention. getMentionName returns display name which is
        // cosmetically nice but does NOT create a real clickable tag.
        text += `║ ○ ${mentionTag(m.user_id)} (${m.count || 0} msgs)\n`;
      }
      text += "║\n";
    }

    if (cmd !== "active") {
      text += `╠═ 🔴 𝗜𝗡𝗔𝗖𝗧𝗜𝗩𝗘\n`;
      for (const m of inactive) {
        text += `║ ○ ${mentionTag(m.user_id)}\n`;
      }
    }

    text += "╚══════════════════╝";

    // normalizeId ensures bare phone numbers become full JIDs
    // (e.g. "1234567890" → "1234567890@s.whatsapp.net") so WhatsApp
    // renders tappable @-mentions instead of plain @number text.
    const mentionJids = [
      ...active.map((m: any) => normalizeId(m.user_id)),
      ...inactive.map((m: any) => normalizeId(m.user_id)),
    ];
    await sock.sendMessage(from, { text, mentions: mentionJids });
    return;
  }

  if (cmd === "gamble") {
    const staffRole = await getStaff(sender);
    const canToggleGamble = isOwner || staffRole?.role === "mod" || staffRole?.role === "guardian";
    if (!canToggleGamble) return noPerms(from);
    const val = args[0]?.toLowerCase();
    if (val === "on") {
      void updateGroup(from, { gambling_enabled: "on" });
      await sendText(from, "🎰 Gambling commands are now *enabled*.");
    } else if (val === "off") {
      void updateGroup(from, { gambling_enabled: "off" });
      await sendText(from, "🎰 Gambling commands are now *disabled*.");
    } else {
      const g = await getGroup(from);
      await sendText(from, `🎰 Gambling is currently: *${g?.gambling_enabled || "on"}*\nUsage: .gamble on/off`);
    }
    return;
  }

  if (cmd === "cards") {
    if (args[0]?.toLowerCase() === "available") {
      const stats = await getCardStats();
      const tierLines = stats.byTier.length > 0
        ? stats.byTier.map((row: any) => `• ${row.tier}: ${row.count}`).join("\n")
        : "• None";
      const seriesLines = stats.bySeries.length > 0
        ? stats.bySeries.map((row: any) => `• ${row.series || "General"}: ${row.count}`).join("\n")
        : "• None";
      await sendText(
        from,
        `🎴 *Cards Available*\n\n` +
        `Total cards in database: *${stats.total}*\n\n` +
        `*By Tier:*\n${tierLines}\n\n` +
        `*Top Series:*\n${seriesLines}`
      );
      return;
    }
    if (!canUse) return noPerms(from);
    const val = args[0]?.toLowerCase();
    if (val === "on") {
      const activity = await getGroupActivity(from);
      if (activity.percentage < 30) {
        await sendText(from,
          `❌ Cannot enable cards yet!\n\n` +
          `📈 Current activity: *${activity.percentage}%* (need 30%)\n` +
          `💬 Messages in 20min: ${activity.count}/600\n\n` +
          `> Use *.activity* to check group activity status.`
        );
        return;
      }
      void updateGroup(from, { cards_enabled: "on", spawn_enabled: "on" });
      await sendText(from, "🎴 Card spawning is now *enabled*!");
    } else if (val === "off") {
      void updateGroup(from, { cards_enabled: "off", spawn_enabled: "off" });
      await sendText(from, "🎴 Card spawning is now *disabled*.");
    } else {
      const g = await getGroup(from);
      await sendText(from, `🎴 Cards are currently: *${g?.cards_enabled || "on"}*\nUsage: .cards on/off`);
    }
    return;
  }

  if (cmd === "antibot") {
    if (!canUse) return noPerms(from);
    const val = args[0]?.toLowerCase();
    if (val === "on") {
      void updateGroup(from, { anti_bot: "on" });
      await sendText(from, "🤖 Anti-Bot enabled. Bot accounts joining will be automatically kicked.");
    } else if (val === "off") {
      void updateGroup(from, { anti_bot: "off" });
      await sendText(from, "🤖 Anti-Bot disabled.");
    } else {
      const g = await getGroup(from);
      await sendText(from, `🤖 Anti-Bot is currently: *${g?.anti_bot || "off"}*\nUsage: .antibot on/off`);
    }
    return;
  }

  if (cmd === "purge") {
    if (!canUse) return noPerms(from);
    if (!isBotAdmin) return botNoAdmin(from);
    const countryCode = args[0]?.replace(/\+/g, "").replace(/\D/g, "");
    if (!countryCode || countryCode.length < 1 || countryCode.length > 4) {
      await sendText(from,
        "❌ Usage: .purge <country_code>\n" +
        "Example: .purge 234 — removes all +234 (Nigeria) members\n" +
        "         .purge 1   — removes all +1 (US/CA) members\n\n" +
        "_Non-admin members with that country code will be removed._"
      );
      return;
    }
    let meta = groupMeta;
    if (!meta) {
      try { meta = await sock.groupMetadata(from); } catch { meta = null; }
    }
    const participants: any[] = meta?.participants || [];
    if (participants.length === 0) {
      await sendText(from, "❌ Could not load group members. Make sure the bot is an admin.");
      return;
    }
    const toRemove = participants
      .filter((p: any) => {
        const phone = (p.id || "").split("@")[0].split(":")[0];
        return phone.startsWith(countryCode) && !p.admin;
      })
      .map((p: any) => p.id);
    if (toRemove.length === 0) {
      await sendText(from, `✅ No non-admin members with country code +${countryCode} found.`);
      return;
    }
    await sendText(from, `⚠️ Removing *${toRemove.length}* member(s) with +${countryCode}…`);
    for (let i = 0; i < toRemove.length; i += 5) {
      const batch = toRemove.slice(i, i + 5);
      await sock.groupParticipantsUpdate(from, batch, "remove").catch(() => {});
      if (i + 5 < toRemove.length) await new Promise((r) => setTimeout(r, 1500));
    }
    await sendText(from, `✅ Purge complete. Removed *${toRemove.length}* member(s) with +${countryCode}.`);
    return;
  }

  if (cmd === "blacklist") {
    if (!canUse) return noPerms(from);
    const sub = args[0]?.toLowerCase();
    const g = await getGroup(from);
    let bl: string[] = [];
    try { bl = JSON.parse(g?.blacklist || "[]"); } catch { bl = []; }

    if (sub === "add") {
      const entry = args.slice(1).join(" ").replace(/\+/g, "").trim();
      if (!entry) {
        await sendText(from, "❌ Usage: .blacklist add [number or word]\nExample: .blacklist add 2348012345678\nExample: .blacklist add badword");
        return;
      }
      if (bl.includes(entry)) {
        await sendText(from, `ℹ️ *${entry}* is already on the blacklist.`);
        return;
      }
      bl.push(entry);
      void updateGroup(from, { blacklist: JSON.stringify(bl) });
      const isPhone = /^\d+$/.test(entry);
      await sendText(from, `✅ Added ${isPhone ? "number" : "word"} *${entry}* to the blacklist.${isPhone ? "\n🚫 They will be removed if already in the group or when they try to join." : ""}`);
      if (isPhone) {
        let meta2 = groupMeta;
        if (!meta2) { try { meta2 = await sock.groupMetadata(from); } catch { meta2 = null; } }
        const existing = (meta2?.participants || []).find((p: any) => {
          const phone = (p.id || "").split("@")[0].split(":")[0];
          return phone.endsWith(entry);
        });
        if (existing && !existing.admin) {
          await sock.groupParticipantsUpdate(from, [existing.id], "remove").catch(() => {});
          await sendText(from, `🚫 *${entry}* was in the group and has been removed.`);
        }
      }
      return;
    } else if (sub === "remove") {
      const entry = args.slice(1).join(" ").replace(/\+/g, "").trim();
      if (!entry) { await sendText(from, "❌ Provide a number or word to remove."); return; }
      bl = bl.filter((w) => w !== entry);
      void updateGroup(from, { blacklist: JSON.stringify(bl) });
      await sendText(from, `✅ Removed *${entry}* from blacklist.`);
    } else if (sub === "list") {
      if (bl.length === 0) {
        await sendText(from, "🔒 Blacklist is empty.");
      } else {
        const phones = bl.filter((e) => /^\d+$/.test(e));
        const words  = bl.filter((e) => !/^\d+$/.test(e));
        let out = "🔒 *Blacklist*\n";
        if (phones.length) out += `\n📵 *Numbers (${phones.length}):*\n${phones.map((p) => `• +${p}`).join("\n")}`;
        if (words.length)  out += `\n🚫 *Words (${words.length}):*\n${words.map((w) => `• ${w}`).join("\n")}`;
        await sendText(from, out);
      }
    } else {
      await sendText(from, "Usage: .blacklist add [number/word] | .blacklist remove [number/word] | .blacklist list");
    }
    return;
  }

  if (cmd === "gi") {
    const meta = groupMeta;
    const admins = meta?.participants?.filter((p: any) => p.admin) || [];
    const adminCount = admins.length;
    const memberCount = meta?.participants?.length || 0;
    const groupName = meta?.subject || "Unknown";
    const groupDesc = meta?.desc || meta?.description || "No description";
    const creation = meta?.creation
      ? new Date(Number(meta.creation) * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
      : "Unknown";
    // Only include real phone JIDs — @lid JIDs can't be mentioned by digit form
    const realAdmins = admins.filter((p: any) => !(p.id as string)?.endsWith("@lid"));
    let adminLines = "";
    const adminMentions: string[] = [];
    for (const p of realAdmins.slice(0, 5)) {
      // mentionTag (digit form) creates a tappable @-mention; display name would not.
      adminLines += `║   • ${mentionTag(p.id)}\n`;
      adminMentions.push(p.id);
    }
    if (admins.length > 5) adminLines += `║   ...and ${admins.length - 5} more\n`;
    const text =
      `╔═ ❰ ℹ️ 𝗚𝗥𝗢𝗨𝗣 𝗜𝗡𝗙𝗢 ❱ ═╗\n` +
      `║ 📛 𝗡𝗮𝗺𝗲: ${groupName}\n` +
      `║ 👥 𝗠𝗲𝗺𝗯𝗲𝗿𝘀: ${memberCount}\n` +
      `║ 🛡️ 𝗔𝗱𝗺𝗶𝗻𝘀: ${adminCount}\n` +
      `║ 📅 𝗖𝗿𝗲𝗮𝘁𝗲𝗱: ${creation}\n║\n` +
      `║ 📝 𝗗𝗲𝘀𝗰𝗿𝗶𝗽𝘁𝗶𝗼𝗻:\n║   ${groupDesc.slice(0, 200)}\n║\n` +
      `║ 🛡️ 𝗔𝗱𝗺𝗶𝗻𝘀:\n${adminLines || "║   None\n"}` +
      `╚══════════════════╝`;
    await sock.sendMessage(from, { text, mentions: adminMentions });
    return;
  }

  if (cmd === "groupinfo") {
    const g = await getGroup(from);
    const meta = groupMeta;
    const admins = meta?.participants?.filter((p: any) => p.admin)?.length || 0;
    let bl: string[] = [];
    try { bl = JSON.parse(g?.blacklist || "[]"); } catch {}

    const text = `╔═ ❰ 📊 𝗚𝗥𝗢𝗨𝗣 𝗖𝗢𝗡𝗙𝗜𝗚 ❱ ═╗\n` +
      `║ 👥 𝗣𝗮𝗿𝘁𝗶𝗰𝗶𝗽𝗮𝗻𝘁𝘀: ${meta?.participants?.length || "?"}\n` +
      `║ 🛡️ 𝗔𝗱𝗺𝗶𝗻𝘀: ${admins}\n║\n` +
      `║ 🔗 𝗔𝗻𝘁𝗶-𝗟𝗶𝗻𝗸: ${g?.antilink || "off"} (${g?.antilink_action || "delete"})\n` +
      `║ 🚫 𝗔𝗻𝘁𝗶-𝗦𝗽𝗮𝗺: ${g?.antispam || "off"}\n` +
      `║ 🤖 𝗔𝗻𝘁𝗶-𝗕𝗼𝘁: ${g?.anti_bot || "off"}\n║\n` +
      `║ ✉️ 𝗪𝗲𝗹𝗰𝗼𝗺𝗲: ${g?.welcome || "off"}\n` +
      `║ 📨 𝗠𝘀𝗴: ${g?.welcome_msg || "(default)"}\n║\n` +
      `║ 🚪 𝗟𝗲𝗮𝘃𝗲: ${g?.leave || "off"}\n` +
      `║ 📨 𝗠𝘀𝗴: ${g?.leave_msg || "(default)"}\n║\n` +
      `║ 🎴 𝗖𝗮𝗿𝗱𝘀: ${g?.cards_enabled || "on"}\n` +
      `║ 🎮 𝗚𝗮𝗺𝗲𝘀: ${g?.games_enabled || "on"}\n` +
      `║ 🎰 𝗚𝗮𝗺𝗯𝗹𝗶𝗻𝗴: ${g?.gambling_enabled || "on"}\n║\n` +
      `║ 🔒 𝗕𝗹𝗮𝗰𝗸𝗹𝗶𝘀𝘁: ${bl.length} words\n` +
      `╚══════════════════╝`;

    await sendText(from, text);
    return;
  }

  if (cmd === "gcl" || cmd === "gclink") {
    if (!isBotAdmin) return botNoAdmin(from);
    try {
      const inviteCode = await sock.groupInviteCode(from);
      const link = `https://chat.whatsapp.com/${inviteCode}`;
      void updateGroup(from, { last_gcl: Math.floor(Date.now() / 1000) });
      await sendTextWithPreview(from, `🔗 *Group Invite Link*\n\n${link}`);
    } catch {
      await sendText(from, "❌ Failed to get group invite link. Make sure the bot is an admin.");
    }
    return;
  }

  if (cmd === "groupstats" || cmd === "gs") {
    const [active, inactive_raw, g] = await Promise.all([
      getActiveMembers(from),
      getInactiveMembers(from),
      getGroup(from),
    ]);
    const meta = groupMeta;
    let bl: string[] = [];
    try { bl = JSON.parse(g?.blacklist || "[]"); } catch {}
    const admins = meta?.participants?.filter((p: any) => p.admin)?.length || 0;

    const text = `╔═ ❰ 📊 𝗚𝗥𝗢𝗨𝗣 𝗦𝗧𝗔𝗧𝗦 📊 ❱ ═╗\n` +
      `║ 👥 𝗣𝗮𝗿𝘁𝗶𝗰𝗶𝗽𝗮𝗻𝘁𝘀: ${meta?.participants?.length || "?"}\n` +
      `║ 🛡️ 𝗔𝗱𝗺𝗶𝗻𝘀: ${admins}\n║\n` +
      `║ 🟢 Active members: ${active.length}\n` +
      `║ 🔴 Inactive members: ${inactive_raw.length}\n║\n` +
      `║ 🔗 𝗔𝗻𝘁𝗶-𝗟𝗶𝗻𝗸: ${g?.antilink || "off"} (${g?.antilink_action || "delete"})\n` +
      `║ 🚫 𝗔𝗻𝘁𝗶-𝗦𝗽𝗮𝗺: ${g?.antispam || "off"}\n` +
      `║ 🤖 𝗔𝗻𝘁𝗶-𝗕𝗼𝘁: ${g?.anti_bot || "off"}\n║\n` +
      `║ ✉️ 𝗪𝗲𝗹𝗰𝗼𝗺𝗲: ${g?.welcome || "off"}\n` +
      `║ 🚪 𝗟𝗲𝗮𝘃𝗲: ${g?.leave || "off"}\n║\n` +
      `║ 🎴 𝗖𝗮𝗿𝗱𝘀: ${g?.cards_enabled || "on"}\n` +
      `║ 🎴 𝗦𝗽𝗮𝘄𝗻: ${g?.spawn_enabled || "on"}\n` +
      `║ 🎰 𝗚𝗮𝗺𝗯𝗹𝗶𝗻𝗴: ${g?.gambling_enabled || "on"}\n║\n` +
      `║ 🔒 𝗕𝗹𝗮𝗰𝗸𝗹𝗶𝘀𝘁: ${bl.length} words\n` +
      `╚══════════════════╝`;

    await sendText(from, text);
    return;
  }

  if (cmd === "addmod") {
    if (!isAdmin && !isOwner) return noPerms(from);
    const rawMentioned = resolvedMentions[0];
    if (!rawMentioned) { await sendText(from, "❌ Mention someone."); return; }
    const mentioned = await resolveMentionedJidAsync(rawMentioned, groupMeta, getUserByLid);
    await addMod(mentioned, from, sender);
    const mentionedName = await getMentionName(mentioned);
    await sendText(from, `✅ @${mentionedName} is now a mod in this group.`, [mentioned]);
    return;
  }
}

async function noPerms(jid: string) {
  await sendText(jid, "❌ You don't have permission to use this command.");
}

async function botNoAdmin(jid: string) {
  await sendText(jid, "❌ Bot needs admin privileges to perform this action.");
}

function parseDuration(input?: string): number | null {
  if (!input) return null;
  const match = input.trim().match(/^(\d+)(s|m|h|d|y)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, y: 31536000 };
  return value > 0 ? value * multipliers[unit] : null;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 31536000) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / 31536000)}y`;
}
