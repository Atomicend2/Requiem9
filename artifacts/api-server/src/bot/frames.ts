import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { col } from "./db/mongo.js";
import { logger } from "../lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAME_SIZE = 220;

const DEFAULT_FRAMES: Array<{ name: string; theme: string; svg: string }> = [
  {
    name: "Celestial Sky",
    theme: "celestial",
    svg: `<svg width="220" height="220" xmlns="http://www.w3.org/2000/svg">
  <circle cx="110" cy="110" r="109" fill="none" stroke="#0369a1" stroke-width="1.5" opacity="0.5"/>
  <circle cx="110" cy="110" r="105" fill="none" stroke="#0ea5e9" stroke-width="3" opacity="0.8"/>
  <circle cx="110" cy="110" r="101" fill="none" stroke="#38bdf8" stroke-width="7"/>
  <circle cx="110" cy="110" r="96" fill="none" stroke="#7dd3fc" stroke-width="2" opacity="0.7"/>
  <circle cx="110" cy="110" r="94" fill="none" stroke="#bae6fd" stroke-width="1" opacity="0.4"/>
  <polygon points="110,1 113.5,9 122,9 115.5,14.5 118,23 110,17.5 102,23 104.5,14.5 98,9 106.5,9" fill="#ffffff" opacity="0.95"/>
  <polygon points="110,219 113.5,211 122,211 115.5,205.5 118,197 110,202.5 102,197 104.5,205.5 98,211 106.5,211" fill="#ffffff" opacity="0.95"/>
  <polygon points="1,110 9,106.5 9,98 14.5,104.5 23,102 17.5,110 23,118 14.5,115.5 9,122 9,113.5" fill="#ffffff" opacity="0.95"/>
  <polygon points="219,110 211,113.5 211,122 205.5,115.5 197,118 202.5,110 197,102 205.5,104.5 211,98 211,106.5" fill="#ffffff" opacity="0.95"/>
  <circle cx="110" cy="5" r="2" fill="#38bdf8" opacity="0.9"/>
  <circle cx="110" cy="215" r="2" fill="#38bdf8" opacity="0.9"/>
  <circle cx="5" cy="110" r="2" fill="#38bdf8" opacity="0.9"/>
  <circle cx="215" cy="110" r="2" fill="#38bdf8" opacity="0.9"/>
</svg>`,
  },
  {
    name: "Cherry Blossom",
    theme: "sakura",
    svg: `<svg width="220" height="220" xmlns="http://www.w3.org/2000/svg">
  <circle cx="110" cy="110" r="109" fill="none" stroke="#9d174d" stroke-width="1.5" opacity="0.4"/>
  <circle cx="110" cy="110" r="105" fill="none" stroke="#db2777" stroke-width="2.5" opacity="0.7"/>
  <circle cx="110" cy="110" r="101" fill="none" stroke="#ec4899" stroke-width="7"/>
  <circle cx="110" cy="110" r="96" fill="none" stroke="#f9a8d4" stroke-width="2" opacity="0.8"/>
  <ellipse cx="110" cy="4" rx="4" ry="6" fill="#fda4af" opacity="0.95" transform="rotate(0,110,110)"/>
  <ellipse cx="110" cy="4" rx="4" ry="6" fill="#fda4af" opacity="0.95" transform="rotate(60,110,110)"/>
  <ellipse cx="110" cy="4" rx="4" ry="6" fill="#fda4af" opacity="0.95" transform="rotate(120,110,110)"/>
  <ellipse cx="110" cy="4" rx="4" ry="6" fill="#fda4af" opacity="0.95" transform="rotate(180,110,110)"/>
  <ellipse cx="110" cy="4" rx="4" ry="6" fill="#fda4af" opacity="0.95" transform="rotate(240,110,110)"/>
  <ellipse cx="110" cy="4" rx="4" ry="6" fill="#fda4af" opacity="0.95" transform="rotate(300,110,110)"/>
  <circle cx="110" cy="215" r="2" fill="#fda4af" opacity="0.9"/>
</svg>`,
  },
  {
    name: "Samurai Gold",
    theme: "samurai",
    svg: `<svg width="220" height="220" xmlns="http://www.w3.org/2000/svg">
  <circle cx="110" cy="110" r="109" fill="none" stroke="#78350f" stroke-width="1.5" opacity="0.5"/>
  <circle cx="110" cy="110" r="101" fill="none" stroke="#fbbf24" stroke-width="8"/>
  <circle cx="110" cy="110" r="97" fill="none" stroke="#d97706" stroke-width="2.5"/>
  <polygon points="110,1 114,9 122,9 116,15 119,23 110,18 101,23 104,15 98,9 106,9" fill="#fbbf24"/>
  <polygon points="110,219 114,211 122,211 116,205 119,197 110,202 101,197 104,205 98,211 106,211" fill="#fbbf24"/>
  <polygon points="1,110 9,106 9,98 15,104 23,101 18,110 23,119 15,116 9,122 9,114" fill="#fbbf24"/>
  <polygon points="219,110 211,114 211,122 205,116 197,119 202,110 197,101 205,104 211,98 211,106" fill="#fbbf24"/>
</svg>`,
  },
  {
    name: "Neon Pulse",
    theme: "neon",
    svg: `<svg width="220" height="220" xmlns="http://www.w3.org/2000/svg">
  <circle cx="110" cy="110" r="109" fill="none" stroke="#7e22ce" stroke-width="1" opacity="0.5"/>
  <circle cx="110" cy="110" r="101" fill="none" stroke="#a855f7" stroke-width="6"/>
  <circle cx="110" cy="110" r="97" fill="none" stroke="#22d3ee" stroke-width="3" opacity="0.9"/>
  <rect x="107" y="1" width="6" height="10" rx="2" fill="#22d3ee" opacity="0.95"/>
  <rect x="107" y="209" width="6" height="10" rx="2" fill="#22d3ee" opacity="0.95"/>
  <rect x="1" y="107" width="10" height="6" rx="2" fill="#22d3ee" opacity="0.95"/>
  <rect x="209" y="107" width="10" height="6" rx="2" fill="#22d3ee" opacity="0.95"/>
  <circle cx="110" cy="5" r="2.5" fill="#a855f7" opacity="0.9"/>
  <circle cx="110" cy="215" r="2.5" fill="#a855f7" opacity="0.9"/>
  <circle cx="5" cy="110" r="2.5" fill="#a855f7" opacity="0.9"/>
  <circle cx="215" cy="110" r="2.5" fill="#a855f7" opacity="0.9"/>
</svg>`,
  },
  {
    name: "Dragon Fire",
    theme: "dragon",
    svg: `<svg width="220" height="220" xmlns="http://www.w3.org/2000/svg">
  <circle cx="110" cy="110" r="109" fill="none" stroke="#7f1d1d" stroke-width="1.5" opacity="0.5"/>
  <circle cx="110" cy="110" r="101" fill="none" stroke="#ef4444" stroke-width="7"/>
  <circle cx="110" cy="110" r="96" fill="none" stroke="#fbbf24" stroke-width="2" opacity="0.8"/>
  <polygon points="110,1 113,12 120,6 116,17 124,14 117,23 110,20 103,23 96,14 104,17 100,6 107,12" fill="#f97316" opacity="0.95"/>
  <polygon points="110,219 113,208 120,214 116,203 124,206 117,197 110,200 103,197 96,206 104,203 100,214 107,208" fill="#f97316" opacity="0.95"/>
  <polygon points="1,110 12,107 6,100 17,104 14,96 23,103 20,110 23,117 14,124 17,116 6,120 12,113" fill="#f97316" opacity="0.95"/>
  <polygon points="219,110 208,113 214,120 203,116 206,124 197,117 200,110 197,103 206,96 203,104 214,100 208,107" fill="#f97316" opacity="0.95"/>
</svg>`,
  },
];

export async function svgToFramePng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg))
    .resize(FRAME_SIZE, FRAME_SIZE)
    .png()
    .toBuffer();
}

export async function seedDefaultFrames(): Promise<void> {
  const existing = await col("frames").countDocuments({ uploaded_by: "system" });
  if (existing > 0) return;

  for (const frame of DEFAULT_FRAMES) {
    const png = await svgToFramePng(frame.svg);
    await col("frames").updateOne(
      { name: frame.name, uploaded_by: "system" },
      {
        $setOnInsert: {
          name: frame.name,
          theme: frame.theme,
          svg: frame.svg,
          image: png.toString("base64"),
          uploaded_by: "system",
          created_at: Math.floor(Date.now() / 1000),
        },
      },
      { upsert: true }
    );
  }
}

/* ── Locate tensura_frames.json the same way cards-loader resolves its file ── */
/* Matches the format generated by generateFrameCode() in db/queries.ts —
 * kept as a separate local copy here since that one is private to that
 * file, but both must produce codes matching the same "fr" + 5 chars
 * pattern that getFrameById's lookup regex expects. */
function generateFrameCodeLocal(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "fr";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function resolveFrameDataFile(): string | null {
  const roots = [
    path.resolve(__dirname, "../../../"),
    path.resolve(__dirname, "../../../../"),
    process.cwd(),
    path.resolve(process.cwd(), "../../"),
  ];
  for (const root of roots) {
    const p = path.join(root, "tensura_frames.json");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Registers the community-sourced Tensura frame collection by URL. Each
 * frame is stored with `url` set and `image`/`svg` left null — the actual
 * artwork is fetched, resized, and cached into `image` lazily the first
 * time a player equips it and their profile card is rendered (see the
 * frame-fetch logic in buildProfileImage / economy.ts). This avoids
 * fetching and storing 195 images up front during a cold start, which
 * could be slow or fail entirely without network access at boot time.
 *
 * Idempotent: re-running this is always safe. Each frame is keyed by its
 * source URL, so running it again after some frames have already been
 * fetched/cached will not duplicate or reset them.
 */
export async function seedTensuraFrames(): Promise<{ added: number; skipped: number }> {
  // Self-heal frames seeded by an earlier version of this function, which
  // didn't assign a `code` and used a name that exposed the source site.
  // Without a code, these frames can't be deleted by short code from the
  // admin panel or .frame delete — only by their raw Mongo _id, which is
  // inconsistent with every other frame in the system.
  const legacyFrames = await col("frames").find({
    uploaded_by: "system",
    theme: { $in: ["tensura", "isekai"] },
    $or: [{ code: { $exists: false } }, { code: null }],
  }).toArray();
  for (const f of legacyFrames as any[]) {
    let code = generateFrameCodeLocal();
    for (let attempt = 0; attempt < 5; attempt++) {
      const clash = await col("frames").findOne({ code });
      if (!clash) break;
      code = generateFrameCodeLocal();
    }
    const fixedName = String(f.name || "").replace(/^Tensura Frame/i, "Isekai Frame");
    await col("frames").updateOne({ _id: f._id }, { $set: { code, name: fixedName, theme: "isekai" } });
  }

  const filePath = resolveFrameDataFile();
  if (!filePath) {
    logger.warn("tensura_frames.json not found — skipping Tensura frame seed");
    return { added: 0, skipped: 0 };
  }

  let entries: Array<{ image: string }>;
  try {
    entries = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e: any) {
    logger.warn({ e: e.message }, "Failed to parse tensura_frames.json — skipping seed");
    return { added: 0, skipped: 0 };
  }

  let added = 0;
  let skipped = 0;
  for (const entry of entries) {
    const url = entry?.image;
    if (!url) { skipped++; continue; }

    // Display name and theme are intentionally generic — players should
    // never be able to tell this frame set came from a third-party site.
    // "Tensura" only ever appears in this source code comment and the
    // bundled filename, never in anything rendered to a user.
    const fileNum = url.split("/").pop()?.replace(/\.\w+$/, "") || "";
    const name = `Isekai Frame ${fileNum}`;

    const existing = await col("frames").findOne({ url, uploaded_by: "system" });
    if (existing) { skipped++; continue; }

    let code = generateFrameCodeLocal();
    for (let attempt = 0; attempt < 5; attempt++) {
      const clash = await col("frames").findOne({ code });
      if (!clash) break;
      code = generateFrameCodeLocal();
    }

    await col("frames").insertOne({
      name,
      theme: "isekai",
      svg: null,
      image: null,
      url,
      code,
      uploaded_by: "system",
      created_at: Math.floor(Date.now() / 1000),
    });
    added++;
  }

  logger.info({ added, skipped, total: entries.length }, "Community frame seed complete");
  return { added, skipped };
}

export function getFrameBuffer(frame: any): Buffer | null {
  if (frame.image) {
    if (Buffer.isBuffer(frame.image)) return frame.image;
    if (typeof frame.image === "string") return Buffer.from(frame.image, "base64");
  }
  return null;
}
