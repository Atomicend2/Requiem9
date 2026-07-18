/**
 * font-setup.ts
 *
 * Points fontconfig at the bundled fonts/ directory (DejaVu Sans +
 * fonts.conf, shipped in src/assets/fonts) so every SVG->PNG render via
 * sharp works identically whether or not the host OS has any fonts
 * installed. See fonts.conf for the full rationale — this fixes the
 * "boxed hex codepoints instead of text" bug in profile cards, welcome
 * cards, and card-spawn images.
 *
 * Import this ONCE, as early as possible (top of index.ts, before any
 * other module that might render an SVG at import time), so the
 * environment variable is set before fontconfig/librsvg initializes.
 * Setting it later (e.g. inside a request handler) is too late — some
 * platforms cache the fontconfig instance in the underlying native
 * library at first use.
 *
 * PATH NOTE: this file is bundled into dist/index.mjs by esbuild (single
 * entry point, bundle: true — see build.mjs), so `import.meta.url` at
 * runtime resolves to dist/index.mjs's location, not this source file's.
 * Every other bundled asset in this codebase (default_bg.jpg etc.) is
 * copied by build.mjs to `<artifactDir>/assets/` and resolved from the
 * built file via `../assets/...` — this follows that exact same
 * convention so it survives the bundling step correctly.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const fontsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/fonts");
const fontsConfPath = path.join(fontsDir, "fonts.conf");

// Only override if not already set — respects an operator's own
// FONTCONFIG_PATH if they've deliberately configured one.
if (!process.env.FONTCONFIG_PATH) {
  process.env.FONTCONFIG_PATH = fontsDir;
}

export { fontsDir, fontsConfPath };
