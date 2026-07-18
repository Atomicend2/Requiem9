---
name: GIF cards need ffmpeg conversion for WhatsApp
description: WhatsApp does not support GIF natively. GIF card URLs must be downloaded and converted to MP4 via ffmpeg before sending.
---

**Rule:** For VIDEO_TIERS card spawning:
- `has_webm=true` → WebM URL → send via `{ video: { url } }` directly (Baileys handles it)
- `has_webm=false` → URL may return GIF → download buffer → ensureMp4() → send as `{ video: mp4Buffer, gifPlayback: true, mimetype: "video/mp4" }`
- `image_data` blob → always buffer → ensureMp4() → send as buffer

**Why:** Sending `{ video: { url: gifUrl }, mimetype: "video/mp4" }` lies about the mime type and WhatsApp won't play it. GIF must actually be transcoded to H.264 MP4.

**How to apply:** Check `card.has_webm` before deciding whether to stream URL or download+convert.
