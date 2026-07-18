import { Router } from "express";
import { col } from "../../bot/db/mongo.js";

const router = Router();

router.get("/stats", async (_req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const [totalMembers, totalCards, totalGuilds, totalBots, activeMissions, totalTransactions] = await Promise.all([
      col("users").countDocuments({ is_bot: { $ne: 1 }, registered: 1 }),
      col("cards").countDocuments(),
      col("guilds").countDocuments(),
      col("bots").countDocuments(),
      col("rpg_characters").countDocuments({
        $or: [
          { last_adventure: { $gt: now - 3600 } },
          { last_quest: { $gt: now - 3600 } },
        ],
      }),
      col("inventory").countDocuments(),
    ]);

    res.json({
      totalMembers,
      totalBots,
      activeMissions,
      totalCards,
      totalGuilds,
      totalTransactions,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export { router as communityRouter };
