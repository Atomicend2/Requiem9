import { Router } from "express";
import { requireAuth, optionalAuth, type AuthRequest } from "./middleware.js";
import { getShop, addToInventory, getInventory } from "../../bot/db/queries.js";
import { col } from "../../bot/db/mongo.js";

// Permanent tools can only be owned once. Duplicate purchases are blocked both
// here (web) and in economy.ts (bot) using the same set — shared business rule.
const PERMANENT_TOOLS = new Set([
  "shovel", "fishing rod", "rod", "pickaxe", "pistol", "rope",
]);

const router = Router();
const LOTTERY_TICKET_DAILY_MAX = 5;

router.get("/", optionalAuth, async (_req, res) => {
  try {
    const items = await getShop();

    const categoryMap: Record<string, any[]> = {};
    for (const item of items) {
      const cat = (item as any).category || "general";
      if (!categoryMap[cat]) categoryMap[cat] = [];
      categoryMap[cat].push({
        id: (item as any)._id?.toString() || (item as any).id,
        name: (item as any).name,
        description: (item as any).description || "",
        price: (item as any).price,
        effect: (item as any).effect || "",
        category: cat,
      });
    }

    const categories = Object.entries(categoryMap).map(([name, shopItems]) => ({ name, items: shopItems }));
    res.json({ categories });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/buy", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { itemId, quantity = 1 } = req.body as { itemId?: string; quantity?: number };
    if (!itemId) {
      res.status(400).json({ success: false, message: "itemId is required", newBalance: 0 });
      return;
    }

    const { ObjectId } = await import("mongodb");
    let oid: any;
    try { oid = new ObjectId(String(itemId)); } catch { oid = null; }

    const shopItems = await getShop();
    const item = shopItems.find((i: any) => {
      const id = i._id?.toString() || i.id?.toString();
      return id === String(itemId) || (oid && i._id?.toString() === oid.toString());
    }) as any;

    if (!item || ["card pack", "premium card pack", "vip pass", "vip access"].includes((item.name || "").toLowerCase())) {
      res.status(400).json({ success: false, message: "Item not found in shop", newBalance: req.user.balance || 0 });
      return;
    }

    const user = req.user;
    const qty = Math.max(1, Number(quantity));
    const totalCost = item.price * qty;

    // Permanent tool duplicate prevention — same rule as bot economy.ts
    const itemKey = (item.name || "").toLowerCase();
    if (PERMANENT_TOOLS.has(itemKey)) {
      const inv = await getInventory(user.id || String(user._id));
      const alreadyOwns = inv.some((i: any) => i.item.toLowerCase() === itemKey);
      if (alreadyOwns) {
        res.status(400).json({
          success: false,
          message: `You already own a ${item.name}. Permanent tools cannot be purchased twice. Sell yours first if you want to rebuy.`,
          newBalance: user.balance || 0,
        });
        return;
      }
    }

    // Fetch freshUser once for lottery_ticket checks (pre-purchase limit + post-purchase update).
    // Declaring it here avoids two separate findOne calls for the same document.
    let freshUser: any = null;
    if ((item.effect || "") === "lottery_ticket") {
      const today = new Date().toISOString().slice(0, 10);
      freshUser = await col("users").findOne({ _id: user._id || user.id });
      const resetDate = freshUser?.lottery_tickets_reset_date || "";
      const boughtToday = resetDate === today ? (freshUser?.lottery_tickets_bought_today || 0) : 0;
      if (boughtToday + qty > LOTTERY_TICKET_DAILY_MAX) {
        const remaining = LOTTERY_TICKET_DAILY_MAX - boughtToday;
        res.status(400).json({
          success: false,
          message: `Daily limit reached. You can only buy ${LOTTERY_TICKET_DAILY_MAX} Lottery Tickets per day. You have ${remaining} purchase(s) remaining today.`,
          newBalance: user.balance || 0,
        });
        return;
      }
    }

    if ((user.balance || 0) < totalCost) {
      res.status(400).json({
        success: false,
        message: `Insufficient funds. You need ${totalCost.toLocaleString()} Gold but have ${(user.balance || 0).toLocaleString()} Gold.`,
        newBalance: user.balance || 0,
      });
      return;
    }

    const newBalance = (user.balance || 0) - totalCost;
    await col("users").updateOne({ _id: user._id || user.id } as any, { $set: { balance: newBalance, updated_at: Math.floor(Date.now() / 1000) } });
    await addToInventory(user.id, item.name, qty);

    if ((item.effect || "") === "lottery_ticket") {
      const today = new Date().toISOString().slice(0, 10);
      // Reuse freshUser fetched above — no second findOne needed
      const resetDate = freshUser?.lottery_tickets_reset_date || "";
      const prevBought = resetDate === today ? (freshUser?.lottery_tickets_bought_today || 0) : 0;
      await col("users").updateOne({ _id: user._id || user.id } as any, {
        $inc: { lottery_tickets: qty },
        $set: { lottery_tickets_bought_today: prevBought + qty, lottery_tickets_reset_date: today },
      });
    }

    res.json({
      success: true,
      message: `Purchased ${qty}x ${item.name} for ${totalCost.toLocaleString()} Gold`,
      newBalance,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export { router as shopRouter };
