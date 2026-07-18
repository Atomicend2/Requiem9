import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuth, type AuthRequest } from "./middleware.js";
import { col } from "../../bot/db/mongo.js";
import { getUserRank, getUserGuild, getInventory, updateUser, extractNumberFromJid } from "../../bot/db/queries.js";

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets");

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

router.get("/stats", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.user;

    const rpgPhone = extractNumberFromJid(user.id);
    const [rank, totalUsers, rpgRow, guildRow, bankCapItems] = await Promise.all([
      getUserRank(user.id),
      col("users").countDocuments({ is_bot: { $ne: 1 } }),
      col("rpg_characters").findOne({ _id: rpgPhone as any }),
      getUserGuild(user.id),
      col("inventory").aggregate([
        { $match: { user_id: user.id, quantity: { $gt: 0 } } },
        {
          $lookup: {
            from: "shop_items",
            let: { item: { $toLower: "$item" } },
            pipeline: [
              { $match: { $expr: { $and: [{ $eq: [{ $toLower: "$name" }, "$$item"] }, { $regexMatch: { input: { $ifNull: ["$effect", ""] }, regex: "^bank_cap:" } }] } } },
            ],
            as: "shopItem",
          },
        },
        { $unwind: "$shopItem" },
        { $project: { quantity: 1, effect: "$shopItem.effect" } },
      ]).toArray(),
    ]);

    const xpNeeded = (rpgRow?.level || 1) * 100;

    const rpg = rpgRow
      ? {
          class: rpgRow.class || "Warrior",
          hp: rpgRow.hp || 100,
          maxHp: rpgRow.max_hp || 100,
          attack: rpgRow.attack || 20,
          defense: rpgRow.defense || 10,
          speed: rpgRow.speed || 15,
          dungeonFloor: rpgRow.dungeon_floor || 1,
          skillPoints: rpgRow.skill_points || 0,
          // Dungeon/RPG progression — this is the real "rank" source now
          // (see getUserRank in db/queries.ts). users.level/xp (chat
          // activity) is kept below for backwards compat but should no
          // longer be treated as the player's rank-defining level.
          level: rpgRow.level || 1,
          xp: rpgRow.xp || 0,
        }
      : null;

    const guild = guildRow
      ? { id: (guildRow as any)._id || (guildRow as any).id, name: (guildRow as any).name, level: (guildRow as any).level || 1 }
      : null;

    const extraBankCap = bankCapItems.reduce((acc: number, row: any) => {
      const val = parseInt((row.effect || "").replace("bank_cap:", ""), 10) || 0;
      return acc + val * (row.quantity || 1);
    }, 0);
    const baseBankMax = 50_000; // matches BASE_CAP in bot/commands/economy.ts — these two must agree
    const bankMax = baseBankMax + extraBankCap;

    const displayPhone = user.phone || user.id;

    res.json({
      profile: {
        id: user.id,
        phone: displayPhone,
        name: user.name || "Shadow",
        level: user.level || 1,
        xp: user.xp || 0,
        balance: user.balance || 0,
        bank: user.bank || 0,
        bankMax,
        lotteryTickets: user.lottery_tickets || 0,
        premium: user.premium || 0,
        bio: user.bio || "",
        registeredAt: user.created_at || 0,
        hasAvatar: !!(user.profile_picture),
        hasBackground: !!(user.profile_background),
      },
      rpg,
      guild,
      rank,
      totalUsers,
      xpNeeded,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/avatar", requireAuth, async (req: AuthRequest, res) => {
  const user = req.user;
  // requireAuth's user lookup deliberately excludes profile_picture/
  // profile_background from its projection (they're large binary blobs —
  // loading them on every authenticated request, for every route, was
  // making all profile endpoints take 15+ seconds; see middleware.ts).
  // That means req.user.profile_picture is ALWAYS undefined here — this
  // route always fell through to the default/placeholder image regardless
  // of what the user actually had uploaded. Do the one targeted fetch this
  // endpoint actually needs instead of relying on the shared projection.
  const picDoc = await col("users").findOne(
    { _id: user.id as any },
    { projection: { profile_picture: 1 } }
  );
  if (picDoc?.profile_picture) {
    const buf = Buffer.isBuffer(picDoc.profile_picture) ? picDoc.profile_picture : Buffer.from(picDoc.profile_picture, "base64");
    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "no-cache");
    res.send(buf);
    return;
  }
  const defaultPath = path.join(ASSETS_DIR, "default_pp.jpg");
  if (existsSync(defaultPath)) {
    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "public, max-age=86400");
    createReadStream(defaultPath).pipe(res);
    return;
  }
  const initial = (user.name || user.id || "?").charAt(0).toUpperCase();
  const svgAvatar = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a0a2e"/>
      <stop offset="100%" stop-color="#0a0a0f"/>
    </linearGradient></defs>
    <circle cx="128" cy="128" r="128" fill="url(#g)"/>
    <circle cx="128" cy="128" r="126" fill="none" stroke="#a000cc" stroke-width="3"/>
    <text x="128" y="168" text-anchor="middle" font-size="110" font-family="'Noto Color Emoji','Noto Sans',Georgia,serif" font-weight="bold" fill="#cc0011">${initial}</text>
  </svg>`;
  const svgBuf = await sharp(Buffer.from(svgAvatar)).jpeg({ quality: 90 }).toBuffer();
  res.set("Content-Type", "image/jpeg");
  res.set("Cache-Control", "public, max-age=86400");
  res.send(svgBuf);
});

router.get("/background", requireAuth, async (req: AuthRequest, res) => {
  const user = req.user;
  // Same targeted-fetch fix as /avatar above — profile_background is
  // excluded from requireAuth's projection, so req.user.profile_background
  // was always undefined here too.
  const bgDoc = await col("users").findOne(
    { _id: user.id as any },
    { projection: { profile_background: 1 } }
  );
  if (bgDoc?.profile_background) {
    const buf = Buffer.isBuffer(bgDoc.profile_background) ? bgDoc.profile_background : Buffer.from(bgDoc.profile_background, "base64");
    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "no-cache");
    res.send(buf);
    return;
  }
  const defaultPath = path.join(ASSETS_DIR, "default_bg.jpg");
  if (existsSync(defaultPath)) {
    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "public, max-age=86400");
    createReadStream(defaultPath).pipe(res);
    return;
  }
  const svgBg = `<svg xmlns="http://www.w3.org/2000/svg" width="765" height="425">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#050510"/>
      <stop offset="60%" stop-color="#1a0a2e"/>
      <stop offset="100%" stop-color="#0a0005"/>
    </linearGradient></defs>
    <rect width="765" height="425" fill="url(#bg)"/>
    <text x="382" y="230" text-anchor="middle" font-size="80" font-family="'Noto Color Emoji','Noto Sans',Georgia,serif" font-weight="bold" fill="rgba(255,255,255,0.04)">反逆</text>
  </svg>`;
  const svgBuf = await sharp(Buffer.from(svgBg)).jpeg({ quality: 90 }).toBuffer();
  res.set("Content-Type", "image/jpeg");
  res.set("Cache-Control", "public, max-age=86400");
  res.send(svgBuf);
});

router.post("/setpp", requireAuth, upload.single("image"), async (req: AuthRequest, res) => {
  try {
    if (!req.file) { res.status(400).json({ success: false, message: "No image provided" }); return; }
    const resized = await sharp(req.file.buffer).resize(800, 800, { fit: "cover" }).jpeg({ quality: 92 }).toBuffer();
    await updateUser(req.user!.id, { profile_picture: resized.toString("base64"), profile_picture_video: null });
    res.json({ success: true, message: "Profile picture updated." });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || "Failed to process image" });
  }
});

router.post("/setbg", requireAuth, upload.single("image"), async (req: AuthRequest, res) => {
  try {
    if (!req.file) { res.status(400).json({ success: false, message: "No image provided" }); return; }
    const resized = await sharp(req.file.buffer).resize(765, 850, { fit: "cover" }).jpeg({ quality: 92 }).toBuffer();
    await updateUser(req.user!.id, { profile_background: resized.toString("base64"), profile_background_video: null });
    res.json({ success: true, message: "Profile background updated." });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || "Failed to process image" });
  }
});

router.get("/skills", requireAuth, async (req: AuthRequest, res) => {
  try {
    const rpg = await col("rpg_characters").findOne({ user_id: req.user!.id });
    if (!rpg) { res.json({ skillPoints: 0, attack: 20, defense: 10, speed: 15, maxHp: 100 }); return; }
    res.json({
      skillPoints: rpg.skill_points || 0,
      attack: rpg.attack || 20,
      defense: rpg.defense || 10,
      speed: rpg.speed || 15,
      maxHp: rpg.max_hp || 100,
      hp: rpg.hp || 100,
      dungeonFloor: rpg.dungeon_floor || 1,
      level: rpg.level || 1,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/skills/assign", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { stat, points } = req.body as { stat?: string; points?: number };
    const validStats: Record<string, string> = { attack: "attack", defense: "defense", speed: "speed", hp: "max_hp" };
    if (!stat || !(stat in validStats)) {
      res.status(400).json({ success: false, message: "stat must be one of: attack, defense, speed, hp" }); return;
    }
    const pts = Math.max(1, Math.floor(Number(points) || 1));
    const rpg = await col("rpg_characters").findOne({ user_id: req.user!.id });
    if (!rpg) { res.status(404).json({ success: false, message: "No RPG character found. Start with .dungeon in the bot." }); return; }
    const available = rpg.skill_points || 0;
    if (pts > available) { res.status(400).json({ success: false, message: `Not enough skill points. You have ${available} SP.` }); return; }
    const dbKey = validStats[stat];
    const gain = dbKey === "max_hp" ? pts * 5 : pts * 2;
    const newVal = (rpg[dbKey] || 0) + gain;
    const upd: any = { skill_points: available - pts, [dbKey]: newVal };
    if (dbKey === "max_hp") upd.hp = Math.min(rpg.hp || 1, newVal);
    await col("rpg_characters").updateOne({ user_id: req.user!.id }, { $set: upd });
    res.json({ success: true, message: `Spent ${pts} SP on ${stat}! +${gain} ${stat === "hp" ? "Max HP" : stat}.`, newValue: newVal, remainingPoints: available - pts });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/skills/unassign", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { stat, points } = req.body as { stat?: string; points?: number };
    const validStats: Record<string, string> = { attack: "attack", defense: "defense", speed: "speed", hp: "max_hp" };
    const BASE_MIN: Record<string, number> = { attack: 20, defense: 10, speed: 15, max_hp: 100 };
    if (!stat || !(stat in validStats)) {
      res.status(400).json({ success: false, message: "stat must be one of: attack, defense, speed, hp" }); return;
    }
    const pts = Math.max(1, Math.floor(Number(points) || 1));
    const rpg = await col("rpg_characters").findOne({ user_id: req.user!.id });
    if (!rpg) { res.status(404).json({ success: false, message: "No RPG character found." }); return; }
    const dbKey = validStats[stat];
    const loss = dbKey === "max_hp" ? pts * 5 : pts * 2;
    const current = rpg[dbKey] || 0;
    const minVal = BASE_MIN[dbKey];
    const newVal = Math.max(minVal, current - loss);
    const actualLoss = current - newVal;
    if (actualLoss <= 0) { res.status(400).json({ success: false, message: `${stat} is already at its minimum value of ${minVal}.` }); return; }
    const actualPtsRefunded = dbKey === "max_hp" ? Math.floor(actualLoss / 5) : Math.floor(actualLoss / 2);
    const newSp = (rpg.skill_points || 0) + actualPtsRefunded;
    const upd: any = { skill_points: newSp, [dbKey]: newVal };
    if (dbKey === "max_hp") upd.hp = Math.min(rpg.hp || newVal, newVal);
    await col("rpg_characters").updateOne({ user_id: req.user!.id }, { $set: upd });
    res.json({ success: true, message: `Removed ${actualLoss} from ${stat}. Refunded ${actualPtsRefunded} SP.`, newValue: newVal, remainingPoints: newSp });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/inventory", requireAuth, async (req: AuthRequest, res) => {
  try {
    const items = await getInventory(req.userId!);
    const categorized = items.map((item: any) => {
      const name = (item.item || "").toLowerCase();
      let category = "general";
      if (name.includes("shovel") || name.includes("fishing") || name.includes("rod") || name.includes("pickaxe")) category = "tools";
      else if (name.includes("potion") || name.includes("elixir") || name.includes("heal")) category = "potions";
      else if (name.includes("pistol") || name.includes("sword") || name.includes("gun") || name.includes("weapon") || name.includes("blade")) category = "weapons";
      else if (name.includes("note") || name.includes("bank")) category = "passive";
      else if (name.includes("ticket") || name.includes("lottery")) category = "lottery";
      return { item: item.item, quantity: item.quantity || 1, category };
    });
    res.json({ items: categorized });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/achievements", requireAuth, async (req: AuthRequest, res) => {
  try {
    // Bot grants achievements into the "achievements" collection (via checkAndGrant
    // in queries.ts). The old "web_achievements" collection was a separate store
    // that was never populated — read from the canonical source instead.
    const achievements = await col("achievements")
      .find({ user_id: req.userId! })
      .sort({ granted_at: -1 })
      .toArray();
    res.json({
      achievements: achievements.map((a: any) => ({
        id: a._id?.toString(),
        name: a.name,
        description: a.description || "",
        icon: a.icon || "⭐",
        earnedAt: a.granted_at || 0,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export { router as userRouter };
