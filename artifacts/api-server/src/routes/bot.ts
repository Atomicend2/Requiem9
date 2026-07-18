import express from "express";
import { connectToWhatsApp, getSocket, isSocketConnected, isSocketConnecting, getPairingCode, rememberPairingPhoneNumber } from "../bot/connection.js";
import { logger } from "../lib/logger.js";

const router = express.Router();

let botStarted = false;

router.post("/start", async (req, res) => {
  if (botStarted && (isSocketConnected() || isSocketConnecting())) {
    res.json({ success: true, message: isSocketConnected() ? "Bot already connected" : "Bot already connecting" });
    return;
  }
  const { phone } = req.body;
  const rememberedPhone = rememberPairingPhoneNumber(phone);
  try {
    botStarted = true;
    connectToWhatsApp(rememberedPhone, { promptForPhone: false }).catch((err) => {
      logger.error({ err }, "Bot connection error");
    });
    res.json({ success: true, message: "Bot starting...", phone: rememberedPhone || null });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/status", (_req, res) => {
  const sock = getSocket();
  const connected = isSocketConnected();
  const pairingCode = getPairingCode();
  res.json({
    connected,
    connecting: isSocketConnecting(),
    pairingCode,
    botId: sock?.user?.id || null,
    botName: sock?.user?.name || null,
  });
});

router.post("/pairing", async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    res.status(400).json({ success: false, message: "Phone number required" });
    return;
  }
  const sock = getSocket();
  if (!sock) {
    res.status(400).json({ success: false, message: "Bot not started. Call /api/bot/start first." });
    return;
  }
  try {
    const rememberedPhone = rememberPairingPhoneNumber(phone);
    if (!rememberedPhone) {
      res.status(400).json({ success: false, message: "Valid phone number required" });
      return;
    }
    const code = await sock.requestPairingCode(rememberedPhone);
    res.json({ success: true, code });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/disconnect", async (_req, res) => {
  const sock = getSocket();
  if (sock) {
    await sock.logout().catch(() => {});
    botStarted = false;
  }
  res.json({ success: true, message: "Disconnected" });
});

export { router as botRouter };
