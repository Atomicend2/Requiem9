import { Router } from "express";
import { requireAuth, optionalAuth, type AuthRequest } from "./middleware.js";
import {
  getAuctionsLive, getAuctionById, placeBid, settleExpiredAuctions,
  extractNumberFromJid,
} from "../../bot/db/queries.js";
import { col } from "../../bot/db/mongo.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const auctions = await getAuctionsLive();
    res.json({ auctions });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch auctions" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const auction = await getAuctionById(req.params.id);
    if (!auction) { res.status(404).json({ error: "Auction not found" }); return; }
    res.json({ auction });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch auction" });
  }
});

router.post("/:id/bid", requireAuth, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { amount } = req.body;

  if (!amount || typeof amount !== "number" || amount <= 0) {
    res.status(400).json({ error: "Invalid bid amount" }); return;
  }

  const user = req.user;
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }

  // Derive phone and JID from req.user.
  const rawId = String((user as any).id || (user as any)._id || "");
  const phone = (user as any).phone || extractNumberFromJid(rawId);

  // Always do a fresh balance read for financial operations — req.user is
  // fetched once at auth time and can be stale if another request changed
  // the balance in the same session.
  const freshUser = await col("users").findOne(
    { $or: [{ _id: rawId as any }, { phone: rawId }] },
    { projection: { balance: 1 } }
  );
  const balance = freshUser?.balance ?? (user as any).balance ?? 0;

  if (balance < amount) {
    res.status(400).json({ error: `Insufficient balance. You have ${balance.toLocaleString()}, bid requires ${amount.toLocaleString()}` }); return;
  }
  const bidderName = (user as any).name || phone || "Unknown";
  const bidderId = phone ? `${phone}@s.whatsapp.net` : rawId;
  const result = await placeBid(id, bidderId, bidderName, amount);

  if (!result.ok) { res.status(400).json({ error: result.message }); return; }

  res.json({ success: true, message: result.message, auction: result.auction });
});

export { router as auctionsRouter };
