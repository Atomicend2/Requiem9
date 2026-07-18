import type { CommandContext } from "./index.js";
import { sendText } from "../connection.js";
import {
  getGuild, getUserGuild, createGuild, joinGuild, leaveGuild, getAllGuilds,
  getGuildMembers, kickFromGuild, disbandGuild, ensureUser, getUser, getMentionName,
  removeFromInventory,
} from "../db/queries.js";
import { col } from "../db/mongo.js";
import { generateId, mentionTag } from "../utils.js";

export async function handleGuilds(ctx: CommandContext): Promise<void> {
  const { from, sender, args, command, sock, resolvedMentions } = ctx;
  const sub = args[0]?.toLowerCase();
  const user = await ensureUser(sender);
  const userId = user?.id || sender.split("@")[0].split(":")[0];
  const rpg = await col("rpg_characters").findOne({ user_id: userId });

  if (command !== "guild") {
    await sendText(from, "❌ Usage: .guild [create/join/leave/info/list/desc/kick/disband]\n_Creating a guild requires Level 20 and a Guild Scroll (.shop, $175,000)._");
    return;
  }

  if (sub === "create") {
    const name = args.slice(1).join(" ");
    if (!name) { await sendText(from, "❌ Usage: .guild create [name]"); return; }
    if (!rpg || rpg.level < 20) { await sendText(from, "❌ You need to be Level 20 to create a guild."); return; }
    const existing = await getUserGuild(userId);
    if (existing) { await sendText(from, "❌ You're already in a guild. Leave first with .guild leave"); return; }
    if (await getGuild(name)) { await sendText(from, "❌ A guild with that name already exists."); return; }

    // A Guild Scroll (175,000 from .shop) is required and consumed on
    // founding — this is the real scarcity gate on guild creation, not just
    // a level requirement, matching how rare guild founding is meant to be.
    const hadScroll = await removeFromInventory(userId, "Guild Scroll", 1);
    if (!hadScroll) {
      await sendText(from, "❌ You need a *Guild Scroll* to found a guild. Buy one from *.shop* for $175,000.");
      return;
    }

    const guildId = generateId(8);
    await createGuild(guildId, name, sender);
    await sendText(from, `🏰 Guild *${name}* founded with a Guild Scroll! You are the owner.`);
    return;
  }

  if (sub === "join") {
    const name = args.slice(1).join(" ");
    if (!name) { await sendText(from, "❌ Usage: .guild join [name]"); return; }
    const g = await getGuild(name);
    if (!g) { await sendText(from, "❌ Guild not found."); return; }
    const existing = await getUserGuild(userId);
    if (existing) { await sendText(from, "❌ You're already in a guild."); return; }
    await joinGuild(sender, (g as any).id);
    await sendText(from, `✅ Joined guild *${(g as any).name}*!`);
    return;
  }

  if (sub === "leave") {
    const g = await getUserGuild(userId);
    if (!g) { await sendText(from, "❌ You're not in a guild."); return; }
    if ((g as any).owner_id === sender) { await sendText(from, "❌ You're the guild owner. Disband it first with .guild disband"); return; }
    await leaveGuild(sender);
    await sendText(from, `✅ Left guild *${(g as any).name}*.`);
    return;
  }

  if (sub === "info") {
    const name = args.slice(1).join(" ");
    const g = name ? await getGuild(name) : await getUserGuild(userId);
    if (!g) { await sendText(from, "❌ Guild not found."); return; }
    const members = await getGuildMembers((g as any).id);
    await sendText(from,
      `🏰 *Guild: ${(g as any).name}*\n👑 Owner: ${mentionTag((g as any).owner_id)}\n📝 ${(g as any).description || "(no description)"}\n⭐ Level: ${(g as any).level || 1}\n👥 Members: ${(members as any[]).length}`,
      [(g as any).owner_id]
    );
    return;
  }

  if (sub === "list") {
    const guilds = await getAllGuilds();
    if ((guilds as any[]).length === 0) { await sendText(from, "❌ No guilds yet."); return; }
    const lines = await Promise.all((guilds as any[]).map(async (g, i) => {
      const members = await getGuildMembers(g.id);
      return `${i + 1}. *${g.name}* (Lv.${g.level || 1}) — ${(members as any[]).length} members`;
    }));
    await sendText(from, `🏰 *Guild List*\n\n${lines.join("\n")}`);
    return;
  }

  if (sub === "desc") {
    const g = await getUserGuild(userId);
    if (!g || (g as any).owner_id !== sender) { await sendText(from, "❌ Only guild owners can set the description."); return; }
    const desc = args.slice(1).join(" ");
    await col("guilds").updateOne({ _id: (g as any).id as any }, { $set: { description: desc } });
    await sendText(from, `✅ Guild description updated: ${desc}`);
    return;
  }

  if (sub === "kick") {
    const mentioned = resolvedMentions[0];
    if (!mentioned) { await sendText(from, "❌ Mention someone to kick."); return; }
    const g = await getUserGuild(userId);
    if (!g || (g as any).owner_id !== sender) { await sendText(from, "❌ Only guild owners can kick members."); return; }
    await kickFromGuild(mentioned, (g as any).id);
    await sock.sendMessage(from, { text: `🚪 ${mentionTag(mentioned)} was kicked from *${(g as any).name}*!`, mentions: [mentioned] });
    return;
  }

  if (sub === "disband") {
    const g = await getUserGuild(userId);
    if (!g || (g as any).owner_id !== sender) { await sendText(from, "❌ Only the guild owner can disband."); return; }
    await disbandGuild((g as any).id);
    await sendText(from, `✅ Guild *${(g as any).name}* has been disbanded.`);
    return;
  }

  await sendText(from, "Usage: .guild create/join/leave/info/list/desc/kick/disband");
}
