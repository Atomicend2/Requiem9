---
name: Welcome/leave auto-enable bug
description: setwelcome and setleave commands must also set the welcome/leave="on" flag in the same updateGroup call.
---

**Rule:** When a user sets a custom welcome or leave message with `.setwelcome`/`.setleave`, the handler must atomically set both the message AND the enabled flag (`welcome:"on"` / `leave:"on"`) in a single `updateGroup()` call.

**Why:** The bot separates "set message" from "toggle on/off" into two commands. Users naturally expect `.setwelcome <msg>` to be sufficient. If they only run the message command, `freshGroup.welcome !== "on"` and the event handler silently does nothing — making it look like the event system is broken when it's actually a missing flag.

**How to apply:** Always check both setwelcome and setleave handlers. Fix: `updateGroup(from, { welcome_msg: msg_text, welcome: "on" })`.
