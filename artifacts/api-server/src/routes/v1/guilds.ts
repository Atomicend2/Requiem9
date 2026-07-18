import { Router } from "express";
import { col } from "../../bot/db/mongo.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const search = req.query.search as string | undefined;
    const filter: any = {};
    if (search) filter.name = { $regex: search, $options: "i" };

    const guilds = await col("guilds").find(filter).sort({ level: -1 }).toArray();
    const guildIds = guilds.map((g) => g._id);
    const memberCounts = await col("guild_members")
      .aggregate([
        { $match: { guild_id: { $in: guildIds as any[] } } },
        { $group: { _id: "$guild_id", count: { $sum: 1 } } },
      ])
      .toArray();
    const countMap = new Map(memberCounts.map((m) => [String(m._id), m.count]));

    const ownerIds = guilds.map((g) => g.owner_id).filter(Boolean);
    const owners = await col("users").find({ _id: { $in: ownerIds as any[] } }).project({ _id: 1, name: 1 }).toArray();
    const ownerMap = new Map(owners.map((o) => [String(o._id), o.name]));

    res.json({
      guilds: guilds.map((g: any) => ({
        id: g._id,
        name: g.name,
        description: g.description || "",
        level: g.level || 1,
        memberCount: countMap.get(String(g._id)) || 0,
        ownerName: ownerMap.get(String(g.owner_id)) || "Unknown",
        createdAt: g.created_at || 0,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:guildId", async (req, res) => {
  try {
    const { guildId } = req.params;
    const guild = await col("guilds").findOne({ _id: guildId as any });
    if (!guild) { res.status(404).json({ success: false, message: "Guild not found" }); return; }

    const [memberDocs, memberCount, owner] = await Promise.all([
      col("guild_members").find({ guild_id: guildId }).sort({ joined_at: 1 }).toArray(),
      col("guild_members").countDocuments({ guild_id: guildId }),
      guild.owner_id ? col("users").findOne({ _id: guild.owner_id as any }, { projection: { name: 1 } }) : null,
    ]);

    const memberUserIds = memberDocs.map((m) => m.user_id);
    const memberUsers = await col("users").find({ _id: { $in: memberUserIds as any[] } }).project({ _id: 1, name: 1, level: 1 }).toArray();
    const userMap = new Map(memberUsers.map((u) => [String(u._id), u]));

    res.json({
      guild: {
        id: guild._id,
        name: guild.name,
        description: guild.description || "",
        level: guild.level || 1,
        memberCount,
        ownerName: owner?.name || "Unknown",
        createdAt: guild.created_at || 0,
      },
      members: memberDocs.map((m: any) => {
        const u = userMap.get(String(m.user_id)) as any;
        return {
          userId: m.user_id,
          name: u?.name || "Shadow",
          level: u?.level || 1,
          joinedAt: m.joined_at || 0,
        };
      }),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export { router as guildsRouter };
