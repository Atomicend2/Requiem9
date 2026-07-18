import type { CommandContext } from "./index.js";
import { sendText, sendImage, sendImageFromUrl, sendMedia } from "../connection.js";
import { logger } from "../../lib/logger.js";
import {
  getUserCards, getCard, giveCard, transferCard, lendCard, retrieveCard, getLentCards,
  getUserCard, getDeck, addToDeck, removeFromDeck, clearDeck, getCardLeaderboard,
  getAllCards, searchCardsByName, searchCardsBySeries, ensureUser, getUser, updateUser,
  createTradeOffer, getPendingTrade, updateTradeStatus, createSellOffer, getPendingSellOffer,
  updateSellOfferStatus, getCardOwners, getCardIssueNumber, addCard, getCardOwnerCount,
  setBotSetting, getBotSetting, deleteBotSetting,
  deleteUserCardByCopyId, getUserCardByCopyId, getStaff, getMentionName, extractNumberFromJid,
  createAuction, placeBid, getAuctionsLive, getAuctionById, settleExpiredAuctions,
  getCardFullById,
} from "../db/queries.js";
import { col } from "../db/mongo.js";
import { getTierEmoji, formatNumber, generateId, mentionTag, normalizeId, escapeRegex, parseCardSearchArgs, computeDebitPayment, getWebsiteUrl } from "../utils.js";
import { isModOrAbove } from "./staff.js";
import { TIER_PRICES, getMaxIssues } from "../handlers/cardspawn.js";
import { resolveCardMedia } from "../media-cache.js";

// Flat, guaranteed instant sell-back value per tier — used by .resell.
// Deliberately modest relative to .sellc's player-negotiated pricing, so
// resell is a safety net for mistakes/unwanted cards, not a way to profit.
const RESELL_VALUES: Record<string, number> = {
  T1: 50, T2: 150, T3: 400, T4: 1000, T5: 2500, T6: 6000,
  TS: 15000, TX: 0, TZ: 0, // event/exclusive tiers aren't resellable for coins
};

export async function handleCards(ctx: CommandContext): Promise<void> {
  const { from, sender, args, command: cmd, msg, sock, resolvedMentions } = ctx;
  const rawUser = await getUser(sender.split("@")[0].split(":")[0]);
  const userId = rawUser?.id || sender.split("@")[0].split(":")[0];

  if (cmd === "collection" || cmd === "coll") {
    const target = resolvedMentions[0] || sender;
    const cards = await getUserCards(target);
    if ((cards as any[]).length === 0) { await sendText(from, `🎴 ${mentionTag(target)} has no cards yet!`, [target]); return; }
    let text = `*🎴 Your card collection:*\n\n`;
    (cards as any[]).slice(0, 30).forEach((c, i) => {
      const tierNum = c.tier.replace(/^T/, "");
      const tierLabel = c.tier.startsWith("T") && !isNaN(Number(tierNum)) ? `Tier ${tierNum}` : c.tier;
      text += `${i + 1}. 🃏 ${c.name} ${tierLabel}\n`;
    });
    if ((cards as any[]).length > 30) text += `\n_...and ${(cards as any[]).length - 30} more_`;
    await sock.sendMessage(from, { text, mentions: [target] });
    return;
  }

  if (cmd === "card") {
    const idx = parseInt(args[0]) - 1;
    const cards = await getUserCards(userId);
    if (isNaN(idx) || idx < 0 || idx >= (cards as any[]).length) { await sendText(from, `❌ Invalid card index. You have ${(cards as any[]).length} cards.`); return; }
    const c = (cards as any[])[idx];
    try {
    const issueNum = await getCardIssueNumber(c.user_card_id, c.id);
    const media = await resolveCardMedia(c, { fetchFull: getCardFullById });
    const caption =
      `∘₊✦──────✦₊∘\n🎴 𝗖𝗔𝗥𝗗 𝗜𝗡𝗙𝗢\n∘₊✦──────✦₊∘\n\n` +
      `𝗡𝗮𝗺𝗲: ${c.name}\n𝗖𝗮𝗿𝗱 𝗜𝗗: ${c.id}\n𝗗𝗲𝘀𝗰𝗿𝗶𝗽𝘁𝗶𝗼𝗻: ${c.description || c.name}\n𝗧𝗶𝗲𝗿: ${c.tier}\n𝗜𝘀𝘀𝘂𝗲: #${issueNum}\n\n∘₊✦──────✦₊∘`;
    if (!media.isAnimated && media.sourceUrl) {
      await sendImageFromUrl(from, media.sourceUrl, caption);
    } else {
      await sendMedia(from, media.buf, media.isAnimated, caption);
    }
    } catch (err) {
      logger.error({ err, card: c?.name }, "Failed to send .card media");
      await sendText(from, `⚠️ Couldn't send *${c?.name || "that card"}* (media error). Try again in a moment.`).catch(() => {});
    }
    return;
  }

  if (cmd === "cardinfo" || cmd === "ci") {
    if (args.length === 0) { await sendText(from, "❌ Usage: .ci <card name> [tier]\n_Mods/staff can also look up an exact card: .ci id:<CardID>_"); return; }
    await sock.sendMessage(from, { react: { text: "⌛", key: msg.key } }).catch(() => {});

    // Mods/staff can target one exact card by ID (shown in every .ci
    // result as "Card ID: ..."), bypassing name search entirely — this is
    // the disambiguation path for cases like two separate T3 "Ichigo
    // Kurosaki" cards, where name+tier still isn't unique because they're
    // genuinely different cards that happen to share a name and tier.
    const idArg = args.find((a) => /^id:/i.test(a));
    let matches: any[];
    if (idArg) {
      if (!(await isModOrAbove(ctx))) { await sendText(from, "❌ Only mods, guardians and the owner can look up a card by ID."); return; }
      const targetId = idArg.slice(3);
      // Direct DB lookup by ID — avoids loading all 51k cards.
      const found = await getCardFullById(targetId);
      matches = found ? [found] : [];
      if (matches.length === 0) { await sendText(from, `❌ No card found with ID *${targetId}*.`); return; }
    } else {
      const { nameQuery, tier: searchTier } = parseCardSearchArgs(args);
      if (!nameQuery) { await sendText(from, "❌ Usage: .ci <card name> [tier]"); return; }
      // Targeted DB query instead of getAllCards() + in-memory filter.
      // searchCardsByName uses a MongoDB regex anchored to ^ and $ so it
      // replicates the strictCardMatch exact-name behaviour without loading
      // the entire 51k-card collection into RAM every time.
      matches = await searchCardsByName(nameQuery, searchTier);
      if (matches.length === 0) { await sendText(from, `❌ No card found named exactly *"${nameQuery}"*${searchTier ? ` in tier ${searchTier}` : ""}.\n_Search is exact — check spelling, or drop the tier to see all matches._`); return; }

      // If the user didn't specify a tier, check whether the results span
      // multiple tiers and ask them to narrow down if so — sending media for
      // every tier at once is slow and noisy.
      if (!searchTier) {
        const tiers = [...new Set((matches as any[]).map((c: any) => c.tier))].sort();
        if (tiers.length > 1) {
          const tierList = tiers.join(", ");
          await sendText(from,
            `🎴 *"${nameQuery}"* exists in multiple tiers: *${tierList}*\n\n` +
            `Please specify a tier:\n` +
            tiers.map((t) => `  • *.ci ${nameQuery} ${t}*`).join("\n") +
            `\n\n_Tip: use .ci id:<CardID> to look up one exact card_`
          );
          return;
        }
        // Only one tier found — auto-narrow to it so the cap below applies cleanly.
      }

      // Cap at 10 results per .ci call to prevent OOM when a name+tier
      // combination has many copies (e.g. series with many identically-named
      // cards). 10 is enough to see every realistic variant; beyond that the
      // WhatsApp message history becomes unusable anyway.
      if (matches.length > 10) {
        const extra = matches.length - 10;
        matches = matches.slice(0, 10);
        // Notify after sending, so the results arrive first.
        (async () => {
          await sendText(from, `_Showing 10 of ${extra + 10} matches. Use .ci id:<CardID> to target one exact card._`).catch(() => {});
        })();
      }
    }

    // Resolve owners + media for ALL matches concurrently instead of one at
    // a time. Sequential resolution was the direct cause of .ci taking
    // 40-49 seconds in production when a query matched 2-3 animated cards
    // and the shoob.gg CDN was slow for each — with up to 3 matches each
    // waiting close to the full fetch timeout one after another, total time
    // could approach 3x a single slow fetch. Resolving in parallel bounds
    // the worst case to roughly one fetch's worth of time regardless of how
    // many matches there are (up to the 3-match cap above).
    const resolved = await Promise.all(matches.map(async (found) => {
      try {
        const [owners, media] = await Promise.all([
          getCardOwners(found.id),
          resolveCardMedia(found, { fetchFull: getCardFullById }),
        ]);
        return { found, owners, media, error: null as unknown };
      } catch (err) {
        return { found, owners: [] as any[], media: null, error: err };
      }
    }));

    for (let i = 0; i < resolved.length; i++) {
      const { found, owners, media, error } = resolved[i];
      try {
      if (error || !media) throw error || new Error("media resolve failed");
      const ownerMentions: string[] = [];
      let ownersSection = "_⛔ No owners yet_";
      if ((owners as any[]).length > 0) {
        const shown = (owners as any[]).slice(0, matches.length === 1 ? 10 : 5);
        ownersSection = shown.map((o: any) => {
          // normalizeId: bare phone → full JID so WhatsApp renders tappable @-mention
          ownerMentions.push(normalizeId(o.user_id));
          return `• #${o.issue_num} ${mentionTag(o.user_id)} [${o.copy_id || o.user_card_id}]`;
        }).join("\n");
        if ((owners as any[]).length > shown.length) ownersSection += `\n_...and ${(owners as any[]).length - shown.length} more_`;
      }
      const caption =
        `∘₊✦────────✦₊∘\n🎴 𝗖𝗔𝗥𝗗 ${matches.length > 1 ? `${i + 1}/${matches.length} ` : ""}𝗜𝗡𝗙𝗢\n∘₊✦────────✦₊∘\n\n` +
        `𝗡𝗮𝗺𝗲: ${found.name}\n𝗦𝗲𝗿𝗶𝗲𝘀: ${found.series || "General"}\n𝗧𝗶𝗲𝗿: ${found.tier}\n𝗖𝗮𝗿𝗱 𝗜𝗗: ${found.id}\n𝗧𝗼𝘁𝗮𝗹 𝗜𝘀𝘀𝘂𝗲𝘀: ${(owners as any[]).length}\n\n` +
        `✦────⋆⋅✧⋅⋆────✦\n👥 𝗢𝗪𝗡𝗘𝗥𝗦\n✦────⋆⋅✧⋅⋆────✦\n\n${ownersSection}\n\n∘₊✦────────✦₊∘`;
      // Static images we didn't need to re-encode can stream straight from
      // the CDN URL — Baileys never buffers the whole file into Node's
      // memory for { url } sends. Animated media (gif/webm) still needs the
      // buffer path in sendMedia() because it must be format-sniffed and,
      // for WhatsApp compatibility, transcoded to MP4 via ffmpeg first.
      if (!media.isAnimated && media.sourceUrl) {
        await sendImageFromUrl(from, media.sourceUrl, caption, ownerMentions);
      } else {
        await sendMedia(from, media.buf, media.isAnimated, caption, ownerMentions);
      }
      } catch (err) {
        logger.error({ err, card: found?.name }, "Failed to send card info — continuing with remaining matches");
        await sendText(from, `⚠️ Couldn't send *${found?.name || "a card"}* (media error) — skipping.`).catch(() => {});
      }
    }
    return;
  }

  if (cmd === "mycollectionseries" || cmd === "mycolls") {
    const cards = await getUserCards(userId);
    const series: Record<string, number> = {};
    for (const c of cards as any[]) { series[c.series] = (series[c.series] || 0) + 1; }
    const text = `📚 *Your Series Collection*\n\n` +
      Object.entries(series).map(([s, n]) => `• ${s}: ${n} cards`).join("\n") || "No cards yet!";
    await sendText(from, text);
    return;
  }

  if (cmd === "ss") {
    const seriesName = args.join(" ").trim();
    if (!seriesName) { await sendText(from, "❌ Usage: .ss <series name>"); return; }
    // Targeted DB regex query — no full 51k-card load.
    const seriesCards = await searchCardsBySeries(seriesName);
    if (seriesCards.length === 0) { await sendText(from, `❌ No cards found for series: *${seriesName}*`); return; }
    const actualSeries = seriesCards[0].series || "General";
    // Cap the listed cards — a single WhatsApp text message has a real
    // length limit, and large series (One Piece has 1000+ cards) would
    // build a message so long the send call throws, which surfaced to
    // users as a generic "❌ An error occurred" with no indication why.
    const MAX_SS_LISTED = 50;
    let text = `╭─❰ 🎴 ᴄᴀʀᴅs ʙʏ sᴇʀɪᴇꜱ ❱─╮\n│ 📚 sᴇʀɪᴇs: ${actualSeries}\n│ 🃏 ᴛᴏᴛᴀʟ ᴄᴀʀᴅs: ${seriesCards.length}\n│\n`;
    const shown = seriesCards.slice(0, MAX_SS_LISTED);
    for (let i = 0; i < shown.length; i++) { text += `├─ 🃏 ${i + 1}. ${shown[i].name}\n│   ᴛɪᴇʀ: ${shown[i].tier}\n`; }
    if (seriesCards.length > MAX_SS_LISTED) {
      text += `│\n│ _...and ${seriesCards.length - MAX_SS_LISTED} more — use .ci <name> to look up a specific card._\n`;
    }
    text += `╰──────────────╯`;
    await sendText(from, text);
    return;
  }

  if (cmd === "sc") {
    const searchName = args.join(" ").trim();
    if (!searchName) { await sendText(from, "❌ Usage: .sc <card name>"); return; }
    const myCards = await getUserCards(userId);
    const found = (myCards as any[]).filter((c) => (c.name || "").toLowerCase().includes(searchName.toLowerCase()));
    if (found.length === 0) { await sendText(from, `🔎 No cards found matching *"${searchName}"* in your collection.`); return; }
    let text = `🔎 Search Results for: *"${searchName}"*\n\n`;
    for (let i = 0; i < found.length; i++) {
      const c = found[i];
      text += `🃏 ${i + 1}. ${c.name} (${c.series || "General"})\n   Tier: ${c.tier}\n   Index: ${(myCards as any[]).indexOf(c) + 1}\n\n`;
    }
    text += `Total found: ${found.length} card(s)`;
    await sendText(from, text);
    return;
  }


  if (cmd === "cardleaderboard" || cmd === "cardlb") {
    const lb = await getCardLeaderboard(10);
    const MEDALS = ["🥇","🥈","🥉"];
    let text = "╔ ❰ 🎴 Cᴀʀᴅ Lᴇᴀᴅᴇʀʙᴏᴀʀᴅ ❱ ╗\n║ 🃏 Tᴏᴘ Cᴏʟʟᴇᴄᴛᴏʀs\n║\n";
    (lb as any[]).forEach((e, i) => {
      const num = String(i + 1).padStart(2, "0");
      const medal = MEDALS[i];
      const name = mentionTag(e.user_id);
      text += `║ ${medal ? `${medal} ${num}.` : `${num}.`} ${name}\n║     └─ 🃏 Cᴀʀᴅs: ${e.card_count}\n║\n`;
    });
    text += "╚══════════════════╝";
    await sock.sendMessage(from, { text, mentions: (lb as any[]).map((e) => e.user_id) });
    return;
  }

  if (cmd === "cardshop") {
    const cards = await getAllCards();
    const tiers: Record<string, any[]> = {};
    for (const c of cards as any[]) { if (!tiers[c.tier]) tiers[c.tier] = []; tiers[c.tier].push(c); }
    let text = "🃏 *Card Shop*\n\n";
    for (const [tier, cs] of Object.entries(tiers)) {
      text += `${getTierEmoji(tier)} *${tier}*\n`;
      cs.slice(0, 5).forEach((c) => { text += `  • ${c.name} (${c.series}) — ID: \`${c.id}\`\n`; });
    }
    text += "\nUse .get [card_id] to claim a spawned card.";
    await sendText(from, text);
    return;
  }

  if (cmd === "stardust") {
    const cards = await getUserCards(userId);
    const tierDustMap: Record<string, number> = {"T1":5,"T2":10,"T3":25,"T4":50,"T5":100,"TS":250,"TX":500};
    const dust = (cards as any[]).reduce((acc, c) => acc + (tierDustMap[c.tier] || 5), 0);
    await sendText(from, `✨ Your stardust value: *${dust} SD*\n(Based on ${(cards as any[]).length} cards)`);
    return;
  }

  if (cmd === "vs") {
    const challenged = resolvedMentions[0];
    if (!challenged) { await sendText(from, "❌ Mention someone to VS."); return; }
    const myDeck = await getDeck(sender);
    const theirDeck = await getDeck(challenged);
    if ((myDeck as any[]).length === 0) { await sendText(from, "❌ You don't have a deck set. Use .ctd [card #]"); return; }
    if ((theirDeck as any[]).length === 0) { await sendText(from, "❌ Your opponent has no deck."); return; }
    const myPower = (myDeck as any[]).reduce((acc, c) => acc + c.attack + c.defense + c.speed, 0);
    const theirPower = (theirDeck as any[]).reduce((acc, c) => acc + c.attack + c.defense + c.speed, 0);
    const winner = myPower > theirPower ? sender : myPower < theirPower ? challenged : null;
    await sock.sendMessage(from, {
      text: `⚔️ *Card Battle*\n\n${mentionTag(sender)} Power: ${myPower}\n${mentionTag(challenged)} Power: ${theirPower}\n\n${winner ? `🏆 Winner: ${mentionTag(winner)}!` : "🤝 It's a tie!"}`,
      mentions: [sender, challenged],
    });
    return;
  }

  // ── Auction: view active auctions ───────────────────────────────────────────
  if (cmd === "auction" || cmd === "auctions") {
    await settleExpiredAuctions();
    const auctions = await getAuctionsLive();
    if (auctions.length === 0) {
      await sendText(from, "🏛️ *Auction House*\n\n_No active auctions right now. Staff and recruits can list cards with .listauc._");
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    let text = `🏛️ *Auction House* — ${auctions.length} active\n\n`;
    for (const a of auctions.slice(0, 10)) {
      const timeLeft = Math.max(0, (a.end_time || 0) - now);
      const h = Math.floor(timeLeft / 3600);
      const m = Math.floor((timeLeft % 3600) / 60);
      const timeStr = timeLeft <= 0 ? "Ended" : h > 0 ? `${h}h ${m}m` : `${m}m`;
      const shortId = String(a.id).slice(-6);
      text += `┌─⟡ *${a.card_name || "Unknown"}* [${a.card_tier || "?"}]\n`;
      text += `║ ➩ 𝗦𝗲𝗿𝗶𝗲𝘀 : ${a.card_series || "General"}\n`;
      text += `║ ➩ 𝗕𝗶𝗱 : $${formatNumber(a.current_bid || a.price || 0)}\n`;
      text += `║ ➩ 𝗟𝗲𝗮𝗱 : ${a.current_bidder_name || "No bids yet"}\n`;
      text += `║ ➩ 𝗦𝗲𝗹𝗹𝗲𝗿 : ${a.seller_name || a.seller_id || "?"}\n`;
      text += `║ ➩ ⏰ : ${timeStr} remaining\n`;
      text += `║ ➩ 𝗜𝗗 : \`${shortId}\`\n`;
      text += `└────────────────\n`;
    }
    if (auctions.length > 10) text += `_…and ${auctions.length - 10} more. Visit the website for full list._`;
    text += `\n_Bid with .bid <id> <amount>_`;
    await sendText(from, text);
    return;
  }

  // ── Auction: my auctions ─────────────────────────────────────────────────────
  if (cmd === "myauc") {
    const myPhone = extractNumberFromJid(sender);
    const auctions = await getAuctionsLive();
    const mine = auctions.filter((a: any) => a.seller_id === myPhone);
    if (mine.length === 0) {
      await sendText(from, "🏛️ You have no active auctions.\n\n_List a card with .listauc <card_index> <price> [hours]_");
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    let text = `🏛️ *My Auctions* (${mine.length})\n\n`;
    for (const a of mine) {
      const timeLeft = Math.max(0, (a.end_time || 0) - now);
      const h = Math.floor(timeLeft / 3600);
      const m = Math.floor((timeLeft % 3600) / 60);
      const timeStr = timeLeft <= 0 ? "Ended" : h > 0 ? `${h}h ${m}m` : `${m}m`;
      const shortId = String(a.id).slice(-6);
      text += `🃏 *${a.card_name}* [${a.card_tier}]\n   Bid: $${formatNumber(a.current_bid || a.price || 0)} | ⏰ ${timeStr} | ID: \`${shortId}\`\n`;
    }
    await sendText(from, text);
    return;
  }

  // ── Auction: remove/cancel ────────────────────────────────────────────────────
  if (cmd === "remauc") {
    const shortId = args[0]?.toLowerCase();
    if (!shortId) { await sendText(from, "❌ Usage: .remauc <auction_id>"); return; }
    const auctions = await getAuctionsLive();
    const match = auctions.find((a: any) => String(a.id).slice(-6) === shortId);
    if (!match) { await sendText(from, "❌ Auction not found."); return; }
    const myPhone = extractNumberFromJid(sender);
    const staffRecord = await getStaff(myPhone);
    if (match.seller_id !== myPhone && !staffRecord && !ctx.isOwner) {
      await sendText(from, "❌ You can only remove your own auctions."); return;
    }
    if (match.current_bidder_id) {
      await sendText(from, "❌ Cannot remove an auction that already has bids."); return;
    }
    const { col: getCol } = await import("../db/mongo.js");
    const { ObjectId } = await import("mongodb");
    try {
      await getCol("auctions").updateOne({ _id: new ObjectId(match.id) }, { $set: { active: 0, status: "cancelled" } });
      await sendText(from, `✅ Auction for *${match.card_name}* cancelled.`);
    } catch { await sendText(from, "❌ Failed to cancel auction."); }
    return;
  }

  // ── Auction: list a card ─────────────────────────────────────────────────────
  if (cmd === "listauc") {
    const staffRecord = await getStaff(extractNumberFromJid(sender));
    const isStaffOrRecruit = ctx.isOwner || (staffRecord?.role === "mod" || staffRecord?.role === "guardian" || staffRecord?.role === "owner" || staffRecord?.role === "recruit");
    if (!isStaffOrRecruit) {
      await sendText(from, "❌ Only staff and recruits can list cards for auction."); return;
    }
    const idxStr = args[0];
    const priceStr = args[1];
    const hoursStr = args[2];
    if (!idxStr || !priceStr) {
      await sendText(from, "❌ Usage: .listauc <card_index> <starting_price> [hours=24]\n_Example: .listauc 3 5000 48_"); return;
    }
    const idx = parseInt(idxStr, 10);
    const price = parseInt(priceStr, 10);
    const hours = Math.max(1, Math.min(168, parseInt(hoursStr || "24", 10) || 24));
    if (isNaN(idx) || idx < 1) { await sendText(from, "❌ Card index must be a positive number."); return; }
    if (isNaN(price) || price < 100) { await sendText(from, "❌ Starting price must be at least 100 coins."); return; }

    const userCardsRaw = await getUserCards(userId);
    const userCards = userCardsRaw as any[];
    if (idx > userCards.length) {
      await sendText(from, `❌ You only have ${userCards.length} card(s). Use .collection to see your cards.`); return;
    }
    const selectedCard = userCards[idx - 1];
    const cardData = await getCard(String(selectedCard.card_id || selectedCard.id));
    if (!cardData) { await sendText(from, "❌ Card data not found."); return; }

    const card = cardData as any;
    const minIncrement = Math.max(100, Math.floor(price * 0.05));
    const endTime = Math.floor(Date.now() / 1000) + hours * 3600;
    const sellerUser = await getUser(userId);
    const sellerName = (sellerUser as any)?.name || userId;

    const auctionId = await createAuction({
      sellerId: sender,
      sellerName,
      userCardId: String(selectedCard._id || selectedCard.id),
      cardId: String(card._id || card.id),
      cardName: card.name,
      cardTier: card.tier,
      cardSeries: card.series || "General",
      cardImageUrl: card.image_url || card.media_url || null,
      startingPrice: price,
      minIncrement,
      endTime,
      groupJid: from,
    });

    const shortId = auctionId.slice(-6);
    await sendText(from, `🏛️ *Auction Created!*\n\n🎴 Card: *${card.name}* [${card.tier}]\n📚 Series: ${card.series || "General"}\n💰 Starting: $${formatNumber(price)}\n⏰ Duration: ${hours}h\n\n_Auction ID: \`${shortId}\`\nBid with: .bid ${shortId} <amount>_`);
    return;
  }

  // ── Auction: bidding now happens on the website only ─────────────────────────
  // WhatsApp .bid was removed because it had no real-time visibility into
  // competing bids and made the self-bid restriction feel arbitrary in a
  // group chat. Auctions can still be listed/created from WhatsApp; bidding
  // itself is web-only where the live auction state is visible.
  if (cmd === "bid") {
    await sendText(from, `🏛️ Bidding now happens on the website only.\n\n${getWebsiteUrl("cards")}\n\n_Use .auctions here to browse what's live._`);
    return;
  }

  if (cmd === "claim") {
    const code = args[0]?.toLowerCase();
    if (!code) { await sendText(from, "❌ Usage: .claim <claimCode>"); return; }
    const spawn = await col("card_spawns").findOne({ spawn_token: code, claimed_by: null });
    if (!spawn) { await sendText(from, "❌ Invalid or already claimed code."); return; }
    const cardData = await getCard(String(spawn.card_id));
    if (!cardData) { await sendText(from, "❌ Card not found."); return; }

    // Same checks .get already had — these were missing here, meaning
    // .claim let someone claim a card they already owned, or claim past a
    // card's max-issue cap, neither of which .get allowed.
    const alreadyOwnedCards = await getUserCards(userId);
    if ((alreadyOwnedCards as any[]).some((c: any) => String(c.id) === String((cardData as any).id))) {
      await sendText(from, `❌ You already own *${(cardData as any).name}*! Each card can only be claimed once per user.`);
      return;
    }
    const maxIssues = getMaxIssues((cardData as any).tier || "T1");
    const currentOwners = await getCardOwnerCount(String((cardData as any).id));
    if (currentOwners >= maxIssues) {
      await sendText(from, `❌ *${(cardData as any).name}* has reached its maximum issues (${maxIssues}/${maxIssues}).`);
      return;
    }

    // Single shared pricing table (imported from cardspawn.ts) — this used
    // to read from a separate, stale TIER_CLAIM_PRICES table defined only
    // in this file, with values far below what the spawn announcement
    // itself displayed (e.g. a T4 card was shown as "$52,500" when it
    // spawned but only actually charged $5,000 on claim). Both paths now
    // read the exact same numbers, so the price shown always matches the
    // price charged.
    const claimCost = TIER_PRICES[(cardData as any).tier] || 500;
    const claimer = await getUser(userId);
    const claimerBal = (claimer as any)?.balance ?? 0;
    const claimerBank = (claimer as any)?.bank ?? 0;
    const claimerLevel = (claimer as any)?.level ?? 1;
    const payment = computeDebitPayment(claimCost, claimerBal, claimerBank, claimerLevel);
    if (!payment.ok) {
      await sendText(from, `❌ Not enough coins to claim *${(cardData as any).name}* (${(cardData as any).tier}).\n\n💰 Cost: $${formatNumber(claimCost)}\n👛 Your wallet: $${formatNumber(claimerBal)}\n🏦 Your bank: $${formatNumber(claimerBank)}\n\n${payment.message}\n\n_Earn more with .daily, .work, .adventure, or dungeon runs._`);
      return;
    }
    await col("card_spawns").updateOne({ _id: spawn._id }, { $set: { claimed_by: sender, claimed_at: Math.floor(Date.now() / 1000) } });
    await giveCard(sender, String((cardData as any).id));
    await updateUser(userId, { balance: payment.newBalance, bank: payment.newBank });
    const debitNote = payment.fromBank > 0 ? `\n_🏦 $${formatNumber(payment.fromBank - payment.fee)} auto-drawn from bank (+ $${formatNumber(payment.fee)} fee)_` : "";
    try {
      const media = await resolveCardMedia(cardData, { fetchFull: getCardFullById });
      const claimCaption = `🎉 ${mentionTag(sender)} claimed *${(cardData as any).name}* (${(cardData as any).tier})! 💰 -$${formatNumber(claimCost)}${debitNote}`;
      if (!media.isAnimated && media.sourceUrl) {
        await sendImageFromUrl(from, media.sourceUrl, claimCaption, [sender]);
      } else {
        await sendMedia(from, media.buf, media.isAnimated, claimCaption, [sender]);
      }
    } catch (err) {
      logger.error({ err, card: (cardData as any)?.name }, "Failed to send claimed card media — confirming via text instead");
      await sendText(from, `🎉 ${mentionTag(sender)} claimed *${(cardData as any).name}* (${(cardData as any).tier})! 💰 -$${formatNumber(claimCost)}${debitNote}\n\n_(card image failed to send — use .ci to view it)_`, [sender]).catch(() => {});
    }
    return;
  }

  if (cmd === "si") {
    const query = args.join(" ").toLowerCase();
    if (!query) { await sendText(from, "❌ Usage: .si <name>"); return; }
    const cards = await getUserCards(userId);
    const matches = (cards as any[]).filter((c) => c.name.toLowerCase().includes(query));
    if (matches.length === 0) { await sendText(from, `❌ No cards matching "${args.join(" ")}".`); return; }
    const shown = matches.slice(0, 20);
    const lines = shown.map((c, i) => {
      const collIndex = (cards as any[]).indexOf(c) + 1;
      const tierNum = c.tier.replace(/^T/, "");
      return `┌─⟡ 𝗖𝗔𝗥𝗗 ${i + 1}\n║ ➩ 𝗡𝗮𝗺𝗲 : ${c.name}\n║ ➩ 𝗦𝗲𝗿𝗶𝗲𝘀 : ${c.series || "General"}\n║ ➩ 𝗧𝗶𝗲𝗿 : ${c.tier.startsWith("T") && !isNaN(Number(tierNum)) ? `T${tierNum}` : c.tier}\n║ ➩ 𝗜𝗻𝗱𝗲𝘅 : #${collIndex}\n║ ➩ 𝗜𝗗 : ${c.id}\n└────────────────`;
    });
    const header = `┌─⟡ 🔍 𝗦𝗘𝗔𝗥𝗖𝗛 𝗥𝗘𝗦𝗨𝗟𝗧𝗦\n║ ➩ Query : "${args.join(" ")}"\n║ ➩ Found : ${matches.length} card(s)\n╠─────────────────────\n`;
    await sendText(from, header + lines.join("\n") + (matches.length > 20 ? `\n_...and ${matches.length - 20} more_` : ""));
    return;
  }

  if (cmd === "slb") {
    const seriesName = args.join(" ");
    if (!seriesName) { await sendText(from, "❌ Usage: .slb <series>"); return; }
    const rows = await col("user_cards").aggregate([
      {
        $lookup: { from: "cards", localField: "card_id", foreignField: "_id", as: "card" },
      },
      { $unwind: "$card" },
      { $match: { "card.series": { $regex: escapeRegex(seriesName), $options: "i" } } },
      { $group: { _id: "$user_id", cnt: { $sum: 1 } } },
      { $sort: { cnt: -1 } },
      { $limit: 10 },
      {
        $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "u" },
      },
      { $unwind: { path: "$u", preserveNullAndEmptyArrays: true } },
      { $project: { user_id: "$_id", cnt: 1, name: { $ifNull: ["$u.name", "$_id"] } } },
    ]).toArray();
    if (rows.length === 0) { await sendText(from, `❌ No collectors found for series "${seriesName}".`); return; }
    const MEDALS = ["🥇","🥈","🥉"];
    const lines = rows.map((r: any, i) => `║ ║ ${MEDALS[i] || `${String(i + 1).padStart(2, "0")}.`} ${r.name}\n║ ║     └─ 🃏 ${r.cnt} cards`);
    const text = `┌─⟡ 『 📊 𝗦𝗘𝗥𝗜𝗘𝗦 𝗟𝗘𝗔𝗗𝗘𝗥𝗕𝗢𝗔𝗥𝗗 』⟡\n║\n║ ┌──────────────────────\n║ ║ 📚 𝗦𝗲𝗿𝗶𝗲𝘀 : ${seriesName}\n║ ║ 👥 𝗧𝗼𝗽 𝗖𝗼𝗹𝗹𝗲𝗰𝘁𝗼𝗿𝘀\n║ └──────────────────────\n║\n╠─⟡ 🏆 𝗥𝗔𝗡𝗞𝗜𝗡𝗚𝗦\n║ ┌──────────────────────\n` + lines.join("\n") + "\n║ └──────────────────────\n╚══════════════════════╝";
    await sendText(from, text);
    return;
  }

  if (cmd === "tier") {
    const cards = await getUserCards(userId);
    if ((cards as any[]).length === 0) { await sendText(from, "🎴 You have no cards."); return; }
    const groups: Record<string, string[]> = {};
    for (const c of cards as any[]) { const t = c.tier || "Unknown"; if (!groups[t]) groups[t] = []; groups[t].push(c.name); }
    const tierOrder = ["TX","TZ","TS","T6","T5","T4","T3","T2","T1"];
    const sortedKeys = [...tierOrder.filter((t) => groups[t]), ...Object.keys(groups).filter((t) => !tierOrder.includes(t))];
    const lines = sortedKeys.map((t) => {
      const label = t.startsWith("T") && !isNaN(Number(t.replace(/^T/, ""))) ? `Tier ${t.replace(/^T/, "")}` : t;
      return `*${label}* (${groups[t].length})\n${groups[t].slice(0, 5).join(", ")}${groups[t].length > 5 ? ` +${groups[t].length - 5} more` : ""}`;
    });
    await sendText(from, `🏆 *Your Cards by Tier*\n\n${lines.join("\n\n")}`);
    return;
  }

  if (cmd === "myseries") {
    const cards = await getUserCards(userId);
    if ((cards as any[]).length === 0) { await sendText(from, "🎴 You have no cards."); return; }
    const seriesMap: Record<string, number> = {};
    for (const c of cards as any[]) { const s = c.series || "General"; seriesMap[s] = (seriesMap[s] || 0) + 1; }
    const sorted = Object.entries(seriesMap).sort(([, a], [, b]) => b - a);
    const lines = sorted.map(([s, cnt], i) => `${i + 1}. ${s} — ${cnt} cards`);
    await sendText(from, `📚 *Your Series Collection*\n\n${lines.join("\n")}`);
    return;
  }

  if (cmd === "cs") {
    const seriesName = args.join(" ");
    if (!seriesName) { await sendText(from, "❌ Usage: .cs <series name>"); return; }
    const cards = await getUserCards(userId);
    const found = (cards as any[]).filter((c) => (c.series || "General").toLowerCase().includes(seriesName.toLowerCase()));
    if (found.length === 0) { await sendText(from, `❌ You have no cards from series: *${seriesName}*`); return; }
    const actualSeries = found[0].series || "General";
    let text = `╭─❰ 🎴 ʏᴏᴜʀ ᴄᴀʀᴅs ❱─╮\n│ 📚 sᴇʀɪᴇs: ${actualSeries}\n│ 🃏 ᴄᴏᴜɴᴛ: ${found.length}\n│\n`;
    for (let i = 0; i < found.length && i < 20; i++) { const c = found[i]; text += `├─ 🃏 #${(cards as any[]).indexOf(c) + 1}: ${c.name}\n│   ᴛɪᴇʀ: ${c.tier}\n`; }
    if (found.length > 20) text += `├─ ᴀɴᴅ ${found.length - 20} ᴍᴏʀᴇ...\n`;
    text += `╰──────────────╯`;
    await sendText(from, text);
    return;
  }

  if (cmd === "ubs") {
    const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = ctxInfo?.quotedMessage;
    if (!quotedMsg?.imageMessage && !msg.message?.imageMessage) {
      await sendText(from, "❌ Reply to an image (or send an image with .ubs) to analyze it with AI.\n\nUsage:\n• Reply to an image: .ubs\n• After result: .ups confirm  to save  |  .ups cancel  to discard");
      return;
    }
    await sendText(from, "🤖 Analyzing card with Gemini AI...");
    try {
      const { downloadMediaMessage } = await import("@whiskeysockets/baileys");
      const target = quotedMsg?.imageMessage
        ? { key: { remoteJid: from, fromMe: false, id: ctxInfo?.stanzaId || "", participant: ctxInfo?.participant }, message: quotedMsg }
        : msg;
      const buffer = await downloadMediaMessage(target as any, "buffer", {}, { reuploadRequest: (sock as any).updateMediaMessage } as any);
      const imageBase64 = (Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as any)).toString("base64");
      const geminiKey = process.env["GEMINI_API_KEY"] || "";
      if (!geminiKey) { await sendText(from, "❌ Gemini API key not configured. Set GEMINI_API_KEY in environment secrets."); return; }
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          contents: [{ parts: [{ text: `Analyze this anime trading card image. Return ONLY a raw JSON object with no markdown, no code fences, no explanation. Format: {"name":"character name","series":"anime/series name","tier":"T1"}. Tier must be one of: T1 T2 T3 T4 T5 T6 TS TX TZ. Guess tier from art quality: sketchy/simple=T1, detailed=T3, cinematic=T5, legendary/god-tier=T6 TS TX TZ. Return ONLY the JSON object.` }, { inline_data: { mime_type: "image/jpeg", data: imageBase64 } }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
        }) }
      );
      const geminiData = await geminiRes.json() as any;
      if (geminiRes.status === 429 || geminiData?.error?.code === 429) { await sendText(from, "❌ Gemini API quota exceeded. Try again tomorrow."); return; }
      if (geminiData?.error) throw new Error(geminiData.error.message || "Gemini API error");
      const rawText = (geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      const stripped = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const jsonMatch = stripped.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error(`No JSON in response. Got: "${rawText.slice(0, 100)}"`);
      const parsed = JSON.parse(jsonMatch[0]);
      await setBotSetting(`ubs_pending:${sender}`, JSON.stringify({ name: parsed.name, series: parsed.series, tier: parsed.tier, imageBase64, uploadedBy: sender }));
      await sendText(from, `🤖 *Gemini Card Analysis*\n\n📛 Name: *${parsed.name}*\n📚 Series: *${parsed.series}*\n⭐ Tier: *${parsed.tier}*\n\nType *.ups confirm* to save this card, or *.ups cancel* to discard.`);
    } catch (err: any) {
      await sendText(from, `❌ Gemini analysis failed: ${err?.message || "Unknown error"}`);
    }
    return;
  }

  if (cmd === "ups") {
    const sub = args[0]?.toLowerCase();
    if (sub === "cancel") { await deleteBotSetting(`ubs_pending:${sender}`); await sendText(from, "❌ Card upload cancelled."); return; }
    if (sub === "confirm") {
      const pendingRaw = await getBotSetting(`ubs_pending:${sender}`);
      if (!pendingRaw) { await sendText(from, "❌ No pending card upload. Use .ubs first."); return; }
      const pending = JSON.parse(pendingRaw.toString());
      const imageBuffer = Buffer.from(pending.imageBase64, "base64");
      const resized = await sharp(imageBuffer).resize(900, 1260, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
      const { generateUniqueCardId } = await import("../utils.js");
      const existingIds = new Set((await getAllCards() as any[]).map((r: any) => r.id));
      const cardId = generateUniqueCardId(existingIds);
      await addCard({ id: cardId, name: pending.name, series: pending.series, tier: pending.tier, image_data: resized, uploaded_by: pending.uploadedBy });
      await deleteBotSetting(`ubs_pending:${sender}`);
      await sendText(from, `✅ Card *${pending.name}* (${pending.tier}) from *${pending.series}* has been added to the database!`);
      return;
    }
    await sendText(from, "❌ Usage: .ups confirm | .ups cancel\n\nTo start: reply to a card image with .ubs");
    return;
  }

  if (cmd === "cg") {
    const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
    const mentioned = resolvedMentions[0] || ctxInfo?.participant;
    const numArg = args.find((a) => /^\d+$/.test(a));
    const cardNum = numArg ? parseInt(numArg) : NaN;
    if (!mentioned || isNaN(cardNum)) { await sendText(from, "❌ Usage: .cg @user [card #]  or reply to a user's message with .cg [card #]"); return; }
    const cards = await getUserCards(userId);
    if (cardNum < 1 || cardNum > (cards as any[]).length) { await sendText(from, `❌ Invalid card number. You have ${(cards as any[]).length} cards.`); return; }
    const card = (cards as any[])[cardNum - 1];
    await ensureUser(mentioned);
    await transferCard(card.user_card_id, mentioned);
    await sock.sendMessage(from, { text: `🎁 ${mentionTag(sender)} gifted *${card.name}* to ${mentionTag(mentioned)}!`, mentions: [sender, mentioned] });
    return;
  }

  if (cmd === "ctd") {
    if (args[0]?.toLowerCase() === "clear") { await clearDeck(sender); await sendText(from, "✅ Deck cleared."); return; }
    if (args[0]?.toLowerCase() === "remove") {
      const slot = parseInt(args[1]);
      if (isNaN(slot)) { await sendText(from, "❌ Usage: .ctd remove [slot]"); return; }
      await removeFromDeck(sender, slot);
      await sendText(from, `✅ Removed card from slot ${slot}.`);
      return;
    }
    const cardNum = parseInt(args[0]);
    if (isNaN(cardNum)) { await sendText(from, "❌ Usage: .ctd [card #]"); return; }
    const cards = await getUserCards(userId);
    if (cardNum < 1 || cardNum > (cards as any[]).length) { await sendText(from, "❌ Invalid card number."); return; }
    const card = (cards as any[])[cardNum - 1];
    const deck = await getDeck(sender);
    if ((deck as any[]).length >= 5) { await sendText(from, "❌ Deck is full (5 cards max). Use .ctd remove [slot] to remove one."); return; }
    const nextSlot = (deck as any[]).length + 1;
    await addToDeck(sender, nextSlot, card.user_card_id);
    await sendText(from, `✅ Added *${card.name}* to deck slot ${nextSlot}.`);
    return;
  }

  if (cmd === "deck") {
    const deck = await getDeck(sender);
    if ((deck as any[]).length === 0) { await sendText(from, "🃏 Your deck is empty. Use .ctd [card #]"); return; }
    const totalPower = (deck as any[]).reduce((acc, c) => acc + c.attack + c.defense + c.speed, 0);
    let text = `🃏 *Your Deck* (Total Power: ${totalPower})\n\n`;
    (deck as any[]).forEach((c) => { text += `[Slot ${c.slot}] ${getTierEmoji(c.tier)} *${c.name}* — ATK:${c.attack} DEF:${c.defense} SPD:${c.speed}\n`; });
    await sendText(from, text);
    return;
  }

  if (cmd === "sdi") { await sendText(from, "🎴 Deck background customization coming soon!"); return; }

  if (cmd === "lc") {
    const mentioned = resolvedMentions[0];
    const cardNum = parseInt(args[1] || args[0]);
    if (!mentioned || isNaN(cardNum)) { await sendText(from, "❌ Usage: .lc @user [card #]"); return; }
    const cards = await getUserCards(userId);
    if (cardNum < 1 || cardNum > (cards as any[]).length) { await sendText(from, "❌ Invalid card number."); return; }
    const card = (cards as any[])[cardNum - 1];
    await lendCard(card.user_card_id, mentioned);
    await sock.sendMessage(from, { text: `🤝 ${mentionTag(sender)} lent *${card.name}* to ${mentionTag(mentioned)}!`, mentions: [sender, mentioned] });
    return;
  }

  if (cmd === "lcd") {
    const lent = await getLentCards(sender);
    if ((lent as any[]).length === 0) { await sendText(from, "✅ You have no lent cards."); return; }
    const text = "🤝 *Lent Cards*\n\n" + (lent as any[]).map((c) => `• *${c.name}* → ${mentionTag(c.lent_to || "")}`).join("\n");
    await sock.sendMessage(from, { text, mentions: (lent as any[]).map((c) => c.lent_to).filter(Boolean) });
    return;
  }

  if (cmd === "retrieve") { await retrieveCard(sender); await sendText(from, "✅ All lent cards have been retrieved!"); return; }

  if (cmd === "sellc") {
    const mentioned = resolvedMentions[0];
    const cardNum = parseInt(args[1] || args[0]);
    const price = parseInt(args[2] || args[1] || args[0]);
    if (!mentioned || isNaN(cardNum) || isNaN(price)) { await sendText(from, "❌ Usage: .sellc @user [card #] [price]"); return; }
    const cards = await getUserCards(userId);
    if (cardNum < 1 || cardNum > (cards as any[]).length) { await sendText(from, "❌ Invalid card number."); return; }
    const card = (cards as any[])[cardNum - 1];
    await createSellOffer(sender, mentioned, card.user_card_id, price);
    await sock.sendMessage(from, {
      text: `💰 ${mentionTag(mentioned)}, ${mentionTag(sender)} wants to sell you *${card.name}* for $${formatNumber(price)}.\n\nReply *.accept* to buy or *.decline* to reject.`,
      mentions: [sender, mentioned],
    });
    return;
  }

  if (cmd === "tc") {
    const quotedCtx = msg.message?.extendedTextMessage?.contextInfo;
    if (!quotedCtx) { await sendText(from, "❌ Reply to someone's message with .tc [your card #] [their card #]"); return; }
    const recipient = quotedCtx.participant || quotedCtx.remoteJid;
    if (!recipient) { await sendText(from, "❌ Couldn't determine recipient."); return; }
    const myCardNum = parseInt(args[0]);
    const theirCardNum = parseInt(args[1]);
    if (isNaN(myCardNum) || isNaN(theirCardNum)) { await sendText(from, "❌ Usage: .tc [your card #] [their card #] (reply to their message)"); return; }
    const myCards = await getUserCards(userId);
    const theirCards = await getUserCards(recipient);
    if (myCardNum < 1 || myCardNum > (myCards as any[]).length) { await sendText(from, "❌ Invalid card number."); return; }
    if (theirCardNum < 1 || theirCardNum > (theirCards as any[]).length) { await sendText(from, "❌ They don't have that card."); return; }
    const myCard = (myCards as any[])[myCardNum - 1];
    const theirCard = (theirCards as any[])[theirCardNum - 1];
    await createTradeOffer(sender, recipient, myCard.user_card_id, theirCard.user_card_id);
    await sock.sendMessage(from, {
      text: `🔄 ${mentionTag(recipient)}, ${mentionTag(sender)} wants to trade:\n*${myCard.name}* for your *${theirCard.name}*\n\nReply *.accept* or *.decline*`,
      mentions: [sender, recipient],
    });
    return;
  }

  if (cmd === "accept") {
    const trade = await getPendingTrade(sender);
    if (trade) {
      const myCard = await getUserCard((trade as any).to_card);
      const theirCard = await getUserCard((trade as any).from_card);
      if (!myCard || !theirCard) { await sendText(from, "❌ Cards no longer available."); return; }
      await transferCard((trade as any).from_card, sender);
      await transferCard((trade as any).to_card, (trade as any).from_user);
      await updateTradeStatus((trade as any).id, "accepted");
      await sock.sendMessage(from, { text: `✅ Trade complete!\n${mentionTag(sender)} got *${(theirCard as any).name}*\n${mentionTag((trade as any).from_user)} got *${(myCard as any).name}*`, mentions: [sender, (trade as any).from_user] });
      return;
    }
    const sell = await getPendingSellOffer(sender);
    if (sell) {
      const buyerUser = await ensureUser(sender);
      if ((buyerUser.balance || 0) < (sell as any).price) { await sendText(from, `❌ Not enough money. Need $${formatNumber((sell as any).price)}.`); return; }
      const card = await getUserCard((sell as any).user_card_id);
      await transferCard((sell as any).user_card_id, sender);
      await updateUser(sender, { balance: (buyerUser.balance || 0) - (sell as any).price });
      const seller = await ensureUser((sell as any).seller_id);
      await updateUser((sell as any).seller_id, { balance: (seller.balance || 0) + (sell as any).price });
      await updateSellOfferStatus((sell as any).id, "accepted");
      await sock.sendMessage(from, { text: `✅ Purchase complete! ${mentionTag(sender)} bought *${(card as any)?.name || "card"}* for $${formatNumber((sell as any).price)}.`, mentions: [sender, (sell as any).seller_id] });
      return;
    }
    await sendText(from, "❌ No pending offer found.");
    return;
  }

  if (cmd === "decline") {
    const trade = await getPendingTrade(sender);
    if (trade) { await updateTradeStatus((trade as any).id, "declined"); await sendText(from, "❌ Trade declined."); return; }
    const sell = await getPendingSellOffer(sender);
    if (sell) { await updateSellOfferStatus((sell as any).id, "declined"); await sendText(from, "❌ Offer declined."); return; }
    await sendText(from, "❌ No pending offer found.");
    return;
  }

  if (cmd === "deletecard" || cmd === "delcard") {
    if (!ctx.isOwner && !(await getStaff(sender))) { await sendText(from, "❌ Only staff can delete cards."); return; }
    const copyId = (args[0] || "").toUpperCase();
    if (!copyId) { await sendText(from, "❌ Usage: .delcard <copy_id>\nExample: .delcard AB3K9"); return; }
    const card = await getUserCardByCopyId(copyId);
    if (!card) { await sendText(from, `❌ No card found with ID: *${copyId}*`); return; }
    const { deleteUserCardByCopyIdAdmin } = await import("../db/queries.js");
    const deleted = await deleteUserCardByCopyIdAdmin(copyId);
    if (!deleted) { await sendText(from, `❌ Could not delete card *${copyId}*.`); return; }
    const u = await getUser((card as any).user_id);
    const ownerDisplay = (u as any)?.name || extractNumberFromJid((card as any).user_id);
    await sendText(from, `🗑️ *Card Deleted*\n\n*Card:* ${(card as any).card_name}\n*Tier:* ${(card as any).tier}\n*Copy ID:* ${copyId}\n*Owner:* ${ownerDisplay}`);
    return;
  }

  if (cmd === "resell" || cmd === "sellback") {
    // Self-service instant sell-back: no buyer needed, unlike .sellc
    // (peer-to-peer trade). Removes the card from your own collection and
    // pays a fixed tier-based amount immediately — for cards you got by
    // mistake (e.g. accidentally claimed the wrong spawn) or just don't
    // want anymore. This is deliberately a flat guaranteed price, not
    // market-based, to keep it simple and impossible to exploit for
    // arbitrage against .sellc's player-set pricing.
    const copyId = (args[0] || "").toUpperCase();
    if (!copyId) { await sendText(from, "❌ Usage: .resell <copy_id>\nExample: .resell AB3K9\n\nSells a card from YOUR OWN collection straight back for coins — no buyer needed. Use *.coll* to see your copy IDs."); return; }
    const card = await getUserCardByCopyId(copyId);
    if (!card) { await sendText(from, `❌ No card found with copy ID: *${copyId}*`); return; }
    if (extractNumberFromJid((card as any).user_id) !== extractNumberFromJid(sender)) {
      await sendText(from, "❌ That card isn't in your collection."); return;
    }
    if ((card as any).tier === "TX" || (card as any).tier === "TZ") {
      await sendText(from, `❌ *${(card as any).card_name}* is an event-exclusive card and can't be sold back for coins.\nAsk a mod/staff member if you obtained it by mistake and need it removed.`);
      return;
    }
    const value = RESELL_VALUES[(card as any).tier] ?? 100;
    const deleted = await deleteUserCardByCopyId(copyId, sender);
    if (!deleted) { await sendText(from, `❌ Could not sell card *${copyId}*.`); return; }
    const freshUser = await getUser(sender);
    await updateUser(sender, { balance: (freshUser?.balance || 0) + value });
    await sendText(from, `💰 *Sold Back*\n\n*Card:* ${(card as any).card_name}\n*Tier:* ${(card as any).tier}\n*Copy ID:* ${copyId}\n*Received:* $${formatNumber(value)}`);
    return;
  }

  if (cmd === "fuse" || cmd === "fusion" || cmd === "forge") {
    const FUSE_RECIPES: Record<string, { cost: number; next: string }> = {
      T1:{ cost:10,next:"T2" }, T2:{ cost:8,next:"T3" }, T3:{ cost:6,next:"T4" }, T4:{ cost:5,next:"T5" }, T5:{ cost:5,next:"T6" },
    };
    const tierArg = (args[0] || "").toUpperCase();
    if (!tierArg || !FUSE_RECIPES[tierArg]) {
      await sendText(from,
        `⚗️ *Card Fusion*\n\nSacrifice lower-tier duplicates to fuse a card of higher power!\n\n*Fusion Recipes:*\n` +
        Object.entries(FUSE_RECIPES).map(([t, r]) => `  ${getTierEmoji(t)} ${r.cost}× ${t} → 1× ${r.next}`).join("\n") +
        `\n\nUsage: *.fuse <tier>* to see your eligible cards and pick exactly which ones to sacrifice.\nExample: *.fuse T1*`
      );
      return;
    }
    const recipe = FUSE_RECIPES[tierArg];
    const allUserCards = await getUserCards(userId);
    const eligible = (allUserCards as any[]).filter((c: any) => c.tier === tierArg && !c.lent_to);
    if (eligible.length < recipe.cost) {
      await sendText(from, `❌ *Not enough cards!*\n\nYou need *${recipe.cost}× ${tierArg}* cards to fuse a ${recipe.next}.\nYou currently have *${eligible.length}* eligible ${tierArg} cards (non-lent).`);
      return;
    }

    // Pull out an optional trailing "as <card name>" before parsing copy IDs,
    // so those tokens are never mistaken for copy IDs.
    const restArgs = args.slice(1);
    const asIdx = restArgs.findIndex((a) => a.toLowerCase() === "as");
    const wantedTargetName = asIdx !== -1 ? restArgs.slice(asIdx + 1).join(" ").trim() : null;
    const copyIdArgs = asIdx !== -1 ? restArgs.slice(0, asIdx) : restArgs;

    // Player must explicitly list which copy_ids to sacrifice — never an
    // automatic pick. This protects a player's favorite/notable copy (e.g.
    // a rare variant) from being burned just because it happened to load
    // first when the collection was fetched.
    const selectedCopyIds = copyIdArgs.map((a) => a.trim()).filter(Boolean);

    if (selectedCopyIds.length === 0) {
      const list = eligible.map((c: any) => `\`${c.copy_id}\` — ${c.name}`).join("\n");
      await sendText(from,
        `⚗️ *Fuse ${recipe.cost}× ${tierArg} → 1× ${recipe.next}*\n\n` +
        `Pick exactly *${recipe.cost}* copy IDs from your ${tierArg} cards below:\n\n${list}\n\n` +
        `Usage: *.fuse ${tierArg} <copy_id1> <copy_id2> ...* (${recipe.cost} total)`
      );
      return;
    }

    if (selectedCopyIds.length !== recipe.cost) {
      await sendText(from, `❌ You need to select exactly *${recipe.cost}* copy IDs (you gave ${selectedCopyIds.length}). Run *.fuse ${tierArg}* with no copy IDs to see the list again.`);
      return;
    }

    const eligibleByCopyId = new Map(eligible.map((c: any) => [String(c.copy_id), c]));
    const invalidIds = selectedCopyIds.filter((id) => !eligibleByCopyId.has(id));
    if (invalidIds.length > 0) {
      await sendText(from, `❌ These copy IDs aren't valid eligible *${tierArg}* cards of yours: ${invalidIds.map((i) => `\`${i}\``).join(", ")}`);
      return;
    }
    const uniqueIds = new Set(selectedCopyIds);
    if (uniqueIds.size !== selectedCopyIds.length) {
      await sendText(from, `❌ You listed the same copy ID more than once.`);
      return;
    }

    // Let the player choose which specific target card they receive, when
    // more than one exists at the destination tier — fusion should never
    // hand back an unpredictable random card.
    const nextTierCards = await col("cards").find({ tier: recipe.next }).project({ _id: 1, name: 1, series: 1, tier: 1 }).limit(50).toArray();
    if (nextTierCards.length === 0) { await sendText(from, `❌ No ${recipe.next} cards exist in the database yet. Check back later!`); return; }

    let chosenTarget: any = null;
    if (wantedTargetName) {
      const wantedLower = wantedTargetName.toLowerCase();
      chosenTarget = nextTierCards.find((c: any) => c.name.toLowerCase().includes(wantedLower));
      if (!chosenTarget) {
        const options = nextTierCards.slice(0, 20).map((c: any) => `• ${c.name}${c.series ? ` (${c.series})` : ""}`).join("\n");
        await sendText(from, `❌ No *${recipe.next}* card matching "${wantedTargetName}" found. Available options:\n${options}${nextTierCards.length > 20 ? `\n...and ${nextTierCards.length - 20} more` : ""}`);
        return;
      }
    } else if (nextTierCards.length > 1) {
      const options = nextTierCards.slice(0, 20).map((c: any) => `• ${c.name}${c.series ? ` (${c.series})` : ""}`).join("\n");
      await sendText(from,
        `⚗️ Multiple *${recipe.next}* cards are possible. Add *as <card name>* to choose exactly which one you receive:\n\n${options}` +
        `${nextTierCards.length > 20 ? `\n...and ${nextTierCards.length - 20} more` : ""}\n\n` +
        `Example: *.fuse ${tierArg} ${selectedCopyIds.join(" ")} as ${nextTierCards[0].name}*`
      );
      return;
    } else {
      chosenTarget = nextTierCards[0];
    }

    const toDelete = selectedCopyIds.map((id) => eligibleByCopyId.get(id));
    for (const uc of toDelete) { await deleteUserCardByCopyId(String(uc.copy_id), userId); }
    const newCopyRowId = await giveCard(userId, String(chosenTarget._id));
    const newCopyRow = newCopyRowId ? await col("user_cards").findOne({ _id: newCopyRowId as any }) : null;
    const copyIdDisplay = (newCopyRow as any)?.copy_id || "—";
    await sendText(from,
      `⚗️ *Fusion Successful!*\n\nBurned *${recipe.cost}× ${getTierEmoji(tierArg)} ${tierArg}* cards:\n` +
      toDelete.map((c: any) => `  • ${c.name} (\`${c.copy_id}\`)`).join("\n") +
      `\n\n→ Fused: *${getTierEmoji(recipe.next)} ${chosenTarget.name}* (${recipe.next})\n📋 Copy ID: \`${copyIdDisplay}\`\n\nType *.cards* to see your collection!`
    );
    return;
  }
}

