import type { CommandContext } from "./index.js";
import { sendText } from "../connection.js";
import { updateGroup } from "../db/queries.js";
import axios from "axios";

const chatSessions: Map<string, Array<{ role: string; content: string }>> = new Map();

export async function handleAI(ctx: CommandContext): Promise<void> {
  const { from, sender, args, command: cmd } = ctx;

  if (cmd === "chat") {
    const val = args[0]?.toLowerCase();
    if (from.endsWith("@g.us")) {
      updateGroup(from, { ai_chat: val === "on" ? "on" : "off" });
      await sendText(from, `🤖 AI Chat ${val === "on" ? "enabled" : "disabled"}.`);
    } else {
      await sendText(from, "❌ This command is for groups.");
    }
    return;
  }

  if (cmd === "ai" || cmd === "gpt") {
    const question = args.join(" ");
    if (!question) {
      await sendText(from, "❌ Usage: .ai [question]");
      return;
    }
    await sendText(from, "🤖 Thinking...");
    try {
      const response = await getAIResponse(question, sender);
      await sendText(from, `🤖 *AI Response:*\n\n${response}`);
    } catch (err) {
      await sendText(from, "❌ AI is unavailable right now. Try again later.");
    }
    return;
  }

  if (cmd === "translate" || cmd === "tt") {
    // Determine if first arg is a language code or part of the text.
    // If args[0] is a short word (≤5 chars, no spaces, plausibly a lang code),
    // treat it as the target language; otherwise default to "en" and translate
    // the whole args string (auto-detect → English).
    let targetLang = "en";
    let textToTranslate = args.join(" ");
    const firstArg = args[0] || "";
    if (firstArg && firstArg.length <= 5 && /^[a-zA-Z-]+$/.test(firstArg) && args.length > 1) {
      targetLang = firstArg.toLowerCase();
      textToTranslate = args.slice(1).join(" ");
    }
    if (!textToTranslate.trim()) {
      await sendText(from, "❌ Usage: .tt [lang] <text>\nExample: .tt es Hello world\nOmit lang to auto-translate to English.");
      return;
    }
    try {
      // Use MyMemory — a free translation API with no API key required.
      // Supports auto-detection (source=autodetect) and most language codes.
      const encoded = encodeURIComponent(textToTranslate.trim().slice(0, 500));
      const url = `https://api.mymemory.translated.net/get?q=${encoded}&langpair=autodetect|${targetLang}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error("API error");
      const data = await res.json() as any;
      const translated = data?.responseData?.translatedText;
      const detectedLang = data?.responseData?.detectedLanguage || "?";
      if (!translated || translated === textToTranslate) throw new Error("No translation");
      await sendText(from, `🌐 *Translation → ${targetLang.toUpperCase()}*\n\n${translated}\n\n_Detected language: ${String(detectedLang).toUpperCase()}_`);
    } catch {
      // Fall back to AI if MyMemory fails
      try {
        const response = await getAIResponse(`Translate this to ${targetLang}, reply with ONLY the translation text, no explanations: "${textToTranslate}"`, sender);
        await sendText(from, `🌐 *Translation → ${targetLang.toUpperCase()}*\n\n${response}`);
      } catch {
        await sendText(from, "❌ Translation failed. Try again later.");
      }
    }
    return;
  }
}

const SYSTEM_PROMPT = "You are Requiem Order, a helpful WhatsApp bot assistant for Requiem Order (反逆) — the Heavenly Sky community. Be concise and friendly. Use emojis sparingly.";

async function getAIResponse(prompt: string, userId: string): Promise<string> {
  const PROMPT_URL = "https://openrouter.ai/api/v1/chat/completions";
  const apiKey = process.env.OPENROUTER_API_KEY;

  const messages = chatSessions.get(userId) || [];
  messages.push({ role: "user", content: prompt });
  if (messages.length > 10) messages.splice(0, messages.length - 10);

  if (apiKey) {
    try {
      const resp = await axios.post(PROMPT_URL, {
        model: "deepseek/deepseek-r1",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
        max_tokens: 300,
      }, {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        timeout: 15000,
      });

      const reply = resp.data.choices[0].message.content;
      messages.push({ role: "assistant", content: reply });
      chatSessions.set(userId, messages);
      return reply;
    } catch (err: any) {
      // If it's a quota/rate-limit error, fall through to Gemini
      const status = err?.response?.status;
      const isQuotaError = status === 429 || status === 402 ||
        err?.response?.data?.error?.code === "insufficient_quota" ||
        String(err?.response?.data?.error?.message || "").toLowerCase().includes("quota");
      if (!isQuotaError) throw err;
    }
  }

  // ── Gemini 2.5 Flash Lite fallback ────────────────────────────────────────
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent?key=${geminiKey}`;
    const geminiResp = await axios.post(geminiUrl, {
      contents: [
        { role: "user", parts: [{ text: `${SYSTEM_PROMPT}\n\n${prompt}` }] },
      ],
      generationConfig: { maxOutputTokens: 300 },
    }, { timeout: 15000 });

    const reply = geminiResp.data?.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't generate a response right now.";
    messages.push({ role: "assistant", content: reply });
    chatSessions.set(userId, messages);
    return reply;
  }

  // No API keys configured at all
  const fallbacks: Record<string, string> = {
    "hello": "Hello! How can I help you today? 👋",
    "hi": "Hey there! 🌟",
    "how are you": "I'm doing great! Ready to help you! 😊",
  };
  const lower = prompt.toLowerCase();
  for (const [key, val] of Object.entries(fallbacks)) {
    if (lower.includes(key)) return val;
  }
  return "I'm here to help! (AI service not configured — contact the bot owner to enable AI)";
}
