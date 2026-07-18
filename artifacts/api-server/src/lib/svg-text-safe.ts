/**
 * svg-text-safe.ts
 *
 * Two narrow, targeted fixes for text rendered through sharp's SVG->PNG
 * pipeline (profile cards, welcome cards, card-spawn images, lottery
 * cards) — NOT for anything sent as a plain WhatsApp chat message, which
 * renders through WhatsApp's own font stack and is unaffected by any of
 * this.
 *
 * 1. EMOJI: sharp renders SVG text via libvips -> librsvg -> pango ->
 *    cairo. Cairo's SVG backend does not support color emoji fonts —
 *    even with Noto Color Emoji installed, the glyph is silently
 *    dropped (or, with no fallback font at all, drawn as a boxed
 *    "tofu" hex codepoint — the exact symptom reported: wallet/bank
 *    labels showing as literal "01F4B0" boxes instead of 💰). The only
 *    reliable fix is to not ask cairo to draw a color emoji glyph at
 *    all — swap it for a small flat-color inline SVG shape instead.
 *
 * 2. CJK BRANDING TEXT: "REQUIEM ORDER 反逆" appears in two SVG
 *    templates. A CJK-capable font (Noto Sans/Serif CJK) is 16-27MB per
 *    weight — far too heavy to bundle just to render two decorative
 *    kanji that aren't meant to be read as functional text. Bundled
 *    DejaVu Sans (src/assets/fonts) doesn't cover CJK, so instead of
 *    shipping a 20MB+ font for cosmetic branding glyphs, this strips
 *    them from the SVG-rendered versions — the readable "REQUIEM ORDER"
 *    part still renders correctly either way.
 */

/** Maps an emoji to a small flat inline SVG snippet drawn at (x, y) with
 *  the given size (roughly the emoji's cap-height). Add more here as
 *  needed — this only needs to cover emoji actually used inside <text>
 *  in the SVG-rendering code paths (not plain WhatsApp chat strings). */
export function emojiIconSvg(emoji: string, x: number, y: number, size: number, color = "currentColor"): string {
  const s = size;
  switch (emoji) {
    case "💰": // wallet/money — coin stack
      return `<g transform="translate(${x},${y - s * 0.75})">
        <ellipse cx="${s*0.5}" cy="${s*0.75}" rx="${s*0.5}" ry="${s*0.18}" fill="${color}"/>
        <rect x="0" y="${s*0.35}" width="${s}" height="${s*0.4}" fill="${color}"/>
        <ellipse cx="${s*0.5}" cy="${s*0.35}" rx="${s*0.5}" ry="${s*0.18}" fill="${color}"/>
        <circle cx="${s*0.5}" cy="${s*0.35}" r="${s*0.14}" fill="#00000030"/>
      </g>`;
    case "🏦": // bank — small columned building
      return `<g transform="translate(${x},${y - s * 0.8})">
        <polygon points="${s*0.5},0 ${s},${s*0.32} 0,${s*0.32}" fill="${color}"/>
        <rect x="${s*0.08}" y="${s*0.4}" width="${s*0.14}" height="${s*0.42}" fill="${color}"/>
        <rect x="${s*0.34}" y="${s*0.4}" width="${s*0.14}" height="${s*0.42}" fill="${color}"/>
        <rect x="${s*0.6}" y="${s*0.4}" width="${s*0.14}" height="${s*0.42}" fill="${color}"/>
        <rect x="${s*0.86}" y="${s*0.4}" width="${s*0.14}" height="${s*0.42}" fill="${color}"/>
        <rect x="0" y="${s*0.86}" width="${s}" height="${s*0.12}" fill="${color}"/>
      </g>`;
    case "❤️": // heart — HP
      return `<path transform="translate(${x},${y - s * 0.8})" d="M${s*0.5},${s*0.9} C${-s*0.1},${s*0.45} ${s*0.05},0 ${s*0.5},${s*0.3} C${s*0.95},0 ${s*1.1},${s*0.45} ${s*0.5},${s*0.9} Z" fill="${color}"/>`;
    case "⚔️": // crossed swords — attack
      return `<g transform="translate(${x},${y - s * 0.8})" stroke="${color}" stroke-width="${s*0.12}" stroke-linecap="round">
        <line x1="0" y1="${s*0.9}" x2="${s}" y2="0"/>
        <line x1="0" y1="0" x2="${s}" y2="${s*0.9}"/>
      </g>`;
    case "🛡️": // shield — defense
      return `<path transform="translate(${x},${y - s * 0.85})" d="M${s*0.5},0 L${s},${s*0.2} L${s},${s*0.5} C${s},${s*0.8} ${s*0.5},${s} ${s*0.5},${s} C${s*0.5},${s} 0,${s*0.8} 0,${s*0.5} L0,${s*0.2} Z" fill="${color}"/>`;
    case "💨": // speed
      return `<g transform="translate(${x},${y - s * 0.55})" stroke="${color}" stroke-width="${s*0.1}" stroke-linecap="round" fill="none">
        <line x1="0" y1="0" x2="${s*0.75}" y2="0"/>
        <line x1="${s*0.15}" y1="${s*0.3}" x2="${s}" y2="${s*0.3}"/>
        <line x1="0" y1="${s*0.6}" x2="${s*0.6}" y2="${s*0.6}"/>
      </g>`;
    case "⭐": // star — rank/rarity
      return `<polygon transform="translate(${x},${y - s * 0.85})" points="${pointsForStar(s)}" fill="${color}"/>`;
    case "🔫": // steal
      return `<g transform="translate(${x},${y - s * 0.5})" fill="${color}">
        <rect x="0" y="${s*0.15}" width="${s*0.7}" height="${s*0.22}" rx="${s*0.05}"/>
        <rect x="${s*0.45}" y="${s*0.32}" width="${s*0.18}" height="${s*0.35}"/>
      </g>`;
    default:
      // Unknown emoji — omit rather than risk a tofu glyph. Callers should
      // add a case above for anything new they need drawn.
      return "";
  }
}

function pointsForStar(size: number): string {
  const cx = size / 2, cy = size / 2, outerR = size / 2, innerR = size / 4.5;
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`);
  }
  return points.join(" ");
}

/**
 * Strips glyphs that the bundled font (DejaVu Sans) can't render and
 * that aren't worth a 20MB+ CJK font bundle for — currently just the
 * "反逆" decorative branding suffix used in a couple of hardcoded
 * template strings. Safe to run on any string destined for an SVG
 * <text> node; a no-op for strings that don't contain it.
 */
export function stripUnrenderableGlyphs(text: string): string {
  return text.replace(/\s*反逆/g, "").trimEnd();
}

// Unicode ranges DejaVu Sans (bundled — see src/assets/fonts) does NOT
// cover, verified against its actual cmap: CJK (Chinese/Japanese/Korean),
// Thai, Devanagari (Hindi/Marathi/etc), and all emoji/symbol blocks. It
// DOES cover Latin (incl. accented — "Más"), Cyrillic, Greek, Arabic, and
// Hebrew, so those are left untouched.
const UNRENDERABLE_RANGES: Array<[number, number]> = [
  [0x0E00, 0x0E7F], // Thai
  [0x0900, 0x097F], // Devanagari
  [0x2E80, 0x2FDF], // CJK Radicals / Kangxi Radicals
  [0x3040, 0x30FF], // Hiragana + Katakana
  [0x3100, 0x312F], // Bopomofo
  [0x3400, 0x4DBF], // CJK Extension A
  [0x4E00, 0x9FFF], // CJK Unified Ideographs (the big one — most Kanji/Hanzi/Hanja)
  [0xAC00, 0xD7AF], // Hangul Syllables
  [0xF900, 0xFAFF], // CJK Compatibility Ideographs
  [0x1F000, 0x1FFFF], // Emoji + misc symbol/pictograph blocks
  [0x2600, 0x27BF],   // Misc symbols / dingbats (many emoji live here too)
];

function isUnrenderableCodePoint(cp: number): boolean {
  return UNRENDERABLE_RANGES.some(([start, end]) => cp >= start && cp <= end);
}

/**
 * General-purpose sanitizer for ANY user-entered text (display names,
 * bios) headed into an SVG <text> node — profile cards, welcome/goodbye
 * cards. Unlike stripUnrenderableGlyphs (which removes a specific known
 * decorative string), this scans arbitrary text character-by-character
 * and replaces anything DejaVu Sans can't draw with "?" — so a name
 * containing Kanji, Thai, Devanagari, or emoji degrades to a readable
 * "Sh?ta" instead of either a tofu-box wall or (if the surrounding text
 * escaping were ever imperfect elsewhere) a corrupted render. This is a
 * pragmatic tradeoff: a full CJK font is 20-27MB, a real cost on a
 * free-tier deploy's disk/memory budget, for a minority of names.
 */
export function sanitizeForDejaVuSans(text: string): string {
  if (!text) return text;
  let result = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    result += isUnrenderableCodePoint(cp) ? "?" : ch;
  }
  return result;
}
