/**
 * identity.ts — Single source of truth for WhatsApp identity resolution.
 *
 * The Rule (tattoo it on your code):
 *   SAVE with plain phone number  →  always extractPhone(jid)
 *   READ from DB                  →  WHERE id = plainPhone
 *   SEND messages                 →  use the original JID (never alter it)
 *
 * WhatsApp gives us two name-tags per user:
 *   JID  → 2547xxxxxxxx@s.whatsapp.net  (phone-based, used for sending)
 *   LID  → 101014040526896@lid          (internal WA identifier)
 *
 * Both represent the same person. We always store the plain phone number
 * as the DB key so the bot and the web site see ONE row, never two.
 */

/**
 * Extract the plain phone number from any WhatsApp JID.
 *
 * Handles:
 *   2547xxxxxxxx@s.whatsapp.net  →  "2547xxxxxxxx"
 *   2547xxxxxxxx:3@s.whatsapp.net (device JID) →  "2547xxxxxxxx"
 *   101014040526896@lid           →  "101014040526896"  (LID number only)
 *   2547xxxxxxxx (bare)           →  "2547xxxxxxxx"
 */
export function extractPhone(jid: string): string {
  if (!jid) return "";
  // Strip @server suffix then strip :device suffix
  return jid.split("@")[0].split(":")[0].replace(/\D/g, "") || jid.split("@")[0];
}

/**
 * True when a JID is a LID (101xxx@lid).
 * LIDs look like very large numbers (>15 digits) at @lid server.
 */
export function isLidJid(jid: string): boolean {
  return typeof jid === "string" && jid.endsWith("@lid");
}

/**
 * Convert a plain phone or JID to the standard sendable JID.
 * Always use this when calling sock.sendMessage — never send to @lid.
 *
 * Example: toSendJid("2547xxxxxxxx") → "2547xxxxxxxx@s.whatsapp.net"
 */
export function toSendJid(phoneOrJid: string): string {
  const phone = extractPhone(phoneOrJid);
  return `${phone}@s.whatsapp.net`;
}

/**
 * Attempt to resolve a @lid JID to a real @s.whatsapp.net JID using
 * the group participants list returned by sock.groupMetadata().
 *
 * Returns the resolved JID if found, or the original lid JID unchanged.
 */
export function resolveLidFromParticipants(
  lidJid: string,
  participants: Array<{ id?: string; lid?: string }>
): string {
  for (const p of participants) {
    if (p.id === lidJid || p.lid === lidJid) {
      const real = [p.id, p.lid].find((j) => j?.endsWith("@s.whatsapp.net"));
      if (real) return real;
    }
  }
  return lidJid; // could not resolve — return as-is
}

/**
 * Resolve any JID — including @lid — using group metadata participants.
 * Non-LID JIDs pass through unchanged. @lid JIDs are resolved to
 * @s.whatsapp.net using the participant list if available.
 *
 * Use this everywhere you read mentionedJid[0] before passing the JID
 * to sock.groupParticipantsUpdate(), DB queries, or display text.
 */
/**
 * Resolve any JID — including @lid — using group metadata participants,
 * with a database fallback for when the group metadata doesn't expose a
 * LID→phone mapping for that participant (this happens routinely on newer
 * WhatsApp clients: some group members only ever appear as @lid in the
 * participant list, with no @s.whatsapp.net counterpart visible to the
 * bot at all).
 *
 * This is the ONLY correct way to resolve a mentioned JID before using it
 * for money transfers, DB lookups, or anything else that identifies a
 * person. The synchronous, metadata-only version silently returned the
 * unresolved @lid JID when it couldn't find a match — every downstream
 * caller (ensureUser, updateUser, etc.) then keyed a brand-new account
 * under the raw LID number instead of the person's real phone-keyed
 * account. That's how ".donate @someone 500" could report success while
 * the money vanished into a ghost account the tagged person could never
 * see or access — no error was ever thrown, it just silently created and
 * credited the wrong row.
 *
 * Any command that identifies a tagged/mentioned user for something that
 * touches money, roles, cards, or any other persistent per-user data MUST
 * use this async version (or ctx.resolvedMentions[0] — see message.ts,
 * which now pre-resolves every mention through this same function) rather
 * than the old resolveMentionedJid, which is kept only for truly
 * best-effort, non-critical display purposes.
 */
export async function resolveMentionedJidAsync(
  jid: string,
  groupMeta: { participants?: Array<{ id?: string; lid?: string }> } | null | undefined,
  getUserByLid: (lid: string) => Promise<{ _id?: string; id?: string; phone?: string } | null>
): Promise<string> {
  if (!jid) return jid;
  if (!jid.endsWith("@lid")) return jid; // already a real JID, no-op

  // Try group metadata first — fast, no DB round-trip.
  const participants = groupMeta?.participants || [];
  const viaMetadata = resolveLidFromParticipants(jid, participants);
  if (viaMetadata !== jid) return viaMetadata; // actually resolved to a real JID

  // Metadata didn't have it — fall back to the DB. Anyone who has ever
  // run .reg/.verify has their LID recorded on their user row, independent
  // of what any single group's metadata happens to expose.
  const lidNum = extractPhone(jid);
  const dbUser = await getUserByLid(lidNum);
  if (dbUser) {
    const phone = dbUser.phone || dbUser._id || dbUser.id;
    if (phone) return toSendJid(String(phone));
  }

  // Genuinely unresolvable — no metadata match, no linked account. Return
  // the original @lid JID; callers should treat this as "could not
  // identify this user" rather than silently proceeding, since proceeding
  // is exactly what created ghost accounts before.
  return jid;
}

export function resolveMentionedJid(
  jid: string,
  groupMeta: { participants?: Array<{ id?: string; lid?: string }> } | null | undefined
): string {
  if (!jid) return jid;
  if (!jid.endsWith("@lid")) return jid; // already a real JID, no-op
  const participants = groupMeta?.participants || [];
  return resolveLidFromParticipants(jid, participants);
}
