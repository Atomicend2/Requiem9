---
name: Bot build & workflow
description: How to build the frontend + backend and start the app correctly in this monorepo.
---

## Build order (critical)

1. **Frontend first** — from `artifacts/shadow-garden`:
   ```
   node ./node_modules/vite/bin/vite.js build --config vite.config.ts
   ```
   `pnpm run build` and `pnpm exec vite build` do NOT work (vite not in PATH at workspace level).

2. **Backend second** — from `artifacts/api-server`:
   ```
   node ./build.mjs
   ```
   This runs esbuild for the backend AND copies `artifacts/shadow-garden/dist/public` into `artifacts/api-server/dist/public`. It does NOT run Vite itself.

**Why:** `build.mjs` only copies a pre-existing frontend dist; it never invokes Vite. If you skip step 1, the old stale bundle is copied and frontend source changes are silently lost.

## Stale bundle trap (seen in production)

`start.sh` previously had `if [ ! -d "dist/public" ]` guards that skipped rebuilds when dist already existed. This caused frontend source edits to be invisible after restart. The guards have been removed — both frontend and backend now always rebuild on `bash start.sh`.

## Workflow command

Workflow (`Start application`) runs: `bash start.sh`
- Do NOT change it to `pnpm run dev` — that triggers a Vite dev server which shadow-garden's config does not support in this setup.

## Other notes

- esbuild via `build.mjs` (not tsc)
- `mongodb` must be in the `external` array in `build.mjs`
- `queries.ts` `getRpg` already exists at ~line 712 — check before adding new exports to avoid duplicate build errors
