---
name: MongoDB migration complete
description: Full SQLite→MongoDB migration status and key patterns to carry forward.
---

All SQLite (`better-sqlite3` / `getDb()`) calls have been replaced with MongoDB `col(name)` throughout the entire codebase. Build passes cleanly.

**Key invariants:**
- `getDb()` in `database.ts` is a `never`-returning stub — calling it throws at runtime. Any new code must use `col()` from `mongo.ts`.
- `col(name)` returns a `Collection<Document>` — always use `await` on all MongoDB operations.
- All ~80 query functions in `queries.ts` are `async` — every call site needs `await`.
- `getStaff`, `getMentionName`, `getUserCards`, `giveCard`, `deleteUserCardByCopyId`, `updateGroup`, `setBotSetting`, `getBotSetting`, `deleteBotSetting` are all async.
- `isModOrAbove` in shoob-sync.ts and echidna.ts is async — await it before using as boolean.

**Server startup failure (credentials, not code):**
- Build is clean; server exits immediately with `MongoServerError: bad auth : Authentication failed.`
- This means `MONGODB_URI` secret in Replit Secrets has wrong username/password for Atlas.
- Fix: Go to Atlas → Database Access, verify/reset the user's password, update Replit Secrets → `MONGODB_URI`.
- Also check Atlas → Network Access has `0.0.0.0/0` in the IP allowlist.
- Special chars in password must be URL-encoded (e.g. `#` → `%23`, `@` → `%40`).

**Why:**
The server was designed to exit on MongoDB connect failure (intentional — no SQLite fallback exists anymore).
