import type { CommandContext } from "./index.js";
import { sendText } from "../connection.js";

const CHARACTERS = [
  "Goku (Dragon Ball Z)","Naruto Uzumaki (Naruto)","Luffy (One Piece)",
  "Ichigo (Bleach)","Zoro (One Piece)","Sasuke (Naruto)","Vegeta (DBZ)",
  "Levi (Attack on Titan)","Todoroki (MHA)","Itachi (Naruto)",
  "Light Yagami (Death Note)","L (Death Note)","Natsu (Fairy Tail)",
  "Erza (Fairy Tail)","Rem (Re:Zero)","Zero Two (Darling in the FranXX)",
  "Kirito (SAO)","Asuna (SAO)","Mikasa (AoT)","Hinata (Naruto)",
];

const POVS = [
  "You just realized you're the villain of someone else's story.",
  "You wake up and your entire memory is gone.",
  "You find a note that says 'Don't look behind you.'",
  "Everyone can see your aura except you.",
  "The world ended last night and you slept through it.",
  "You discover you've been an NPC this whole time.",
];

const RELATIONS = [
  "Soulmates", "Rivals", "Best Friends", "Enemies", "Secret Lovers",
  "Childhood Friends", "Mentor & Student", "Twin Flames", "Frenemies",
];

const WYR = [
  "Fight 100 duck-sized horses or 1 horse-sized duck?",
  "Never eat your favorite food again OR eat only your favorite food forever?",
  "Be able to fly but only 1 inch off the ground OR run at 100mph?",
  "Know when you'll die OR how you'll die?",
  "Live without music OR live without TV/movies?",
  "Be able to speak all languages OR talk to animals?",
  "Have unlimited money but no friends OR be loved by everyone but be broke?",
];

const JOKES = [
  "My grandfather died peacefully in his sleep. The passengers in his car, not so much. 🚗",
  "My doctor told me I needed to watch my drinking. Now I do it in front of a mirror. 🍺",
  "My therapist told me I have trouble accepting reality. I said: 'We'll see about that.' 🗑️",
  "I have enough money to last the rest of my life. Unless I buy something. 💀",
  "My wife told me to stop acting like a flamingo. I had to put my foot down. 🦩",
  "Someone broke into my house and stole all my lamps. I was delighted. 🕯️",
  "I hate double standards. If you cremate someone at a funeral home, you're a professional. Do it at home and people get weird about it. 🔥",
  "My dad always said: 'Fight fire with fire.' Great man. Terrible firefighter. 🚒",
  "My grandpa died doing what he loved — not paying attention while driving. 🚗",
  "I asked my North Korean friend how things were going. He said he couldn't complain. 🙃",
  "I told my son he was adopted. He cried. I said 'It was a joke.' He asked 'Is that a joke too?' I said 'No, this part's real.' 👶",
  "My wife and I have a safe word. 'Divorce.' 💍",
  "We bought a dog and named him 'Stay.' 'Come here, Stay!' The dog is confused. The dog is also dead. 🐶",
  "I'm great at forgetting things. Which is why I keep re-reading my therapist's bills. 🧠",
  "My ex got hit by a bus. Lost my job as a bus driver. 🚌",
  "I asked a woman on the street what the time was. She said 'I don't talk to strangers.' It was 3am, she was in a graveyard. Should've put two and two together. 💀",
  "My wife told me she wanted to feel like a princess on her birthday. I left her with three brothers fighting over who rules the kingdom. 👸",
  "My son asked me what it's like to have kids. I told him I'd tell him later. Then never did. 🤷",
  "I threw a boomerang years ago. Now I live in constant fear. 🪃",
  "I was reading a book about Stockholm syndrome. Awful start, great ending. 📖",
  "A cop stops me: 'Sir, are you aware your wife fell out the car three blocks ago?' I said, 'Thank God, I thought I went deaf.' 🚔",
  "My sister burned all my anime DVDs. I watched her burn. 🔥",
  "My mom says I have no empathy. She has no idea how little I care. 😐",
  "I was gonna tell a joke about unemployment but none of them work. 😂",
  "I asked my dog what 2 minus 2 is. He said nothing. 🐶",
  "My gym instructor died. Should I still do the plank? 🏋️",
  "I have a joke about time travel but you didn't like it. ⌛",
  "Cemetery just raised prices. Blame it on the cost of living. ⚰️",
  "A skeleton walks into a bar. Orders a beer and a mop. 💀",
  "My father has schizophrenia, but he's good people. Both of them. 🧩",
  "Two cannibals are eating a clown. One turns to the other: 'Does this taste funny to you?' 🤡",
  "I hate Russian dolls. You open them and there's another problem inside. 🪆",
  "My wife and I were happy for 20 years. Then we met. 💍",
  "I used to be a banker, then I lost interest. 🏦",
  "My son cried when I told him Santa wasn't real. The bad part was telling him his dad wasn't either. 🎅",
  "I named my horse Mayo. Mayo neighs. 🐴",
  "If at first you don't succeed... skydiving is not for you. 🪂",
  "I have a lot of growing up to do. I realized that the other day inside my fort. 🏰",
  "My wife said I had to stop acting immature. I said 'Tell that to my fort.' 👑",
  "I have enough money to live comfortably for the rest of my life. If I die next Thursday. 💸",
  "My wife told me she wanted to feel special on our anniversary. So I reminded her that statistically, she's one in a million. 💎",
  "My friend said he knew a thousand jokes. I asked him to tell me one. He said 'You.' Then left. 🚪",
  "I tried writing a book on insomnia. Couldn't put it down. 📚",
  "I live in constant fear of someone discovering I'm adopted. Especially my biological parents. 👨‍👩‍👦",
  "My therapist says I have a preoccupation with revenge. We'll see about that. 😶",
  "I told my friend he should embrace his mistakes. He's been hugging me for three days now. 🫂",
  "My boss said I intimidate coworkers. I just stared at him until he apologized. 👁️",
  "The other day I helped an old man cross the street. He screamed the whole way. Thought he needed help. Turns out he didn't want to cross. 🚶",
  "I bought a book called 'How to Scam People Online.' Cost me $200 and never arrived. 💻",
  "My son kept saying 'Are we there yet?' the whole flight. Embarrassing — he's the pilot. ✈️",
  "My wife said I never listen, or something like that. 👂",
  "I have an inferiority complex but it's not a very good one. 🤷",
  "My therapist says I have trouble letting go. We'll see about that. 🗑️",
  "I'm writing a book on reverse psychology. Please don't read it. 📚",
  "People say I have a drinking problem. But I'm actually very good at it. 🍺",
  "My ex got into a car accident. I told her to stop texting me while she was driving. 📱",
  "I failed my driver's test. The instructor asked what to do when the car slides. I said 'panic.' 🚗",
  "Life is too short to worry. Life is also too short not to. Make up your mind, life. 😤",
];

// Named fancy styles for .fancy command
const FANCY_STYLES: Array<{ name: string; fn: (t: string) => string }> = [
  // ─── Fantasy / Ancient ────────────────────────────────────────
  {
    name: "Strikethrough",
    fn: (t) => t.split("").map(c => c + "\u0336").join(""),
  },
  {
    name: "Fantasy Capital",
    fn: (t) => t.toUpperCase().split("").map(c => ({"A":"Æ","B":"ß","C":"Ç","D":"Ð","E":"È","F":"Ƒ","G":"Ğ","H":"Ħ","I":"Ì","J":"Ĵ","K":"Ķ","L":"Ł","M":"Μ","N":"Ñ","O":"Ø","P":"Þ","Q":"Ω","R":"Ȑ","S":"Ś","T":"Ŧ","U":"Ü","V":"Ʋ","W":"Ψ","X":"Χ","Y":"Ÿ","Z":"Ž"}[c] || c)).join(""),
  },
  {
    name: "Samurai",
    fn: (t) => t.toUpperCase().split("").map(c => ({"A":"卂","B":"乃","C":"匚","D":"ᗪ","E":"乇","F":"千","G":"Ꮆ","H":"卄","I":"丨","J":"ﾌ","K":"Ҝ","L":"ㄥ","M":"爪","N":"几","O":"ㄖ","P":"卩","Q":"Ɋ","R":"尺","S":"丂","T":"ㄒ","U":"ㄩ","V":"ᐯ","W":"山","X":"乂","Y":"ㄚ","Z":"乙"}[c] || c)).join(""),
  },
  // ─── Gothic / Dark ────────────────────────────────────────────
  {
    name: "Underline",
    fn: (t) => t.split("").map(c => c + "\u0332").join(""),
  },
  {
    name: "Tilde Glow",
    fn: (t) => t.split("").map(c => c + "\u0303").join(""),
  },
  {
    name: "Overline",
    fn: (t) => t.split("").map(c => c + "\u0305").join(""),
  },
  {
    name: "Runic",
    fn: (t) => t.toUpperCase().split("").map(c => ({"A":"ᚨ","B":"ᛒ","C":"ᚲ","D":"ᛞ","E":"ᛖ","F":"ᚠ","G":"ᚷ","H":"ᚺ","I":"ᛁ","J":"ᛃ","K":"ᚲ","L":"ᛚ","M":"ᛗ","N":"ᚾ","O":"ᛟ","P":"ᛈ","Q":"ᛩ","R":"ᚱ","S":"ᛊ","T":"ᛏ","U":"ᚢ","V":"ᚡ","W":"ᚹ","X":"ᛪ","Y":"ᛇ","Z":"ᛉ"}[c] || c)).join(""),
  },
  {
    name: "Shadow Drip",
    fn: (t) => t.split("").map(c => c + "\u0330").join(""),
  },
  {
    name: "Dotted Sky",
    fn: (t) => t.split("").map(c => c + "\u0307").join(""),
  },
  // ─── Cute / Soft ──────────────────────────────────────────────
  {
    name: "Flag Letters",
    fn: (t) => t.toUpperCase().split("").map(c => {
      const idx = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(c);
      return idx >= 0 ? String.fromCodePoint(0x1F1E6 + idx) : c;
    }).join(" "),
  },
  {
    name: "Tiny Caps",
    fn: (t) => t.split("").map(c => ({"a":"ᴀ","b":"ʙ","c":"ᴄ","d":"ᴅ","e":"ᴇ","f":"ꜰ","g":"ɢ","h":"ʜ","i":"ɪ","j":"ᴊ","k":"ᴋ","l":"ʟ","m":"ᴍ","n":"ɴ","o":"ᴏ","p":"ᴘ","q":"Q","r":"ʀ","s":"s","t":"ᴛ","u":"ᴜ","v":"ᴠ","w":"ᴡ","x":"x","y":"ʏ","z":"ᴢ"}[c.toLowerCase()] || c)).join(""),
  },
  {
    name: "Rounded",
    fn: (t) => t.split("").map(c => "ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏ"["abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(c)] || c).join(""),
  },
  {
    name: "Soft Wide",
    fn: (t) => t.split("").map(c => "ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ"["abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(c)] || c).join(""),
  },
  // ─── Hacker / Celestial ───────────────────────────────────────
  {
    name: "Glitch",
    fn: (t) => t.split("").map(c => c + "\u0334").join(""),
  },
  {
    name: "Dot Below",
    fn: (t) => t.split("").map(c => c + "\u0323").join(""),
  },
  {
    name: "Double Crown",
    fn: (t) => t.split("").map(c => c + "\u033F").join(""),
  },
  {
    name: "Ring Halo",
    fn: (t) => t.split("").map(c => c + "\u0325").join(""),
  },
  {
    name: "ZigZag Font",
    fn: (t) => t.split("").map(c => ({"a":"α","b":"в","c":"ς","d":"∂","e":"є","f":"ƒ","g":"ɢ","h":"н","i":"ι","j":"נ","k":"к","l":"ℓ","m":"м","n":"η","o":"σ","p":"ρ","q":"ϑ","r":"я","s":"ѕ","t":"т","u":"υ","v":"ν","w":"ω","x":"χ","y":"у","z":"ζ","A":"Λ","B":"ß","C":"Ç","D":"Ð","E":"Σ","F":"Ƒ","G":"Ğ","H":"Η","I":"Ī","J":"Ĵ","K":"Ҝ","L":"Ł","M":"Μ","N":"И","O":"Ω","P":"Ρ","Q":"Θ","R":"Я","S":"Ş","T":"Τ","U":"Ц","V":"Ψ","W":"Ш","X":"Χ","Y":"Ч","Z":"Ζ"}[c] || c)).join(""),
  },
  {
    name: "Д Cyrillic Mix Д",
    fn: (t) => t.toUpperCase().split("").map(c => ({"A":"А","B":"В","C":"С","D":"Д","E":"Е","F":"Ғ","G":"Г","H":"Н","I":"И","J":"Ĵ","K":"К","L":"Л","M":"М","N":"И","O":"О","P":"Р","Q":"Ω","R":"Я","S":"Ş","T":"Т","U":"У","V":"Ѵ","W":"Ш","X":"Х","Y":"Ч","Z":"З"}[c] || c)).join(""),
  },
  {
    name: "Inverted Squares",
    fn: (t) => t.toUpperCase().split("").map(c => ({"A":"🅰","B":"🅱","C":"🅲","D":"🅳","E":"🅴","F":"🅵","G":"🅶","H":"🅷","I":"🅸","J":"🅹","K":"🅺","L":"🅻","M":"🅼","N":"🅽","O":"🅾","P":"🅿","Q":"🆀","R":"🆁","S":"🆂","T":"🆃","U":"🆄","V":"🆅","W":"🆆","X":"🆇","Y":"🆈","Z":"🆉"}[c] || c)).join(""),
  },
];

const SOCIALS = [
  "Instagram addict 📸","Twitter main character 🐦","TikTok dancer 💃",
  "Discord lurker 👁️","Twitch streamer 🎮","Reddit philosopher 🤔",
];

const DUALITIES = [
  "Soft-spoken but will fight you 🥊","Introvert online, extrovert with friends",
  "Says 'I don't care' but cares deeply","Looks mean, is actually soft","Quiet in real life, chaotic online",
];

const SKILLS = [
  "Professional overthinker","Master of saying 'I'll do it later'",
  "Expert at pretending to be busy","PhD in sleeping through alarms",
  "Certified snack locator","World champion at avoiding conflict",
];

const GENS = [
  "You were definitely a cat in a past life 🐱",
  "Your vibe screams main character energy ✨",
  "You have the energy of someone who's seen too much 👁️",
  "You're 90% internet and 10% real world",
  "Your personality is literally a mood board",
];

export async function handleFun(ctx: CommandContext): Promise<void> {
  const { from, sender, args, command: cmd, msg, sock, resolvedMentions } = ctx;
  const { getMentionName: funGetName } = await import("../db/queries.js");
  const name = await funGetName(sender);
  const mentioned = resolvedMentions[0];
  if (cmd === "gay") {
    const targetId = getFunTarget(ctx);
    const targetName = await funGetName(targetId);
    const pct = Math.floor(Math.random() * 101);
    await sock.sendMessage(from, {
      text: analysisResult("𝗚𝗮𝘆", targetName, pct),
      mentions: [targetId],
    });
    return;
  }

  if (cmd === "lesbian") {
    const targetId = getFunTarget(ctx);
    const targetName = await funGetName(targetId);
    const pct = Math.floor(Math.random() * 101);
    await sock.sendMessage(from, {
      text: analysisResult("𝗟𝗲𝘀𝗯𝗶𝗮𝗻", targetName, pct),
      mentions: [targetId],
    });
    return;
  }

  if (cmd === "simp") {
    const target = mentioned ? `@${await funGetName(mentioned)}` : "someone";
    const pct = Math.floor(Math.random() * 101);
    await sock.sendMessage(from, {
      text: `😩 @${name} is *${pct}% simp* for ${target}!`,
      mentions: [sender, ...(mentioned ? [mentioned] : [])],
    });
    return;
  }

  if (cmd === "match") {
    if (!mentioned) { await sendText(from, "❌ Mention someone to match with!"); return; }
    const pct = Math.floor(Math.random() * 101);
    const rating = pct >= 80 ? "💍 Perfect match!" : pct >= 60 ? "💕 Good match!" : pct >= 40 ? "🤝 Decent match." : "💔 Not meant to be.";
    const matchedName = await funGetName(mentioned);
    await sock.sendMessage(from, {
      text: `💘 @${name} + @${matchedName} = *${pct}%* match\n${rating}`,
      mentions: [sender, mentioned],
    });
    return;
  }

  if (cmd === "ship") {
    if (!mentioned) { await sendText(from, "❌ Mention someone to ship with!"); return; }
    const n1 = name;
    const n2 = await funGetName(mentioned);
    const ship = n1.slice(0, Math.ceil(n1.length / 2)) + n2.slice(Math.floor(n2.length / 2));
    await sock.sendMessage(from, {
      text: `💑 Ship name: *${ship}* 💕`,
      mentions: [sender, mentioned],
    });
    return;
  }

  if (cmd === "character") {
    const char = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
    await sendText(from, `🎭 @${name}'s anime character is:\n*${char}*`, [sender]);
    return;
  }

  if (cmd === "psize" || cmd === "pp") {
    const size = Math.floor(Math.random() * 25);
    const bar = "8" + "=".repeat(size) + "D";
    await sendText(from, `📏 @${name}'s size: ${size}cm\n${bar}`, [sender]);
    return;
  }

  if (cmd === "skill") {
    const s = SKILLS[Math.floor(Math.random() * SKILLS.length)];
    await sendText(from, `🎯 @${name}'s special skill:\n*${s}*`, [sender]);
    return;
  }

  if (cmd === "duality") {
    const d = DUALITIES[Math.floor(Math.random() * DUALITIES.length)];
    await sendText(from, `♎ @${name}'s duality:\n*${d}*`, [sender]);
    return;
  }

  if (cmd === "gen") {
    const g = GENS[Math.floor(Math.random() * GENS.length)];
    await sendText(from, `🔮 ${g}`, [sender]);
    return;
  }

  if (cmd === "pov") {
    const p = POVS[Math.floor(Math.random() * POVS.length)];
    await sendText(from, `📖 *POV:* ${p}`);
    return;
  }

  if (cmd === "social") {
    const s = SOCIALS[Math.floor(Math.random() * SOCIALS.length)];
    await sendText(from, `📱 @${name} gives off:\n*${s}* energy`, [sender]);
    return;
  }

  if (cmd === "relation") {
    if (!mentioned) { await sendText(from, "❌ Mention someone!"); return; }
    const r = RELATIONS[Math.floor(Math.random() * RELATIONS.length)];
    await sock.sendMessage(from, {
      text: `💫 @${name} and @${mentioned.split("@")[0]} are:\n*${r}*`,
      mentions: [sender, mentioned],
    });
    return;
  }

  if (cmd === "rizz") {
    const targetId = getFunTarget(ctx);
    const targetName = await funGetName(targetId);
    const score = Math.floor(Math.random() * 101);
    const tier =
      score >= 95 ? "🌟 Sigma Rizz — you make people question their orientation" :
      score >= 80 ? "🔥 High Rizz — effortlessly charming" :
      score >= 60 ? "😎 Mid Rizz — solid, gets the job done" :
      score >= 40 ? "🫤 Low Rizz — trying, but struggling" :
      score >= 20 ? "💀 Negative Rizz — somehow makes it worse" :
                    "☠️ Rizz -999 — certified NPC";
    const filled = Math.round((score / 100) * 10);
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    await sock.sendMessage(from, {
      text: `✨ *Rizz Meter* — @${targetName}\n\n[${bar}] ${score}%\n\n${tier}`,
      mentions: [targetId],
    });
    return;
  }

  if (cmd === "wouldyourather" || cmd === "wyr") {
    const q = WYR[Math.floor(Math.random() * WYR.length)];
    await sendText(from, `🤔 *Would You Rather...*\n\n${q}`);
    return;
  }

  if (cmd === "joke") {
    await sendText(from, `😂 ${JOKES[Math.floor(Math.random() * JOKES.length)]}`);
    return;
  }

  if (cmd === "fancy") {
    const styleNum = parseInt(args[0]);
    const text = args.slice(1).join(" ");
    const total = FANCY_STYLES.length;
    if (!args[0] || isNaN(styleNum) || !text) {
      const allPreviews = FANCY_STYLES.map((style, i) =>
        `${String(i + 1).padStart(2, "0")}. ${style.name}\n    ${style.fn("Requiem Order")}`
      ).join("\n");
      await sendText(from,
        `🎭 *Fancy Text Styles*\n` +
        `Usage: .fancy <1-${total}> <your text>\n` +
        `Example: .fancy 3 Shadow King\n\n` +
        allPreviews
      );
      return;
    }
    const idx = Math.max(1, Math.min(total, styleNum)) - 1;
    const style = FANCY_STYLES[idx];
    const styled = style.fn(text);
    await sendText(from, styled);
    return;
  }
}

function loadingText(command: string): string {
  return `┌─⟡ 『 𝗔𝗟𝗣𝗛𝗔 𝗟𝗢𝗔𝗗𝗜𝗡𝗚 』⟡\n║\n║ ➩ Command: .${command}\n║ ➩ Target: calculating...\n║\n└────────────────────`;
}

function getFunTarget(ctx: CommandContext): string {
  // Use pre-resolved mentions first (handles @lid correctly)
  if (ctx.resolvedMentions[0]) return ctx.resolvedMentions[0];
  const info = getContextInfo(ctx.msg.message);
  const participant = info?.participant || info?.quotedMessage?.key?.participant || info?.quotedMessage?.participant;
  return participant || ctx.sender;
}

function getContextInfo(message: any): any {
  return message?.extendedTextMessage?.contextInfo ||
    message?.imageMessage?.contextInfo ||
    message?.videoMessage?.contextInfo ||
    message?.documentMessage?.contextInfo ||
    message?.stickerMessage?.contextInfo ||
    message?.buttonsResponseMessage?.contextInfo ||
    message?.listResponseMessage?.contextInfo ||
    message?.templateButtonReplyMessage?.contextInfo ||
    {};
}

function analysisResult(label: string, targetName: string, pct: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  const bar = "■".repeat(filled) + "□".repeat(10 - filled);
  return `╔═ ❰ 🌈 𝗔𝗡𝗔𝗟𝗬𝗦𝗜𝗦 𝗥𝗘𝗦𝗨𝗟𝗧 🌈 ❱ ═╗\n` +
    `║\n` +
    `║ 👤 𝗨𝘀𝗲𝗿: @${targetName}\n` +
    `║ 💖 ${label} 𝗟𝗲𝘃𝗲𝗹: ${pct}%\n` +
    `║\n` +
    `║ 📊 𝗦𝘁𝗮𝘁𝘂𝘀: [${bar}]\n` +
    `║\n` +
    `╚═════════════════╝`;
}
