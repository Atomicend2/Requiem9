import type { CommandContext } from "./index.js";
import { BOT_OWNER_LID, sendText, sendTextWithPreview } from "../connection.js";
import {
  getUser, ensureUser, updateUser, incrementUserFields, decrementUserFieldFloored, getInventory, addToInventory, removeFromInventory,
  getShop, getShopItem, getRichList, ensureRpg, getUserRank, getUserGuild, isBanned, getStaff, isMod,
  getXpLeaderboard, isBot, getAllFrames, getFrameById, equipFrame, getMentionName, getUserByLid,
} from "../db/queries.js";
import { col } from "../db/mongo.js";
import { mark } from "../cmd-trace.js";
import { ObjectId } from "mongodb";
import { formatNumber, timeAgo, mentionTag, getWebsiteUrl } from "../utils.js";
import { resolveMentionedJidAsync } from "../utils/identity.js";
import sharp from "sharp";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { FFMPEG_PATH } from "../../lib/ffmpeg-path.js";
import { xpNeededForLevel, cumulativeXpForLevel } from "../../lib/xp-curve.js";
import { CMD_COOLDOWNS } from "./gambling.js";
import { emojiIconSvg, stripUnrenderableGlyphs, sanitizeForDejaVuSans } from "../../lib/svg-text-safe.js";

const DAILY_AMOUNT = 1000;
const DAILY_COOLDOWN = 86400;
const WORK_COOLDOWN = 3600;
const DIG_COOLDOWN = 120;
const FISH_COOLDOWN = 120;
const BEG_COOLDOWN = 300;
const STEAL_COOLDOWN = 6000;
// Reward tuning: rates are set so effective $/hour scales with cooldown.
//   work  (1h CD):  ~$4,800/hr
//   dig/fish (2m CD): $400–$900 avg ~$650/use → ~$19,500/hr if spammed
//   beg   (5m CD): kept as flavor/very-low-income, ~$900/hr
const DIG_FISH_MIN_REWARD = 400;
const DIG_FISH_MAX_REWARD = 900;

const WORK_JOBS = [
  "You coded for 8 hours straight",
  "You delivered packages in the rain",
  "You served tables all night",
  "You fixed a mysterious server bug",
  "You designed a logo for a client",
  "You streamed for 4 hours",
  "You wrote an article",
  "You taught online classes",
];

const DIG_FINDS = [
  { item: "Ancient Coin" },
  { item: "Rusty Sword" },
  { item: "Buried Treasure" },
  { item: "Old Ring" },
  { item: "Gem Fragment" },
  { item: "Crystal Shard" },
  { item: "Golden Relic" },
];

const FISH_CATCHES = [
  { item: "Common Fish" },
  { item: "Rare Fish" },
  { item: "Legendary Fish" },
  { item: "Golden Koi" },
  { item: "Deep Sea Pearl" },
  { item: "Moonlit Tuna" },
  { item: "Treasure Clam" },
];

const BEG_RESPONSES = [
  "A kind stranger gave you some coins.",
  "Someone took pity on you.",
  "You found some loose change.",
  "A passerby dropped some coins.",
];

const execFileAsync = promisify(execFile);

async function runFfmpeg(args: string[]): Promise<void> {
  await execFileAsync(FFMPEG_PATH, ["-loglevel", "error", ...args], { maxBuffer: 10 * 1024 * 1024 });
}

const REGISTERED_ONLY_CMDS = new Set([
  "daily","work","dig","fish","beg","steal","donate",
  "richlist","richlistglobal","richlg","leaderboard","lb","stats",
  "buy","sell","use","withdraw","wid","wd","deposit","dep","roast",
  "shop",
]);

async function getBankCapExtra(userId: string): Promise<number> {
  // PERF/FIX (2026-07-19): previously matched via
  // { $expr: { $eq: [{ $toLower: "$name" }, "$$item"] } }, which computes
  // $toLower on every document and can never use an index — a full
  // shop_items collection scan on every call. This is called from .bal/
  // .balance and .deposit/.dep, both high-traffic commands, and matches
  // production logs showing extreme, highly variable latency (78s, 153s)
  // specifically on commands that call this function, under concurrent
  // load. Rewritten to use case-insensitive collation equality, which can
  // use the collation-based index added on shop_items.name in mongo.ts.
  // maxTimeMS added as a safety net regardless — this is user-facing
  // financial data, so failing fast with a clear error beats hanging.
  const results = await col("inventory").aggregate([
    { $match: { user_id: userId, quantity: { $gt: 0 } } },
    {
      $lookup: {
        from: "shop_items",
        localField: "item",
        foreignField: "name",
        as: "si",
      },
    },
    { $unwind: "$si" },
    { $match: { "si.effect": { $regex: "^bank_cap:" } } },
    { $project: { quantity: 1, effect: "$si.effect" } },
  ], { collation: { locale: "en", strength: 2 }, maxTimeMS: 5000 }).toArray();
  return results.reduce((sum: number, row: any) => {
    const cap = parseInt((row.effect as string).split(":")[1] || "0");
    return sum + (isNaN(cap) ? 0 : cap * (row.quantity || 1));
  }, 0);
}

export async function handleEconomy(ctx: CommandContext): Promise<void> {
  const { from, sender, args, command: cmd, groupMeta, resolvedMentions } = ctx;

  const user = await ensureUser(sender);
  mark("ensureUser");
  const userId = user?.id || sender.split("@")[0].split(":")[0];
  const now = Math.floor(Date.now() / 1000);

  if (REGISTERED_ONLY_CMDS.has(cmd) && !user.registered) {
    // FIX (2026-07-20): this used to tell every unregistered user to type
    // .reg, even though web registration already auto-links by phone
    // number with no further WhatsApp step needed (ensureUser never
    // touches `registered`, and .reg's own text says "links
    // automatically once you register"). If someone registered on the
    // web with a number that doesn't match what WhatsApp reports for
    // them, .reg is still the right recovery step — kept as a mention,
    // but the primary instruction now matches what actually happens.
    await sendText(from, `❌ This number isn't linked to a registered account yet.\n\n🌐 Register at ${process.env["WEBSITE_URL"] || "https://requiemorder.qd.je/"} with this WhatsApp number (include your country code) — you'll be able to use *.dig*, *.fish*, and other commands immediately after, no extra step needed.\n\nAlready registered but seeing this? Type *.reg* to check what number the bot has linked.`);
    return;
  }

  if (cmd === "balance" || cmd === "bal") {
    const displayName = user.name || sender.split("@")[0];
    const wallet = user.balance || 0;
    const bank = user.bank || 0;
    const total = wallet + bank;
    const BASE_CAP = 50_000;
    const extraCap = await getBankCapExtra(userId);
    const accountCapacity = BASE_CAP + extraCap;
    const pct = accountCapacity > 0 ? Math.min(100, Math.floor((bank / accountCapacity) * 100)) : 0;
    const filled = Math.round((pct / 100) * 10);
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    await sendText(
      from,
      `💰 𝗔𝗖𝗖𝗢𝗨𝗡𝗧 𝗕𝗔𝗟𝗔𝗡𝗖𝗘\n\n` +
      `𝗡𝗮𝗺𝗲: ${displayName}\n` +
      `𝗪𝗮𝗹𝗹𝗲𝘁: $${formatNumber(wallet)}\n` +
      `𝗕𝗮𝗻𝗸:   $${formatNumber(bank)}\n` +
      `𝗧𝗼𝘁𝗮𝗹:  $${formatNumber(total)}\n` +
      `𝗖𝗮𝗽𝗮𝗰𝗶𝘁𝘆: $${formatNumber(accountCapacity)}\n\n` +
      `│ ${bar} ${pct}%`
    );
    return;
  }

  if (cmd === "gems") {
    await sendText(from, `💎 You have *${user.gems || 0}* gems.`);
    return;
  }

  if (cmd === "premium" || cmd === "prem") {
    if (user.premium) {
      const exp = user.premium_expiry;
      const left = exp - now;
      if (left > 0) {
        await sendText(from, `⭐ You have *Premium* status!\nExpires in: ${formatDuration(left)}`);
      } else {
        await updateUser(sender, { premium: 0 });
        await sendText(from, "❌ Your premium has expired.");
      }
    } else {
      await sendText(from, "❌ You don't have premium. Get it from an owner/admin.");
    }
    return;
  }

  if (cmd === "membership" || cmd === "memb") {
    const lvl = user.level || 1;
    const xp = user.xp || 0;
    const xpNeeded = lvl * 100;
    await sendText(
      from,
      `👤 *Membership — ${mentionTag(sender)}*\n\n` +
      `🎖️ Level: ${lvl}\n` +
      `✨ XP: ${xp} / ${xpNeeded}\n` +
      `⭐ Premium: ${user.premium ? "Yes" : "No"}\n` +
      `📅 Joined: ${timeAgo(user.created_at || now)}`,
      [sender]
    );
    return;
  }

  if (cmd === "daily") {
    const last = user.last_daily || 0;
    const diff = now - last;
    if (diff < DAILY_COOLDOWN) {
      const remaining = DAILY_COOLDOWN - diff;
      await sendText(from, `⏳ Daily cooldown: ${formatDuration(remaining)} left.`);
      return;
    }
    // Lucky Coin (double_daily effect): consumed one-time via .use, marks
    // double_daily_active on the user doc. Previously this item did
    // nothing at all when used — buying it just printed "Effect applied!"
    const luckyCoinActive = !!(user as any).double_daily_active;
    const amount = (DAILY_AMOUNT + (user.premium ? 500 : 0)) * (luckyCoinActive ? 2 : 1);
    await updateUser(sender, {
      balance: (user.balance || 0) + amount,
      last_daily: now,
      ...(luckyCoinActive ? { double_daily_active: false } : {}),
    });
    await sendText(from, `🎁 Daily reward: *$${formatNumber(amount)}*${luckyCoinActive ? " (🍀 Lucky Coin doubled it!)" : ""}!\nNew balance: $${formatNumber((user.balance || 0) + amount)}`);
    return;
  }

  if (cmd === "withdraw" || cmd === "wid" || cmd === "wd") {
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount <= 0) { await sendText(from, "❌ Enter a valid amount. Usage: .withdraw [amount]"); return; }
    if (amount > (user.bank || 0)) { await sendText(from, `❌ Not enough in bank. Bank: $${formatNumber(user.bank || 0)}`); return; }
    await updateUser(sender, { bank: (user.bank || 0) - amount, balance: (user.balance || 0) + amount });
    await sendText(from, `✅ Withdrew $${formatNumber(amount)} from bank.\nWallet: $${formatNumber((user.balance || 0) + amount)}`);
    return;
  }

  if (cmd === "deposit" || cmd === "dep") {
    const wallet = user.balance || 0;
    const parsed = parseInt(args[0]);
    const amount = (isNaN(parsed) || !args[0]) ? wallet : parsed;
    if (amount <= 0) { await sendText(from, "❌ Your wallet is empty."); return; }
    if (amount > wallet) { await sendText(from, `❌ Not enough in wallet. Wallet: $${formatNumber(wallet)}`); return; }
    const BASE_CAP = 50_000;
    const extraCap = await getBankCapExtra(userId);
    mark("getBankCapExtra");
    const bankCap = BASE_CAP + extraCap;
    const currentBank = user.bank || 0;
    if (currentBank >= bankCap) {
      await sendText(from, `❌ Your bank is full! (*$${formatNumber(currentBank)}* / *$${formatNumber(bankCap)}`+`*)\n💡 Buy a *Bank Note* from the *.shop* to expand your bank capacity.`);
      return;
    }
    const space = bankCap - currentBank;
    const actual = Math.min(amount, space);
    await updateUser(sender, { balance: wallet - actual, bank: currentBank + actual });
    mark("updateUser");
    let msg = `✅ Deposited *$${formatNumber(actual)}* to bank.\nBank: *$${formatNumber(currentBank + actual)}* / *$${formatNumber(bankCap)}*`;
    if (actual < amount) msg += `\n⚠️ Only $${formatNumber(actual)} deposited — bank capacity reached. Buy a *Bank Note* to expand.`;
    await sendText(from, msg);
    return;
  }

  if (cmd === "donate") {
    const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
    const rawMentioned = resolvedMentions[0] || info?.participant;
    const amount = parseInt(args[args.length - 1]);
    if (!rawMentioned || isNaN(amount) || amount <= 0) { await sendText(from, "❌ Usage: .donate @user [amount] or reply with .donate [amount]"); return; }
    const mentioned = resolvedMentions[0] ? resolvedMentions[0] : await resolveMentionedJidAsync(rawMentioned, groupMeta, getUserByLid);
    // Safety guard: if resolution still couldn't turn this into a real
    // phone-based JID (i.e. it's still a raw @lid — no group-metadata match
    // and no linked account in the DB), refuse the transfer instead of
    // silently crediting a brand-new ghost account under the LID number.
    // This is the exact bug that made donated money "vanish" — it was
    // never lost, it went to an account the recipient could never see
    // because it wasn't keyed by their real phone number.
    if (mentioned.endsWith("@lid")) {
      await sendText(from, "❌ Couldn't verify that user's account — ask them to send any message in this group first (or run *.reg*), then try again.");
      return;
    }
    if (await isBot(mentioned)) { await sendText(from, "❌ Bots are not part of the economy system."); return; }
    if (amount > (user.balance || 0)) { await sendText(from, "❌ Not enough in wallet."); return; }
    const target = await ensureUser(mentioned);
    // 3.5% transfer tax — makes donations a small but real sink, not a lossless wash.
    const DONATE_TAX_RATE = 0.035;
    const tax = Math.floor(amount * DONATE_TAX_RATE);
    const received = amount - tax;
    await updateUser(sender, { balance: (user.balance || 0) - amount });
    await updateUser(mentioned, { balance: (target.balance || 0) + received });
    await sendText(from, `💸 ${mentionTag(sender)} donated ${formatNumber(received)} to ${mentionTag(mentioned)}!\n_(3.5% transfer tax: -${formatNumber(tax)})_`, [sender, mentioned]);
    return;
  }

  if (cmd === "cds") {
    const rpg = await ensureRpg(userId);
    // Legacy self-heal: any last_* value written before the gambling
    // ms→seconds fix will still be sitting in the DB as a ~13-digit
    // millisecond epoch. A seconds epoch "now" is currently ~10 digits —
    // treat anything with more digits as milliseconds and convert.
    const norm = (v: any): number => {
      const n = Number(v || 0);
      return n > 100_000_000_000 ? Math.floor(n / 1000) : n;
    };
    const guild = await getUserGuild(userId).catch(() => null);
    const isGuildOwner = !!guild && (guild as any).owner_id === userId;
    const allCooldowns: Array<{ emoji: string; name: string; cd: number; last: number }> = [
      { emoji: "📅", name: "Daily",       cd: DAILY_COOLDOWN,   last: norm(user.last_daily) },
      { emoji: "💼", name: "Work",        cd: WORK_COOLDOWN,    last: norm(user.last_work) },
      { emoji: "⛏️", name: "Dig",         cd: DIG_COOLDOWN,     last: norm(user.last_dig) },
      { emoji: "🎣", name: "Fish",        cd: FISH_COOLDOWN,    last: norm(user.last_fish) },
      { emoji: "🙏", name: "Beg",         cd: BEG_COOLDOWN,     last: norm(user.last_beg) },
      // Gambling cooldowns pulled from the same CMD_COOLDOWNS map gambling.ts
      // actually enforces, instead of hand-duplicated numbers that can (and
      // did) silently drift out of sync with the real values.
      { emoji: "🎰", name: "Slots",       cd: CMD_COOLDOWNS.slots,        last: norm(user.last_slots) },
      { emoji: "🎲", name: "Dice",        cd: CMD_COOLDOWNS.dice,         last: norm(user.last_dice) },
      { emoji: "🪙", name: "Coinflip",    cd: CMD_COOLDOWNS.coinflip,     last: norm(user.last_coinflip) },
      { emoji: "🃏", name: "Casino",      cd: CMD_COOLDOWNS.casino,       last: norm(user.last_casino) },
      { emoji: "🎯", name: "Doublebet",   cd: CMD_COOLDOWNS.doublebet,    last: norm(user.last_doublebet) },
      { emoji: "💰", name: "Doublepayout",cd: CMD_COOLDOWNS.doublepayout, last: norm(user.last_doublepayout) },
      { emoji: "🎡", name: "Roulette",    cd: CMD_COOLDOWNS.roulette,     last: norm(user.last_roulette) },
      { emoji: "🏇", name: "Horse",       cd: CMD_COOLDOWNS.horse,        last: norm(user.last_horse) },
      { emoji: "🌀", name: "Spin",        cd: CMD_COOLDOWNS.spin,         last: norm(user.last_spin) },
      { emoji: "🔫", name: "Steal",       cd: STEAL_COOLDOWN,   last: norm(user.last_steal) },
      { emoji: "🏰", name: "Raid",        cd: 21600,            last: norm(rpg.last_raid) },
      { emoji: "📜", name: "Quest",       cd: 240,              last: norm(rpg.last_quest) },
      { emoji: "🌍", name: "Adventure",   cd: 3600,             last: norm(rpg.last_adventure) },
      { emoji: "🏰", name: "Dungeon",     cd: 360,              last: norm(rpg.last_dungeon) },
      ...(isGuildOwner ? [{ emoji: "🚩", name: "Territory Claim", cd: 21600, last: norm((user as any).last_territory_claim) }] : []),
    ];
    const active = allCooldowns.filter((c) => now - c.last < c.cd);
    let text = `˗ˏˋ★ᯓ 𝗔𝗖𝗧𝗜𝗩𝗘 𝗖𝗢𝗢𝗟𝗗𝗢𝗪𝗡𝗦 ᯓ★ˎˊ˗\n`;
    if (active.length === 0) {
      text += `\n✅ *No active cooldowns!* You're all good to go.\n`;
    } else {
      text += "\n";
      for (const c of active) {
        const rem = c.cd - (now - c.last);
        text += `• \`${c.emoji} ${c.name}\`— \`${formatDuration(rem)}\` left\n`;
      }
    }
    await sendText(from, text);
    return;
  }

  if (cmd === "richlist") {
    const list = await getRichList(from.endsWith("@g.us") ? from : undefined, 10);
    const MEDALS = ["🥇", "🥈", "🥉"];
    let text = "╔ ❰ 🏆 Gᴄ Rɪᴄʜʟɪsᴛ ❱ ╗\n║  💰 Tᴏᴘ Mᴇᴍʙᴇʀs\n║\n";
    list.forEach((u, i) => {
      const num = String(i + 1).padStart(2, "0");
      const medal = MEDALS[i];
      const name = u.name || u.id.split("@")[0];
      const prefix = medal ? `${medal} ${num}.` : `${num}.`;
      text += `║ ${prefix} ${name}\n║     └─ 💰 Bᴀʟ: $${formatNumber(u.total)}\n║\n`;
    });
    text += "╚══════════════════╝";
    await ctx.sock.sendMessage(from, { text, mentions: list.map((u) => u.id) });
    return;
  }

  if (cmd === "richlistglobal" || cmd === "richlg") {
    const list = await getRichList(undefined, 10);
    const MEDALS = ["🥇", "🥈", "🥉"];
    let text = "╔ ❰ 🏆 Gʟᴏʙᴀʟ Rɪᴄʜʟɪsᴛ ❱ ╗\n║ 🌍 Tᴏᴘ Pʟᴀʏᴇʀs\n║\n";
    list.forEach((u, i) => {
      const num = String(i + 1).padStart(2, "0");
      const medal = MEDALS[i];
      const name = u.name || u.id.split("@")[0];
      const prefix = medal ? `${medal} ${num}.` : `${num}.`;
      text += `║ ${prefix} ${name}\n║     └─ 💰 Bᴀʟ: $${formatNumber(u.total)}\n║\n`;
    });
    text += "╚══════════════════╝";
    await ctx.sock.sendMessage(from, { text, mentions: list.map((u) => u.id) });
    return;
  }

  if (cmd === "register" || cmd === "reg") {
    if (user?.registered) {
      await sendText(from, "✅ *You're already registered.*\n\nType *.p* to see your profile.");
      return;
    }
    await sendText(
      from,
      `🌸━━━『 反逆 』━━━🌸\n\n` +
      `✦ 𝗪𝗲𝗹𝗰𝗼𝗺𝗲 𝘁𝗼 𝗥𝗲𝗾𝘂𝗶𝗲𝗺 𝗢𝗿𝗱𝗲𝗿 ✦\n\n` +
      `❀━━━━━━━━━━━━━━❀\n` +
      `      🔗 𝗟𝗜𝗡𝗞 𝗬𝗢𝗨𝗥 𝗔𝗖𝗖𝗢𝗨𝗡𝗧\n` +
      `❀━━━━━━━━━━━━━━❀\n` +
      `➺ *Step 1:* .link <your phone number>\n` +
      `   _Example: .link 2348144550593_\n\n` +
      `➺ *Step 2:* We'll send a 6-digit code to that number on WhatsApp\n\n` +
      `➺ *Step 3:* .verify <code> to activate your account\n\n` +
      `❀━━━━━━━━━━━━━━❀\n` +
      `_Already have a website account? Just link here with the same number._`
    );
    return;
  }

  if (cmd === "setname") {
    const name = args.join(" ");
    if (!name) { await sendText(from, "❌ Usage: .setname <name>\n📃 Requires: *Rename Sheet* (buy from .shop for $91,000)\nName must be 2–20 characters."); return; }
    if (name.length < 2 || name.length > 20) { await sendText(from, "❌ Name must be between 2 and 20 characters."); return; }
    const inv = await getInventory(userId);
    const sheet = inv.find((i) => i.item.toLowerCase().includes("rename sheet"));
    if (!sheet) { await sendText(from, "❌ You need a *Rename Sheet* to change your name.\nBuy one from the *.shop* for $91,000."); return; }
    await removeFromInventory(userId, sheet.item);
    await updateUser(sender, { name });
    await sendText(from, `✅ Name changed to: *${name}*\n📃 1 Rename Sheet consumed.`);
    return;
  }

  if (cmd === "setpp" || cmd === "setbg") {
    const media = await getCommandProfileMedia(ctx).catch(() => null);
    if (!media) { await sendText(from, `❌ Reply to an image/video/sticker or send media with .${cmd} as the caption.`); return; }
    const imageKey = cmd === "setpp" ? "profile_picture" : "profile_background";
    const videoKey = cmd === "setpp" ? "profile_picture_video" : "profile_background_video";
    const label = cmd === "setpp" ? "picture" : "background";
    if (media.type === "video") {
      if (!canSetProfileVideo(ctx, user)) { await sendText(from, "❌ Only owner, guardians, mods, group mods, and active premium users can set video profile media."); return; }
      const poster = await getVideoPoster(media.buffer).catch(() => null);
      const resizedPoster = poster
        ? await sharp(poster).resize(cmd === "setpp" ? 640 : 765, cmd === "setpp" ? 640 : 850, { fit: "cover" }).jpeg({ quality: 92 }).toBuffer()
        : null;
      await updateUser(sender, { [videoKey]: media.buffer.toString("base64"), [imageKey]: resizedPoster?.toString("base64") });
      await sendText(from, `✅ Your animated profile ${label} has been updated.`);
      return;
    }
    const resized = await sharp(media.buffer).resize(cmd === "setpp" ? 640 : 765, cmd === "setpp" ? 640 : 850, { fit: "cover" }).jpeg({ quality: 92 }).toBuffer();
    await updateUser(sender, { [imageKey]: resized.toString("base64"), [videoKey]: null });
    await sendText(from, `✅ Your profile ${label} has been updated.`);
    return;
  }

  if (cmd === "profile" || cmd === "p") {
    // React immediately so the user knows we received the command — profile
    // card generation is slow (image compositing + optional video encode).
    ctx.sock.sendMessage(from, { react: { text: "👤", key: ctx.msg.key } }).catch(() => {});

    const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
    const rawTargetId = resolvedMentions[0] || info?.participant || sender;
    const targetId = await resolveMentionedJidAsync(rawTargetId, groupMeta, getUserByLid);
    const target = await ensureUser(targetId);
    const rpg = await ensureRpg(targetId);
    const rank = await getUserRank(targetId);
    const guild = await getUserGuild(targetId);
    const role = await getProfileRole(targetId, target);
    const name = target.name && target.name !== targetId.split("@")[0]
      ? target.name
      : await getMentionName(targetId);
    const age = target.age || "Not set";
    const bio = target.bio || "No bio set";
    const regTimestamp = Number(target.registered_at || 0) || Number(target.created_at || 0);
    const regDate = regTimestamp
      ? new Date(regTimestamp * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      : "Unknown";
    const hasVideoProfile = !!(target.profile_picture_video || target.profile_background_video);
    const animatedProfile = hasVideoProfile
      ? await buildAnimatedProfileGif(ctx, targetId, target, rpg, rank, role).catch(async () => null)
      : null;
    const profileImage = animatedProfile
      ? null
      : await buildProfileImage(ctx, targetId, target, rpg, rank, role).catch(async () => null);

    // ꕥ (Vai script, U+A515) and ℙℝ𝕆𝔽𝕀𝕃𝔼 (mathematical double-struck letters)
    // don't render correctly on many Android/iOS WhatsApp versions — they appear
    // as boxes or are stripped entirely. Replaced with widely-supported chars.
    const text =
      `╔══ ✦ 𝗣𝗥𝗢𝗙𝗜𝗟𝗘 ✦ ══╗\n` +
      `☁️ Welcome to Requiem Order ☁️\n` +
      `\n` +
      `✦ 𝗡𝗮𝗺𝗲: ${name} ✨\n` +
      `✦ 𝗔𝗴𝗲: ${age}\n` +
      `✦ 𝗕𝗶𝗼: ${bio}\n` +
      `✦ 𝗥𝗲𝗴𝗶𝘀𝘁𝗲𝗿𝗲𝗱: ${regDate}\n` +
      `✦ 𝗥𝗼𝗹𝗲: ${role}\n` +
      `✦ 𝗚𝘂𝗶𝗹𝗱: ${(guild as any)?.name || "N/A"}\n` +
      `✦ 𝗗𝘂𝗻𝗴𝗲𝗼𝗻: Floor ${rpg.dungeon_floor} · Lv.${rpg.level}\n` +
      `✦ 𝗕𝗮𝗻𝗻𝗲𝗱: ${await isBanned("user", targetId) ? "Yes" : "No"}\n` +
      `╚══════════════════╝\n` +
      `☁️ Rise Beyond the Clouds ☁️`;

    if (animatedProfile) {
      await ctx.sock.sendMessage(from, { video: animatedProfile, gifPlayback: true, mimetype: "video/mp4", caption: text, mentions: [targetId] });
    } else if (profileImage) {
      await ctx.sock.sendMessage(from, { image: profileImage, caption: text, mentions: [targetId] });
    } else {
      await ctx.sock.sendMessage(from, { text, mentions: [targetId] });
    }
    return;
  }

  if (cmd === "frame") {
    if (args[0] === "delete" || args[0] === "remove") {
      const staffRow = await getStaff(sender);
      const isStaffMember = ctx.isOwner || !!staffRow;
      if (!isStaffMember) { await sendText(from, "❌ Only staff can delete frames."); return; }
      const target = args[1];
      if (!target) { await sendText(from, "❌ Usage: .frame delete <code or number>"); return; }
      const frame = await getFrameById(target);
      if (!frame) { await sendText(from, `❌ Frame not found.`); return; }
      const PROTECTED_BRAND_FRAMES = new Set(["Celestial Sky", "Cherry Blossom", "Samurai Gold", "Neon Pulse", "Dragon Fire"]);
      if ((frame as any).uploaded_by === "system" && PROTECTED_BRAND_FRAMES.has((frame as any).name)) {
        await sendText(from, "❌ Can't delete a built-in default frame."); return;
      }
      await col("frames").deleteOne({ _id: (frame as any)._id });
      const frameCode = (frame as any).code || (frame as any)._id?.toString();
      const frameOidStr = (frame as any)._id?.toString();
      await col("users").updateMany(
        { frame_id: { $in: [frameCode, frameOidStr].filter(Boolean) } },
        { $set: { frame_id: null } }
      ).catch(() => {});
      await sendText(from, `✅ Frame *${(frame as any).name}* deleted.`);
      return;
    }

    if (!args[0] || /^\d+$/.test(args[0])) {
      const frames = await getAllFrames();
      if ((frames as any[]).length === 0) { await sendText(from, "❌ No frames available yet."); return; }
      const PER_PAGE = 15;
      const pageNum = args[0] ? Math.max(1, parseInt(args[0], 10) || 1) : 1;
      const totalPages = Math.ceil((frames as any[]).length / PER_PAGE);
      const pageFrames = (frames as any[]).slice((pageNum - 1) * PER_PAGE, pageNum * PER_PAGE);
      const target = await ensureUser(sender);
      const equippedId = (target as any).frame_id;
      const list = pageFrames.map((f: any, idx: number) => {
        const seqNum = (pageNum - 1) * PER_PAGE + idx + 1;
        const code = f.code || f._id?.toString() || f.id;
        const oid = f._id?.toString() || f.id;
        const tag = (equippedId && (equippedId === code || equippedId === oid)) ? " ✅" : "";
        return `${seqNum}. *${f.name}*${tag} [${f.theme}] — \`${code}\``;
      }).join("\n");
      await sendText(
        from,
        `🖼️ *Available Frames* (page ${pageNum}/${totalPages}, ${(frames as any[]).length} total)\n\n${list}\n\n` +
        `Use *.frame <number or code>* to equip a frame.\nUse *.frame 0* to remove your frame.\nUse *.frame <page>* to see more (e.g. *.frame 2*).`
      );
      return;
    }
    const frameArg = args[0];
    if (frameArg === "0") { await equipFrame(sender, null); await sendText(from, "✅ Frame removed."); return; }
    const frame = await getFrameById(frameArg);
    if (!frame) { await sendText(from, `❌ Frame not found. Use *.frame* to see the list.`); return; }
    const frameCode = (frame as any).code || (frame as any)._id?.toString() || (frame as any).id;
    await equipFrame(sender, frameCode);
    await sendText(from, `✅ Frame *${(frame as any).name}* equipped! Your profile card now uses this frame.`);
    return;
  }

  if (cmd === "bio") {
    const bio = args.join(" ");
    if (!bio) { await sendText(from, "❌ Usage: .bio [your bio]"); return; }
    await updateUser(sender, { bio });
    await sendText(from, `✅ Bio updated: ${bio}`);
    return;
  }

  if (cmd === "setage") {
    const age = args[0];
    if (!age || !/^\d+$/.test(age)) { await sendText(from, "❌ Usage: .setage [age] — only numbers are allowed."); return; }
    const ageNum = parseInt(age, 10);
    if (ageNum < 13 || ageNum > 60) { await sendText(from, "❌ Age must be between 13 and 60."); return; }
    await updateUser(sender, { age });
    await sendText(from, `✅ Age set to: ${age}`);
    return;
  }

  if (cmd === "inventory" || cmd === "inv") {
    const ITEM_EMOJIS: Record<string, string> = {
      "Health Potion": "🧪", "Elixir": "⚗️", "Sword": "⚔️", "Shield": "🛡️",
      "Speed Boots": "👟", "Lucky Charm": "🍀", "Dungeon Key": "🗝️", "Guild License": "📜",
    };
    const inv = await getInventory(userId);
    if (inv.length === 0) { await sendText(from, "🎒 Your inventory is empty."); return; }
    const text = `🎒 *Inventory — ${mentionTag(sender)}*\n\n` +
      inv.map((i) => `${ITEM_EMOJIS[i.item] || "📦"} *${i.item}* x${i.quantity}`).join("\n");
    await sendText(from, text);
    return;
  }

  if (cmd === "shop") {
    // .shop now points straight at the on-chain (EVM) shop link instead of
    // listing in-game items here. .buy still works with in-game items below.
    const shopLink = process.env["SHOP_LINK"] || getWebsiteUrl("shop");
    await sendTextWithPreview(
      from,
      `┌─⟡ 『 🏪 𝗦𝗛𝗢𝗣 』⟡\n║\n` +
      `║ Visit the shop here:\n` +
      `║ ${shopLink}\n` +
      `║\n╚══════════════════╝`
    );
    return;
  }

  // Permanent tools — can only be purchased once. Selling one is allowed;
  // the gate prevents duplicate purchases filling inventory and giving
  // infinite uses of single-use mechanics (digging, fishing, robbery, etc).
  const PERMANENT_TOOLS = new Set([
    "shovel", "fishing rod", "rod", "pickaxe", "pistol", "rope",
  ]);

  if (cmd === "buy") {
    const itemName = args.join(" ");
    const item = await getShopItem(itemName);
    if (!item) { await sendText(from, "❌ Item not found. Use .shop to see available items."); return; }

    // Permanent tool duplicate check
    const itemKey = (item as any).name.toLowerCase();
    if (PERMANENT_TOOLS.has(itemKey)) {
      const currentInv = await getInventory(userId);
      const alreadyOwns = currentInv.some((i) => i.item.toLowerCase() === itemKey);
      if (alreadyOwns) {
        await sendText(from, `❌ You already own a *${(item as any).name}*. Permanent tools cannot be purchased twice.\n_Sell yours first if you want to rebuy._`);
        return;
      }
    }

    if ((user.balance || 0) < (item as any).price) {
      await sendText(from, `❌ Not enough money. You need ${formatNumber((item as any).price)}, you have ${formatNumber(user.balance || 0)}.`);
      return;
    }
    await updateUser(sender, { balance: (user.balance || 0) - (item as any).price });
    const effect: string = (item as any).effect || "";
    if (effect === "lottery_entry") {
      // Directly credit lottery_tickets on user — no inventory step
      await updateUser(userId, { lottery_tickets: ((await import("../db/queries.js").then(m => m.getUser(userId))) as any)?.lottery_tickets + 1 || 1 });
      await sendText(from, `✅ Purchased *${(item as any).name}* for $${formatNumber((item as any).price)}!\n🎫 Lottery ticket added! Type *.lottery* to enter the draw.`);
    } else if (effect.startsWith("bank_cap:")) {
      // Bank capacity is calculated by getBankCapExtra() from items sitting
      // in inventory (see above) — it sums bank_cap:<amount> effects across
      // every Bank Note owned, multiplied by quantity. Writing to a separate
      // user.bank_cap field here (the old behavior) had no effect on the
      // actual deposit limit, since nothing ever read that field — this is
      // exactly the bug where buying a Bank Note still showed "not enough
      // bank capacity" afterward. Adding it to inventory instead makes the
      // purchase immediately effective, and consistent with selling a note
      // later correctly reducing capacity again.
      await addToInventory(userId, (item as any).name);
      const extra = parseInt(effect.split(":")[1]) || 0;
      const newExtraCap = await getBankCapExtra(userId);
      const BASE_CAP = 50_000;
      await sendText(from, `✅ Purchased *${(item as any).name}* for $${formatNumber((item as any).price)}!\n📄 Bank capacity increased by $${formatNumber(extra)}. New cap: $${formatNumber(BASE_CAP + newExtraCap)}`);
    } else {
      await addToInventory(userId, (item as any).name);
      await sendText(from, `✅ Purchased *${(item as any).name}* for $${formatNumber((item as any).price)}!\n_Use *.inventory* to view your items._`);
    }
    return;
  }

  if (cmd === "sell") {
    const itemName = args.join(" ");
    const inv = await getInventory(userId);
    const invEntry = inv.find((i) => i.item.toLowerCase() === itemName.toLowerCase());
    if (!invEntry) { await sendText(from, "❌ You don't have that item."); return; }
    const removed = await removeFromInventory(userId, invEntry.item);
    if (!removed) { await sendText(from, "❌ Could not remove item."); return; }
    const item = await getShopItem(invEntry.item);
    const sellPrice = Math.floor(((item as any)?.price || 100) * 0.5);
    await updateUser(sender, { balance: (user.balance || 0) + sellPrice });
    await sendText(from, `✅ Sold *${invEntry.item}* for $${formatNumber(sellPrice)}.`);
    return;
  }

  if (cmd === "use") {
    const itemName = args.join(" ");
    const inv = await getInventory(userId);
    const entry = inv.find((i) => i.item.toLowerCase() === itemName.toLowerCase());
    if (!entry) { await sendText(from, "❌ You don't have that item."); return; }
    const item = await getShopItem(entry.item);
    if (!item) { await sendText(from, "❌ Unknown item effect."); return; }
    const effect = (item as any).effect as string;

    if (effect.startsWith("heal:")) {
      const rpg = await ensureRpg(userId);
      const heal = effect === "heal:full" ? rpg.max_hp : parseInt(effect.split(":")[1]);
      const newHp = Math.min(rpg.hp + heal, rpg.max_hp);
      const { updateRpg } = await import("../db/queries.js");
      await updateRpg(sender, { hp: newHp });
      await removeFromInventory(userId, entry.item);
      await sendText(from, `❤️ Used *${entry.item}*. HP: ${newHp}/${rpg.max_hp}`);
    } else if (effect === "double_daily") {
      if ((user as any).double_daily_active) { await sendText(from, "🍀 You already have a Lucky Coin active — use *.daily* first."); return; }
      await removeFromInventory(userId, entry.item);
      await updateUser(sender, { double_daily_active: true });
      await sendText(from, `🍀 *Lucky Coin* activated! Your next *.daily* will pay double.`);
    } else if (effect === "half_work_cd") {
      if ((user as any).half_work_cd_active) { await sendText(from, "⚡ You already have an Energy Drink active — use *.work* first."); return; }
      await removeFromInventory(userId, entry.item);
      await updateUser(sender, { half_work_cd_active: true });
      await sendText(from, `⚡ *Energy Drink* activated! Your next *.work* cooldown is halved.`);
    } else if (effect === "half_steal_cd") {
      if ((user as any).half_steal_cd_active) { await sendText(from, "🪢 You already have a Rope active — use *.steal* first."); return; }
      await removeFromInventory(userId, entry.item);
      await updateUser(sender, { half_steal_cd_active: true });
      await sendText(from, `🪢 *Rope* activated! Your next *.steal* cooldown is halved.`);
    } else if (effect === "xp_boost") {
      const XP_BOOST_DURATION = 3600; // 1 hour
      await removeFromInventory(userId, entry.item);
      await updateUser(sender, { xp_boost_until: now + XP_BOOST_DURATION });
      await sendText(from, `✨ *XP Boost* activated! 2x XP from dungeons/quests/raids/adventures for the next hour.`);
    } else if (effect === "resurrect") {
      // Doesn't get consumed here — it sits "armed" in inventory and is
      // auto-consumed by the dungeon battle handler the moment it would
      // actually save the player (see rpg.ts processDungeonMove). Using
      // it manually outside battle wouldn't make sense (nothing to revive
      // from), so .use just confirms it's armed instead of no-op'ing it.
      const armed = inv.some((i) => i.item.toLowerCase() === "resurrection stone");
      await sendText(from, armed
        ? `💠 *Resurrection Stone* is armed — it'll automatically save you from a dungeon defeat with 50% HP. It's consumed the moment it triggers, not now.`
        : `❌ You don't have a Resurrection Stone.`);
    } else if (effect === "restore_mana") {
      const rpg = await ensureRpg(userId);
      if (!rpg.max_mana) { await sendText(from, "❌ Your class doesn't use Mana."); return; }
      const newMana = Math.min((rpg.mana || 0) + Math.floor(rpg.max_mana * 0.5), rpg.max_mana);
      const { updateRpg } = await import("../db/queries.js");
      await updateRpg(sender, { mana: newMana });
      await removeFromInventory(userId, entry.item);
      await sendText(from, `💙 Used *${entry.item}*. MP: ${newMana}/${rpg.max_mana}`);
    } else if (effect === "str_boost") {
      const STR_BOOST_DURATION = 1800; // 30 min
      await removeFromInventory(userId, entry.item);
      await updateUser(sender, { str_boost_until: now + STR_BOOST_DURATION });
      await sendText(from, `💪 *Strength Elixir* activated! +25% attack in dungeon battles for 30 minutes.`);
    } else if (effect === "anti_steal") {
      if ((user as any).anti_steal_active) { await sendText(from, "🛡️ You already have a Shield active."); return; }
      await removeFromInventory(userId, entry.item);
      await updateUser(sender, { anti_steal_active: true });
      await sendText(from, `🛡️ *Shield* activated! The next *.steal* attempt against you will be blocked.`);
    } else if (effect === "steal_boost" || effect === "unlock_fish" || effect === "unlock_dig" || effect === "unlock_steal") {
      // These are standing tools (Lockpick/Fishing Rod/Shovel/Pistol) —
      // just owning them in inventory is what matters (checked directly
      // by .steal/.dig/.fish), so there's nothing for .use to "activate".
      await sendText(from, `ℹ️ *${entry.item}* works automatically just by being in your inventory — no need to *.use* it.`);
    } else {
      await removeFromInventory(userId, entry.item);
      await sendText(from, `✅ Used *${entry.item}*. Effect applied!`);
    }
    return;
  }

  if (cmd === "leaderboard" || cmd === "lb") {
    const list = await getXpLeaderboard(10);
    const MEDALS = ["🥇", "🥈", "🥉"];
    let text = "╔ ❰ 🏆 Xᴘ Lᴇᴀᴅᴇʀʙᴏᴀʀᴅ ❱ ╗\n║  🌟 Tᴏᴘ Pʟᴀʏᴇʀs\n║\n";
    list.forEach((u, i) => {
      const num = String(i + 1).padStart(2, "0");
      const medal = MEDALS[i];
      const name = u.name || u.id.split("@")[0];
      const prefix = medal ? `${medal} ${num}.` : `${num}.`;
      const level = Number(u.level || 1);
      const xp = Number(u.xp || 0);
      const totalXp = getTotalXpScore(level, xp);
      text += `║ ${prefix} ${name}\n║     └─ ⭐ Lᴠ ${level} · ${formatNumber(xp)} / ${formatNumber(xpNeededForLevel(level))} XP\n║        Tᴏᴛᴀʟ XP: ${formatNumber(totalXp)}\n║\n`;
    });
    text += "╚══════════════════╝";
    await ctx.sock.sendMessage(from, { text, mentions: list.map((u) => u.id) });
    return;
  }

  if (cmd === "work") {
    const lastWork = user.last_work || 0;
    const diff = now - lastWork;
    // Energy Drink (half_work_cd effect): consumed via .use, halves the
    // wait on the very next .work cooldown check. Previously this item
    // did nothing when used — buying/using it just said "Effect applied!"
    const energyDrinkActive = !!(user as any).half_work_cd_active;
    const effectiveCooldown = energyDrinkActive ? Math.floor(WORK_COOLDOWN / 2) : WORK_COOLDOWN;
    if (diff < effectiveCooldown) {
      await sendText(from, `⏳ Cooldown: ${formatDuration(effectiveCooldown - diff)} left to work again.${energyDrinkActive ? " (⚡ Energy Drink halved this wait)" : ""}`);
      return;
    }
    const job = WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)];
    const earned = 4200 + Math.floor(Math.random() * 1201); // $4,200–$5,400 (was $2,500–3,500)
    await updateUser(sender, {
      balance: (user.balance || 0) + earned,
      last_work: now,
      ...(energyDrinkActive ? { half_work_cd_active: false } : {}),
    });
    await sendText(from, `💼 ${job} and earned *${formatNumber(earned)}*!${energyDrinkActive ? " ⚡" : ""}\nWallet: ${formatNumber((user.balance || 0) + earned)}`);
    return;
  }

  if (cmd === "dig") {
    // Digging requires a Shovel in inventory — buy one from .shop
    const digInv = await getInventory(userId);
    const hasShovel = digInv.some((i: any) => i.item.toLowerCase() === "shovel");
    if (!hasShovel) {
      await sendText(from, `⛏️ You need a *Shovel* to dig!\n\nBuy one from the *.shop* to start digging for treasures.`);
      return;
    }
    const lastDig = user.last_dig || 0;
    const diff = now - lastDig;
    if (diff < DIG_COOLDOWN) { await sendText(from, `⏳ Cooldown: ${formatDuration(DIG_COOLDOWN - diff)} left to dig again.`); return; }
    const find = DIG_FINDS[Math.floor(Math.random() * DIG_FINDS.length)];
    const value = randomDigFishReward();
    // SECURITY FIX (2026-07-19): was `updateUser(sender, { balance: (user.balance||0)+value })`,
    // a read-modify-write vulnerable to a race if two commands for the
    // same person run concurrently — see incrementUserFields's doc
    // comment. Split into an atomic increment for balance plus a plain
    // set for the cooldown timestamp (last_dig doesn't need atomicity).
    await incrementUserFields(sender, { balance: value });
    await updateUser(sender, { last_dig: now });
    await addToInventory(userId, find.item);
    await sendText(from, `⛏️ You dug and found: *${find.item}*!\n+${formatNumber(value)}`);
    return;
  }

  if (cmd === "fish") {
    // Fishing requires a Fishing Rod in inventory — buy one from .shop
    const fishInv = await getInventory(userId);
    const hasRod = fishInv.some((i: any) => /fishing\s*rod/i.test(i.item) || i.item.toLowerCase() === "rod");
    if (!hasRod) {
      await sendText(from, `🎣 You need a *Fishing Rod* to fish!\n\nBuy one from the *.shop* to start catching fish.`);
      return;
    }
    const lastFish = user.last_fish || 0;
    const diff = now - lastFish;
    if (diff < FISH_COOLDOWN) { await sendText(from, `⏳ Cooldown: ${formatDuration(FISH_COOLDOWN - diff)} left to fish again.`); return; }
    const catch_ = FISH_CATCHES[Math.floor(Math.random() * FISH_CATCHES.length)];
    const value = randomDigFishReward();
    await incrementUserFields(sender, { balance: value });
    await updateUser(sender, { last_fish: now });
    await addToInventory(userId, catch_.item);
    await sendText(from, `🎣 You fished and caught: *${catch_.item}*!\n+${formatNumber(value)}`);
    return;
  }

  if (cmd === "beg") {
    const lastBeg = user.last_beg || 0;
    const diff = now - lastBeg;
    if (diff < BEG_COOLDOWN) { await sendText(from, `⏳ Cooldown: ${formatDuration(BEG_COOLDOWN - diff)} left.`); return; }
    const response = BEG_RESPONSES[Math.floor(Math.random() * BEG_RESPONSES.length)];
    const earned = 10 + Math.floor(Math.random() * 90);
    await incrementUserFields(sender, { balance: earned });
    await updateUser(sender, { last_beg: now });
    await sendText(from, `🙏 ${response}\nYou received *$${formatNumber(earned)}*.`);
    return;
  }

  if (cmd === "steal") {
    const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
    const rawTarget = ctx.resolvedMentions[0] || info?.participant;
    if (!rawTarget) { await sendText(from, "❌ Usage: .steal @user or reply to their message with .steal"); return; }
    const targetId = rawTarget;
    if (targetId === sender) { await sendText(from, "❌ You can't steal from yourself."); return; }
    if (await isBot(targetId)) { await sendText(from, "❌ Bots are not part of the economy system."); return; }
    const inv = await getInventory(userId);
    const pistol = inv.find((i) => i.item.toLowerCase() === "pistol");
    if (!pistol) { await sendText(from, "❌ You need a *Pistol* to steal.\nBuy one from the *.shop* for $15,000."); return; }
    const lastSteal = user.last_steal || 0;
    const ropeActive = !!(user as any).half_steal_cd_active;
    const effectiveStealCooldown = ropeActive ? Math.floor(STEAL_COOLDOWN / 2) : STEAL_COOLDOWN;
    if (now - lastSteal < effectiveStealCooldown) { await sendText(from, `⏳ Steal cooldown: ${formatDuration(effectiveStealCooldown - (now - lastSteal))} left.${ropeActive ? " (🪢 Rope halved this wait)" : ""}`); return; }
    const target = await ensureUser(targetId);
    const targetBal = target.balance || 0;
    if (targetBal <= 0) { await sendText(from, `❌ ${mentionTag(targetId)} has nothing to steal!`, [targetId]); return; }
    await updateUser(sender, { last_steal: now, ...(ropeActive ? { half_steal_cd_active: false } : {}) });

    // Shield (anti_steal effect): consumed via .use, blocks the NEXT theft
    // attempt made against its owner outright. Previously did nothing —
    // buying/using a Shield had no actual protective effect.
    if ((target as any).anti_steal_active) {
      await updateUser(targetId, { anti_steal_active: false });
      await sendText(from, `🛡️ *Blocked!* ${mentionTag(targetId)} had a *Shield* active and your heist attempt was foiled — no cooldown refund, better luck next time.`, [targetId]);
      return;
    }

    // Lockpick (steal_boost effect): a standing (not consumed) item that
    // improves the OWNER's steal success chance while it's in inventory —
    // previously did nothing at all.
    const hasLockpick = inv.some((i) => i.item.toLowerCase() === "lockpick");
    const successChance = hasLockpick ? 0.65 : 0.5;
    const success = Math.random() < successChance;
    if (success) {
      const pct = 0.1 + Math.random() * 0.2;
      const stolen = Math.max(1, Math.floor(targetBal * pct));
      // SECURITY FIX (2026-07-19): atomic operations on both sides
      // instead of read-modify-write — this command moves money between
      // two different users' documents, making it the highest-risk call
      // site for the race described in incrementUserFields's doc
      // comment. Target's side uses the floor-safe decrement since it
      // must never go negative even under a rare remaining race window.
      await incrementUserFields(sender, { balance: stolen });
      await decrementUserFieldFloored(targetId, "balance", stolen);
      const newBal = (user.balance || 0) + stolen;
      await sendText(from, `🔫 *Heist Successful!*${hasLockpick ? " 🗝️" : ""}\n\nYou robbed ${mentionTag(targetId)} and got away with *$${formatNumber(stolen)}*!\nYour new balance: $${formatNumber(newBal)}`, [targetId]);
    } else {
      const pct = 0.05 + Math.random() * 0.1;
      const lost = Math.max(1, Math.floor((user.balance || 0) * pct));
      await decrementUserFieldFloored(sender, "balance", lost);
      const newBal = Math.max(0, (user.balance || 0) - lost);
      await sendText(from, `🚓 *Caught Red-Handed!*\n\nYou failed to rob ${mentionTag(targetId)} and lost *$${formatNumber(lost)}* in the chaos.\nYour new balance: $${formatNumber(newBal)}`, [targetId]);
    }
    return;
  }

  if (cmd === "roast") {
    const mentioned = ctx.resolvedMentions[0];
    const roasts = [
      "You're so slow, even your internet runs faster than your brain.",
      "You're the reason they put instructions on shampoo.",
      "If brains were gasoline, you couldn't power a go-kart.",
      "You have the personality of a wet napkin.",
      "I'd roast you harder, but my mom says I can't burn trash.",
    ];
    const target = mentioned ? `${mentionTag(mentioned)}` : "you";
    await ctx.sock.sendMessage(from, { text: `🔥 ${target}: ${roasts[Math.floor(Math.random() * roasts.length)]}`, mentions: mentioned ? [mentioned] : [] });
    return;
  }

  if (cmd === "stats") {
    // PERF: these 4 calls are independent (each only depends on userId,
    // not on each other's results) but were previously awaited one at a
    // time — 4 sequential DB round trips instead of 1 concurrent batch.
    const [inv, rpg, rank, guild] = await Promise.all([
      getInventory(userId),
      ensureRpg(userId),
      getUserRank(userId),
      getUserGuild(userId),
    ]);
    const level = Number(user.level || 1);
    const xp = Number(user.xp || 0);
    const xpNeeded = xpNeededForLevel(level);
    const total = Number(user.balance || 0) + Number(user.bank || 0);
    await sendText(from,
      `╔ ❰ 📊 Sᴛᴀᴛs Pᴀɴᴇʟ ❱ ╗\n║  👤 ${mentionTag(sender)}\n║\n` +
      `╠═ ❰ Eᴄᴏɴᴏᴍʏ ❱\n║ 💰 Wᴀʟʟᴇᴛ: $${formatNumber(user.balance || 0)}\n║ 🏦 Bᴀɴᴋ: $${formatNumber(user.bank || 0)}\n║ 💸 Tᴏᴛᴀʟ: $${formatNumber(total)}\n║ 💎 Gᴇᴍs: ${formatNumber(user.gems || 0)}\n║\n` +
      `╠═ ❰ Pʀᴏɢʀᴇss ❱\n║ ⭐ Lᴠ: ${level}  ·  Rᴀɴᴋ #${rank}\n║ ✨ XP: ${formatNumber(xp)} / ${formatNumber(xpNeeded)}\n║ 🌌 Tᴏᴛᴀʟ XP: ${formatNumber(getTotalXpScore(level, xp))}\n║\n` +
      `╠═ ❰ Rᴘɢ ❱\n║ ⚔️ Aᴛᴋ: ${rpg?.attack || 20}  🛡️ Dᴇғ: ${rpg?.defense || 10}\n║ 💨 Sᴘᴅ: ${rpg?.speed || 15}  ❤️ HP: ${rpg?.hp || 100}/${rpg?.max_hp || 100}\n║ 🧬 Cʟᴀss: ${rpg?.class || "Warrior"}\n║ 🏰 Gᴜɪʟᴅ: ${(guild as any)?.name || "None"}\n║\n` +
      `╠═ ❰ Iɴᴠᴇɴᴛᴏʀʏ ❱\n║ 🎒 Iᴛᴇᴍ Tʏᴘᴇs: ${inv.length}\n║ 🧾 Rᴇɢɪsᴛᴇʀᴇᴅ: ${user.registered ? "Yᴇs" : "Nᴏ"}\n╚══════════════════╝`,
      [sender]
    );
    return;
  }

  if (cmd === "lc" && !args[0]?.startsWith("@")) {
    const borrowed = user.borrowed_cash || 0;
    const lent = user.lent_cash || 0;
    await sendText(from, `💸 *Lend/Borrow Status*\n\nYou lent: $${formatNumber(lent)}\nYou borrowed: $${formatNumber(borrowed)}`);
    return;
  }

  if (cmd === "bc") {
    const borrowed = user.borrowed_cash || 0;
    await sendText(from, `💸 You have borrowed $${formatNumber(borrowed)} total.`);
    return;
  }
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function randomDigFishReward(): number {
  return DIG_FISH_MIN_REWARD + Math.floor(Math.random() * (DIG_FISH_MAX_REWARD - DIG_FISH_MIN_REWARD + 1));
}

function getTotalXpScore(level: number, xp: number): number {
  return Math.max(0, Number(xp || 0)) + cumulativeXpForLevel(level);
}

async function getProfileRole(userId: string, user?: any): Promise<string> {
  const phone = userId.split("@")[0].split(":")[0];
  if (phone === BOT_OWNER_LID || userId === `${BOT_OWNER_LID}@s.whatsapp.net` || userId === `${BOT_OWNER_LID}@lid`) {
    return "Owner";
  }
  const staff = await getStaff(userId);
  if ((staff as any)?.role === "owner") return "Owner";
  if ((staff as any)?.role === "guardian") return "Guardian";
  if ((staff as any)?.role === "mod") return "Mod";

  // Below this point the role reflects the player's actual account standing,
  // not just staff permissions — this is what shows on the profile card for
  // everyone who isn't bot/group staff.
  const u = user || (await ensureUser(userId).catch(() => null));
  if (u) {
    const premiumActive = !!u.premium && (!u.premium_expiry || Number(u.premium_expiry) === 0 || Number(u.premium_expiry) > Math.floor(Date.now() / 1000));
    if (premiumActive) return "Premium User";

    const regTimestamp = Number(u.registered_at || 0) || Number(u.created_at || 0);
    const accountAgeDays = regTimestamp ? (Date.now() / 1000 - regTimestamp) / 86400 : 0;
    const level = Number(u.level || 0);

    // Brand-new accounts (first week, still low level) are Recruits.
    if (regTimestamp && accountAgeDays < 7 && level < 5) return "Recruit";

    // Established, higher-level players earn the Ascendant title.
    if (level >= 15) return "Ascendant";
  }

  return "User";
}

async function canSetProfileVideo(ctx: CommandContext, user: any): Promise<boolean> {
  if (ctx.isOwner) return true;
  const staff = await getStaff(ctx.sender);
  if ((staff as any)?.role === "guardian" || (staff as any)?.role === "mod") return true;
  if (ctx.from.endsWith("@g.us") && await isMod(ctx.sender, ctx.from)) return true;
  if (!user?.premium) return false;
  const expiry = Number(user.premium_expiry || 0);
  return expiry === 0 || expiry > Math.floor(Date.now() / 1000);
}

function profileWrapText(text: string, maxChars: number): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars) {
      if (line) lines.push(line);
      line = word.length > maxChars ? word.slice(0, maxChars) : word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function escapeXml(s: string): string {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

function toBuffer(data: any): Buffer | null {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === "string") return Buffer.from(data, "base64");
  return null;
}

async function buildProfileImage(ctx: CommandContext, targetId: string, user: any, rpg: any, rank: number, role: string): Promise<Buffer> {
  const defaultBgPath = path.resolve(new URL(import.meta.url).pathname, "../../assets/default_bg.jpg");
  const W = 800;
  const H = 800;

  const level   = Math.max(1, Number(user.level || 1));
  const xp      = Math.max(0, Number(user.xp || 0));
  const xpNeed  = xpNeededForLevel(level);
  const progress= Math.max(0, Math.min(1, xp / xpNeed));
  const name    = sanitizeForDejaVuSans(String(user.name || targetId.split("@")[0]).slice(0, 26));
  const subtitle= `${role} ~ ${rpg?.class || "Warrior"}`;
  const rawBio  = sanitizeForDejaVuSans(String(user.bio || "").trim());
  const wallet  = formatNumber(Math.max(0, Number(user.balance || 0)));
  const bank    = formatNumber(Math.max(0, Number(user.bank    || 0)));
  const bioLines = profileWrapText(rawBio, 38).slice(0, 3);

  const avatar     = await getProfileAvatar(ctx, targetId, user);
  const AV_SIZE    = 168;
  const AV_CX     = 400;
  const AV_CY     = 256;
  const AV_LEFT   = AV_CX - AV_SIZE / 2;
  const AV_TOP    = AV_CY - AV_SIZE / 2;
  const avatarMask = Buffer.from(`<svg width="${AV_SIZE}" height="${AV_SIZE}"><circle cx="${AV_SIZE/2}" cy="${AV_SIZE/2}" r="${AV_SIZE/2}" fill="#fff"/></svg>`);
  const circularAvatar = await sharp(avatar)
    .resize(AV_SIZE, AV_SIZE, { fit: "cover" })
    .composite([{ input: avatarMask, blend: "dest-in" }])
    .png()
    .toBuffer();

  // Frame gets a generous, clearly-visible margin around the avatar so an
  // equipped frame reads as surrounding the portrait rather than cutting
  // across it. Some uploaded frames (including third-party sets) include
  // decorative elements — horns, points, asymmetric flourishes — that
  // intentionally extend inward past a plain ring's radius; a bigger gap
  // between the avatar's own edge and the frame's bounding box gives that
  // kind of artwork room to do that without visually overlapping the face.
  const FRAME_SIZE = Math.round(AV_SIZE * 1.7);
  const FR_LEFT    = AV_CX - FRAME_SIZE / 2;
  const FR_TOP     = AV_CY - FRAME_SIZE / 2;

  let frameBuffer: Buffer | null = null;
  if (user.frame_id) {
    try {
      const frame = await getFrameById(user.frame_id);
      if (frame) {
        const frameOid = (frame as any)._id;
        const imgBuf = toBuffer(frame.image);
        if (imgBuf && imgBuf.length > 0) {
          frameBuffer = await sharp(imgBuf).resize(FRAME_SIZE, FRAME_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        } else if (frame.svg) {
          frameBuffer = await sharp(Buffer.from(frame.svg)).resize(FRAME_SIZE, FRAME_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        } else if (frame.url) {
          try {
            const fr = await fetch(frame.url, { signal: AbortSignal.timeout(8000) });
            if (fr.ok) {
              const rawBuf = Buffer.from(await fr.arrayBuffer());
              const pngBuf = await sharp(rawBuf).resize(FRAME_SIZE, FRAME_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
              try { await col("frames").updateOne({ _id: frameOid }, { $set: { image: pngBuf.toString("base64") } }); } catch {}
              frameBuffer = pngBuf;
            }
          } catch {}
        }
      }
    } catch {}
  }

  const BAR_W     = 420;
  const BAR_X     = AV_CX - BAR_W / 2;
  const BAR_Y     = 500;
  const BAR_FILL  = Math.round(BAR_W * progress);
  const BIO_Y_START = 600;
  const bioSvg = bioLines.length > 0
    ? bioLines.map((line, i) =>
        `<text x="${AV_CX}" y="${BIO_Y_START + i * 30}" text-anchor="middle" font-size="20" fill="rgba(255,255,255,.88)" class="shadow">${escapeXml(line)}</text>`
      ).join("\n")
    : `<text x="${AV_CX}" y="${BIO_Y_START}" text-anchor="middle" font-size="20" fill="rgba(255,255,255,.4)" class="shadow">No bio set.</text>`;

  // Decorative fallback ring — only drawn when the player has NO frame equipped.
  // Previously this ring was drawn unconditionally on every profile card,
  // which painted over the actual equipped frame artwork underneath it.
  const fallbackRing = !frameBuffer
    ? `<circle cx="${AV_CX}" cy="${AV_CY}" r="${FRAME_SIZE/2}" fill="none" stroke="rgba(124,58,237,.55)" stroke-width="5" filter="url(#glow)"/>`
    : "";

  const overlay = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,.15)"/><stop offset="55%" stop-color="rgba(0,0,0,.45)"/><stop offset="100%" stop-color="rgba(0,0,0,.75)"/>
    </linearGradient>
    <linearGradient id="xpbar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#7c3aed"/><stop offset="100%" stop-color="#a855f7"/>
    </linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <style>text { font-family: 'DejaVu Sans', Arial, Helvetica, sans-serif; fill: white; } .shadow { paint-order: stroke; stroke: rgba(0,0,0,.80); stroke-width: 4px; stroke-linejoin: round; } .sm { paint-order: stroke; stroke: rgba(0,0,0,.70); stroke-width: 3px; stroke-linejoin: round; }</style>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#scrim)"/>
  <rect x="16" y="16" width="260" height="68" rx="14" fill="rgba(0,0,0,.55)" stroke="rgba(255,255,255,.15)" stroke-width="1.5"/>
  ${emojiIconSvg("💰", 36, 40, 16, "#fbbf24")}
  <text x="58" y="44" font-size="19" font-weight="700" fill="#fbbf24" class="sm">Wallet</text>
  <text x="36" y="70" font-size="18" fill="rgba(255,255,255,.9)" class="sm">$${escapeXml(wallet)}</text>
  ${emojiIconSvg("🏦", 164, 40, 16, "#34d399")}
  <text x="186" y="44" font-size="19" font-weight="700" fill="#34d399" class="sm">Bank</text>
  <text x="164" y="70" font-size="18" fill="rgba(255,255,255,.9)" class="sm">$${escapeXml(bank)}</text>
  ${fallbackRing}
  <circle cx="${AV_CX}" cy="${AV_CY}" r="${AV_SIZE/2 + 3}" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="3"/>
  <text x="${AV_CX}" y="392" text-anchor="middle" font-size="36" font-weight="800" class="shadow">${escapeXml(name)}</text>
  <text x="${AV_CX}" y="426" text-anchor="middle" font-size="22" fill="rgba(220,220,255,.9)" class="shadow">${escapeXml(subtitle)}</text>
  <rect x="195" y="444" width="155" height="36" rx="10" fill="rgba(124,58,237,.35)" stroke="rgba(124,58,237,.6)" stroke-width="1.5"/>
  <text x="272" y="467" text-anchor="middle" font-size="19" font-weight="700" class="sm">Rank #${rank}</text>
  <rect x="450" y="444" width="155" height="36" rx="10" fill="rgba(16,185,129,.28)" stroke="rgba(16,185,129,.55)" stroke-width="1.5"/>
  <text x="527" y="467" text-anchor="middle" font-size="19" font-weight="700" class="sm">Level ${level}</text>
  <rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_W}" height="20" rx="10" fill="rgba(0,0,0,.55)" stroke="rgba(255,255,255,.12)" stroke-width="1.5"/>
  ${BAR_FILL > 0 ? `<rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_FILL}" height="20" rx="10" fill="url(#xpbar)"/>` : ""}
  <text x="${AV_CX}" y="${BAR_Y + 15}" text-anchor="middle" font-size="13" font-weight="700" class="sm">${xp} / ${xpNeed} XP</text>
  <rect x="60" y="582" width="680" height="${Math.max(46, bioLines.length * 30 + 22)}" rx="14" fill="rgba(0,0,0,.40)" stroke="rgba(255,255,255,.1)" stroke-width="1"/>
  ${bioSvg}
  <text x="${AV_CX}" y="772" text-anchor="middle" font-size="24" font-weight="800" font-style="italic" fill="rgba(255,255,255,.72)" class="shadow">${stripUnrenderableGlyphs("REQUIEM ORDER 反逆")}</text>
</svg>`);

  const profileBgBuf = toBuffer(user.profile_background);
  const background: any = profileBgBuf ?? defaultBgPath;

  const composites: Parameters<ReturnType<typeof sharp>["composite"]>[0] = [];
  if (frameBuffer) composites.push({ input: frameBuffer, left: FR_LEFT, top: FR_TOP });
  composites.push({ input: circularAvatar, left: AV_LEFT, top: AV_TOP });
  composites.push({ input: overlay, left: 0, top: 0 });

  return sharp(background).resize(W, H, { fit: "cover" }).composite(composites).jpeg({ quality: 92 }).toBuffer();
}

async function buildAnimatedProfileGif(ctx: CommandContext, targetId: string, user: any, rpg: any, rank: number, role: string): Promise<Buffer> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `profile-${randomUUID()}-`));
  try {
    const bgVideoBuf = toBuffer(user.profile_background_video);
    const avatarVideoBuf = toBuffer(user.profile_picture_video);
    const bgFrames = bgVideoBuf
      ? await extractVideoFrames(tmpDir, "bg", bgVideoBuf, "scale=765:850:force_original_aspect_ratio=increase,crop=765:850")
      : [];
    const avatarFrames = avatarVideoBuf
      ? await extractVideoFrames(tmpDir, "avatar", avatarVideoBuf, "scale=640:640:force_original_aspect_ratio=increase,crop=640:640")
      : [];
    const frameCount = Math.max(bgFrames.length, avatarFrames.length, 1);
    const outputPattern = path.join(tmpDir, "profile_%03d.png");
    for (let i = 0; i < frameCount; i++) {
      const frameUser = {
        ...user,
        profile_background: bgFrames.length > 0 ? bgFrames[i % bgFrames.length] : user.profile_background,
        profile_picture: avatarFrames.length > 0 ? avatarFrames[i % avatarFrames.length] : user.profile_picture,
      };
      const frame = await buildProfileImage(ctx, targetId, frameUser, rpg, rank, role);
      await sharp(frame).png().toFile(path.join(tmpDir, `profile_${String(i + 1).padStart(3, "0")}.png`));
    }
    const outPath = path.join(tmpDir, "profile.mp4");
    await runFfmpeg(["-y","-framerate","6","-i",outputPattern,"-movflags","+faststart","-pix_fmt","yuv420p","-vf","scale=trunc(iw/2)*2:trunc(ih/2)*2",outPath]);
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractVideoFrames(tmpDir: string, prefix: string, buffer: Buffer, vf: string): Promise<Buffer[]> {
  const inputPath = path.join(tmpDir, `${prefix}.mp4`);
  const framePattern = path.join(tmpDir, `${prefix}_%03d.jpg`);
  await fs.writeFile(inputPath, buffer);
  await runFfmpeg(["-y","-i",inputPath,"-vf",`fps=6,${vf}`,"-frames:v","18",framePattern]);
  const entries = (await fs.readdir(tmpDir)).filter((n) => n.startsWith(`${prefix}_`) && n.endsWith(".jpg")).sort();
  return Promise.all(entries.map((n) => fs.readFile(path.join(tmpDir, n))));
}

async function getVideoPoster(buffer: Buffer): Promise<Buffer | null> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `poster-${randomUUID()}-`));
  try {
    const inputPath = path.join(tmpDir, "input.mp4");
    const outputPath = path.join(tmpDir, "poster.jpg");
    await fs.writeFile(inputPath, buffer);
    await runFfmpeg(["-y","-i",inputPath,"-frames:v","1",outputPath]);
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function getProfileAvatar(ctx: CommandContext, targetId: string, user: any): Promise<Buffer> {
  const ppBuf = toBuffer(user.profile_picture);
  if (ppBuf) return ppBuf;
  try {
    const url = await (ctx.sock as any).profilePictureUrl(targetId, "image");
    if (url) {
      const res = await fetch(url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    }
  } catch {}
  const defaultPpPath = path.resolve(new URL(import.meta.url).pathname, "../../assets/default_pp.jpg");
  try { return await fs.readFile(defaultPpPath); } catch {}
  return sharp({ create: { width: 300, height: 300, channels: 4, background: "#161622" } })
    .composite([{ input: Buffer.from(`<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="300" height="300" fill="#151527"/><text x="150" y="176" text-anchor="middle" font-size="92" font-family="'DejaVu Sans', Arial" font-weight="700" fill="#ffffff">${escapeXml(targetId[0]?.toUpperCase() || "U")}</text></svg>`), left: 0, top: 0 }])
    .png().toBuffer();
}

async function getCommandProfileMedia(ctx: CommandContext): Promise<{ buffer: Buffer; type: "image" | "video" } | null> {
  const { from, msg, sock } = ctx;
  const directImage = msg.message?.imageMessage ? msg : null;
  const directVideo = msg.message?.videoMessage ? msg : null;
  const directDocument = msg.message?.documentMessage ? msg : null;
  const context = msg.message?.extendedTextMessage?.contextInfo;
  const quoted = context?.quotedMessage;
  const quotedMedia = quoted?.imageMessage || quoted?.stickerMessage || quoted?.videoMessage || quoted?.documentMessage ? quoted : null;
  const target = directImage || directVideo || directDocument || (quotedMedia ? {
    key: { remoteJid: from, fromMe: false, id: context?.stanzaId || "", participant: context?.participant },
    message: quotedMedia,
  } : null);
  if (!target) return null;
  const message = (target as any).message || {};
  const docMime = message.documentMessage?.mimetype || "";
  const type = message.videoMessage || docMime.startsWith("video/") ? "video" : "image";
  if (message.documentMessage && type !== "video") return null;
  const downloaded = await downloadMediaMessage(target as any, "buffer", {}, { reuploadRequest: (sock as any).updateMediaMessage } as any);
  return { buffer: Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as any), type };
}
