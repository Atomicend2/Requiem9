---
name: PvP duel system
description: Turn-based player-vs-player combat added to the bot; key design decisions for routing, conflict resolution, and reward structure.
---

## Commands
- `.duel @user` — challenge a player (NOT `.startbattle` — that's already used by mini-games)
- `.accept` / `.decline` — conditionally routed in message.ts: `pendingPvpChallenges.has(ctx.sender) ? handleRpg : handleCards`

## Routing
`accept`/`decline` are shared with card trade acceptance. message.ts checks `pendingPvpChallenges.has(ctx.sender)` (imported from pvp.ts) to decide: PvP if pending, cards otherwise.

## Files
- `src/bot/commands/pvp.ts` — all PvP logic (challenge, accept, moves, rewards)
- `src/bot/handlers/message.ts` — imports `pendingPvpChallenges` from pvp.ts; conditional routing for accept/decline
- `src/bot/commands/rpg.ts` — routes `.duel`, `.accept`, `.decline` to pvp.ts handlers; PvP checked BEFORE dungeon in DUNGEON_MOVES block

## Mechanics
- Both players use level-scaled stats (levelStatMultiplier applied)
- Moves: attack, heavy, defend, special, flee (same vocab as dungeon)
- Turn-based, challenger goes first; both see HP bars after each move
- Cooldown: 30 minutes (stored as last_pvp on rpg_characters)
- Win: +3 SP, +200 XP, +$2,000; Lose: +1 SP, +50 XP, +$500 consolation
- Win increments weekly_quests progress key "pvp_wins"

**Why `.duel` not `.startbattle`:** `.startbattle` was already registered in handleGames (mini-games); `.duel` is unambiguous.
**Why shared accept/decline:** Better UX — one natural word, context-aware routing.
