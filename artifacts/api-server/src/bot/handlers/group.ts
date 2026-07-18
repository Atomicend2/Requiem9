import type { WASocket } from "@whiskeysockets/baileys";
import { ensureGroup, getGroup, isBanned, updateGroup } from "../db/queries.js";
// sendText is intentionally not imported here — all sends use the explicit
// `sock` parameter to ensure managed-bot group events route through the
// correct socket, not the global primary-bot socket returned by getActiveSock().
// Previously every sendText() fallback here used the primary socket, meaning
// welcome/leave messages silently failed for any group owned by a managed bot.
import { mentionTag } from "../utils.js";
import { checkBlacklistedJoin } from "./antispam.js";
import { logger } from "../../lib/logger.js";
import { generateWelcomeCard } from "./welcomecard.js";

export async function handleGroupUpdate(sock: WASocket, updates: any[]) {
  for (const update of updates) {
    if (!update.id) continue;
    const group = await sock.groupMetadata(update.id).catch(() => null);
    if (!group) continue;
    await ensureGroup(update.id, group.subject);
    if (await isBanned("group", update.id)) {
      await sock.groupLeave(update.id).catch(() => {});
    }
  }
}

export async function handleGroupParticipantsUpdate(
  sock: WASocket,
  update: { id: string; participants: (string | { id?: string; phoneNumber?: string; lid?: string; admin?: string | null })[]; action: string }
) {
  const { id: groupId, action } = update;

  // Baileys' group-participants.update payload has been observed delivering
  // `participants` as an array of OBJECTS ({ id, phoneNumber, admin }), not
  // plain string JIDs. Every downstream line in this function assumed
  // strings (rawParticipant.endsWith(...) etc), so any event with this
  // object shape threw "rawParticipant.endsWith is not a function" and
  // crashed the whole handler before welcome/leave logic ever ran — this
  // was confirmed in production: settings were correctly "on" and the event
  // correctly fired, but the handler died immediately after logging,
  // silently, for every group. Normalize to plain JID strings once, here,
  // so nothing below needs to change.
  const participants: string[] = update.participants
    .map((p) => (typeof p === "string" ? p : (p?.id || p?.phoneNumber || p?.lid || null)))
    .filter((p): p is string => typeof p === "string" && p.length > 0);

  logger.info({ groupId, participants, action }, "[group-event] group-participants.update received");

  if (!["add", "remove", "leave"].includes(action)) return;
  if (participants.length === 0) return;

  let group = await getGroup(groupId);
  if (!group) {
    let subject: string | undefined;
    try { subject = (await sock.groupMetadata(groupId))?.subject; } catch {}
    group = await ensureGroup(groupId, subject);
  }

  if (await isBanned("group", groupId)) {
    await sock.groupLeave(groupId).catch(() => {});
    return;
  }

  // Use the already-fetched group record — avoids a redundant second DB read.
  const freshGroup = group;
  logger.info({ groupId, welcome: freshGroup?.welcome, leave: freshGroup?.leave }, "Group settings");

  let groupMeta: any = null;
  try { groupMeta = await sock.groupMetadata(groupId); } catch {}

  // Resolve the best display name we can for a participant, without ever
  // falling back to their raw LID digits — a LID is an internal WhatsApp
  // identifier, not a phone number, and showing it on the welcome/goodbye
  // card just reads as a garbled/wrong number to the group. Preference
  // order: WhatsApp push name (matched against BOTH the original @lid the
  // event arrived with and whatever JID we managed to resolve it to,
  // since Baileys' groupMetadata often keys participants by @lid even
  // after we've resolved a phone JID elsewhere) → a real phone number, if
  // the JID we ended up with is a genuine @s.whatsapp.net JID → a generic
  // "New Member"/"A Member" label as the last resort.
  function resolveDisplayName(rawJid: string, resolvedJid: string): string {
    const meta = (groupMeta?.participants ?? []) as any[];
    const pushName = meta.find((p) => p.id === rawJid || p.lid === rawJid || p.id === resolvedJid || p.lid === resolvedJid)?.name;
    if (pushName && String(pushName).trim()) return String(pushName).trim();
    if (resolvedJid.endsWith("@s.whatsapp.net")) {
      return resolvedJid.split("@")[0].split(":")[0];
    }
    // Still only a LID at this point (no push name, no resolvable phone
    // number) — use a neutral label instead of the raw LID digits.
    return "New Member";
  }

  for (const rawParticipant of participants) {
    let participant = rawParticipant;
    if (rawParticipant.endsWith("@lid") && groupMeta) {
      for (const p of (groupMeta.participants ?? []) as any[]) {
        if (p.id === rawParticipant || p.lid === rawParticipant) {
          const real = ([p.id, p.lid] as string[]).find((j: string) => j?.endsWith("@s.whatsapp.net"));
          if (real) { participant = real; break; }
        }
      }
    }
    // If group metadata couldn't resolve the LID, try the DB — users are
    // stored with their LID when they first message the bot, so we can
    // reverse-look it up to get their real phone JID.
    if (participant.endsWith("@lid")) {
      try {
        const { getUserByLid } = await import("../db/queries.js");
        const lidNum = participant.split("@")[0];
        const dbUser = await getUserByLid(lidNum);
        if (dbUser?.id) participant = `${dbUser.id}@s.whatsapp.net`;
      } catch {}
    }

    if (action === "add") {
      const blocked = await checkBlacklistedJoin(sock, groupId, participant).catch(() => false);
      if (blocked) continue;

      const isLikelyBot = rawParticipant.includes(".bot@");
      if (isLikelyBot && (freshGroup?.anti_bot || "off") === "on") {
        try {
          await sock.groupParticipantsUpdate(groupId, [rawParticipant], "remove");
          await sock.sendMessage(groupId, { text: `🤖 Suspected bot account was automatically removed.` });
        } catch {}
        void updateGroup(groupId, { cards_enabled: "off", spawn_enabled: "off" });
        continue;
      }

      if (freshGroup?.welcome === "on") {
        const template = freshGroup.welcome_msg || "Welcome to the group, @user! 👋";
        const memberCount = (groupMeta?.participants?.length as number | undefined) ?? undefined;
        const displayName = resolveDisplayName(rawParticipant, participant);
        const msg = replaceWelcomeMention(template, participant);

        logger.info({ groupId, participant, displayName }, "Sending welcome message");
        try {
          const card = await generateWelcomeCard({
            sock,
            type: "welcome",
            participantJid: participant,
            participantName: displayName,
            groupName: groupMeta?.subject || "the group",
            memberCount,
          }).catch(() => null);

          if (card) {
            await sock.sendMessage(groupId, { image: card, caption: msg, mentions: [participant] });
          } else {
            await sock.sendMessage(groupId, { text: msg, mentions: [participant] });
          }
        } catch (err) {
          logger.error({ err, groupId, participant }, "Welcome send failed — retrying plain text");
          try { await sock.sendMessage(groupId, { text: msg, mentions: [participant] }); } catch {}
        }
      }

    } else if (action === "remove" || action === "leave") {
      if (freshGroup?.leave === "on") {
        const displayName = resolveDisplayName(rawParticipant, participant);
        // groupMeta is fetched AFTER the participant left, so .length is already
        // decremented by WhatsApp. No manual -1 needed.
        const memberCount = Math.max(0, groupMeta?.participants?.length ?? 0);
        const template = freshGroup.leave_msg || "Goodbye, @user! 👋";
        const msg = replaceWelcomeMention(template, participant);

        logger.info({ groupId, participant, displayName }, "Sending goodbye message");
        try {
          const card = await generateWelcomeCard({
            sock,
            type: "goodbye",
            participantJid: participant,
            participantName: displayName,
            groupName: groupMeta?.subject || "the group",
            memberCount,
          }).catch(() => null);

          if (card) {
            await sock.sendMessage(groupId, { image: card, caption: msg, mentions: [participant] });
          } else {
            await sock.sendMessage(groupId, { text: msg, mentions: [participant] });
          }
        } catch (err) {
          logger.error({ err, groupId, participant }, "Goodbye send failed — retrying plain text");
          try { await sock.sendMessage(groupId, { text: msg, mentions: [participant] }); } catch {}
        }
      }
    }
  }
}

function replaceWelcomeMention(template: string, participant: string): string {
  return template
    .replace(/@user/gi, mentionTag(participant))
    .replace(/@mention/gi, mentionTag(participant));
}
