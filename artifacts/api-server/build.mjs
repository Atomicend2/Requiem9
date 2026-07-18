import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { copyFile, rm, cp } from "node:fs/promises";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "ffmpeg-static",
      "mongodb",
      "@whiskeysockets/baileys",
      "@hapi/boom",
      "jimp",
      "qrcode",
      "play-dl",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  // Copy menu-image.jpg — this file is optional (admins upload a custom one via the web UI).
  // If it has not been committed to the repo, skip it gracefully so the build doesn't fail.
  // At runtime the bot falls back to the default assets or prompts the admin to upload one.
  const menuImgSrc = path.resolve(artifactDir, "src/bot/menu-image.jpg");
  const menuImgDst = path.resolve(distDir, "menu-image.jpg");
  if (existsSync(menuImgSrc)) {
    await copyFile(menuImgSrc, menuImgDst);
    console.log("menu-image.jpg copied to dist.");
  } else {
    // Fallback: copy the default profile picture as a placeholder so any
    // code that reads dist/menu-image.jpg at startup still finds a valid image.
    const fallbackSrc = path.resolve(artifactDir, "src/bot/assets/default_pp.jpg");
    if (existsSync(fallbackSrc)) {
      await copyFile(fallbackSrc, menuImgDst);
      console.warn("src/bot/menu-image.jpg not found — using default_pp.jpg as placeholder. Upload a real menu image via the web dashboard.");
    } else {
      console.warn("src/bot/menu-image.jpg not found and no fallback available — skipping. Upload a menu image via the web dashboard.");
    }
  }

  // Copy default assets (default_bg.jpg, default_pp.jpg) so they are available at runtime.
  // The code resolves: path.resolve(import.meta.url, "../../assets/...") from dist/index.mjs
  // which evaluates to <artifactDir>/assets/ — so we copy there, not inside dist/.
  const assetsSrc = path.resolve(artifactDir, "src/bot/assets");
  const assetsDst = path.resolve(artifactDir, "assets");
  await cp(assetsSrc, assetsDst, { recursive: true });
  console.log("Default assets copied to", assetsDst);

  // Copy bundled fonts (DejaVu Sans + fonts.conf) so SVG->PNG rendering
  // (profile cards, welcome cards, card-spawn images) works identically
  // regardless of what fonts the host OS has installed — see
  // src/font-setup.ts and src/assets/fonts/fonts.conf for why this exists.
  // font-setup.ts resolves this the same way as the assets above:
  // path.resolve(import.meta.url, "../assets/fonts") from dist/index.mjs.
  const fontsSrc = path.resolve(artifactDir, "src/assets/fonts");
  const fontsDst = path.resolve(artifactDir, "assets/fonts");
  await cp(fontsSrc, fontsDst, { recursive: true });
  console.log("Bundled fonts copied to", fontsDst);

  const frontendSrc = path.resolve(artifactDir, "../../artifacts/shadow-garden/dist/public");
  const frontendDist = path.resolve(distDir, "public");

  if (existsSync(frontendSrc)) {
    console.log("Copying frontend build to dist/public...");
    await cp(frontendSrc, frontendDist, { recursive: true });
    console.log("Frontend copied successfully.");
  } else {
    console.warn("Frontend build not found at", frontendSrc, "- skipping copy. Run shadow-garden build first.");
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
