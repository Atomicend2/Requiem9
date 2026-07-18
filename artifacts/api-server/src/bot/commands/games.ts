import type { CommandContext } from "./index.js";
import { sendText } from "../connection.js";
import { col } from "../db/mongo.js";
import { ensureUser, updateUser, getUser, getMentionName } from "../db/queries.js";
import { formatNumber, generateId, mentionTag } from "../utils.js";
import type { WASocket } from "@whiskeysockets/baileys";
import { logger } from "../../lib/logger.js";

const wcgJoinTimers = new Map<string, NodeJS.Timeout>();
const wcgWordTimers = new Map<string, NodeJS.Timeout>();

function normalizePlayer(id: string): string {
  return id.split("@")[0].split(":")[0].replace(/\D/g, "") || id.split("@")[0].split(":")[0];
}

function samePlayer(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return normalizePlayer(a) === normalizePlayer(b);
}

const WCG_START_WORDS = [
  "apple","banana","cat","dog","elephant","forest","guitar","house","island","jungle",
  "kite","lemon","mango","night","ocean","planet","queen","river","stone","tiger",
  "umbrella","violet","water","xerox","yellow","zebra",
];

function getWcgTimeLimit(roundNumber: number): number {
  const reduction = Math.floor(roundNumber / 3) * 5;
  return Math.max(10, 60 - reduction);
}

async function startWcgGame(sock: WASocket, from: string, gameId: string, players: string[]): Promise<void> {
  const startWord = WCG_START_WORDS[Math.floor(Math.random() * WCG_START_WORDS.length)];
  await col("word_chain").updateOne(
    { _id: gameId as any },
    { $set: { status: "active", last_word: startWord, used_words: JSON.stringify([startWord]), current_player: 0, round_number: 0 } }
  );
  const playerTags = players.map((p) => `${mentionTag(p)}`).join(", ");
  const timeLimit = getWcgTimeLimit(0);
  await sock.sendMessage(from, {
    text: `📝 *Word Chain Started!*\n\nPlayers: ${playerTags}\n\nFirst word: *${startWord}*\nNext word must start with: *${startWord.slice(-1).toUpperCase()}*\n\n${mentionTag(players[0])}'s turn! ⏱️ ${timeLimit} seconds!`,
    mentions: players,
  });
  startWcgWordTimer(sock, from, gameId, players, 0, 0);
}

function startWcgWordTimer(sock: WASocket, from: string, gameId: string, players: string[], playerIdx: number, roundNumber: number): void {
  const prev = wcgWordTimers.get(from);
  if (prev) clearTimeout(prev);
  const timeLimit = getWcgTimeLimit(roundNumber);
  const timer = setTimeout(async () => {
    wcgWordTimers.delete(from);
    const game = await col("word_chain").findOne({ _id: gameId as any, status: "active" });
    if (!game) return;
    const currentPlayers: string[] = JSON.parse(game.players);
    const timedOut = currentPlayers[game.current_player];
    if (!timedOut) return;
    currentPlayers.splice(game.current_player, 1);
    await sock.sendMessage(from, { text: `⏰ ${mentionTag(timedOut)} ran out of time and was *eliminated*!`, mentions: [timedOut] });
    if (currentPlayers.length <= 1) {
      await col("word_chain").updateOne({ _id: gameId as any }, { $set: { status: "ended" } });
      await sock.sendMessage(from, { text: `🏆 @${currentPlayers[0] ? await getMentionName(currentPlayers[0]) : "Nobody"} wins Word Chain! 🎉`, mentions: currentPlayers });
      return;
    }
    const nextIdx = game.current_player % currentPlayers.length;
    const nextRound = game.round_number + 1;
    await col("word_chain").updateOne(
      { _id: gameId as any },
      { $set: { players: JSON.stringify(currentPlayers), current_player: nextIdx, round_number: nextRound } }
    );
    await sock.sendMessage(from, { text: `${mentionTag(currentPlayers[nextIdx])}'s turn! Word must start with *${game.last_word.slice(-1).toUpperCase()}* — ⏱️ ${getWcgTimeLimit(nextRound)}s!`, mentions: [currentPlayers[nextIdx]] });
    startWcgWordTimer(sock, from, gameId, currentPlayers, nextIdx, nextRound);
  }, timeLimit * 1000);
  wcgWordTimers.set(from, timer);
}

function createTTTBoard(): string[][] {
  return [["1","2","3"],["4","5","6"],["7","8","9"]];
}

function renderTTT(board: string[][]): string {
  return board.map((row) => row.join(" | ")).join("\n---------\n");
}

function checkTTTWinner(b: string[][]): string | null {
  const lines = [
    [b[0][0],b[0][1],b[0][2]],[b[1][0],b[1][1],b[1][2]],[b[2][0],b[2][1],b[2][2]],
    [b[0][0],b[1][0],b[2][0]],[b[0][1],b[1][1],b[2][1]],[b[0][2],b[1][2],b[2][2]],
    [b[0][0],b[1][1],b[2][2]],[b[0][2],b[1][1],b[2][0]],
  ];
  for (const [a, bb, c] of lines) {
    if (!["1","2","3","4","5","6","7","8","9"].includes(a) && a === bb && bb === c) return a;
  }
  return null;
}

const UNO_COLORS = ["Red","Green","Blue","Yellow"];
const UNO_VALUES = ["0","1","2","3","4","5","6","7","8","9","Skip","Reverse","Draw2"];
const UNO_SPECIALS = ["Wild","Wild Draw4"];

function createUnoDeck(): string[] {
  const deck: string[] = [];
  for (const color of UNO_COLORS) {
    for (const val of UNO_VALUES) {
      deck.push(`${color} ${val}`);
      if (val !== "0") deck.push(`${color} ${val}`);
    }
  }
  for (const s of UNO_SPECIALS) { for (let i = 0; i < 4; i++) deck.push(s); }
  return shuffleArr(deck);
}

function shuffleArr<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function canPlayUno(card: string, topCard: string, wildColor: string): boolean {
  if (card.startsWith("Wild")) return true;
  const [cardColor, cardVal] = card.split(" ");
  const effectiveTopColor = wildColor || topCard.split(" ")[0];
  const topVal = topCard.split(" ")[1];
  return cardColor === effectiveTopColor || cardVal === topVal;
}

function unoCardPoints(card: string): number {
  if (card === "Wild" || card === "Wild Draw4") return 50;
  const val = card.split(" ")[1];
  if (val === "Skip" || val === "Reverse" || val === "Draw2") return 20;
  return parseInt(val, 10) || 0;
}

export async function handleGames(ctx: CommandContext): Promise<void> {
  const { from, sender, args, command: cmd, msg, sock, resolvedMentions } = ctx;
  const rawUser = await getUser(sender.split("@")[0].split(":")[0]);
  const userId = rawUser?.id || sender.split("@")[0].split(":")[0];

  if (cmd === "tictactoe" || cmd === "ttt") {
    const challenged = resolvedMentions[0];
    if (!challenged) { await sendText(from, "❌ Mention someone to play! Usage: .ttt @user"); return; }
    if (challenged === sender) { await sendText(from, "❌ You can't play against yourself!"); return; }
    const existingGame = await col("games").findOne({ group_id: from, type: "ttt", status: { $ne: "ended" } });
    if (existingGame) { await sendText(from, "❌ A game is already active. Use .stopgame to stop it."); return; }
    const board = createTTTBoard();
    const gameId = generateId(8);
    await col("games").insertOne({ _id: gameId as any, type: "ttt", group_id: from, player1: sender, player2: challenged, state: JSON.stringify(board), current_turn: sender, status: "active" });
    await sock.sendMessage(from, {
      text: `⭕❌ *Tic Tac Toe*\n\n${mentionTag(sender)} (❌) vs ${mentionTag(challenged)} (⭕)\n\n${renderTTT(board)}\n\n${mentionTag(sender)}'s turn! Type 1-9 to place.`,
      mentions: [sender, challenged],
    });
    return;
  }

  if (cmd === "connectfour" || cmd === "c4") {
    const challenged = resolvedMentions[0];
    if (!challenged) { await sendText(from, "❌ Mention someone to play! Usage: .c4 @user"); return; }
    const board = Array.from({length:6}, () => Array(7).fill("⚫"));
    const gameId = generateId(8);
    await col("games").insertOne({ _id: gameId as any, type: "c4", group_id: from, player1: sender, player2: challenged, state: JSON.stringify(board), current_turn: sender, status: "active" });
    const render = board.map((r) => r.join("")).join("\n") + "\n1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣";
    await sock.sendMessage(from, {
      text: `🔴🟡 *Connect Four*\n\n${mentionTag(sender)} (🔴) vs ${mentionTag(challenged)} (🟡)\n\n${render}\n\n${mentionTag(sender)}'s turn! Type 1-7 to drop.`,
      mentions: [sender, challenged],
    });
    return;
  }

  if (cmd === "stopgame") {
    const jt = wcgJoinTimers.get(from); if (jt) { clearTimeout(jt); wcgJoinTimers.delete(from); }
    const wt = wcgWordTimers.get(from); if (wt) { clearTimeout(wt); wcgWordTimers.delete(from); }
    const game = await col("games").findOne({ group_id: from, status: "active" });
    if (!game) { await sendText(from, "❌ No active game."); return; }
    if (!ctx.isAdmin && !ctx.isOwner && game.player1 !== sender && game.player2 !== sender) { await sendText(from, "❌ Only admins or players can stop the game."); return; }
    await col("games").updateOne({ _id: game._id }, { $set: { status: "ended" } });
    await sendText(from, "✅ Game stopped.");
    return;
  }

  if (cmd === "truthordare" || cmd === "td") {
    const truths = ["What's the most embarrassing thing you've done?","Who was your first crush?","What's a secret you've never told anyone?","What's the most childish thing you still do?","What's your biggest fear?"];
    const dares = ["Send a voice note singing a song!","Change your status to something embarrassing for 1 hour!","Send your most embarrassing photo!","Text your crush right now!","Do 10 push-ups and send proof!"];
    const isTruth = Math.random() < 0.5;
    const list = isTruth ? truths : dares;
    await sendText(from, `${isTruth ? "🤔 *TRUTH*" : "💥 *DARE*"}\n\n${list[Math.floor(Math.random() * list.length)]}`);
    return;
  }

  if (cmd === "truth") {
    const truths = ["What's your biggest regret?","Have you ever lied to your best friend?","What's something you've stolen?","Who do you have a crush on right now?","What's your darkest secret?"];
    await sendText(from, `🤔 *Truth:*\n\n${truths[Math.floor(Math.random() * truths.length)]}`);
    return;
  }

  if (cmd === "dare") {
    const dares = ["Send a voice note of yourself saying a nursery rhyme!","Change your profile picture for 1 hour!","Tag 3 people and say something nice!","Do a handstand and send a photo!","Tell a joke right now!"];
    await sendText(from, `💥 *Dare:*\n\n${dares[Math.floor(Math.random() * dares.length)]}`);
    return;
  }

  if (cmd === "uno") {
    const existing = await col("uno_games").findOne({ group_id: from, status: "waiting" });
    if (existing) {
      const players: string[] = JSON.parse(existing.players);
      if (!players.includes(sender)) {
        players.push(sender);
        await col("uno_games").updateOne({ _id: existing._id }, { $set: { players: JSON.stringify(players) } });
        await sock.sendMessage(from, { text: `🃏 ${mentionTag(sender)} joined UNO! ${players.length} players. Type .startuno to start.`, mentions: [sender] });
      } else {
        await sendText(from, "❌ You're already in the game!");
      }
      return;
    }
    const gameId = generateId(8);
    await col("uno_games").insertOne({ _id: gameId as any, group_id: from, players: JSON.stringify([sender]), deck: "[]", discard: "[]", status: "waiting", current_player: 0, direction: 1, wild_color: "", uno_called: "[]" });
    await sock.sendMessage(from, { text: `🃏 *UNO* started! ${mentionTag(sender)} joined. Others type *.uno* to join!\nType *.startuno* when ready.`, mentions: [sender] });
    return;
  }

  if (cmd === "startuno") {
    const game = await col("uno_games").findOne({ group_id: from, status: "waiting" });
    if (!game) { await sendText(from, "❌ No UNO game waiting. Use .uno to start one."); return; }
    const players: string[] = JSON.parse(game.players);
    if (players.length < 2) { await sendText(from, "❌ Need at least 2 players!"); return; }
    const deck = createUnoDeck();
    for (const p of players) {
      const hand = deck.splice(0, 7);
      await col("uno_hands").updateOne({ game_id: String(game._id), user_id: p }, { $set: { game_id: String(game._id), user_id: p, cards: JSON.stringify(hand) } }, { upsert: true });
    }
    let topCard = deck.splice(0, 1)[0];
    while (topCard === "Wild Draw4") { deck.push(topCard); shuffleArr(deck); topCard = deck.splice(0, 1)[0]; }
    await col("uno_games").updateOne({ _id: game._id }, { $set: { deck: JSON.stringify(deck), discard: JSON.stringify([topCard]), status: "active", wild_color: "", uno_called: "[]", current_player: 0, direction: 1 } });
    await sock.sendMessage(from, {
      text: `🃏 *UNO Started!*\n\nPlayers: ${players.map((p) => mentionTag(p)).join(", ")}\nTop card: *${topCard}*\n\n${mentionTag(players[0])}'s turn!\nSending your cards to your DM now...\nType *.unohand* if you missed your cards.\nType *.unoplay [number]* to play a card.\nFor Wild cards: *.unoplay [number] [Red|Green|Blue|Yellow]*\nType *.unodraw* to draw a card.\nType *.unouno* when you're down to 2 cards!`,
      mentions: players,
    });

    // Auto-DM every player their starting hand — no need to type .unohand manually.
    // We send with a short stagger (500ms) to avoid rate-limiting.
    const gameId = String(game._id);
    for (let pi = 0; pi < players.length; pi++) {
      const p = players[pi];
      if (pi > 0) await new Promise((r) => setTimeout(r, 500));
      try {
        const [check] = await sock.onWhatsApp(p).catch(() => [null]);
        if (check && !check.exists) continue; // DM unreachable — skip silently
        const hand = await col("uno_hands").findOne({ game_id: gameId, user_id: p });
        if (!hand) continue;
        const cards: string[] = JSON.parse(hand.cards);
        const handText = `🃏 *Your UNO Starting Hand* (7 cards)\n\n${cards.map((c, i) => `${i+1}. ${c}`).join("\n")}\n\nTop card: *${topCard}*\n\nIt's ${mentionTag(players[0])}'s turn first.\nType *.unoplay [number]* when it's your turn.`;
        await sock.sendMessage(p, { text: handText }).catch(() => {});
      } catch { /* DM failed — player can use .unohand */ }
    }
    return;
  }

  if (cmd === "unohand") {
    const game = await col("uno_games").findOne({ group_id: from, status: "active" });
    if (!game) { await sendText(from, "❌ No active UNO game."); return; }
    const hand = await col("uno_hands").findOne({ game_id: String(game._id), user_id: sender });
    if (!hand) { await sendText(from, "❌ You're not in this game."); return; }
    const cards: string[] = JSON.parse(hand.cards);
    const topCard = JSON.parse(game.discard).slice(-1)[0];
    const wildColor = game.wild_color || "";
    const effectiveTop = wildColor ? `${wildColor} (Wild)` : topCard;
    const text = `🃏 *Your UNO Hand* (${cards.length} cards)\n\n${cards.map((c, i) => `${i+1}. ${c}`).join("\n")}\n\nTop card: *${effectiveTop}*\n\n${wildColor ? `_Effective color: *${wildColor}*_` : ""}`;
    // Previously this just tried sock.sendMessage(sender, ...) and reported
    // "Hand sent to your DM!" as long as the call didn't throw — but a call
    // not throwing doesn't guarantee the DM actually landed for every
    // player. Some players' JIDs resolve to a real, DM-able phone address
    // reliably; others (depending on their own lid-linking history) don't,
    // and the message can silently go nowhere while still reporting
    // success. Verify the recipient is reachable first, and if the DM
    // genuinely can't be delivered, say so honestly instead of a false
    // positive — do NOT fall back to posting the hand publicly in the
    // group, since that would leak a player's cards to everyone.
    try {
      const [check] = await sock.onWhatsApp(sender).catch(() => [null]);
      if (check && !check.exists) {
        await sendText(from, `❌ Couldn't reach your DM (${mentionTag(sender)}) — make sure the bot has your number correctly linked and try messaging the bot directly first.`, [sender]);
        return;
      }
      await sock.sendMessage(sender, { text });
      await sendText(from, "📬 Hand sent to your DM!");
    } catch (err) {
      logger.warn({ err, sender }, "Failed to DM UNO hand");
      await sendText(from, `❌ Couldn't send your hand to DM. Try messaging the bot directly first (send it any message), then run *.unohand* again.`);
    }
    return;
  }

  if (cmd === "unouno") {
    const game = await col("uno_games").findOne({ group_id: from, status: "active" });
    if (!game) { await sendText(from, "❌ No active UNO game."); return; }
    const hand = await col("uno_hands").findOne({ game_id: String(game._id), user_id: sender });
    if (!hand) { await sendText(from, "❌ You're not in this game."); return; }
    const cards: string[] = JSON.parse(hand.cards);
    if (cards.length !== 2) { await sendText(from, `❌ You can only call UNO when you have exactly 2 cards (you have ${cards.length}).`); return; }
    const unoCalled: string[] = JSON.parse(game.uno_called || "[]");
    if (unoCalled.includes(sender)) { await sendText(from, "✅ You already called UNO!"); return; }
    unoCalled.push(sender);
    await col("uno_games").updateOne({ _id: game._id }, { $set: { uno_called: JSON.stringify(unoCalled) } });
    await sock.sendMessage(from, { text: `🃏 ${mentionTag(sender)} calls *UNO!* 🔔`, mentions: [sender] });
    return;
  }

  if (cmd === "unocatch") {
    const game = await col("uno_games").findOne({ group_id: from, status: "active" });
    if (!game) { await sendText(from, "❌ No active UNO game."); return; }
    const players: string[] = JSON.parse(game.players);
    const unoCalled: string[] = JSON.parse(game.uno_called || "[]");
    let caught = false;
    for (const p of players) {
      if (p === sender) continue;
      const pHand = await col("uno_hands").findOne({ game_id: String(game._id), user_id: p });
      if (!pHand) continue;
      const pCards: string[] = JSON.parse(pHand.cards);
      if (pCards.length === 1 && !unoCalled.includes(p)) {
        const deck: string[] = JSON.parse(game.deck);
        const drawn = deck.splice(0, 2);
        pCards.push(...drawn);
        await col("uno_hands").updateOne({ game_id: String(game._id), user_id: p }, { $set: { cards: JSON.stringify(pCards) } });
        await col("uno_games").updateOne({ _id: game._id }, { $set: { deck: JSON.stringify(deck) } });
        await sock.sendMessage(from, { text: `🚨 ${mentionTag(sender)} caught ${mentionTag(p)} forgetting to call UNO! ${mentionTag(p)} draws 2 cards as penalty! 😅`, mentions: [sender, p] });
        caught = true;
        break;
      }
    }
    if (!caught) await sendText(from, "❌ No one to catch right now!");
    return;
  }

  if (cmd === "unoplay") {
    const cardIdx = parseInt(args[0]) - 1;
    const chosenColor = args[1] ? UNO_COLORS.find((c) => c.toLowerCase() === args[1].toLowerCase()) : undefined;
    const game = await col("uno_games").findOne({ group_id: from, status: "active" });
    if (!game) { await sendText(from, "❌ No active UNO game."); return; }
    const players: string[] = JSON.parse(game.players);
    const currentPlayer = players[game.current_player];
    if (!samePlayer(currentPlayer, sender)) { await sendText(from, "❌ It's not your turn!"); return; }
    const handRow = await col("uno_hands").findOne({ game_id: String(game._id), user_id: sender });
    if (!handRow) { await sendText(from, "❌ You're not in this game."); return; }
    const hand: string[] = JSON.parse(handRow.cards);
    if (isNaN(cardIdx) || cardIdx < 0 || cardIdx >= hand.length) { await sendText(from, `❌ Invalid card number. You have ${hand.length} cards.`); return; }
    const card = hand[cardIdx];
    const discard: string[] = JSON.parse(game.discard);
    const topCard = discard[discard.length - 1];
    const wildColor: string = game.wild_color || "";
    if (card === "Wild Draw4") {
      const effectiveColor = wildColor || topCard.split(" ")[0];
      const hasMatchingColor = hand.some((c, i) => i !== cardIdx && !c.startsWith("Wild") && c.split(" ")[0] === effectiveColor);
      if (hasMatchingColor) { await sendText(from, `❌ You can only play *Wild Draw4* if you have no cards matching the current color (*${effectiveColor}*).`); return; }
    }
    if (!canPlayUno(card, topCard, wildColor)) { await sendText(from, `❌ Can't play *${card}* on *${wildColor ? `${wildColor} (Wild)` : topCard}*!`); return; }
    if (card.startsWith("Wild") && !chosenColor) {
      await sendText(from, `🌈 *${card}* is a Wild card!\n\nChoose a color:\n*.unoplay ${cardIdx + 1} Red*\n*.unoplay ${cardIdx + 1} Green*\n*.unoplay ${cardIdx + 1} Blue*\n*.unoplay ${cardIdx + 1} Yellow*`);
      return;
    }
    hand.splice(cardIdx, 1);
    discard.push(card);
    await col("uno_hands").updateOne({ game_id: String(game._id), user_id: sender }, { $set: { cards: JSON.stringify(hand) } });
    const unoCalled: string[] = JSON.parse(game.uno_called || "[]");
    const newUnoCalled = unoCalled.filter((p) => p !== sender);
    if (hand.length === 1 && unoCalled.includes(sender)) {
      await sock.sendMessage(from, { text: `🃏 ${mentionTag(sender)} has *1 card left!* 🔔 UNO!`, mentions: [sender] });
    }
    if (hand.length === 0) {
      let totalPoints = 0;
      for (const p of players) {
        if (samePlayer(p, sender)) continue;
        const pHand = await col("uno_hands").findOne({ game_id: String(game._id), user_id: p });
        if (pHand) { const pCards: string[] = JSON.parse(pHand.cards); totalPoints += pCards.reduce((sum, c) => sum + unoCardPoints(c), 0); }
      }
      await col("uno_games").updateOne({ _id: game._id }, { $set: { status: "ended" } });
      await sock.sendMessage(from, { text: `🎉 ${mentionTag(sender)} played *${card}* and *WON UNO*! 🏆\n\n*Round Points: ${totalPoints}*\n_(First to 500 points wins the game)_`, mentions: [sender] });
      return;
    }
    let direction: number = game.direction;
    let newWildColor = card.startsWith("Wild") ? (chosenColor || "") : "";
    let nextPlayer = (game.current_player + direction + players.length) % players.length;
    if (card.includes("Skip")) { nextPlayer = players.length === 2 ? game.current_player : (nextPlayer + direction + players.length) % players.length; }
    if (card.includes("Reverse")) {
      if (players.length === 2) { nextPlayer = game.current_player; }
      else { direction = -game.direction; nextPlayer = (game.current_player + direction + players.length) % players.length; }
    }
    if (card.includes("Draw2")) {
      const nextHand = await col("uno_hands").findOne({ game_id: String(game._id), user_id: players[nextPlayer] });
      if (nextHand) {
        const deck: string[] = JSON.parse(game.deck);
        const drawn = deck.splice(0, 2);
        const nh: string[] = JSON.parse(nextHand.cards); nh.push(...drawn);
        await col("uno_hands").updateOne({ game_id: String(game._id), user_id: players[nextPlayer] }, { $set: { cards: JSON.stringify(nh) } });
        await col("uno_games").updateOne({ _id: game._id }, { $set: { deck: JSON.stringify(deck) } });
      }
      nextPlayer = (nextPlayer + direction + players.length) % players.length;
    }
    if (card === "Wild Draw4") {
      const nextHand = await col("uno_hands").findOne({ game_id: String(game._id), user_id: players[nextPlayer] });
      if (nextHand) {
        const deck: string[] = JSON.parse(game.deck);
        const drawn = deck.splice(0, 4);
        const nh: string[] = JSON.parse(nextHand.cards); nh.push(...drawn);
        await col("uno_hands").updateOne({ game_id: String(game._id), user_id: players[nextPlayer] }, { $set: { cards: JSON.stringify(nh) } });
        await col("uno_games").updateOne({ _id: game._id }, { $set: { deck: JSON.stringify(deck) } });
      }
      nextPlayer = (nextPlayer + direction + players.length) % players.length;
    }
    await col("uno_games").updateOne({ _id: game._id }, { $set: { discard: JSON.stringify(discard), current_player: nextPlayer, direction, wild_color: newWildColor, uno_called: JSON.stringify(newUnoCalled) } });
    const effectiveColor = newWildColor ? ` → *${newWildColor}*` : "";
    await sock.sendMessage(from, {
      text: `🃏 ${mentionTag(sender)} played *${card}*!${effectiveColor}\nTop: ${card}${newWildColor ? ` (${newWildColor})` : ""}\n\n${mentionTag(players[nextPlayer])}'s turn! (${hand.length} cards left for ${mentionTag(sender)})`,
      mentions: [sender, players[nextPlayer]],
    });
    return;
  }

  if (cmd === "unodraw") {
    const game = await col("uno_games").findOne({ group_id: from, status: "active" });
    if (!game) { await sendText(from, "❌ No active UNO game."); return; }
    const players: string[] = JSON.parse(game.players);
    if (!samePlayer(players[game.current_player], sender)) { await sendText(from, "❌ Not your turn!"); return; }
    const deck: string[] = JSON.parse(game.deck);
    if (deck.length === 0) { await sendText(from, "❌ Deck is empty!"); return; }
    const drawn = deck.splice(0, 1)[0];
    const handRow = await col("uno_hands").findOne({ game_id: String(game._id), user_id: sender });
    if (!handRow) return;
    const hand: string[] = JSON.parse(handRow.cards);
    hand.push(drawn);
    await col("uno_hands").updateOne({ game_id: String(game._id), user_id: sender }, { $set: { cards: JSON.stringify(hand) } });
    await col("uno_games").updateOne({ _id: game._id }, { $set: { deck: JSON.stringify(deck) } });
    const discard: string[] = JSON.parse(game.discard);
    const topCard = discard[discard.length - 1];
    if (canPlayUno(drawn, topCard, game.wild_color || "")) {
      await sock.sendMessage(from, { text: `🃏 ${mentionTag(sender)} drew *${drawn}* — and it can be played!\nType *.unoplay ${hand.length}* to play it, or pass your turn.`, mentions: [sender] });
      return;
    }
    const nextPlayer = (game.current_player + game.direction + players.length) % players.length;
    await col("uno_games").updateOne({ _id: game._id }, { $set: { current_player: nextPlayer } });
    await sock.sendMessage(from, { text: `🃏 ${mentionTag(sender)} drew a card (no playable card — turn skipped).\n${mentionTag(players[nextPlayer])}'s turn!`, mentions: [sender, players[nextPlayer]] });
    return;
  }

  if (cmd === "wordchain" || cmd === "wcg") {
    const sub = args[0]?.toLowerCase();
    if (sub === "start") {
      const existing = await col("word_chain").findOne({ group_id: from, status: { $ne: "ended" } });
      if (existing) { await sendText(from, "❌ A Word Chain game is already active. Use .stopgame to cancel."); return; }
      const gameId = generateId(8);
      const joinDeadline = Math.floor(Date.now() / 1000) + 20;
      await col("word_chain").insertOne({ _id: gameId as any, group_id: from, players: JSON.stringify([sender]), status: "waiting", last_word: "", used_words: "[]", current_player: 0, round_number: 0, join_deadline: joinDeadline });
      await sock.sendMessage(from, { text: `📝 *Word Chain Game!*\n\n${mentionTag(sender)} started a game!\nType *.joinwcg* to join (20 seconds)\nType *.wcg go* to start early\n\n_Max 5 players. Auto-starts in 20s!_\n\n⏱️ Time starts at 60s and gets faster each round!`, mentions: [sender] });
      const joinTimer = setTimeout(async () => {
        wcgJoinTimers.delete(from);
        const game = await col("word_chain").findOne({ _id: gameId as any, status: "waiting" });
        if (!game) return;
        const players: string[] = JSON.parse(game.players);
        if (players.length < 2) { await col("word_chain").updateOne({ _id: gameId as any }, { $set: { status: "ended" } }); await sendText(from, "❌ Word Chain cancelled — not enough players joined (need 2+)."); return; }
        await startWcgGame(sock, from, gameId, players);
      }, 20000);
      wcgJoinTimers.set(from, joinTimer);
      return;
    }
    if (sub === "go") {
      const game = await col("word_chain").findOne({ group_id: from, status: "waiting" });
      if (!game) { await sendText(from, "❌ No waiting Word Chain game."); return; }
      const players: string[] = JSON.parse(game.players);
      if (players.length < 2) { await sendText(from, "❌ Need at least 2 players to start!"); return; }
      const joinTimer = wcgJoinTimers.get(from); if (joinTimer) { clearTimeout(joinTimer); wcgJoinTimers.delete(from); }
      await startWcgGame(sock, from, String(game._id), players);
      return;
    }
    await sendText(from, "📝 *Word Chain (WCG)*\n\n.wcg start — Start a new game\n.joinwcg — Join a game\n.wcg go — Force start early\n\nEach player must say the next word before time runs out.\n⏱️ Time limit starts at 60s and *decreases* each round!\nWrong word or timeout = eliminated!\nLast player standing wins! 🏆");
    return;
  }

  if (cmd === "joinwcg") {
    const game = await col("word_chain").findOne({ group_id: from, status: "waiting" });
    if (!game) { await sendText(from, "❌ No waiting Word Chain game. Use .wcg start to begin one."); return; }
    const players: string[] = JSON.parse(game.players);
    if (players.length >= 5) { await sendText(from, "❌ Game is full (max 5 players)."); return; }
    if (players.includes(sender)) { await sendText(from, "❌ You're already in!"); return; }
    players.push(sender);
    await col("word_chain").updateOne({ _id: game._id }, { $set: { players: JSON.stringify(players) } });
    await sock.sendMessage(from, { text: `✅ ${mentionTag(sender)} joined Word Chain! (${players.length}/5 players)`, mentions: [sender] });
    return;
  }

  if (cmd === "startbattle") {
    const challenged = resolvedMentions[0];
    if (!challenged) { await sendText(from, "❌ Mention someone to battle!"); return; }
    const { ensureRpg } = await import("../db/queries.js");
    const p1 = await ensureRpg(userId);
    const p2 = await ensureRpg(challenged);
    const damage = (atk: number, def: number) => Math.max(1, atk - Math.floor(def * 0.5) + Math.floor(Math.random() * 20) - 10);
    let p1hp = p1.hp, p2hp = p2.hp;
    let log = `⚔️ *Battle!*\n${mentionTag(sender)} (HP:${p1hp}) vs ${mentionTag(challenged)} (HP:${p2hp})\n\n`;
    let round = 0;
    while (p1hp > 0 && p2hp > 0 && round < 5) {
      round++;
      const d1 = damage(p1.attack, p2.defense), d2 = damage(p2.attack, p1.defense);
      p2hp -= d1; p1hp -= d2;
      log += `R${round}: ${mentionTag(sender)} dealt ${d1} dmg | ${mentionTag(challenged)} dealt ${d2} dmg\n`;
    }
    const winner = p1hp > p2hp ? sender : p2hp > p1hp ? challenged : null;
    log += `\n${winner ? `🏆 ${mentionTag(winner)} wins!` : "🤝 Draw!"}`;
    await sock.sendMessage(from, { text: log, mentions: [sender, challenged] });
    return;
  }
}

export async function handleGameInput(ctx: CommandContext, text: string): Promise<boolean> {
  const { from, sender, sock } = ctx;

  const tttGame = await col("games").findOne({ group_id: from, type: "ttt", status: "active" });
  if (tttGame) {
    const num = parseInt(text.trim());
    if (!isNaN(num) && num >= 1 && num <= 9 && samePlayer(tttGame.current_turn, sender)) {
      const board: string[][] = JSON.parse(tttGame.state);
      const piece = samePlayer(tttGame.player1, sender) ? "❌" : "⭕";
      let placed = false;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) { if (board[r][c] === String(num)) { board[r][c] = piece; placed = true; break; } }
        if (placed) break;
      }
      if (!placed) return false;
      const winner = checkTTTWinner(board);
      const nextTurn = samePlayer(tttGame.current_turn, tttGame.player1) ? tttGame.player2 : tttGame.player1;
      const flat = board.flat();
      const isDraw = !winner && !flat.some((v) => !["❌","⭕"].includes(v));
      if (winner) {
        await col("games").updateOne({ _id: tttGame._id }, { $set: { status: "ended" } });
        await sock.sendMessage(from, { text: `${renderTTT(board)}\n\n🏆 ${mentionTag(sender)} wins!`, mentions: [sender] });
      } else if (isDraw) {
        await col("games").updateOne({ _id: tttGame._id }, { $set: { status: "ended" } });
        await sendText(from, `${renderTTT(board)}\n\n🤝 It's a draw!`);
      } else {
        await col("games").updateOne({ _id: tttGame._id }, { $set: { state: JSON.stringify(board), current_turn: nextTurn } });
        await sock.sendMessage(from, { text: `${renderTTT(board)}\n\n${mentionTag(nextTurn)}'s turn!`, mentions: [nextTurn] });
      }
      return true;
    }
  }

  const c4Game = await col("games").findOne({ group_id: from, type: "c4", status: "active" });
  if (c4Game) {
    const colNum = parseInt(text.trim()) - 1;
    if (!isNaN(colNum) && colNum >= 0 && colNum <= 6 && samePlayer(c4Game.current_turn, sender)) {
      const board: string[][] = JSON.parse(c4Game.state);
      const piece = samePlayer(c4Game.player1, sender) ? "🔴" : "🟡";
      let row = -1;
      for (let r = 5; r >= 0; r--) { if (board[r][colNum] === "⚫") { row = r; break; } }
      if (row === -1) { await sendText(from, `❌ Column ${colNum + 1} is full! Choose another (1-7).`); return true; }
      board[row][colNum] = piece;
      const render = board.map((r) => r.join("")).join("\n") + "\n1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣";
      if (checkC4Winner(board, piece)) {
        await col("games").updateOne({ _id: c4Game._id }, { $set: { status: "ended" } });
        await sock.sendMessage(from, { text: `${render}\n\n🏆 ${mentionTag(sender)} wins Connect Four! 🎉`, mentions: [sender] });
        return true;
      }
      if (board[0].every((cell) => cell !== "⚫")) {
        await col("games").updateOne({ _id: c4Game._id }, { $set: { status: "ended" } });
        await sendText(from, `${render}\n\n🤝 It's a draw!`);
        return true;
      }
      const nextTurn = samePlayer(c4Game.current_turn, c4Game.player1) ? c4Game.player2 : c4Game.player1;
      const nextPiece = samePlayer(nextTurn, c4Game.player1) ? "🔴" : "🟡";
      await col("games").updateOne({ _id: c4Game._id }, { $set: { state: JSON.stringify(board), current_turn: nextTurn } });
      await sock.sendMessage(from, { text: `${render}\n\n${nextPiece} ${mentionTag(nextTurn)}'s turn! Type 1-7 to drop.`, mentions: [nextTurn] });
      return true;
    }
  }

  const wcgGame = await col("word_chain").findOne({ group_id: from, status: "active" });
  if (wcgGame && /^[a-zA-Z]+$/.test(text.trim())) {
    const word = text.trim().toLowerCase();
    const players: string[] = JSON.parse(wcgGame.players);
    const currentPlayer = players[wcgGame.current_player];
    if (currentPlayer !== sender) return false;
    const lastWord: string = wcgGame.last_word;
    const usedWords: string[] = JSON.parse(wcgGame.used_words);
    const roundNumber: number = wcgGame.round_number || 0;
    if (word[0] !== lastWord.slice(-1).toLowerCase()) {
      await sock.sendMessage(from, { text: `⚠️ ${mentionTag(sender)} — *${word}* doesn't start with *${lastWord.slice(-1).toUpperCase()}*! Try again before time runs out!`, mentions: [sender] });
      return true;
    }
    if (usedWords.includes(word)) {
      await sock.sendMessage(from, { text: `⚠️ ${mentionTag(sender)} — *${word}* was already used! Try a different word before time runs out!`, mentions: [sender] });
      return true;
    }
    const wordIsReal = await isRealWord(word);
    if (!wordIsReal) {
      await sock.sendMessage(from, { text: `⚠️ ${mentionTag(sender)} — *${word}* doesn't seem to be a real English word! Try again before time runs out!`, mentions: [sender] });
      return true;
    }
    const timer = wcgWordTimers.get(from); if (timer) { clearTimeout(timer); wcgWordTimers.delete(from); }
    usedWords.push(word);
    const nextIdx = (wcgGame.current_player + 1) % players.length;
    const nextRound = roundNumber + 1;
    await col("word_chain").updateOne({ _id: wcgGame._id }, { $set: { last_word: word, used_words: JSON.stringify(usedWords), current_player: nextIdx, round_number: nextRound } });
    await sock.sendMessage(from, { text: `✅ ${mentionTag(sender)} said *${word}*!\nNext: ${mentionTag(players[nextIdx])} — must start with *${word.slice(-1).toUpperCase()}* ⏱️ ${getWcgTimeLimit(nextRound)}s`, mentions: [sender, players[nextIdx]] });
    startWcgWordTimer(sock, from, String(wcgGame._id), players, nextIdx, nextRound);
    return true;
  }

  return false;
}

async function isRealWord(word: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return true; }
}

function checkC4Winner(board: string[][], piece: string): boolean {
  const R = 6, C = 7;
  for (let r = 0; r < R; r++) for (let c = 0; c <= C-4; c++) if ([0,1,2,3].every((d) => board[r][c+d] === piece)) return true;
  for (let c = 0; c < C; c++) for (let r = 0; r <= R-4; r++) if ([0,1,2,3].every((d) => board[r+d][c] === piece)) return true;
  for (let r = 0; r <= R-4; r++) for (let c = 0; c <= C-4; c++) if ([0,1,2,3].every((d) => board[r+d][c+d] === piece)) return true;
  for (let r = 0; r <= R-4; r++) for (let c = 3; c < C; c++) if ([0,1,2,3].every((d) => board[r+d][c-d] === piece)) return true;
  return false;
}
