import { Router } from "express";
import { col } from "../../bot/db/mongo.js";

const router = Router();

const MAX_ENTRIES = 15;

router.get("/", async (_req, res) => {
  try {
    const activeLottery = await col("lotteries").findOne({ active: 1 }, { sort: { created_at: -1 } });

    let entries: any[] = [];
    let entryCount = 0;
    let pool = 0;

    if (activeLottery) {
      pool = activeLottery.pool || 0;
      // Match by the raw ObjectId — NOT by .toString(). The bot inserts
      // lottery_entries with lottery_id as an ObjectId; querying by string
      // would always return 0 results and the web view would show an empty
      // participant list even while the bot showed 15 entries.
      const rawEntries = await col("lottery_entries")
        .find({ lottery_id: activeLottery._id })
        .sort({ created_at: 1 })
        .toArray();
      entryCount = rawEntries.length;

      const userIds = rawEntries.map((e) => e.user_id);
      const users = await col("users").find({ _id: { $in: userIds as any[] } }).project({ _id: 1, name: 1 }).toArray();
      const userMap = new Map(users.map((u) => [String(u._id), u.name]));

      entries = rawEntries.map((e: any) => ({
        userId: e.user_id,
        name: userMap.get(String(e.user_id)) || "Shadow",
        enteredAt: e.created_at || 0,
      }));
    }

    const recentWinnerDocs = await col("lotteries")
      .find({ active: 0, winner_id: { $ne: null } })
      .sort({ ended_at: -1 })
      .limit(10)
      .toArray();

    const winnerIds = recentWinnerDocs.map((w) => w.winner_id).filter(Boolean);
    const winnerUsers = await col("users").find({ _id: { $in: winnerIds as any[] } }).project({ _id: 1, name: 1 }).toArray();
    const winnerMap = new Map(winnerUsers.map((u) => [String(u._id), u.name]));

    res.json({
      active: !!activeLottery,
      pool,
      entryCount,
      maxEntries: MAX_ENTRIES,
      entries,
      recentWinners: recentWinnerDocs.map((w: any) => ({
        userId: w.winner_id,
        name: winnerMap.get(String(w.winner_id)) || "Shadow",
        prize: w.pool || 0,
        wonAt: w.ended_at || 0,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export { router as lotteryRouter };
