---
name: Profile card SVG Unicode fonts
description: The profile card SVG renderer (Sharp/librsvg) needs Noto fonts installed system-wide to render fancy Unicode (Mathematical Script) and emoji characters correctly.
---

# Profile card SVG font rendering

## The Rule
The profile card in `economy.ts` uses Sharp to render an SVG overlay. Sharp/librsvg uses system fonts. Without Noto fonts, Mathematical Script Unicode characters (𝓜𝓲𝓴𝓪𝓼𝓪) and emoji (💰🏦) render as codepoint boxes (01D4DC, 01F4B0).

**Why:** Arial/Helvetica don't include these Unicode blocks. Noto fonts were specifically designed to cover all Unicode code points.

**Fix applied:**
- Installed `noto-fonts` and `noto-fonts-color-emoji` via `installSystemDependencies`
- Updated SVG `font-family` in economy.ts to: `'Noto Color Emoji', 'Noto Sans', 'Noto Sans Math', Arial, Helvetica, sans-serif`
- The fallback avatar SVG in the same file also updated from `font-family="Arial"` to `font-family="Noto Sans, Arial"`

**When to apply:** Any time an SVG is rendered server-side with Sharp that needs to display emoji or non-ASCII Unicode from user-provided content.
