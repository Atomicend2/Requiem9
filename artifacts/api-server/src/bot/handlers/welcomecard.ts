/**
 * Welcome / Goodbye card image generator
 * Uses sharp + inline SVG — no @napi-rs/canvas dependency needed.
 *
 * The original glowLine bug (wrong argument order: y2 and color swapped) was
 * the source of "Failed to convert napi value String into rust type f64".
 * This implementation avoids that entirely by drawing glow lines as SVG filter
 * elements, which are natively supported by sharp's librsvg backend.
 */

import sharp from "sharp";
import { logger } from "../../lib/logger.js";
import { stripUnrenderableGlyphs, sanitizeForDejaVuSans } from "../../lib/svg-text-safe.js";

// Escape characters that would break SVG text nodes
function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Fetch a user's WhatsApp profile picture as a circular Buffer
async function fetchCircularAvatar(sock: any, jid: string): Promise<Buffer | null> {
  try {
    const url = await sock.profilePictureUrl(jid, "image");
    if (!url) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const raw = Buffer.from(await res.arrayBuffer());
    const size = 96;
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
    );
    return await sharp(raw)
      .resize(size, size, { fit: "cover" })
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

export interface WelcomeCardOpts {
  sock: any;
  type: "welcome" | "goodbye";
  participantJid: string;
  participantName: string;
  groupName: string;
  memberCount?: number;
  /** Optional background image Buffer (jpeg/png). Falls back to gradient. */
  bgBuffer?: Buffer | null;
}

export async function generateWelcomeCard(opts: WelcomeCardOpts): Promise<Buffer | null> {
  try {
    console.log(`[${opts.type.toUpperCase()} CARD] Rendering for ${opts.participantName}…`);
    return await render(opts);
  } catch (err) {
    logger.error({ err }, `[${opts.type.toUpperCase()} CARD] Render failed`);
    console.error(err);
    return null;
  }
}

async function render(opts: WelcomeCardOpts): Promise<Buffer> {
  const { sock, type, participantJid, participantName, groupName, memberCount, bgBuffer } = opts;
  const isWelcome = type === "welcome";

  const W = 800;
  const H = 300;
  const accent = isWelcome ? "#a000cc" : "#cc0011";
  const accentDim = isWelcome ? "#7b00a8" : "#8b0000";

  // ── Avatar ──────────────────────────────────────────────────────────────────
  const avatarBuf = await fetchCircularAvatar(sock, participantJid);

  // ── Background ──────────────────────────────────────────────────────────────
  let bgLayer: sharp.Sharp;
  if (bgBuffer) {
    bgLayer = sharp(bgBuffer).resize(W, H, { fit: "cover" });
  } else {
    // Procedural SVG gradient background
    const bgSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#050510"/>
          <stop offset="55%" stop-color="#130025"/>
          <stop offset="100%" stop-color="#0a0005"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#bg)"/>
      <circle cx="680" cy="60" r="160" fill="rgba(160,0,204,0.06)"/>
      <circle cx="100" cy="260" r="100" fill="rgba(160,0,26,0.05)"/>
    </svg>`;
    bgLayer = sharp(Buffer.from(bgSvg));
  }

  // ── Overlay SVG (dark scrim + text + glow lines) ────────────────────────────
  const name = esc(participantName.slice(0, 28));
  const group = esc(groupName.slice(0, 36));
  const headline = isWelcome ? "WELCOME" : "GOODBYE";
  const subline = isWelcome
    ? `to ${group}`
    : `from ${group}`;
  const memberLine = memberCount != null
    ? isWelcome
      ? `Member #${memberCount}`
      : `${memberCount} members remaining`
    : "";

  // Glow line: use SVG feGaussianBlur filter applied to a rect stripe
  const overlaySvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="glow" x="-20%" y="-200%" width="140%" height="500%">
        <feGaussianBlur stdDeviation="5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <linearGradient id="topBar" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${accent}"/>
        <stop offset="100%" stop-color="${accentDim}cc"/>
      </linearGradient>
      <linearGradient id="botBar" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${accentDim}55"/>
        <stop offset="100%" stop-color="${accent}33"/>
      </linearGradient>
    </defs>

    <!-- Dark scrim over bg so text reads clearly -->
    <rect width="${W}" height="${H}" fill="rgba(0,0,0,0.52)"/>

    <!-- Top glow line -->
    <rect x="0" y="0" width="${W}" height="4" fill="url(#topBar)" filter="url(#glow)"/>

    <!-- Avatar placeholder circle (avatar image composited separately) -->
    <circle cx="148" cy="150" r="52" fill="${accent}22" stroke="${accent}88" stroke-width="2.5"/>

    <!-- Headline -->
    <text x="230" y="110" font-family="'DejaVu Sans',Arial,Helvetica,sans-serif" font-size="42" font-weight="900"
          fill="${accent}" filter="url(#glow)" letter-spacing="6">${esc(headline)}</text>

    <!-- Name -->
    <text x="230" y="162" font-family="'DejaVu Sans',Georgia,serif" font-size="30" font-weight="700"
          fill="white" paint-order="stroke" stroke="rgba(0,0,0,.7)" stroke-width="4"
          stroke-linejoin="round">${esc(sanitizeForDejaVuSans(name))}</text>

    <!-- Subline -->
    <text x="230" y="200" font-family="'DejaVu Sans',Arial,Helvetica,sans-serif" font-size="17"
          fill="rgba(255,255,255,0.65)">${esc(subline)}</text>

    <!-- Member count -->
    ${memberLine
      ? `<text x="230" y="228" font-family="'DejaVu Sans',Arial,Helvetica,sans-serif" font-size="14"
              fill="${accent}cc">${esc(memberLine)}</text>`
      : ""}

    <!-- Bottom glow line -->
    <rect x="230" y="${H - 26}" width="${W - 250}" height="2" fill="url(#botBar)" filter="url(#glow)"/>

    <!-- Watermark -->
    <text x="${W - 16}" y="${H - 10}" text-anchor="end"
          font-family="'DejaVu Sans',Arial,Helvetica,sans-serif" font-size="11"
          fill="rgba(255,255,255,0.12)" letter-spacing="3">${stripUnrenderableGlyphs("REQUIEM ORDER 反逆")}</text>
  </svg>`;

  // ── Composite: bg → overlay → avatar ────────────────────────────────────────
  const composites: sharp.OverlayOptions[] = [
    { input: Buffer.from(overlaySvg), top: 0, left: 0 },
  ];
  if (avatarBuf) {
    // Centre the circular avatar at (148, 150)
    composites.push({ input: avatarBuf, top: 150 - 48, left: 148 - 48 });
  }

  return bgLayer
    .composite(composites)
    .jpeg({ quality: 88 })
    .toBuffer();
}
