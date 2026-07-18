# Requiem9 — Final Build (Jul 2026)

Full, complete project tree — ready to push to GitHub and deploy on Render
as-is. This supersedes every prior checkpoint zip; you don't need to apply
anything on top of this one.

## ⚠️ Read this first — the Render free-tier reality

Your logs showed EVERY command slow, including `.ping` (which does nothing
but reply "pong"). Two separate things were causing this:

1. **Render's free tier spins your service down after ~15 min of no
   traffic** (your hostname literally contains `hibernate`). The first
   request after that has to cold-boot the whole process — reconnect
   MongoDB, re-establish the WhatsApp socket, everything. That's a
   platform behavior, not a code bug, and there's no in-process fix for a
   container that isn't running. Real options: an external uptime-monitor
   ping (imperfect — still a small window), or a paid Render instance
   ($7/mo Starter — this is what actually eliminates it).

2. **A real, separate bug I found and fixed**, proven by two `.dig`
   commands from different users arriving 0.2 seconds apart *both* taking
   several seconds — too close together for cold-start alone to explain.
   Root causes, all fixed in this build:
   - Mongo connection pool was capped at 5 (`maxPoolSize: 5`). Atlas M0's
     real limit is 500 — the cap was based on an overly cautious
     assumption and became a genuine bottleneck once several bots +
     multiple concurrent commands were in flight. Raised to 40.
   - Every single message paid for several DB calls **awaited
     sequentially** before a command handler even started — ban checks,
     group setup, mention resolution, staff lookup, AFK bookkeeping — even
     for something as trivial as `.ping`. Parallelized the independent
     ones, made the fire-and-forget ones (AFK clearing, mention tracking)
     actually fire-and-forget instead of blocking.

Apply both, and ordinary commands should be consistently fast except for
the unavoidable first-request-after-sleep cold start.

## Everything fixed in this build (full list)

**Performance**
- Mongo pool size 5 → 40
- Parallelized independent DB calls on the per-message hot path (ban
  checks, group setup + metadata fetch, mention resolution + staff
  lookup)
- Made AFK-clearing/mention-tracking side effects fire-and-forget instead
  of blocking every message
- Group metadata cache actually used by the code path that was bypassing
  it (was already-built caching that nothing read from)

**Progression / Economy**
- Removed a real leftover chat-XP grant (+5 XP per message) that was
  silently undoing the entire dungeon-only leveling rework
- XP curve rebalanced (steep curve + diminishing returns for over-leveled
  players), dungeon enemy curve retuned to stay winnable at high floors,
  player combat stats now actually scale with level
- Dungeon `.item` potion-spam exploit closed, dungeon reward scaling
  tapered instead of uncapped linear growth
- `.heal` scales with amount healed instead of flat price
- `.work`/`.dig`/`.fish` pay rebalanced so long-cooldown commands
  properly out-earn short-cooldown spam
- All 8 previously-decorative shop items (Lucky Coin, Energy Drink, XP
  Boost, Resurrection Stone, Mana Potion, Strength Elixir, Shield,
  Lockpick) now have real effects; Rope and Bank Upgrade I given real
  value
- `.lb` wording updated to reflect dungeon-only leveling + the level-20
  guild milestone

**Gambling**
- `.cds` wrong-time bug fixed (gambling stored ms, everything else stores
  seconds — this was also the "cooldown error in gamble commands" report)
- `.cds` now lists every command with a real cooldown
- All 9 gambling commands require an explicit bet amount (no more silent
  $100 default)

**Images / rendering**
- Bundled DejaVu Sans + fontconfig so SVG-rendered text (profile cards,
  welcome cards, card-spawn images) works regardless of what fonts the
  host has — fixes boxed-hex-codepoint text
- Emoji inside SVG text replaced with small vector icons (cairo, which
  sharp uses, cannot render color emoji in SVG — confirmed real
  limitation, not fixable by installing a font)
- CJK/Thai/Devanagari/emoji in user-entered names/bios now degrade
  gracefully to `?` instead of corrupting the render — full CJK font
  support would need a 20-27MB font bundle, a real cost on a free-tier
  deploy; documented as a deliberate tradeoff, reconsider if you want it
- Found and fixed a real missing-XML-escape bug on welcome card names
  (any name with `<`, `&`, `"` could break the whole render)

**yt-dlp**
- Added Deno to both deploy configs (yt-dlp needs a JS runtime for
  YouTube's cipher decryption)
- Added an Invidious-based fallback for the "sign in to confirm you're
  not a bot" wall — routes through a public instance so this server's own
  IP/session isn't what's being checked

**Menu / commands**
- `.modcmds` now actually works (was dead code, never wired to the
  dispatcher) — aliased to the existing, already-good staff menu instead
  of shipping a second near-duplicate one
- Confirmed `.restartserv` (process restart), `.git` (deploy info),
  `.servstats` (resource usage) all already exist and work
- Added missing `.item`/`.mentor` entries to `.menu`

**Bugs found via code audit**
- Sticker "cannot be shared" after favoriting — invalid WebP container
- Menu-image bleeding between bots — confirmed already correctly fixed
- Web profile pic/bg not showing + admin search icon missing — root
  cause was the shared auth middleware excluding those exact fields
- GIF/video conversion — bundled ffmpeg-static since production wasn't
  guaranteed to have system ffmpeg
- Skill-points-overwrite bug on level-up (found while fixing XP curve)
- Level-up not cascading through multiple levels in one grant

**Repo hygiene**
- Removed `attached_assets/` (9.2MB — uploaded reference files, log
  dumps, duplicate zips; confirmed nothing in source code uses them)
- Removed committed `dist/` build output (19MB — regenerated on every
  deploy anyway)
- Added `.gitignore` so both stay out going forward

## Still open (lower priority, not blocking a deploy)
- Gambling house edge — explicit review/setting
- Mentorship/duel/quest systems exist (built by a prior Replit pass) —
  reviewed at a high level, not deep-audited line by line yet given quota
- Web bid "bid failed" bug — not yet investigated
- Message formatting (multi-paragraph/newlines collapsing) — not yet
  investigated
- Fancy text formatting — waiting on the reference text you mentioned
  sending
- Registration flow: skip `.reg` for web-registered users
- OTP multi-bot-assignment bug
- Signup recovery key + admin password reset from Admin page
- Wishlist notifications
- UNO hand delivery flow (DM vs secure web view) + `.unohand`
- Card spawn: pure time-based pacing spread across the day (per-group
  spawn count target ~7-8/day)

## Deploy checklist
1. Push this tree to your GitHub repo (replacing what's there)
2. Confirm `MONGODB_URI` and other secrets are still set in Render's
   environment variables (not stored in this repo)
3. Render should pick up `render.yaml` automatically — it now also
   installs Deno during build (for yt-dlp) and copies the bundled fonts
4. First request after deploy will still be a cold start (free tier) —
   that's expected, not a regression
