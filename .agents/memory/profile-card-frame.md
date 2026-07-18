---
name: Profile card frame compositing order
description: Frame must be composited BEHIND avatar (not on top) for it to show as an outer border ring.
---

**Rule:** To make a frame appear as a decorative border ring around the profile picture:
1. Frame size must be larger than avatar (e.g. avatar=186px, frame=238px → 26px border each side)
2. Composite order: background → frame → avatar → SVG overlay
3. Both frame and avatar must be centered at the same coordinates

**Why:** If the frame is composited AFTER the avatar (on top), it covers the center of the avatar face. This makes the card look wrong. The frame image itself is typically a ring PNG with transparent center — it must sit underneath the avatar.

**How to apply:** In sharp composite calls: push frame first, then circularAvatar, then SVG overlay.
