---
name: Daily and weekly quest boards
description: Persistent progress-tracked quest objectives separate from the random .quest command.
---

## Commands
- `.quests` — daily quest board (NOT `.daily` — that's the economy daily coin reward)
- `.quests claim` — claim all completed daily quests
- `.weekly` — weekly quest board
- `.weekly claim` — claim all completed weekly quests

**Why `.quests` not `.daily`:** `.daily` is already registered in handleEconomy for the daily login coin reward. `.quests` (plural) is distinct from `.quest` (singular = do a random quest action).

## Daily Quest Definitions (reset at midnight UTC)
| Key | Label | Target | Reward |
|---|---|---|---|
| quests | Complete 3 quests | 3 | $2,000 + 2 SP + 200 XP |
| dungeons | Win 2 dungeon battles | 2 | $5,000 + 3 SP + 300 XP |
| xp | Earn 500 XP | 500 | $3,000 + 2 SP |

## Weekly Quest Definitions (reset on Monday UTC)
| Key | Label | Target | Reward |
|---|---|---|---|
| quests | Complete 15 quests | 15 | $15,000 + 10 SP + 1000 XP |
| dungeons | Win 5 dungeon battles | 5 | $20,000 + 8 SP + Dragon Scale |
| pvp_wins | Win 5 PvP duels | 5 | $10,000 + 8 SP + 600 XP |
| raids | Complete 1 raid | 1 | $12,000 + 6 SP + 500 XP |
| mentor_sessions | Guide 5 apprentice sessions | 5 | $8,000 + 5 SP + 400 XP |

## Storage
- `daily_quests` collection: user_id, date (YYYY-MM-DD UTC), progress (nested doc), claimed (array of keys)
- `weekly_quests` collection: user_id, week (YYYY-MM-DD of Monday), progress, claimed

## Progress Hook Sites in rpg.ts
- After quest success → dailyProgress("quests"), dailyProgress("xp", xp), weeklyProgress("quests")
- After dungeon victory → dailyProgress("dungeons"), weeklyProgress("dungeons")
- After raid success → weeklyProgress("raids")
- After PvP win → weeklyProgress("pvp_wins") [in pvp.ts endPvpBattle]
- After mentor session → weeklyProgress("mentor_sessions") [in mentorship.ts]
