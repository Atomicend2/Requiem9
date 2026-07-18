---
name: AFK sticker download key fix
description: handleAfk used msg.key (the .afk command's own key) for downloadMediaMessage instead of the quoted sticker's key — fix and pattern for future media downloads from quoted messages.
---

# AFK sticker quoted-media download key

## The Rule
When downloading media from a **quoted** message, always build the key from `contextInfo.stanzaId` + `contextInfo.participant`, NOT from `msg.key` (which is the currently-received command message's key).

**Why:** Baileys' `downloadMediaMessage` uses the key to identify which message to fetch/reupload. Using the wrong key causes the download to silently fail or fetch wrong bytes.

**How to apply:**
```typescript
const contextInfo = (msg.message as any)?.extendedTextMessage?.contextInfo;
const quotedKey = {
  remoteJid: from,
  fromMe: false,
  id: contextInfo?.stanzaId || "",
  participant: contextInfo?.participant,
};
await downloadMediaMessage(
  { message: quotedMessage, key: quotedKey } as any,
  "buffer",
  { reuploadRequest: (sock as any).updateMediaMessage } as any
);
```

This is consistent with how converter.ts downloads quoted images/videos for the `.s` command.
