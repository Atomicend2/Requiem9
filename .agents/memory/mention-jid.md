---
name: WhatsApp mention JID requirement
description: For tappable blue @mentions on WhatsApp, the phone JID must be in the mentions array AND @number must be in the text.
---

**Rule:** WhatsApp only renders a tappable blue mention when BOTH conditions are met:
1. The text contains `@phonenumber` (e.g. `@2348144550593`)
2. The `mentions` array in the message content includes the full JID (e.g. `2348144550593@s.whatsapp.net`)

**Why:** mentionTag(jid) produces `@number` in text (correct), but if `sendText` is called without passing the JID in the mentions array, WhatsApp shows it as plain gray `@number` text — not a clickable mention.

**How to apply:** The sendText function in connection.ts now auto-detects `@\d{7,15}` patterns and adds them as `phone@s.whatsapp.net` JIDs in the mentions array automatically. No manual passing needed for most cases.
