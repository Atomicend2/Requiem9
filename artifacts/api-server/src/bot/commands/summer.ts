import type { CommandContext } from "./index.js";
import { sendText } from "../connection.js";
import { getSummerTokens, addSummerTokens, setSummerTokens, getTopSummerTokens, getUser } from "../db/queries.js";
import { formatNumber } from "../utils.js";

const SUMMER_SHOP: Array<{ name: string; cost: number; description: string }> = [
  { name: "Summer Sunglasses", cost: 50, description: "A cool summer accessory" },
  { name: "Beach Ball", cost: 30, description: "Fun at the beach!" },
  { name: "Ice Cream", cost: 20, description: "Refreshing summer treat" },
  { name: "Surfboard", cost: 100, description: "Ride the waves!" },
  { name: "Summer Bundle", cost: 500, description: "Exclusive summer items!" },
];

export async function handleSummer(ctx: CommandContext): Promise<void> {
  const { from, sender, args, command: cmd } = ctx;
  // Canonical DB key — user.id (phone), not raw sender which may be @lid
  const rawUser = await getUser(sender.split("@")[0].split(":")[0]);
  const userId = rawUser?.id || sender.split("@")[0].split(":")[0];
  const tokens = await getSummerTokens(userId);

  if (cmd === "summer") {
    await sendText(from,
      `☀️ *Summer Event*\n\n` +
      `🎫 Your Tokens: ${tokens}\n\n` +
      `📋 Commands:\n` +
      `• .token check — check your tokens\n` +
      `• .token shop — view shop\n` +
      `• .token buy [#] — buy an item\n` +
      `• .token top — leaderboard\n\n` +
      `💡 Earn tokens by chatting, playing games, and winning battles!`
    );
    return;
  }

  if (cmd === "token") {
    const sub = args[0]?.toLowerCase();

    if (sub === "check") {
      await sendText(from, `🎫 You have *${tokens} Summer Tokens*!`);
      return;
    }

    if (sub === "shop") {
      let text = "🏪 *Summer Token Shop*\n\n";
      SUMMER_SHOP.forEach((item, i) => {
        text += `${i + 1}. *${item.name}* — ${item.cost} tokens\n   ${item.description}\n`;
      });
      text += "\nUse .token buy [#] to purchase!";
      await sendText(from, text);
      return;
    }

    if (sub === "buy") {
      const idx = parseInt(args[1]) - 1;
      if (isNaN(idx) || idx < 0 || idx >= SUMMER_SHOP.length) {
        await sendText(from, "❌ Invalid item number. Use .token shop to see items.");
        return;
      }
      const item = SUMMER_SHOP[idx];
      if (tokens < item.cost) {
        await sendText(from, `❌ Not enough tokens. Need ${item.cost}, you have ${tokens}.`);
        return;
      }
      await setSummerTokens(sender, tokens - item.cost);
      const { addToInventory } = await import("../db/queries.js");
      await addToInventory(userId, item.name);

      await sendText(from, `✅ Purchased *${item.name}* for ${item.cost} tokens!`);
      return;
    }

    if (sub === "top") {
      const top = await getTopSummerTokens(10);
      let text = "🏆 *Summer Token Leaderboard*\n\n";
      top.forEach((u, i) => {
        text += `${i + 1}. @${u.user_id.split("@")[0]} — ${u.tokens} tokens\n`;
      });
      await sendText(from, text, top.map((u) => u.user_id));
      return;
    }

    await sendText(from, "Usage: .token check | .token shop | .token buy [#] | .token top");
    return;
  }
}
