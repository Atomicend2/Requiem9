---
name: cards-loader blocks event loop
description: loadCardsFromRepo() uses synchronous SQLite calls; must run after app.listen() or the port never binds
---

`loadCardsFromRepo()` iterates over ~35k cards using synchronous `better-sqlite3` calls (`.prepare().run()`, `.prepare().get()`). Even though the function is declared `async`, there are no `await` points inside the for-loop, so it runs entirely synchronously and blocks the Node.js event loop for ~2 minutes on 35k cards.

If called before `app.listen()`, the listen callback never fires and the port never opens — causing the Replit workflow health check to time out.

**Fix:** defer the call with `setImmediate()` inside the `app.listen()` callback:

```ts
const server = app.listen(port, "0.0.0.0", async (err) => {
  // port is now bound — safe to kick off blocking work
  setImmediate(() => {
    loadCardsFromRepo().then(...).catch(...);
  });
  // ... rest of startup
});
```

**Why:** `setImmediate` yields to the event loop once, allowing the listen socket to fully register before the synchronous DB loop takes over.

**How to apply:** any time a synchronous-heavy operation needs to run at startup but must not delay the port from binding.
