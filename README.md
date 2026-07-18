# 反逆 Requiem Order — WhatsApp Community Bot + Web Dashboard

A full-stack community platform: WhatsApp bot (Baileys) + React web dashboard + Express API, deployable as a single Render service.

---

## Quick Deploy to Render

1. **Push this repo to GitHub** (or GitLab).
2. Go to [render.com](https://render.com) → **New Web Service** → connect your repo.
3. Render will auto-detect `render.yaml`. Set these **Environment Variables** in the Render dashboard:

| Variable | Required | Description |
|---|---|---|
| `BOT_PHONE_NUMBER` | Yes | Bot's WhatsApp number (digits only, e.g. `2348012345678`) |
| `BOT_OWNER_PHONE` | Yes | Your phone number (digits only) |
| `OWNER_NUMBERS` | Optional | Comma-separated extra owner numbers |
| `BOT_OWNER_LID` | Optional | WhatsApp internal LID (digits only) |
| `OPENROUTER_API_KEY` | Optional | For Echidna AI (OpenRouter key) |
| `JWT_SECRET` | Yes | Random secret for web sessions (any long random string) |
| `ADMIN_PASSWORD` | Yes | Password for the `/admin` web panel (default: `Flowers`) |
| `WEBSITE_URL` | Optional | Your public URL, e.g. `https://requiem-order.onrender.com` |
| `DATA_DIR` | Auto-set | Set to `/data` by render.yaml (persistent disk) |
| `PORT` | Auto-set | Set to `10000` by render.yaml |

4. **Add a Persistent Disk** in Render dashboard:
   - Mount path: `/data`
   - Size: 1GB (free tier)

5. Click **Deploy**. After the build (~3 min), visit your URL.

---

## Pairing the Bot

1. Go to `https://your-url.onrender.com/admin`
2. Log in with your `ADMIN_PASSWORD`
3. Under **Bot Management**, enter the bot phone number and click **Start Bot**
4. Copy the **Pairing Code** shown
5. On WhatsApp: Linked Devices → Link a Device → Enter code

---

## Bot Commands (overview)

| Command | Description |
|---|---|
| `.help` | Shows all commands |
| `.daily` | Claim daily coins |
| `.bal` | Check balance |
| `.collection` | View your cards |
| `.pullcards` | Import all cards from Shoob.gg (mod+) |
| `.synccards` | Incremental Shoob sync (mod+) |
| `.cardlogs` | View sync history (mod+) |
| `.echidna on/off` | Toggle Echidna AI in group |
| `.mem` | See what Echidna knows about you |

---

## Architecture

```
Tenkyu/
├── artifacts/
│   ├── api-server/          ← Express + WhatsApp bot (Baileys)
│   │   └── src/
│   │       ├── bot/         ← All bot logic
│   │       │   ├── commands/    ← .help, .cards, .echidna, etc.
│   │       │   ├── handlers/    ← message, cardspawn, shoob-sync
│   │       │   └── db/          ← SQLite (better-sqlite3)
│   │       └── routes/v1/   ← REST API for web dashboard
│   └── shadow-garden/       ← React frontend (Vite + Tailwind)
│       └── src/pages/       ← home, cards, profile, admin, shop...
├── lib/
│   └── api-client-react/    ← Auto-generated API hooks (React Query)
└── render.yaml              ← One-click Render deployment
```

---

## Local Development

```bash
# Install dependencies
pnpm install

# Start API server (port 3000) + bot
cd artifacts/api-server && pnpm run dev

# Start frontend dev server (port 5173, proxies /api to 3000)
cd artifacts/shadow-garden && pnpm run dev
```

Set `DATA_DIR` to a local folder or leave unset (defaults to `./data`).

---

## Card System — Shoob.gg Integration

Cards are imported from [Shoob.gg](https://shoob.gg) public API:

- **`.pullcards`** — full import of all Shoob cards with image download
- **`.synccards`** — only imports new cards not yet in database
- **`.cardlogs`** — shows last 10 sync run statistics

From the web admin panel (`/admin` → **Import Cards**):
- **By Anime / By Tier** — targeted import of specific cards
- **Incremental Sync** — same as `.synccards`
- **Full Import** — same as `.pullcards`

Cards are stored as BLOBs in SQLite with tier normalisation (T1–T6, TS, TX, TZ).

---

## Echidna AI

Echidna is the Witch of Greed from Re:Zero, operating as a companion AI in the bot. She uses OpenRouter (GPT-4o) and maintains per-user affinity, mood, and memory across conversations.

- Set `OPENROUTER_API_KEY` in env to enable
- Use `.mem` to see what she knows about you
- Use `.comp` to see affinity stats
- Toggle auto-reply in a group: `.botreply echidna on`
