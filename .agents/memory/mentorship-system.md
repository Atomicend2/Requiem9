---
name: Mentorship system
description: Mentor/apprentice relationship system; how bonuses flow and where they're triggered.
---

## Commands
- `.mentor` — show your mentorship status
- `.mentor @user` — offer to mentor someone
- `.mentor accept` — accept a pending offer (5min expiry)
- `.mentor leave` — end the relationship
- `.mentors` — list all mentorships in this group

## Eligibility
- Mentor must be Level 8+ AND have chosen a class
- Mentor must be at least 5 levels ABOVE the apprentice
- Max 3 apprentices per mentor, 1 mentor per user

## Bonus Triggers (applyMentorshipBonus in mentorship.ts)
Called from rpg.ts after:
1. Quest success → mentor +1 SP +50 XP; apprentice +15% XP on that quest
2. Dungeon victory → mentor +1 SP +80 XP
3. Levelup (future hook available) → mentor gets 10% of XP

## Weekly Quest Integration
Every quest/dungeon session where mentor earns bonus → `incrementWeeklyProgress(mentorId, "mentor_sessions")`. This feeds the "Guide 5 apprentice sessions" weekly quest.

## Storage
- `mentorships` collection: mentor_id, apprentice_id, group_id, quests_guided, xp_shared, sp_shared
- `mentor_offers` collection: expires_at TTL for pending offers

## Files
- `src/bot/commands/mentorship.ts` — all command logic + applyMentorshipBonus()
- `src/bot/commands/rpg.ts` — calls applyMentorshipBonus after quest/dungeon success
