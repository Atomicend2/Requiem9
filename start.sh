#!/bin/bash
set -e

# ── Ensure yt-dlp binary is available for the .play command ──────────────────
YTDLP_BIN="artifacts/api-server/bin/yt-dlp"
if ! command -v yt-dlp &>/dev/null && [ ! -f "$YTDLP_BIN" ]; then
  echo "Downloading yt-dlp binary..."
  mkdir -p "$(dirname "$YTDLP_BIN")"
  curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o "$YTDLP_BIN" && chmod +x "$YTDLP_BIN" && echo "yt-dlp ready" || echo "yt-dlp download failed (non-fatal)"
fi

# Install dependencies only if needed
if [ ! -d "node_modules/.pnpm" ]; then
  echo "Installing dependencies..."
  pnpm install
fi

# Always rebuild frontend so source changes are picked up
echo "Building frontend..."
cd artifacts/shadow-garden
node ./node_modules/vite/bin/vite.js build --config vite.config.ts
cd ../..

# Always rebuild backend (copies new frontend into dist/public)
echo "Building backend..."
cd artifacts/api-server
node ./build.mjs
cd ../..

echo "Starting server..."
cd artifacts/api-server
node ./dist/index.mjs
