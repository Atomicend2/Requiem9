import type { CommandContext } from "./index.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DB_DIR } from "../db/database.js";
import { col } from "../db/mongo.js";
import { getMentionName, getStaff } from "../db/queries.js";
import { mentionTag } from "../utils.js";
import { getBotName } from "../connection.js";
import { downloadMediaMessage } from "@whiskeysockets/baileys";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MENU_ASSETS_DIR = path.join(DB_DIR, "menu-assets");
if (!fs.existsSync(MENU_ASSETS_DIR)) fs.mkdirSync(MENU_ASSETS_DIR, { recursive: true });

export async function handleStaffMenu(ctx: CommandContext): Promise<void> {
  const { from, sender, sock, isOwner } = ctx;
  const staff = await getStaff(sender);
  const role = isOwner ? "owner" : (staff as any)?.role;
  if (!role || !["owner", "guardian", "mod"].includes(role)) {
    await sock.sendMessage(from, { text: "❌ This command is for staff only." });
    return;
  }

  const staffMenu =
`🌸━━━『 反逆 』━━━🌸
✦ Staff Command Reference ✦
👑 Your role: ${role.toUpperCase()}

❀━━━━━━━━━━━━━━❀
        👮 MODERATION
❀━━━━━━━━━━━━━━❀
➺ .ban @user [reason] — Ban a user globally
➺ .unban @user — Lift a global ban
➺ .banlist — View all banned users
➺ .warn @user [reason] — Warn a member (group-level)
➺ .resetwarn — Clear a member's warnings

❀━━━━━━━━━━━━━━❀
       🛡️ STAFF MANAGEMENT
❀━━━━━━━━━━━━━━❀
➺ .bots — List all managed bot instances
➺ .modlist / .mods / .modslist / .cardmakers — List all staff
➺ .addmod @user — Promote to mod (guardian/owner only)
➺ .addguardian @user — Promote to guardian (owner only)
➺ .removemod @user — Demote a mod
➺ .removeguardian @user — Demote a guardian
➺ .recruit @user — Mark a user as a recruit
➺ .addpremium @user [days] — Grant premium
➺ .removepremium @user — Remove premium
➺ .addrole @user [role] — Set a custom display role
➺ .restart — Restart the bot process

❀━━━━━━━━━━━━━━❀
      🃏 CARD MANAGEMENT
❀━━━━━━━━━━━━━━❀
➺ .upload — Upload a new card (reply to image/video)
➺ .fetchcards — Re-sync cards from unified_cards.jsonl
➺ .summon [tier] [@user] — Force-spawn a card
➺ .dc — Disable card spawning in this group
➺ .ac — Enable card spawning in this group
➺ .rc — Toggle card spawning in this group
➺ .frame delete <code or number> — Delete a frame (staff)
➺ .delcard / .deletecard <copy_id> — Permanently delete a player's card copy

❀━━━━━━━━━━━━━━❀
       📢 GROUPS / BROADCAST
❀━━━━━━━━━━━━━━❀
➺ .post <text> — Broadcast a message to all groups
➺ .join <invite link> — Make the bot join a group
➺ .exit — Make the bot leave the current group
➺ .show — Show all groups the bot is in
➺ .setms <key> <value> — Set a bot setting
➺ .delms <key> — Delete a bot setting
➺ .rules [text] — Set this group's staff-managed rules
➺ .website — Show the website link (staff variant)

❀━━━━━━━━━━━━━━❀
       💰 USER MANAGEMENT
❀━━━━━━━━━━━━━━❀
➺ .resetbal @user — Reset a user's balance to 0
➺ .reset @user — Fully reset a user's profile (owner only)
➺ .addinv @user <item> [qty] — Give a user an inventory item

✨ ━━━━━━━━━━━━━━✨
This list is staff-only — regular players see *.menu* instead.
✨ ━━━━━━━━━━━━━━✨`;

  await sock.sendMessage(from, { text: staffMenu, mentions: [sender] });
}

// NOTE: .modcmds is wired (message.ts) as an alias for handleStaffMenu
// above, rather than a separate implementation — there used to be a
// second, near-duplicate "mod commands" menu here that was never actually
// reachable by any command, which risked drifting out of sync with this
// one as commands were added/changed. One menu, kept current, is safer
// than two that silently disagree.

export async function handleMenu(ctx: CommandContext): Promise<void> {
  const { from, sender, sock } = ctx;
  const senderTag = mentionTag(sender);
  const botName = getBotName();

  const menuText =
`🌸━━━『 反逆 』━━━🌸

✦ Where Stars Touch The Sky ✦

🎐 𝗣𝗥𝗢𝗙𝗜𝗟𝗘

┌──────────────
│ 👋 Hey       : ${senderTag}
│ 🌌 Bot       : ${botName}
│ 👑 Creator   : Eᴍᴘᴇʀᴏʀ Lᴇʟᴏᴜᴄʜ
│ 🔹 Prefix    : [ . ]
└──────────────

❀━━━━━━━━━━━━━━❀
            📋 𝗠𝗔𝗜𝗡
❀━━━━━━━━━━━━━━❀
➺ .menu — Full command list
➺ .ping — Check bot status
➺ .website — Web dashboard
➺ .community — Join the community
➺ .bots — Available bot instances
➺ .afk [reason] — Away From Keyboard
➺ .help / .info — Help & bot info
➺ .uptime — Bot uptime
➺ .modcmds — Staff command reference (staff only)

❀━━━━━━━━━━━━━━❀
            ⚙️ 𝗔𝗗𝗠𝗜𝗡
❀━━━━━━━━━━━━━━❀
➺ .kick @user — Remove a member
➺ .delete / .del / .d — Delete message
➺ .antilink set [action] — Link control
➺ .warn @user [reason] — Warn member
➺ .resetwarn @user — Clear warnings
➺ .groupinfo / .gi — Group info
➺ .welcome on/off — Toggle welcome message
➺ .setwelcome / .setleave — Custom messages
➺ .promote / .demote — Rank members
➺ .mute / .unmute — Silence members
➺ .hidetag / .tagall — Tag all members
➺ .open / .close — Lock/unlock group
➺ .purge [code] — Remove by country
➺ .antism on/off — Block status mentions
➺ .antibot on/off — Block bot accounts
➺ .blacklist add/remove/list — Block numbers
➺ .groupstats / .gs — Group stats
➺ .activity — Activity score
➺ .active / .inactive — Member status
➺ .gclink / .gcl — Group link
➺ .rules — View/set rules
➺ .setmenuimg — Set menu image

❀━━━━━━━━━━━━━━❀
         💰 𝗘𝗖𝗢𝗡𝗢𝗠𝗬
❀━━━━━━━━━━━━━━❀
➺ .bal / .balance — Check balance
➺ .gems — Gems (card currency)
➺ .premium / .membership — Premium info
➺ .daily — Daily reward
➺ .withdraw / .deposit [amt] — Move money
➺ .donate [amount] — Donate coins
➺ .richlist / .richlg — Top earners
➺ .register / .reg — Link WhatsApp
➺ .setname <name> — Custom name
➺ .setpp / .setbg — Profile pic/banner
➺ .profile / .p — View profile
➺ .bio [text] — Set bio
➺ .setage [age] — Set age
➺ .inventory / .shop / .buy — Inventory
➺ .leaderboard / .lb — Top players by level (earned via dungeon clears)
➺ .work / .dig / .fish / .beg — Earn coins
➺ .steal / .roast — Risky earnings
➺ .stats / .cds — Cooldowns
➺ .frame [id] — View frame

❀━━━━━━━━━━━━━━❀
           🎴 𝗖𝗔𝗥𝗗𝗦
❀━━━━━━━━━━━━━━❀
➺ .collection / .coll — View collection
➺ .deck / .sdi — View deck
➺ .card [index] — View card
➺ .cardinfo / .ci <name> — Card info
➺ .sc <name> — Search cards
➺ .si <name> — Search info
➺ .ss <series> — Series cards
➺ .slb <series> — Series leaderboard
➺ .cs <series> — My series cards
➺ .mycollectionseries — My series list
➺ .tier — Cards by tier
➺ .myseries — Cards by series
➺ .fuse / .fusion / .forge — Fuse cards
➺ .cardleaderboard / .cardlb — Top cards
➺ .cardshop / .stardust — Card shop
➺ .get [id] — Get card
➺ .vs @user — Battle deck
➺ .auction / .auctions — View auctions
➺ .myauc — My auctions
➺ .listauc [price] [hours] — List card
➺ .bid [id] [amt] — Bid on card
➺ .remauc <id> — Cancel auction
➺ .cg @user — Challenge card
➺ .ctd / .lcd / .retrieve — Retrieve cards
➺ .sellc / .tc — Sell card
➺ .accept / .decline — Accept/decline

❀━━━━━━━━━━━━━━❀
          ⚔️ 𝗥𝗣𝗚 & 𝗗𝗨𝗡𝗚𝗘𝗢𝗡
❀━━━━━━━━━━━━━━❀
➺ .rpg — RPG stats
➺ .rpgstats — Full breakdown
➺ .class — Choose class
➺ .adventure — Go adventure
➺ .achievements / .achieve — Achievements
➺ .explore — Explore areas
➺ .rest — Recover health
➺ .territory / .claim — Claim territory
➺ .dungeon — Enter dungeon
➺ .attack — Attack boss
➺ .heavy — Heavy attack
➺ .defend — Block damage
➺ .flee — Escape dungeon
➺ .quest — View quests
➺ .raid — Raid boss
➺ .boss — Challenge boss
➺ .heal — Heal
➺ .item — Use a potion/elixir in dungeon (2 uses per battle)
➺ .mentor — Team up with a lower-level player for shared XP

❀━━━━━━━━━━━━━━❀
        🏰 𝗚𝗨𝗜𝗟𝗗𝗦
❀━━━━━━━━━━━━━━❀
➺ .guild create <name> — Create guild
➺ .guild join <name> — Join guild
➺ .guild leave — Leave guild
➺ .guild info [name] — Guild info
➺ .guild list — All guilds
➺ .guild desc <text> — Set description
➺ .guild kick @user — Remove member
➺ .guild disband — Disband guild

❀━━━━━━━━━━━━━━❀
           🤖 𝗔𝗜
❀━━━━━━━━━━━━━━❀
➺ .ai / .gpt / .chat <text> — Chat with AI
➺ .translate / .tt <text> — Translate
➺ .mood — Echidna's mood
➺ .mem — Echidna's memory

❀━━━━━━━━━━━━━━❀
           🎮 𝗚𝗔𝗠𝗘𝗦
❀━━━━━━━━━━━━━━❀
➺ .tictactoe / .ttt [@user] — Tic Tac Toe
➺ .connectfour / .c4 [@user] — Connect Four
➺ .wcg / .wordchain — Word Chain
➺ .startbattle — Battle event
➺ .truthordare / .td — Truth or Dare
➺ .stopgame — End game
➺ .uno / .startuno — UNO game
➺ .unoplay / .unodraw — Play UNO
➺ .unohand — View hand

❀━━━━━━━━━━━━━━❀
            🎲 𝗚𝗔𝗠𝗕𝗟𝗘
❀━━━━━━━━━━━━━━❀
➺ .slots / .dice / .casino — Slots
➺ .coinflip / .cf — Coin flip
➺ .doublebet / .doublepayout — Double bet
➺ .roulette / .horse / .spin — Roulette

❀━━━━━━━━━━━━━━❀
           🎟️ 𝗟𝗢𝗧𝗧𝗘𝗥𝗬
❀━━━━━━━━━━━━━━❀
➺ .lottery — Lottery info
➺ .ll — Buy ticket
➺ .lp — My tickets
➺ .drawlottery — Draw lottery

❀━━━━━━━━━━━━━━❀
    🌐 𝗪𝗘𝗕 / 𝗔𝗖𝗖𝗢𝗨𝗡𝗧
❀━━━━━━━━━━━━━━❀
➺ .website — Dashboard
➺ .reg — Link account
➺ .verify <code> — Verify OTP

❀━━━━━━━━━━━━━━❀
           🖼️ 𝗠𝗘𝗗𝗜𝗔
❀━━━━━━━━━━━━━━❀
➺ .sticker / .s — Make sticker
➺ .toimg / .turnimg — Sticker to image
➺ .take — Screenshot
➺ .pint <query> — Image search

❀━━━━━━━━━━━━━━❀
           🎭 𝗙𝗨𝗡
❀━━━━━━━━━━━━━━❀
➺ .fancy <1-35> <text> — Fancy text
➺ .gay / .lesbian / .simp — Meme text
➺ .match / .ship / .relation — Compatibility
➺ .character / .psize / .pp — Generator
➺ .skill / .duality / .gen — Skills
➺ .pov / .social — POV cards
➺ .wouldyourather / .wyr — Questions
➺ .joke — Tell joke

❀━━━━━━━━━━━━━━❀
       👤 𝗜𝗡𝗧𝗘𝗥𝗔𝗖𝗧𝗜𝗢𝗡
❀━━━━━━━━━━━━━━❀
➺ .hug / .kiss / .slap — Hugs/Kiss/Slap
➺ .wave / .pat / .dance — Actions
➺ .sad / .smile / .laugh — Emotions
➺ .punch / .kill / .hit — Combat
➺ .kidnap / .lick / .bonk — Silly
➺ .tickle / .shrug — Misc

✨ ━━━━━━━━━━━━━━✨
♣️ The world is cruel, yet beautiful. 反逆
✨ ━━━━━━━━━━━━━━✨`;

  try {
    const bot = await col("bots").findOne(
      {},
      { sort: { is_primary: -1, created_at: 1 } }
    );
    // ── Menu image: MongoDB-first, filesystem fallback ────────────────────────
    // The authoritative copy is stored in bot_settings under the key
    // "menu_image" (set by .setmenuimg). We also fall back to the legacy
    // bot.menu_image_url path for backwards compatibility with older records.
    // Filesystem storage was removed as the primary store because files are
    // wiped on every server restart/redeploy.
    let imageBuffer: Buffer | null = null;

    // Menu image is per-bot: each linked WhatsApp number can carry its own
    // artwork, keyed by "menu_image:<botId>". The old global "menu_image" key
    // is kept as a fallback for the primary/single-instance bot and for any
    // bot that hasn't had a per-bot image set yet.
    const { getBotSetting } = await import("../db/queries.js");
    const { getBotIdForSock } = await import("../bot-manager.js");
    // Use managed botId first; fall back to phone derived from sock.user so
    // standalone-mode bots don't all share the global "menu_image" key.
    const botId = getBotIdForSock(sock)
      || sock.user?.id?.split("@")[0]?.split(":")[0]
      || null;
    const stored = (botId ? await getBotSetting(`menu_image:${botId}`).catch(() => null) : null)
      || await getBotSetting("menu_image").catch(() => null);
    if (stored) {
      imageBuffer = stored;
    } else {
      // Fallback: legacy file path or HTTP URL stored in bots.menu_image_url
      const imageUrl = bot?.menu_image_url;
      if (imageUrl) {
        if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
          try {
            const res = await fetch(imageUrl, { signal: AbortSignal.timeout(10000) });
            if (res.ok) imageBuffer = Buffer.from(await res.arrayBuffer());
          } catch {}
        } else if (fs.existsSync(imageUrl)) {
          imageBuffer = fs.readFileSync(imageUrl);
        }
      }
    }

    if (imageBuffer) {
      await sock.sendMessage(from, {
        image: imageBuffer,
        caption: menuText,
        mentions: [sender],
      });
      return;
    }

    await sock.sendMessage(from, {
      text: menuText,
      mentions: [sender],
    });
  } catch {
    await sock.sendMessage(from, {
      text: menuText,
      mentions: [sender],
    });
  }
}

export async function handleSetMenuImage(ctx: CommandContext): Promise<void> {
  const { from, sock, msg } = ctx;

  const quoted = (msg.message as any)?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted?.imageMessage) {
    await sock.sendMessage(from, { text: "❌ Reply to an image with *.setmenuimg* to set it as the menu image." });
    return;
  }

  try {
    const downloaded = await downloadMediaMessage(
      { message: quoted, key: msg.key } as any,
      "buffer",
      { reuploadRequest: (sock as any).updateMediaMessage } as any
    );
    const buffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as any);

    // Store the image binary in MongoDB (bot_settings) rather than the local
    // filesystem. Local files are wiped on every server restart/redeploy, so
    // .setmenuimg would appear to work but the image would vanish after the
    // next deploy. bot_settings persists across restarts.
    // Keyed per-bot so different linked numbers can carry different menu
    // artwork; also refreshes the legacy global key as a fallback for setups
    // running a single bot instance.
    const { setBotSetting } = await import("../db/queries.js");
    const { getBotIdForSock } = await import("../bot-manager.js");
    // Use managed botId first; fall back to phone derived from sock.user so
    // standalone bots each get their own key rather than sharing the global one.
    const botId = getBotIdForSock(sock)
      || sock.user?.id?.split("@")[0]?.split(":")[0]
      || null;
    // Only write the per-bot key — never overwrite the global "menu_image"
    // fallback here, because that would cause every bot without its own
    // image to suddenly show whichever bot most recently ran .setmenuimg.
    if (botId) {
      await setBotSetting(`menu_image:${botId}`, buffer);
    } else {
      // No botId resolvable at all — fall back to global key
      await setBotSetting("menu_image", buffer);
    }

    // Also write to local disk as a best-effort cache (for faster reads),
    // but the authoritative copy is now in MongoDB.
    try {
      fs.writeFileSync(path.join(MENU_ASSETS_DIR, "menu.jpg"), buffer);
    } catch {}

    const botLabel = botId ? `bot *${botId}*` : "global fallback";
    await sock.sendMessage(from, { text: `✅ Menu image saved for ${botLabel}. Every *.menu* from this bot will now show it.\n\n_To verify: type *.menu* and confirm the image matches._` });
  } catch {
    await sock.sendMessage(from, { text: "❌ Couldn't save that image. Try again with a JPG or PNG." });
  }
}

export async function handleHelp(ctx: CommandContext): Promise<void> {
  const { from, sock } = ctx;
  const help =
`🌸━━━『 反逆 』━━━🌸

✦ 𝗖𝗼𝗺𝗺𝗮𝗻𝗱 𝗚𝘂𝗶𝗱𝗲 ✦

❀━━━━━━━━━━━━━━❀
            📋 𝗠𝗔𝗜𝗡
❀━━━━━━━━━━━━━━❀
➺ .menu — Shows the full command list
➺ .ping — Checks if bot is online
➺ .afk [reason] — Sets you as Away From Keyboard
➺ .uptime — Shows how long the bot has been running
➺ .website — Bot website link
➺ .community — Join the community group
➺ .bots — View available bot instances
➺ .help / .info — This help message

❀━━━━━━━━━━━━━━❀
            ⚙️ 𝗔𝗗𝗠𝗜𝗡
❀━━━━━━━━━━━━━━❀
➺ .kick @user — Removes a member
➺ .warn @user [reason] — Warns a member (5 = kick)
➺ .antilink set [delete/warn/kick] — Auto-remove links
➺ .antism on/off — Deletes status-mention messages
➺ .antibot on/off — Auto-remove bot accounts
➺ .blacklist add/remove [number] — Block a number from the group
➺ .purge [country_code] — Remove all non-admins from a country code
➺ .welcome on/off / .setwelcome [msg] — New member message
➺ .hidetag [text] — Silently tag all members
➺ .activity — Check group activity score
➺ .gclink — Get the group invite link
➺ .rules — View group rules
➺ .setmenuimg — Set the image attached to .menu (reply to an image)

❀━━━━━━━━━━━━━━❀
         💰 𝗘𝗖𝗢𝗡𝗢𝗠𝗬
❀━━━━━━━━━━━━━━❀
➺ .reg — Link your WhatsApp to your account
➺ .bal — Wallet & bank balance
➺ .daily — Collect daily reward
➺ .deposit / .withdraw [amount] — Move money
➺ .shop / .buy [item] — Browse and buy items
➺ .gems — Card draw currency (used for getting cards)
➺ .leaderboard / .lb — Top players — level up via .dungeon only. Lv.20 unlocks guild creation!

❀━━━━━━━━━━━━━━❀
           🎴 𝗖𝗔𝗥𝗗𝗦
❀━━━━━━━━━━━━━━❀
➺ .coll — View your card collection
➺ .ci [name] — Card info lookup
➺ .sc [name] — Search all cards by name
➺ .ss [series] — View all cards in a series
➺ .cs [series] — View your cards from a specific series
➺ .vs @user — Battle another player's deck
➺ .auction / .bid [id] [amt] — Auction cards
➺ .mzsearch [name] — Search Mazoku cards by name
➺ .mzseries [series] — Browse Mazoku cards by series

❀━━━━━━━━━━━━━━❀
           ⚔️ 𝗗𝗨𝗡𝗚𝗘𝗢𝗡 & 𝗥𝗣𝗚
❀━━━━━━━━━━━━━━❀
➺ .rpg — View your RPG character
➺ .dungeon — Enter a dungeon and level up!
➺ .adventure — Go on an adventure
➺ .quest — View active quests
➺ .explore — Explore new areas
➺ .territory — Claim world territories

❀━━━━━━━━━━━━━━❀
        🏰 𝗚𝗨𝗜𝗟𝗗𝗦
❀━━━━━━━━━━━━━━❀
➺ .guild create <name> — Create a guild (Lv.20)
➺ .guild join <name> — Join an existing guild
➺ .guild list — See all guilds
➺ .guild info [name] — Guild details

❀━━━━━━━━━━━━━━❀
         🎮 𝗚𝗔𝗠𝗘𝗦
❀━━━━━━━━━━━━━━❀
➺ .ttt @user — Tic Tac Toe
➺ .c4 @user — Connect Four
➺ .wcg start — Word Chain Game
➺ .td — Truth or Dare
➺ .uno — Play UNO

❀━━━━━━━━━━━━━━❀
🚀 *Level 20 is a major milestone!*
Once you reach Lv.20 via dungeons, you can create your own GUILD.
Dungeon is the only way to level up — go grind! ⚔️

_Use .menu for the full command list_`;

  await sock.sendMessage(from, { text: help });
}

export async function handleInfo(ctx: CommandContext): Promise<void> {
  const { from, sender, sock } = ctx;
  const uptime = process.uptime();
  const d = Math.floor(uptime / 86400);
  const h = Math.floor((uptime % 86400) / 3600);
  const m = Math.floor((uptime % 3600) / 60);
  const s = Math.floor(uptime % 60);
  const uptimeStr = d > 0 ? `${d}d ${h}h ${m}m ${s}s` : `${h}h ${m}m ${s}s`;

  const [groupCount, userCount, cardCount] = await Promise.all([
    col("groups").countDocuments({}),
    col("users").countDocuments({ registered: 1, is_bot: { $ne: 1 } }),
    col("cards").countDocuments({}),
  ]);

  const info = `🌌 *Requiem Order Bot — 反逆*\n\n` +
    `🌌 Bot: ${ctx.sock.user?.name || "Requiem Order"}\n` +
    `👑 Creator: Eᴍᴘᴇʀᴏʀ Lᴇʟᴏᴜᴄʜ\n` +
    `🔹 Prefix: [ . ]\n` +
    `📡 Status: Online ✅\n` +
    `⏱️ Uptime: ${uptimeStr}\n` +
    `🏘️ Active Groups: ${groupCount}\n` +
    `👥 Registered Users: ${userCount}\n` +
    `🎴 Cards in Database: ${cardCount}\n` +
    `\n_🌌 Requiem Order — Heavenly Sky_`;

  await sock.sendMessage(from, { text: info, mentions: [sender] });
}
