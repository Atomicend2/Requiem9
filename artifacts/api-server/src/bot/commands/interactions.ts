import type { CommandContext } from "./index.js";
import { sendText, animatedToMp4 } from "../connection.js";
import { mentionTag } from "../utils.js";
import { logger } from "../../lib/logger.js";

export const INTERACTION_NAMES = new Set([
  "hug","kiss","slap","pat","punch","kill","hit","kidnap","lick","bonk","tickle",
  "wave","dance","sad","smile","laugh","shrug","bite","cry","blush",
]);

const ACTIONS: Record<string, { with: string[]; self: string[] }> = {
  hug: {
    with: ["hugs {target} tightly! 🤗", "wraps {target} in a warm hug 💕"],
    self: ["wants a hug... 🥺"],
  },
  kiss: {
    with: ["kisses {target}! 💋", "gives {target} a little kiss 😘"],
    self: ["kissed the mirror again 😚"],
  },
  slap: {
    with: ["slaps {target}! SMACK! 👋", "gave {target} a reality check 🖐️"],
    self: ["slapped themselves... are you okay? 🤔"],
  },
  pat: {
    with: ["pats {target} on the head 🥰", "gives {target} a gentle pat 👋"],
    self: ["pats themselves... hang in there 💪"],
  },
  punch: {
    with: ["punches {target}! POW! 👊", "sends a punch flying at {target} 🥊"],
    self: ["punched themselves. Ouch?"],
  },
  kill: {
    with: ["eliminated {target}! 💀", "got rid of {target}. RIP 🪦"],
    self: ["tried self-deletion but respawned 😂"],
  },
  hit: {
    with: ["hits {target}! 💢", "smacks {target} 🏏"],
    self: ["hit themselves... 😬"],
  },
  kidnap: {
    with: ["kidnapped {target}! 🎭", "snatched {target} away! 😈"],
    self: ["tried to kidnap themselves. Failed 🕵️"],
  },
  lick: {
    with: ["licked {target}! 😛", "gives {target} a lick for some reason... 👅"],
    self: ["licked themselves 😂"],
  },
  bonk: {
    with: ["bonks {target} on the head! 🔨", "sends {target} to horny jail 🚔"],
    self: ["self-bonked 💥"],
  },
  tickle: {
    with: ["tickles {target}! Hehehe! 😂", "attacks {target}'s weak spot 🤣"],
    self: ["tried to tickle themselves 🤷"],
  },
  wave: {
    with: ["waved at {target}! 👋", "waves to {target}~ 🌊"],
    self: ["waves hello! 👋", "waves at everyone~ 🌊"],
  },
  bite: {
    with: ["bites {target}! 😬", "nibbles on {target} 🦷", "chomps {target}! Ow! 😤"],
    self: ["bit themselves... 🤦"],
  },
  cry: {
    with: ["cries on {target}'s shoulder 😢", "bursts into tears in front of {target} 😭"],
    self: ["is sobbing alone 😭"],
  },
  blush: {
    with: ["blushes at {target} 😳", "turns bright red looking at {target} 🌹"],
    self: ["is blushing for no reason 😳"],
  },
};

const SOLO_ACTIONS: Record<string, string[]> = {
  dance: ["is dancing! 💃", "starts busting moves! 🕺"],
  sad: ["is feeling sad right now... 😢", "needs some comfort 🥺"],
  smile: ["smiles brightly! 😊", "gives you a warm smile ☺️"],
  laugh: ["bursts out laughing! 😂", "can't stop laughing 🤣"],
  shrug: ["shrugs. ¯\\_(ツ)_/¯", "doesn't know either 🤷"],
};

// otakugifs.xyz reaction mapping — verified against the live
// https://api.otakugifs.xyz/gif/allreactions endpoint. kill, kidnap, and
// bonk have no equivalent reaction on this API (checked directly, not
// guessed), so those three stay text-only rather than risk a silently
// wrong/404ing endpoint name.
const OTAKUGIFS_MAP: Record<string, string> = {
  pat: "pat", slap: "slap", hug: "hug", kiss: "kiss",
  punch: "punch", bite: "bite", lick: "lick",
  tickle: "tickle", wave: "wave", hit: "smack",
  dance: "dance", sad: "sad", smile: "smile", blush: "blush",
  cry: "cry", laugh: "laugh", shrug: "shrug",
};

export async function handleInteraction(ctx: CommandContext): Promise<void> {
  const { from, sender, args, command: cmd, sock, resolvedMentions } = ctx;
  const info = ctx.msg.message?.extendedTextMessage?.contextInfo;
  const mentioned = resolvedMentions[0] || info?.participant || undefined;

  if (SOLO_ACTIONS[cmd]) {
    const actions = SOLO_ACTIONS[cmd];
    const action = actions[Math.floor(Math.random() * actions.length)];
    await sendInteractionResult(ctx, `${mentionTag(sender)} ${action}`, [sender]);
    return;
  }

  if (ACTIONS[cmd]) {
    const actions = ACTIONS[cmd];
    if (mentioned) {
      const templates = actions.with;
      const tmpl = templates[Math.floor(Math.random() * templates.length)];
      const text = `${mentionTag(sender)} ${tmpl.replace("{target}", `${mentionTag(mentioned)}`)}`;
      await sendInteractionResult(ctx, text, [sender, mentioned]);
    } else {
      const texts = actions.self;
      await sendInteractionResult(ctx, `${mentionTag(sender)} ${texts[Math.floor(Math.random() * texts.length)]}`, [sender]);
    }
    return;
  }
}

async function sendInteractionResult(ctx: CommandContext, text: string, mentions: string[]): Promise<void> {
  const gifBuffer = await fetchInteractionGif(ctx.command).catch(() => null);
  if (gifBuffer) {
    try {
      await ctx.sock.sendMessage(ctx.from, {
        video: gifBuffer,
        gifPlayback: true,
        caption: text,
        mentions,
        mimetype: "video/mp4",
      });
      return;
    } catch (err) {
      logger.warn({ err, cmd: ctx.command }, "Failed to send interaction GIF, falling back to text");
    }
  }
  await ctx.sock.sendMessage(ctx.from, { text, mentions });
}

async function fetchInteractionGif(action: string): Promise<Buffer | null> {
  const reaction = OTAKUGIFS_MAP[action];
  if (!reaction) return null;

  const res = await fetch(`https://api.otakugifs.xyz/gif?reaction=${reaction}&format=gif`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;

  const json = await res.json() as any;
  const url: string | undefined = json?.url;
  if (!url) return null;

  const gifRes = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!gifRes.ok) return null;
  const rawData = Buffer.from(await gifRes.arrayBuffer());

  if (url.endsWith(".mp4") || url.includes(".mp4?")) {
    return rawData;
  }

  return convertGifToMp4(rawData);
}

async function convertGifToMp4(gifBuffer: Buffer): Promise<Buffer | null> {
  return animatedToMp4(gifBuffer, "gif");
}
