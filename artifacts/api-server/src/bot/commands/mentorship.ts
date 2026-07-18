/**
 * mentorship.ts — Mentor/Apprentice system
 *
 * A senior player (mentor) guides a junior (apprentice). Both earn bonus
 * rewards when the apprentice completes content — quests, dungeons, and
 * level-ups trigger passive SP/XP grants to the mentor, and the apprentice
 * gets a bonus on their own rewards while mentored.
 *
 * Rules:
 *   • Mentor must be at least 5 levels above the apprentice
 *   • Mentor must be Level 8+ and have chosen a class
 *   • One mentor per user; mentor can have up to 3 apprentices
 *   • Offer expires after 5 minutes
 *
 * Commands:
 *   .mentor          → show your mentorship status
 *   .mentor @user    → offer to mentor someone
 *   .mentor accept   → accept a pending offer
 *   .mentor leave    → leave the current mentorship
 *   .mentors         → list active mentorships in this group
 *
 * Bonus triggers (called externally via applyMentorshipBonus):
 *   "quest"    → mentor +1 SP, +50 XP; apprentice +15% XP on that quest
 *   "dungeon"  → mentor +1 SP, +80 XP
 *   "levelup"  → mentor gets 10% of apprentice's leveling XP
 */
import type { CommandContext } from "./index.js";
import { sendText } from "../connection.js";
import {
  ensureRpg, updateRpg, getRpg, getUser, updateUser,
  getMentorship, getMentorApprentices, getPendingMentorOffer,
  createMentorOffer, clearMentorOffer, createMentorship,
  leaveMentorship, incrementMentorStat, getGroupMentorships,
  incrementWeeklyProgress, getMentionName,
} from "../db/queries.js";
import { formatNumber, mentionTag } from "../utils.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_MENTOR_LEVEL      = 8;  // mentor must be at least this level
const MIN_LEVEL_DIFFERENCE  = 5;  // mentor must be this many levels above apprentice
const MAX_APPRENTICES       = 3;

// ── Bonus trigger (called from rpg.ts after events) ──────────────────────────

/**
 * Called after the apprentice completes a quest or dungeon floor, or levels up.
 * Grants the mentor bonus SP/XP and tracks mentorship stats + weekly progress.
 *
 * Returns the XP bonus the apprentice should receive on top of their own reward
 * (only applies to "quest" events — 15% bonus XP for being mentored).
 */
export async function applyMentorshipBonus(
  apprenticeId: string,
  event: "quest" | "dungeon" | "levelup",
  apprenticeXpGained = 0,
  from?: string,
  sock?: any,
): Promise<number> {
  const rel = await getMentorship(apprenticeId);
  if (!rel || rel.apprentice_id !== (apprenticeId.split("@")[0].split(":")[0].replace(/\D/g, "") || apprenticeId)) {
    return 0; // not an apprentice, or user is the mentor side
  }

  const mentorId = rel.mentor_id;
  const mentorRpg = await getRpg(mentorId);
  if (!mentorRpg) return 0;

  let mentorSp = 0;
  let mentorXp = 0;
  let apprenticeBonus = 0;

  if (event === "quest") {
    mentorSp = 1;
    mentorXp = 50;
    apprenticeBonus = Math.floor(apprenticeXpGained * 0.15); // +15% XP for apprentice
    await incrementMentorStat(mentorId, apprenticeId, "quests_guided");
    await incrementWeeklyProgress(mentorId, "mentor_sessions");
  } else if (event === "dungeon") {
    mentorSp = 1;
    mentorXp = 80;
    await incrementMentorStat(mentorId, apprenticeId, "quests_guided");
    await incrementWeeklyProgress(mentorId, "mentor_sessions");
  } else if (event === "levelup") {
    mentorSp = 0;
    mentorXp = Math.floor(apprenticeXpGained * 0.10);
  }

  if (mentorSp > 0 || mentorXp > 0) {
    await updateRpg(mentorId, {
      xp: (mentorRpg.xp || 0) + mentorXp,
      skill_points: (mentorRpg.skill_points || 0) + mentorSp,
    });
    await incrementMentorStat(mentorId, apprenticeId, "xp_shared", mentorXp);
    if (mentorSp) await incrementMentorStat(mentorId, apprenticeId, "sp_shared", mentorSp);
  }

  return apprenticeBonus;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handleMentorship(ctx: CommandContext): Promise<void> {
  const { from, sender, args, sock } = ctx;
  const user = await getUser(sender);
  const userId = user?.id || sender.split("@")[0].split(":")[0].replace(/\D/g, "");
  const rpg = await ensureRpg(userId);
  const sub = (args[0] || "").toLowerCase();

  // ── .mentors — list group mentorships ─────────────────────────────────────
  if (ctx.command === "mentors") {
    if (!from.endsWith("@g.us")) { await sendText(from, "❌ Use in a group."); return; }
    const rels = await getGroupMentorships(from);
    if (rels.length === 0) { await sendText(from, "🎓 No active mentorships in this group yet.\n\n_Use *.mentor @user* to offer guidance._"); return; }
    const lines = await Promise.all(rels.map(async (r) => {
      const mName = await getMentionName(r.mentor_id);
      const aName = await getMentionName(r.apprentice_id);
      return `🎓 *${mName}* → *${aName}* (${r.quests_guided || 0} sessions, +${r.xp_shared || 0} XP shared)`;
    }));
    await sendText(from, `🎓 *Active Mentorships — This Group*\n\n${lines.join("\n")}`);
    return;
  }

  // ── .mentor accept ────────────────────────────────────────────────────────
  if (sub === "accept") {
    const offer = await getPendingMentorOffer(userId);
    if (!offer) { await sendText(from, "❌ No pending mentor offer for you (or it expired after 5 minutes)."); return; }

    // Already mentored?
    const existing = await getMentorship(userId);
    if (existing) { await sendText(from, "❌ You're already in a mentorship. Use *.mentor leave* first."); return; }

    await clearMentorOffer(userId);
    await createMentorship(offer.mentor_id, userId, from);

    const mentorName = await getMentionName(offer.mentor_id);
    const apprenticeName = user?.name || userId;
    await sendText(from,
      `🎓 *Mentorship Established!*\n\n` +
      `✅ *${apprenticeName}* is now apprenticed to *${mentorName}*!\n\n` +
      `📌 *Perks:*\n` +
      `• Apprentice: +15% XP on every quest\n` +
      `• Mentor: +1 SP + XP when you complete quests/dungeons\n` +
      `• Both earn weekly quest progress via mentorship sessions\n\n` +
      `_Use *.mentor* to check your status._`
    );
    return;
  }

  // ── .mentor leave ─────────────────────────────────────────────────────────
  if (sub === "leave") {
    const rel = await leaveMentorship(userId);
    if (!rel) { await sendText(from, "❌ You're not in any mentorship relationship."); return; }
    const other = rel.mentor_id === userId ? rel.apprentice_id : rel.mentor_id;
    const role = rel.mentor_id === userId ? "mentor" : "apprentice";
    const otherName = await getMentionName(other);
    await sendText(from,
      `🎓 You've left the mentorship with *${otherName}*.\n` +
      `_Sessions guided: ${rel.quests_guided || 0} · XP shared: ${rel.xp_shared || 0}_`
    );
    return;
  }

  // ── .mentor @user — offer mentorship ─────────────────────────────────────
  const { resolveMentionedJidAsync } = await import("../utils/identity.js");
  const mentionJid = await resolveMentionedJidAsync(ctx);

  if (mentionJid) {
    if (!from.endsWith("@g.us")) { await sendText(from, "❌ Mentor offers must be sent in a group."); return; }

    const targetPhone = mentionJid.split("@")[0].split(":")[0].replace(/\D/g, "");
    if (targetPhone === userId) { await sendText(from, "❌ You can't mentor yourself."); return; }

    // Mentor eligibility
    if (!rpg.class) { await sendText(from, "❌ You need to choose a class (*.class*) before mentoring others."); return; }
    if ((rpg.level || 1) < MIN_MENTOR_LEVEL) {
      await sendText(from, `❌ You need to be at least *Level ${MIN_MENTOR_LEVEL}* to become a mentor. (You are Level ${rpg.level || 1})`);
      return;
    }

    const targetRpg = await ensureRpg(targetPhone);
    const levelDiff = (rpg.level || 1) - (targetRpg.level || 1);
    if (levelDiff < MIN_LEVEL_DIFFERENCE) {
      await sendText(from, `❌ You must be at least *${MIN_LEVEL_DIFFERENCE} levels above* your apprentice.\nYou: Level ${rpg.level || 1} · Target: Level ${targetRpg.level || 1} → gap: ${levelDiff}`);
      return;
    }

    // Cap apprentices
    const existing = await getMentorApprentices(userId);
    if (existing.length >= MAX_APPRENTICES) {
      await sendText(from, `❌ You already have ${MAX_APPRENTICES} apprentices — the maximum. Use *.mentor leave* with one to make room.`);
      return;
    }

    // Check if target already has a mentor
    const targetRel = await getMentorship(targetPhone);
    if (targetRel) {
      const theirMentorName = await getMentionName(targetRel.mentor_id);
      await sendText(from, `❌ ${mentionTag(mentionJid)} already has a mentor (*${theirMentorName}*).`, { mentions: [mentionJid] });
      return;
    }

    await createMentorOffer(userId, targetPhone, from);
    const myName = user?.name || userId;
    const targetName = await getMentionName(targetPhone);

    await sendText(from,
      `🎓 *Mentorship Offer*\n\n` +
      `*${myName}* (Lv. ${rpg.level || 1}) offers to mentor ${mentionTag(mentionJid)} (Lv. ${targetRpg.level || 1})!\n\n` +
      `${mentionTag(mentionJid)} — type *.mentor accept* to accept, or ignore to let it expire.\n` +
      `_Offer expires in 5 minutes._`,
      { mentions: [mentionJid] }
    );
    return;
  }

  // ── .mentor — show status ─────────────────────────────────────────────────
  const rel = await getMentorship(userId);
  const myName = user?.name || userId;

  if (!rel) {
    const apprentices = await getMentorApprentices(userId);
    if (apprentices.length === 0) {
      await sendText(from,
        `🎓 *Mentorship — ${myName}*\n\n` +
        `You are not in any mentorship.\n\n` +
        `*To become a mentor:* *.mentor @user* (must be Lv. ${MIN_MENTOR_LEVEL}+, 5+ levels above target)\n` +
        `*To find a mentor:* Ask someone senior to offer with *.mentor @you*`
      );
    } else {
      const lines = await Promise.all(apprentices.map(async (r) => {
        const aName = await getMentionName(r.apprentice_id);
        return `• *${aName}* — ${r.quests_guided || 0} sessions, +${r.xp_shared || 0} XP, +${r.sp_shared || 0} SP earned`;
      }));
      await sendText(from,
        `🎓 *Your Apprentices (${apprentices.length}/${MAX_APPRENTICES})*\n\n${lines.join("\n")}\n\n` +
        `_You earn +1 SP + XP whenever your apprentices complete quests/dungeons._`
      );
    }
    return;
  }

  const isMentor = rel.mentor_id === userId;
  if (isMentor) {
    const aName = await getMentionName(rel.apprentice_id);
    await sendText(from,
      `🎓 *Mentoring: ${aName}*\n\n` +
      `📊 Sessions: ${rel.quests_guided || 0}\n` +
      `✨ XP shared: ${rel.xp_shared || 0}\n` +
      `⚡ SP earned: ${rel.sp_shared || 0}\n\n` +
      `_Use *.mentor leave* to end the relationship._`
    );
  } else {
    const mName = await getMentionName(rel.mentor_id);
    await sendText(from,
      `🎓 *Your Mentor: ${mName}*\n\n` +
      `📊 Sessions completed: ${rel.quests_guided || 0}\n` +
      `🎁 Your bonus: +15% XP on every quest\n\n` +
      `_Use *.mentor leave* to leave this mentorship._`
    );
  }
}
