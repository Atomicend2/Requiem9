import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import sharp from "sharp";
import { requireAuth, type AuthRequest } from "./middleware.js";
import { requireAdminAccess } from "./admin.js";
import { col } from "../../bot/db/mongo.js";
import { getAllFrames, getFrameById, addFrame, equipFrame, getUserEquippedFrame } from "../../bot/db/queries.js";
import { svgToFramePng } from "../../bot/frames.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

// The 5 hardcoded brand-default frames ship with the bot and re-seed
// automatically if missing — these are the only frames that can never be
// deleted. Everything else with uploaded_by "system" (bulk-seeded sets like
// the Tensura community frames, or any future bulk import) is a normal,
// deletable frame — "system" here means "not uploaded by a specific staff
// member through the upload form," not "protected."
const PROTECTED_BRAND_FRAMES = new Set([
  "Celestial Sky", "Cherry Blossom", "Samurai Gold", "Neon Pulse", "Dragon Fire",
]);

const BOT_OWNER = (process.env["BOT_OWNER_PHONE"] || "2348144550593").replace(/\D/g, "");

async function isStaff(req: AuthRequest): Promise<boolean> {
  const phone = (req.user?.phone || "").replace(/\D/g, "");
  if (phone === BOT_OWNER) return true;
  const userId = req.user?.id || "";
  const row = await col("staff").findOne({ user_id: userId });
  return !!row;
}

router.get("/", async (_req, res) => {
  try {
    const frames = await getAllFrames();
    res.json({
      success: true,
      frames: (frames as any[]).map((f: any) => ({
        id: f.code || f._id?.toString() || f.id,
        mongoId: f._id?.toString() || f.id,
        name: f.name,
        theme: f.theme,
        uploadedBy: f.uploaded_by,
        createdAt: f.created_at,
        isSystem: f.uploaded_by === "system",
        isProtected: f.uploaded_by === "system" && PROTECTED_BRAND_FRAMES.has(f.name),
      })),
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch frames" });
  }
});

router.get("/:id/image", async (req, res) => {
  try {
    const frame = await getFrameById(req.params.id);
    if (!frame) { res.status(404).json({ success: false, message: "Frame not found" }); return; }

    let imageBuffer: Buffer;
    if ((frame as any).image) {
      const img = (frame as any).image;
      imageBuffer = Buffer.isBuffer(img) ? img : Buffer.from(img, "base64");
    } else if ((frame as any).svg) {
      imageBuffer = await svgToFramePng((frame as any).svg);
    } else if ((frame as any).url) {
      // Never redirect to the external URL directly — that exposes the
      // source domain to anyone who inspects the image (and this source in
      // particular is another community bot's own site, not a neutral CDN).
      // Fetch it once, cache the bytes into this frame's own `image` field,
      // and serve from our own domain from now on. If the fetch fails (the
      // external site being slow/down/blocking hotlinking), the player sees
      // a clear placeholder instead of a broken-image icon that points
      // straight at someone else's domain.
      try {
        const upstream = await fetch((frame as any).url, { signal: AbortSignal.timeout(10000) });
        if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
        const rawBuf = Buffer.from(await upstream.arrayBuffer());
        imageBuffer = await sharp(rawBuf).resize(220, 220, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        const frameOid = (frame as any)._id;
        if (frameOid) {
          await col("frames").updateOne({ _id: frameOid }, { $set: { image: imageBuffer.toString("base64") } }).catch(() => {});
        }
      } catch {
        res.redirect(302, "/frame-placeholder.png");
        return;
      }
    } else {
      res.status(404).json({ success: false, message: "Frame has no image" }); return;
    }
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(imageBuffer);
  } catch {
    res.status(500).json({ success: false, message: "Failed to render frame" });
  }
});

router.put("/equip", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { frameId } = req.body;
    if (frameId === null || frameId === undefined) {
      await equipFrame(req.userId!, null);
      res.json({ success: true, message: "Frame unequipped" });
      return;
    }
    const id = String(frameId);
    const frame = await getFrameById(id);
    if (!frame) { res.status(404).json({ success: false, message: "Frame not found" }); return; }
    await equipFrame(req.userId!, id);
    res.json({ success: true, message: `Frame "${(frame as any).name}" equipped` });
  } catch {
    res.status(500).json({ success: false, message: "Failed to equip frame" });
  }
});

router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const frame = await getUserEquippedFrame(req.userId!);
    res.json({
      success: true,
      frame: frame
        ? { id: (frame as any).code || (frame as any)._id?.toString() || (frame as any).id, name: (frame as any).name, theme: (frame as any).theme, url: (frame as any).url || null }
        : null,
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to get equipped frame" });
  }
});

router.post("/upload", requireAdminAccess as any, upload.single("frame"), async (req: AuthRequest, res) => {
  try {
    if (!(req as any).isAdminSession && !(await isStaff(req))) {
      res.status(403).json({ success: false, message: "Staff only" }); return;
    }
    if (!req.file) { res.status(400).json({ success: false, message: "No file uploaded" }); return; }

    // Validate the source image BEFORE resizing. A frame that's too small or
    // the wrong aspect ratio looks unrecognizable once force-squeezed into the
    // profile card's circular slot — reject it here instead of letting it
    // silently render badly for every player who equips it.
    const meta = await sharp(req.file.buffer).metadata();
    const srcW = meta.width || 0;
    const srcH = meta.height || 0;
    const MIN_DIMENSION = 300; // upscaling below this looks blurry/unrecognizable at frame size
    if (srcW < MIN_DIMENSION || srcH < MIN_DIMENSION) {
      res.status(400).json({
        success: false,
        message: `Image too small (${srcW}x${srcH}). Frames need at least ${MIN_DIMENSION}x${MIN_DIMENSION} so artwork stays recognizable when scaled.`,
      });
      return;
    }
    const aspectRatio = srcW / srcH;
    if (aspectRatio < 0.85 || aspectRatio > 1.15) {
      res.status(400).json({
        success: false,
        message: `Image aspect ratio (${srcW}x${srcH}) is too far from square. Frames are displayed as a square/circular ring — use artwork close to a 1:1 ratio or it will be cropped unrecognizably.`,
      });
      return;
    }

    const name = String(req.body.name || "Custom Frame").slice(0, 50);
    const theme = String(req.body.theme || "custom").slice(0, 30);
    const png = await sharp(req.file.buffer).resize(220, 220, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const uploadedBy = req.userId || "admin";
    const id = await addFrame(name, theme, null, png, uploadedBy);
    res.json({ success: true, message: `Frame "${name}" uploaded`, frameId: id });
  } catch {
    res.status(500).json({ success: false, message: "Failed to upload frame" });
  }
});

router.delete("/:id", requireAdminAccess as any, async (req: AuthRequest, res) => {
  try {
    if (!(req as any).isAdminSession && !(await isStaff(req))) {
      res.status(403).json({ success: false, message: "Staff only" }); return;
    }
    const id = req.params.id;
    const frame = await getFrameById(id);
    if (!frame) { res.status(404).json({ success: false, message: "Frame not found" }); return; }

    // The 5 hardcoded brand-default frames (Celestial Sky, Cherry Blossom,
    // Samurai Gold, Neon Pulse, Dragon Fire) are protected from deletion —
    // they ship with the bot and re-seed automatically if missing. Everything
    // else with uploaded_by "system" (e.g. the Tensura community frame set,
    // or any other bulk-seeded collection) CAN be deleted individually —
    // staff need this to remove a mistakenly-imported frame.
    if ((frame as any).uploaded_by === "system" && PROTECTED_BRAND_FRAMES.has((frame as any).name)) {
      res.status(403).json({ success: false, message: "Cannot delete a built-in default frame" }); return;
    }

    // Use the resolved frame's real Mongo _id — the route param `id` may be a
    // short code (e.g. "fr7k2") or a numeric list position, neither of which
    // matches the document's _id directly. Deleting with the raw param here
    // previously matched nothing and silently reported success.
    await col("frames").deleteOne({ _id: (frame as any)._id });

    // Unequip this frame from anyone currently wearing it so a deleted
    // frame doesn't leave players with a dangling, unrenderable frame_id.
    const frameCode = (frame as any).code || (frame as any)._id?.toString();
    const frameOidStr = (frame as any)._id?.toString();
    await col("users").updateMany(
      { frame_id: { $in: [frameCode, frameOidStr].filter(Boolean) } },
      { $set: { frame_id: null } }
    ).catch(() => {});

    res.json({ success: true, message: `Frame "${(frame as any).name}" deleted` });
  } catch {
    res.status(500).json({ success: false, message: "Failed to delete frame" });
  }
});

export { router as framesRouter };
