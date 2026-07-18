import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import { fileURLToPath } from "url";
import { requireAuth, optionalAuth, type AuthRequest } from "./middleware.js";
import { requireAdminAccess } from "./admin.js";
import { col } from "../../bot/db/mongo.js";
import { invalidateCardsCache } from "../../bot/db/queries.js";
import { getSocket, isSocketConnected } from "../../bot/connection.js";
import { getStaff, getUserCards, deleteUserCardByCopyId, giveCard } from "../../bot/db/queries.js";
import { logger } from "../../lib/logger.js";

const __dirname_routes = path.dirname(fileURLToPath(import.meta.url));

function getCardImageUrl(card: any): string {
  if (card.image_data) return `/api/v1/cards/${card._id || card.id}/image`;

  let rawObj: any = null;
  try {
    if (card.raw_data) {
      rawObj = typeof card.raw_data === "string" ? JSON.parse(card.raw_data) : card.raw_data;
    }
  } catch {}

  if (rawObj?.media_url) return rawObj.media_url;

  const shoobId = card.shoob_id || rawObj?._id || rawObj?.id;
  if (shoobId) {
    const hasWebm = card.has_webm || rawObj?.has_webm;
    if (hasWebm) return `https://api.shoob.gg/site/api/cardr/${shoobId}?type=webm`;
    return `https://api.shoob.gg/site/api/cardr/${shoobId}?size=400`;
  }

  // Mazoku cards have no shoob_id — they carry their own image_url (or, as a
  // last resort, can be built from mazoku_id against the Mazoku CDN). Without
  // this branch every mazoku card fell through to "" here, which is why
  // mazoku cards rendered fine in list views (mongoDocToFrontendCard handles
  // them) but showed a broken image on the detail/owners view, which calls
  // this function instead.
  if (card.mazoku_id) {
    return card.image_url || card.webp_url || `https://cdn7.mazoku.cc/cards/${card.mazoku_id}.webp`;
  }

  if (card.image_url) return card.image_url;

  return "";
}

function toImageBuffer(data: any): Buffer | null {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data;
  if (data?.buffer instanceof ArrayBuffer) return Buffer.from(data.buffer);
  if (typeof data === "string") return Buffer.from(data, "base64");
  try { return Buffer.from(data); } catch { return null; }
}

const router = Router();
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const ANIMATED_TIERS = new Set(["T6", "TS", "TX", "TZ"]);
const VALID_TIERS = ["T1","T2","T3","T4","T5","T6","TS","TX","TZ"];

// Mazoku tier → internal tier mapping (C→T2, R→T4, SR→T5, SSR→T6, UR→TS)
const MAZOKU_TIER_MAP: Record<string, string> = { C: "T2", R: "T4", SR: "T5", SSR: "T6", UR: "TS" };

export function mongoDocToFrontendCard(c: any): any {
  const isAnimated = ANIMATED_TIERS.has(c.tier) || c.is_animated === 1 || c.is_animated === true;

  // Resolve image URL — works for shoob, mazoku, or merged cards
  let imageUrl = "";
  let videoUrl: string | null = null;
  let gifUrl: string | null   = null;

  if (c.shoob_id) {
    const hasWebm = c.has_webm === 1 || c.has_webm === true;
    const base    = `https://api.shoob.gg/site/api/cardr/${c.shoob_id}`;
    imageUrl = hasWebm ? `${base}?type=webm` : `${base}?size=400`;
    videoUrl = hasWebm ? `${base}?type=webm` : null;
    // Animated gif via CDN hash when available
    if (isAnimated && c.file_hash && c.tier) {
      const tierNum = c.tier.replace(/^T/i, "").toLowerCase();
      gifUrl = `https://cdn.shoob.gg/images/cards/${tierNum}/${c.file_hash}`;
    } else if (c.gif_url) {
      gifUrl = c.gif_url;
    }
    // Also pick up mazoku URLs if this was a merged card
    if (!videoUrl && c.webm_url) videoUrl = c.webm_url;
    if (!gifUrl   && c.gif_url)  gifUrl   = c.gif_url;
  } else if (c.mazoku_id) {
    imageUrl = c.image_url || c.webp_url || `https://cdn7.mazoku.cc/cards/${c.mazoku_id}.webp`;
    videoUrl = c.webm_url || null;
    gifUrl   = c.gif_url  || null;
  } else if (c.image_url) {
    imageUrl = c.image_url;
    videoUrl = c.webm_url || null;
    gifUrl   = c.gif_url  || null;
  }

  // Also try legacy raw_data for old DB documents
  if (!imageUrl) {
    let rawObj: any = null;
    try { if (c.raw_data) rawObj = typeof c.raw_data === "string" ? JSON.parse(c.raw_data) : c.raw_data; } catch {}
    imageUrl = rawObj?.media_url || "";
  }

  const id = c.shoob_id || c.mazoku_id || String(c._id);

  return {
    id,
    name:        c.name   || "Unknown",
    tier:        c.tier   || "T1",
    series:      c.series || "General",
    isAnimated,
    isEvent:     c.is_event === 1 || c.is_event === true,
    eventName:   c.event_name || null,
    imageUrl,
    gifUrl:      gifUrl || imageUrl,
    videoUrl,
    totalCopies: 0,
    owners:      [],
    ownerName:   "Unclaimed",
    ownerId:     null,
  };
}

const SHOOB_API       = "https://api.shoob.gg";
const SHOOB_PAGE_SIZE = 15;

// ── Async helpers ─────────────────────────────────────────────────────────────

async function getCardOwner(cardId: string): Promise<{ name: string; id: string } | null> {
  const ucRow = await col("user_cards").findOne({ card_id: cardId }, { sort: { obtained_at: 1 } });
  if (!ucRow) return null;
  const user = await col("users").findOne({ _id: ucRow.user_id });
  return user ? { id: user._id as string, name: user.name || "Unknown" } : null;
}

async function getCardCopyCount(cardId: string): Promise<number> {
  return col("user_cards").countDocuments({ card_id: cardId });
}

async function getCardOwners(cardId: string, limit = 5): Promise<{ id: string; name: string }[]> {
  const ucs = await col("user_cards").find({ card_id: cardId }).limit(limit * 2).toArray();
  const seenIds = new Set<string>();
  const unique = ucs.filter((uc: any) => {
    if (seenIds.has(uc.user_id)) return false;
    seenIds.add(uc.user_id);
    return true;
  }).slice(0, limit);
  if (!unique.length) return [];
  const ownerIds = unique.map((uc: any) => uc.user_id);
  const users = await col("users").find({ _id: { $in: ownerIds } }).toArray();
  const userMap = new Map(users.map((u: any) => [u._id, u.name || "Shadow"]));
  return ownerIds.map((id: string) => ({ id, name: userMap.get(id) || "Shadow" }));
}

// ── Read all cards — random mix by default, explicit sort available ─────────
//
// Every card document carries a precomputed `random_key` (a random float
// 0..1 assigned once at sync time in cards-loader.ts, indexed). The default
// (no explicit sort) view orders by that field starting from a random
// rotation point supplied by the client as `spin` — a fresh random number
// the frontend generates once per page mount/refresh. Sorting by
// `random_key >= spin` first, then wrapping around to `random_key < spin`,
// gives a different starting point (and so a different visible mix) on
// every reload, while staying a single plain indexed sort — no aggregation,
// no server-side JS, nothing that can silently misbehave on a 50k+ doc
// collection or an unusual MongoDB tier. Pagination within one reload stays
// consistent because `spin` doesn't change between page 1/2/3 requests for
// the same session (the frontend reuses it until the next full reload).
router.get("/from-json", async (req, res) => {
  try {
    const { tier, search, sortBy, sortDir, spin: spinStr, page: pageStr, limit: limitStr } = req.query as Record<string, string | undefined>;

    const filter: any = {};
    if (tier && tier !== "all") filter.tier = tier;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name:   { $regex: escaped, $options: "i" } },
        { series: { $regex: escaped, $options: "i" } },
      ];
    }

    const limit = Math.min(Math.max(parseInt(limitStr || "10", 10) || 10, 1), 200);
    const page  = Math.max(parseInt(pageStr  || "1",  10) || 1, 1);
    const skip  = (page - 1) * limit;

    const SORTABLE_FIELDS = new Set(["name", "tier", "series", "created_at"]);
    const explicitSort = !!(sortBy && SORTABLE_FIELDS.has(sortBy));

    const total = await col("cards").countDocuments(filter);
    if (total === 0) {
      res.json({ cards: [], total: 0, page, limit, pages: 0 });
      return;
    }

    let docs: any[];
    let spinUsed: number | undefined;

    if (explicitSort) {
      // Deterministic, stable sort. _id is always included as a tiebreaker so
      // that cards with equal sort keys keep a fixed relative order across
      // pages instead of shuffling between requests.
      const dir = sortDir === "asc" ? 1 : -1;
      const sortSpec: Record<string, 1 | -1> = { [sortBy as string]: dir, _id: 1 };
      docs = await col("cards").find(filter).sort(sortSpec).skip(skip).limit(limit).toArray();
    } else {
      const spin = (() => {
        const n = parseFloat(spinStr || "");
        return Number.isFinite(n) && n >= 0 && n < 1 ? n : Math.random();
      })();
      spinUsed = spin;

      // First page (and any page that fits entirely before the wrap) is a
      // single indexed range query. If a page straddles the wrap point
      // (rare — only the one page where `skip+limit` crosses the total
      // count above `spin`), fetch both sides and slice, so pagination
      // never skips or repeats a card across the boundary.
      const aboveCount = await col("cards").countDocuments({ ...filter, random_key: { $gte: spin } });

      if (skip + limit <= aboveCount) {
        docs = await col("cards")
          .find({ ...filter, random_key: { $gte: spin } })
          .sort({ random_key: 1, _id: 1 })
          .skip(skip)
          .limit(limit)
          .toArray();
      } else if (skip >= aboveCount) {
        docs = await col("cards")
          .find({ ...filter, random_key: { $lt: spin } })
          .sort({ random_key: 1, _id: 1 })
          .skip(skip - aboveCount)
          .limit(limit)
          .toArray();
      } else {
        const fromAbove = await col("cards")
          .find({ ...filter, random_key: { $gte: spin } })
          .sort({ random_key: 1, _id: 1 })
          .skip(skip)
          .limit(limit)
          .toArray();
        const remaining = limit - fromAbove.length;
        const fromBelow = remaining > 0
          ? await col("cards")
              .find({ ...filter, random_key: { $lt: spin } })
              .sort({ random_key: 1, _id: 1 })
              .limit(remaining)
              .toArray()
          : [];
        docs = [...fromAbove, ...fromBelow];
      }
    }

    const cards = docs.map(mongoDocToFrontendCard);
    res.json({ cards, total, page, limit, pages: Math.ceil(total / limit), spin: spinUsed });
  } catch (err: any) {
    logger.error({ err }, "Error reading cards from MongoDB");
    res.status(500).json({ success: false, message: "Failed to read cards", cards: [], total: 0 });
  }
});

// ── Card detail ───────────────────────────────────────────────────────────────
router.get("/detail/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) { res.status(400).json({ error: "id required" }); return; }

  let card = await col("cards").findOne({
    $or: [{ shoob_id: id }, { mazoku_id: id }, { _id: id }],
  });

  const imageUrl = card ? getCardImageUrl(card) : `https://api.shoob.gg/site/api/cardr/${id}?size=400`;
  const internalId = card?._id as string | undefined;

  let owners: { id: string; name: string }[] = [];
  let totalCopies = 0;
  if (internalId) {
    const [ownerList, count] = await Promise.all([
      getCardOwners(internalId, 50),
      getCardCopyCount(internalId),
    ]);
    owners = ownerList;
    totalCopies = count;
  }

  const detailTier = card?.tier || "";
  const detailIsAnimated = ANIMATED_TIERS.has(detailTier);
  res.json({
    id: card?.shoob_id || card?.mazoku_id || id,
    name: card?.name || "Unknown Card",
    tier: detailTier,
    series: card?.series || "General",
    description: card?.description || "",
    imageUrl,
    isAnimated: detailIsAnimated,
    isVideo: detailIsAnimated && !!card?.image_data,
    totalCopies,
    owners,
  });
});

// ── Reload cards from JSON ────────────────────────────────────────────────────
router.post("/reload-from-json", requireAdminAccess as any, async (req: AuthRequest, res) => {
  try {
    const { loadCardsFromRepo, getSyncState } = await import("../../bot/cards-loader.js");
    const already = getSyncState();
    if (already.running) {
      res.json({ success: true, alreadyRunning: true, message: "A sync is already running — check status instead of starting a new one." });
      return;
    }

    // Fire and forget: a full sync of 50k+ cards can take well over a
    // minute, comfortably past most reverse-proxy request timeouts
    // (Render's included). Holding the HTTP response open for that whole
    // time is what made the button look broken — the connection would get
    // killed mid-sync, the admin would see nothing and press it again, and
    // that second press used to start a fully independent second sync
    // racing the first. Returning immediately and letting the frontend
    // poll /reload-status instead sidesteps that timeout entirely.
    loadCardsFromRepo({ force: true }).catch((err) => {
      logger.error({ err }, "Background card sync failed");
    });

    res.json({ success: true, started: true, message: "Sync started in the background — poll /api/v1/cards/reload-status for progress." });
  } catch (err: any) {
    logger.error({ err }, "reload-from-json error");
    res.status(500).json({ success: false, message: err?.message || "Reload failed" });
  }
});

// ── Poll sync progress ────────────────────────────────────────────────────────
router.get("/reload-status", requireAdminAccess as any, async (req: AuthRequest, res) => {
  try {
    const { getSyncState } = await import("../../bot/cards-loader.js");
    const state = getSyncState();
    res.json({ success: true, ...state });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || "Could not read sync status" });
  }
});

// ── Wipe the cards collection entirely ────────────────────────────────────────
// Last-resort recovery tool: if the card database ever gets stuck in a state
// a normal re-sync can't fix (e.g. corrupted documents, a sync that partially
// completed in a broken way), this clears every card document so the next
// sync starts from a genuinely empty collection instead of reconciling
// against whatever is already there. Deliberately scoped to ONLY the `cards`
// collection — never touches users, guilds, inventories, owned cards
// (user_cards), or anything else. Does NOT delete cards players already own;
// those live in a separate collection untouched by this.
router.post("/wipe-cards", requireAdminAccess as any, async (req: AuthRequest, res) => {
  try {
    const result = await col("cards").deleteMany({});
    // Also clear the sync bookkeeping so the very next sync (auto or
    // manual) can't fast-skip thinking nothing changed.
    await col("sync_meta").deleteMany({});
    invalidateCardsCache();
    res.json({
      success: true,
      message: `Wiped ${result.deletedCount ?? 0} card document(s) from the database. Owned cards (user_cards) were not touched. Run a sync now to repopulate from unified_cards.jsonl.`,
      deleted: result.deletedCount ?? 0,
    });
  } catch (err: any) {
    logger.error({ err }, "wipe-cards error");
    res.status(500).json({ success: false, message: err?.message || "Wipe failed" });
  }
});

// ── Media proxy ───────────────────────────────────────────────────────────────
router.get("/media-proxy", (req, res) => {
  const raw = req.query.url as string;
  if (!raw) { res.status(400).send("Missing url"); return; }

  let target: URL;
  try { target = new URL(decodeURIComponent(raw)); } catch {
    res.status(400).send("Invalid url"); return;
  }

  if (!target.hostname.endsWith("shoob.gg")) {
    res.status(403).send("Forbidden"); return;
  }

  function fetchWithRedirects(url: URL, redirectsLeft: number) {
    const lib = url.protocol === "https:" ? https : http;
    const req2 = lib.get(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://shoob.gg/",
      },
    }, (upstream) => {
      const status = upstream.statusCode || 200;

      if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308)
          && upstream.headers.location && redirectsLeft > 0) {
        upstream.resume();
        let nextUrl: URL;
        try { nextUrl = new URL(upstream.headers.location, url.toString()); } catch {
          if (!res.headersSent) res.status(502).send("Bad redirect");
          return;
        }
        if (!nextUrl.hostname.endsWith("shoob.gg") && !nextUrl.hostname.endsWith("cdn.shoob.gg")) {
          if (!res.headersSent) res.status(502).send("Redirect outside shoob");
          return;
        }
        fetchWithRedirects(nextUrl, redirectsLeft - 1);
        return;
      }

      const ct = upstream.headers["content-type"] || "application/octet-stream";
      const cl = upstream.headers["content-length"];
      res.setHeader("Content-Type", ct);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      if (cl) res.setHeader("Content-Length", cl);
      res.status(status);
      upstream.pipe(res);
    });
    req2.on("error", (err) => {
      logger.error({ err }, "media-proxy upstream error");
      if (!res.headersSent) res.status(502).send("Upstream error");
    });
    req2.setTimeout(15000, () => {
      req2.destroy();
      if (!res.headersSent) res.status(504).send("Upstream timeout");
    });
  }

  fetchWithRedirects(target, 5);
});

// ── Card image blob ───────────────────────────────────────────────────────────
router.get("/:id/image", async (req, res) => {
  const card = await col("cards").findOne({ _id: req.params.id });
  if (!card?.image_data) { res.status(404).end(); return; }

  const isAnimated = ANIMATED_TIERS.has(card.tier);
  const contentType = isAnimated ? "video/mp4" : "image/jpeg";
  const buf = toImageBuffer(card.image_data);
  if (!buf) { res.status(404).end(); return; }
  const total = buf.length;

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Accept-Ranges", "bytes");

  const rangeHeader = req.headers["range"];
  if (isAnimated && rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : total - 1;
      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", chunkSize);
      res.end(buf.slice(start, end + 1));
      return;
    }
  }

  res.setHeader("Content-Length", total);
  res.end(buf);
});

// ── List all cards ────────────────────────────────────────────────────────────
router.get("/", optionalAuth, async (req, res) => {
  const { tier, series } = req.query as { tier?: string; series?: string };

  const filter: any = {};
  if (tier) filter.tier = tier;
  if (series) filter.series = { $regex: series, $options: "i" };

  const cards = await col("cards").find(filter).sort({ tier: 1, name: 1 }).toArray();

  const result = await Promise.all(cards.map(async (card: any) => {
    const [owner, totalCopies, owners] = await Promise.all([
      getCardOwner(card._id),
      getCardCopyCount(card._id),
      getCardOwners(card._id, 5),
    ]);
    const isAnimated = ANIMATED_TIERS.has(card.tier);
    const isVideo = isAnimated && !!card.image_data;
    return {
      id: card._id,
      name: card.name,
      tier: card.tier,
      series: card.series || "General",
      description: card.description || "",
      imageUrl: getCardImageUrl(card),
      isAnimated,
      isVideo,
      totalCopies,
      ownerName: owner?.name || "Unclaimed",
      ownerId: owner?.id || null,
      owners,
    };
  }));

  res.json({ cards: result, total: result.length });
});

// ── My cards ──────────────────────────────────────────────────────────────────
router.get("/my", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const userCards = await getUserCards(userId);

  const result = await Promise.all(userCards.map(async (uc: any) => {
    const cardId = uc.card_id || uc.id;
    const card = await col("cards").findOne({ _id: cardId });
    const [totalCopies, owners] = await Promise.all([
      getCardCopyCount(cardId),
      getCardOwners(cardId, 5),
    ]);
    const isAnimated = ANIMATED_TIERS.has(uc.tier || card?.tier || "");
    const isVideo = isAnimated && !!card?.image_data;
    return {
      userCardId: uc._id?.toString() || uc.copy_id || uc.user_card_id,
      card: {
        id: cardId,
        name: uc.name || card?.name || "Unknown",
        tier: uc.tier || card?.tier || "T1",
        series: uc.series || card?.series || "General",
        description: uc.description || card?.description || "",
        imageUrl: card ? getCardImageUrl(card) : "",
        isAnimated,
        isVideo,
        totalCopies,
        ownerName: req.user?.name || "You",
        ownerId: userId,
        owners,
      },
      obtainedAt: uc.obtained_at || 0,
    };
  }));

  res.json({ cards: result, total: result.length });
});

// ── Wishlist / trade notification ─────────────────────────────────────────────
router.post("/wishlist", requireAuth, async (req: AuthRequest, res) => {
  const { cardId } = req.body as { cardId?: string };
  if (!cardId) {
    res.status(400).json({ success: false, message: "cardId is required" });
    return;
  }

  const card = await col("cards").findOne({ $or: [{ shoob_id: cardId }, { _id: cardId }] });
  if (!card) {
    res.status(404).json({ success: false, message: "Card not found" });
    return;
  }

  const owner = await getCardOwner(card._id as string);
  if (!owner) {
    res.json({ success: true, message: "Card is unclaimed — no owner to notify" });
    return;
  }

  const sock = getSocket();
  if (sock && isSocketConnected() && owner.id !== req.userId) {
    try {
      const requesterName = req.user?.name || "Someone";
      await sock.sendMessage(owner.id, {
        text: `*Requiem Order 反逆 — Trade Alert*\n\n${requesterName} wants to trade for your *${card.name}* (${card.tier} - ${card.series || "General"}).\n\nReply with .trade to negotiate.`,
      });
    } catch (err) {
      logger.error({ err }, "Failed to send wishlist notification");
    }
  }

  res.json({ success: true, message: "Trade notification sent to card owner" });
});

// ── Card fusion ───────────────────────────────────────────────────────────────
router.post("/fuse", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) { res.status(401).json({ success: false, message: "Not authenticated" }); return; }

    const FUSE_RECIPES: Record<string, { cost: number; next: string }> = {
      T1: { cost: 10, next: "T2" },
      T2: { cost: 8,  next: "T3" },
      T3: { cost: 6,  next: "T4" },
      T4: { cost: 5,  next: "T5" },
      T5: { cost: 5,  next: "T6" },
    };

    const body = req.body as any;
    const tierArg = (body?.tier || "").toUpperCase();
    const selectedCardIds: string[] | undefined = Array.isArray(body?.cardIds) ? body.cardIds : undefined;
    const targetCardId: string | undefined = body?.targetCardId ? String(body.targetCardId) : undefined;

    const recipe = FUSE_RECIPES[tierArg];
    if (!recipe) {
      res.status(400).json({ success: false, message: `Invalid tier "${tierArg}". Valid tiers: T1–T5` });
      return;
    }

    const allUserCards = await getUserCards(userId);
    const eligible = allUserCards.filter((c: any) => (c.tier || "") === tierArg && !c.lent_to);

    let toDelete: any[];

    if (selectedCardIds && selectedCardIds.length > 0) {
      if (selectedCardIds.length !== recipe.cost) {
        res.status(400).json({
          success: false,
          message: `You must select exactly ${recipe.cost} ${tierArg} cards to fuse. You selected ${selectedCardIds.length}.`,
        });
        return;
      }
      toDelete = selectedCardIds.map((copyId) => {
        const card = eligible.find((c: any) => String(c.copy_id || c._id) === String(copyId));
        return card || null;
      });
      const invalid = toDelete.filter((c) => !c);
      if (invalid.length > 0) {
        res.status(400).json({
          success: false,
          message: "One or more selected cards are invalid, not owned by you, wrong tier, or currently lent out.",
        });
        return;
      }
    } else {
      if (eligible.length < recipe.cost) {
        res.status(400).json({
          success: false,
          message: `Not enough cards. You need ${recipe.cost}× ${tierArg} but only have ${eligible.length} eligible (non-lent).`,
          have: eligible.length,
          need: recipe.cost,
        });
        return;
      }
      toDelete = eligible.slice(0, recipe.cost);
    }

    // Let the player choose exactly which next-tier card they receive,
    // instead of a random draw. If there's only one possible result, that's
    // used automatically; otherwise the frontend must pass targetCardId,
    // and gets the full option list back to choose from if it hasn't yet.
    const nextCards = await col("cards").find({ tier: recipe.next }).project({ _id: 1, name: 1, series: 1, tier: 1, image_url: 1, shoob_id: 1, mazoku_id: 1, has_webm: 1 }).limit(100).toArray();
    if (nextCards.length === 0) {
      res.status(500).json({ success: false, message: `No ${recipe.next} cards exist in the database yet.` });
      return;
    }

    let nextCard: any;
    if (targetCardId) {
      nextCard = nextCards.find((c: any) => String(c._id) === targetCardId);
      if (!nextCard) {
        res.status(400).json({ success: false, message: "Selected target card is not a valid option for this fusion." });
        return;
      }
    } else if (nextCards.length === 1) {
      nextCard = nextCards[0];
    } else {
      res.status(409).json({
        success: false,
        needsTargetSelection: true,
        message: `Multiple ${recipe.next} cards are possible — choose which one you want.`,
        options: nextCards.map((c: any) => ({ id: String(c._id), name: c.name, series: c.series, tier: c.tier })),
      });
      return;
    }

    // Burn the selected cards
    for (const uc of toDelete) {
      await deleteUserCardByCopyId(String(uc.copy_id || uc._id), userId);
    }

    // Grant the result card
    const newCopyId = await giveCard(userId, String(nextCard._id));

    const hasWebm = nextCard.has_webm === 1 || nextCard.has_webm === true;
    const imageUrl = nextCard.shoob_id
      ? (hasWebm
        ? `https://api.shoob.gg/site/api/cardr/${nextCard.shoob_id}?type=webm`
        : `https://api.shoob.gg/site/api/cardr/${nextCard.shoob_id}?size=400`)
      : `/api/v1/cards/${nextCard._id}/image`;

    res.json({
      success: true,
      burned: recipe.cost,
      sourceTier: tierArg,
      result: {
        id: nextCard._id,
        shoob_id: nextCard.shoob_id || "",
        name: nextCard.name,
        tier: nextCard.tier,
        imageUrl,
        copyId: newCopyId || "—",
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Card fusion error");
    res.status(500).json({ success: false, message: err?.message || "Fusion failed" });
  }
});

// ── Web card upload (staff only) ──────────────────────────────────────────────
router.post("/upload", requireAuth, uploadMem.single("file"), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ success: false, message: "Not authenticated" }); return; }

    const staffRow = await getStaff(userId);
    const BOT_OWNER = (process.env["OWNER_NUMBERS"] || process.env["BOT_OWNER_LID"] || "2348144550593").split(",")[0].replace(/\D/g, "");
    const isStaff = !!staffRow || userId.replace(/\D/g, "") === BOT_OWNER;
    if (!isStaff) {
      res.status(403).json({ success: false, message: "Only staff can upload cards." });
      return;
    }

    if (!req.file) { res.status(400).json({ success: false, message: "No file provided" }); return; }

    const tier = (req.body?.tier || "").toUpperCase().trim();
    const name = (req.body?.name || "").trim();
    const series = (req.body?.series || "").trim();

    if (!VALID_TIERS.includes(tier)) {
      res.status(400).json({ success: false, message: `Invalid tier. Valid: ${VALID_TIERS.join(", ")}` });
      return;
    }
    if (!name || name.length < 2) {
      res.status(400).json({ success: false, message: "Card name is required (min 2 chars)" });
      return;
    }
    if (!series || series.length < 2) {
      res.status(400).json({ success: false, message: "Series name is required" });
      return;
    }

    const existing = await col("cards").findOne({ name: { $regex: `^${name}$`, $options: "i" } });
    if (existing) {
      res.status(409).json({ success: false, message: `A card named "${name}" already exists (ID: ${existing._id}).` });
      return;
    }

    const isAnimated = ANIMATED_TIERS.has(tier);
    const mimeType = req.file.mimetype;
    const isVideo = mimeType.startsWith("video/");

    if (isAnimated && !isVideo && !mimeType.startsWith("image/")) {
      res.status(400).json({ success: false, message: "Animated tier cards require a video or image file." });
      return;
    }
    if (!isAnimated && isVideo) {
      res.status(400).json({ success: false, message: `Tier ${tier} is not animated. Please upload an image.` });
      return;
    }

    let imageData: Buffer = req.file.buffer;

    if (!isVideo) {
      try {
        const sharp = (await import("sharp")).default;
        imageData = await sharp(req.file.buffer)
          .resize(800, 1100, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 92 })
          .toBuffer();
      } catch { /* sharp not available — use raw */ }
    }

    // Generate unique card ID
    const { randomBytes } = await import("crypto");
    const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let cardId = "C" + Date.now().toString(36).toUpperCase();
    for (let a = 0; a < 50; a++) {
      const bytes = randomBytes(8);
      const candidate = Array.from(bytes as Buffer).map((b: number) => ID_CHARS[b % ID_CHARS.length]).join("");
      if (!(await col("cards").findOne({ _id: candidate }))) { cardId = candidate; break; }
    }

    await col("cards").insertOne({
      _id: cardId, name, series, tier,
      image_data: imageData,
      is_animated: isAnimated ? 1 : 0,
      uploaded_by: userId,
    });

    res.json({
      success: true,
      message: `Card uploaded! 🎴 ${name} (${tier}) — ${series}`,
      card: { id: cardId, name, series, tier, isAnimated },
    });
  } catch (err: any) {
    logger.error({ err }, "Card upload error");
    res.status(500).json({ success: false, message: err?.message || "Upload failed" });
  }
});

// ── Normalise Shoob tier ──────────────────────────────────────────────────────
function normaliseShoobTier(raw: string | number | undefined, fallback = "T1"): string {
  if (raw === null || raw === undefined) return fallback;
  const s = String(raw).trim().toUpperCase();
  if (s.startsWith("T") && ["T1","T2","T3","T4","T5","T6","TS","TX","TZ"].includes(s)) return s;
  if (/^\d$/.test(s)) return `T${s}`;
  if (s === "S") return "TS";
  if (s === "X") return "TX";
  if (s === "Z") return "TZ";
  return fallback;
}

// ── Sync log ──────────────────────────────────────────────────────────────────
router.get("/sync-log", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ success: false, message: "Not authenticated" }); return; }
    const staffRow = await getStaff(userId);
    const BOT_OWNER = (process.env["OWNER_NUMBERS"] || process.env["BOT_OWNER_PHONE"] || "2348144550593").split(",")[0].replace(/\D/g, "");
    const isStaff = !!staffRow || userId.replace(/\D/g, "") === BOT_OWNER;
    if (!isStaff) { res.status(403).json({ success: false, message: "Only staff can view sync logs." }); return; }

    const [logs, totalCards, shoobCards, trackedIds] = await Promise.all([
      col("shoob_sync_log").find({}).sort({ ran_at: -1 }).limit(20).toArray(),
      col("cards").countDocuments({}),
      col("cards").countDocuments({ source: "shoob" }),
      col("shoob_imported_ids").countDocuments({}),
    ]);
    res.json({ success: true, logs, totalCards, shoobCards, trackedIds });
  } catch (err: any) {
    logger.error({ err }, "Sync log error");
    res.status(500).json({ success: false, message: err?.message || "Failed to fetch sync log" });
  }
});

// ── Fetch cards from Shoob API ────────────────────────────────────────────────
router.post("/fetch-cards", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ success: false, message: "Not authenticated" }); return; }

    const staffRow = await getStaff(userId);
    const BOT_OWNER = (process.env["OWNER_NUMBERS"] || process.env["BOT_OWNER_PHONE"] || "2348144550593").split(",")[0].replace(/\D/g, "");
    const isStaff = !!staffRow || userId.replace(/\D/g, "") === BOT_OWNER;
    if (!isStaff) { res.status(403).json({ success: false, message: "Only staff can import cards." }); return; }

    const rawTier = (req.body?.tier as string | undefined)?.toUpperCase().trim() || "";
    const tier = rawTier || "";

    if (tier && !VALID_TIERS.includes(tier)) {
      res.status(400).json({ success: false, message: `Invalid tier. Valid: ${VALID_TIERS.join(", ")} (or leave blank for all tiers)` });
      return;
    }

    const seriesOverride = ((req.body?.series || "") as string).trim();
    const limit = Math.min(parseInt(req.body?.limit || "20", 10) || 20, 200);

    const collected: any[] = [];
    let page = 1;
    while (collected.length < limit) {
      const url = `${SHOOB_API}/site/api/cards?page=${page}`;
      logger.info({ url }, "Fetching Shoob card page");
      const apiRes = await fetch(url, {
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; RequiemOrderBot/1.0)" },
        signal: AbortSignal.timeout(20000),
      });
      if (!apiRes.ok) {
        res.status(502).json({ success: false, message: `Shoob API returned ${apiRes.status}. Try again.` });
        return;
      }
      const apiData: any = await apiRes.json();
      const pageCards: any[] = Array.isArray(apiData) ? apiData : (apiData.cards || apiData.data || apiData.results || []);
      if (!pageCards.length) break;

      for (const c of pageCards) {
        const cardTier = normaliseShoobTier(c.tier);
        if (tier && cardTier !== tier) continue;
        if (req.body?.anime) {
          const animeQuery = (req.body.anime as string).trim().toLowerCase();
          const cats = Array.isArray(c.category) ? c.category.map((x: string) => String(x).toLowerCase()) : [];
          const nameMatch = String(c.name || c.slug || "").toLowerCase().includes(animeQuery);
          const catMatch  = cats.some((cat: string) => cat.includes(animeQuery));
          const slugMatch = String(c.slugged || "").toLowerCase().includes(animeQuery);
          if (!nameMatch && !catMatch && !slugMatch) continue;
        }
        collected.push(c);
        if (collected.length >= limit) break;
      }
      if (pageCards.length < SHOOB_PAGE_SIZE) break;
      page++;
    }

    if (!collected.length) {
      res.status(502).json({
        success: false,
        message: tier
          ? `No ${tier} cards found on Shoob right now. Try a different tier.`
          : "No cards returned from Shoob. Try again later.",
      });
      return;
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const sc of collected) {
      const shoobId: string = String(sc._id || sc.id || "").trim();
      const cardName: string = (sc.name || sc.slug || shoobId).trim().replace(/_/g, " ");
      if (!cardName || cardName.length < 2) { skipped++; continue; }

      const existsByShoobId = shoobId ? await col("cards").findOne({ shoob_id: shoobId }) : null;
      const existsByName = await col("cards").findOne({ name: { $regex: `^${cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: "i" } });
      if (existsByShoobId || existsByName) { skipped++; continue; }

      const cardTier = normaliseShoobTier(sc.tier, tier || "T1");
      const cardSeries: string = seriesOverride ||
        (Array.isArray(sc.category) && sc.category[0] ? String(sc.category[0]).trim() : (sc.series || sc.anime || "Shoob"));

      const file    = String(sc.file || "").toLowerCase();
      const isGif   = file.endsWith(".gif");
      const isWebm  = sc.has_webm === true;
      const cardIsAnimated = (
        isGif || isWebm ||
        sc.has_webp === true ||
        sc.patched === true ||
        ANIMATED_TIERS.has(cardTier)
      ) ? 1 : 0;

      const mediaUrl = isWebm
        ? `${SHOOB_API}/site/api/cardr/${shoobId}?type=webm`
        : `${SHOOB_API}/site/api/cardr/${shoobId}?size=400`;

      const { randomBytes } = await import("crypto");
      const idChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      let localId = "C" + Date.now().toString(36).toUpperCase();
      for (let a = 0; a < 50; a++) {
        const bytes = randomBytes(8);
        const candidate = Array.from(bytes as Buffer).map((b: number) => idChars[b % idChars.length]).join("");
        if (!(await col("cards").findOne({ _id: candidate }))) { localId = candidate; break; }
      }

      let imageData: Buffer | null = null;
      if (mediaUrl) {
        try {
          const mediaRes = await fetch(mediaUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; RequiemOrderBot/1.0)" },
            signal: AbortSignal.timeout(30000),
          });
          if (mediaRes.ok) {
            const buf = Buffer.from(await mediaRes.arrayBuffer());
            if (!isWebm && !isGif) {
              try {
                const sharp = (await import("sharp")).default;
                imageData = await sharp(buf).resize(800, 1100, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
              } catch { imageData = buf; }
            } else {
              imageData = buf;
            }
          }
        } catch (e: any) {
          errors.push(`${cardName}: ${e?.message || "fetch failed"}`);
        }
      }

      await col("cards").insertOne({
        _id: localId, name: cardName, series: cardSeries, tier: cardTier,
        image_data: imageData, is_animated: cardIsAnimated,
        uploaded_by: userId, source: "shoob", shoob_id: shoobId || null,
      });

      if (shoobId) {
        await col("shoob_imported_ids").updateOne(
          { shoob_id: shoobId },
          { $setOnInsert: { shoob_id: shoobId, local_card_id: localId } },
          { upsert: true }
        );
      }
      imported++;
    }

    res.json({
      success: true,
      message: `Import complete: ${imported} imported, ${skipped} skipped${errors.length ? ` (${errors.length} image errors)` : ""}.`,
      imported, skipped, total_available: collected.length, errors: errors.slice(0, 10),
    });
  } catch (err: any) {
    logger.error({ err }, "Card fetch error");
    res.status(500).json({ success: false, message: err?.message || "Fetch failed" });
  }
});

export { router as cardsRouter };

// ── Scraper routes ────────────────────────────────────────────────────────────

router.get("/scraper/status", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ success: false, message: "Not authenticated" }); return; }
    const staffRow = await getStaff(userId);
    const BOT_OWNER = (process.env["OWNER_NUMBERS"] || process.env["BOT_OWNER_PHONE"] || "2348144550593").split(",")[0].replace(/\D/g, "");
    const isStaff = !!staffRow || userId.replace(/\D/g, "") === BOT_OWNER;
    if (!isStaff) { res.status(403).json({ success: false, message: "Only staff can view sync status." }); return; }

    const [totalCards, shoobCards, trackedIds, lastRun] = await Promise.all([
      col("cards").countDocuments({}),
      col("cards").countDocuments({ source: "shoob" }),
      col("shoob_imported_ids").countDocuments({}),
      col("shoob_sync_log").findOne({}, { sort: { ran_at: -1 } }),
    ]);

    res.json({
      source: "shoob.gg",
      status: "ready",
      total_cards: totalCards,
      shoob_cards: shoobCards,
      tracked_ids: trackedIds,
      last_run: lastRun ? new Date((lastRun as any).ran_at * 1000).toISOString() : null,
      last_run_type: (lastRun as any)?.run_type ?? null,
    });
  } catch (err: any) {
    logger.error({ err }, "Scraper status error");
    res.status(500).json({ success: false, message: err?.message || "Failed to fetch status" });
  }
});

router.get("/scraper/history", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ success: false, message: "Not authenticated" }); return; }
    const staffRow = await getStaff(userId);
    const BOT_OWNER = (process.env["OWNER_NUMBERS"] || process.env["BOT_OWNER_PHONE"] || "2348144550593").split(",")[0].replace(/\D/g, "");
    const isStaff = !!staffRow || userId.replace(/\D/g, "") === BOT_OWNER;
    if (!isStaff) { res.status(403).json({ success: false, message: "Only staff can view sync history." }); return; }

    const logs = await col("shoob_sync_log").find({}).sort({ ran_at: -1 }).limit(20).toArray();
    const result = logs.map((r: any) => ({
      timestamp: new Date(r.ran_at * 1000).toISOString(),
      run_type: r.run_type,
      cards_added: r.imported,
      updated: r.updated,
      skipped: r.skipped,
      errors: r.errors,
      total_seen: r.total_seen,
      duration_ms: r.duration_ms,
      started_by: r.started_by,
      success: r.errors === 0,
    }));
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "Scraper history error");
    res.status(500).json({ success: false, message: err?.message || "Failed to fetch history" });
  }
});

router.post("/scraper/run", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ success: false, message: "Not authenticated" }); return; }
    const staffRow = await getStaff(userId);
    const BOT_OWNER = (process.env["OWNER_NUMBERS"] || process.env["BOT_OWNER_PHONE"] || "2348144550593").split(",")[0].replace(/\D/g, "");
    const isStaff = !!staffRow || userId.replace(/\D/g, "") === BOT_OWNER;
    if (!isStaff) { res.status(403).json({ success: false, message: "Only staff can trigger sync." }); return; }

    const runMode = (req.body?.mode === "full") ? "full" : "incremental";
    const uploader = userId.replace(/\D/g, "");

    // ── Try Playwright scraper first ──────────────────────────────────────
    try {
      const { runPlaywrightScraper } = await import("../../scraper/shoob-playwright.js");
      const result = await runPlaywrightScraper({
        syncOnly: runMode === "incremental",
        uploader,
        onProgress: undefined,
        maxPage: runMode === "incremental" ? 100 : undefined,
      });

      res.json({
        success: true, method: "playwright", mode: runMode,
        imported: result.imported, updated: result.updated, skipped: result.skipped,
        errors: result.errors, total_seen: result.totalSeen,
        pages_scraped: result.pagesScraped, duration_ms: result.durationMs,
      });
      return;
    } catch (pwErr: any) {
      logger.warn({ pwErr }, "Playwright unavailable for web scraper/run — using REST fallback");
    }

    // ── REST API fallback ─────────────────────────────────────────────────
    let imported = 0, updated = 0, skipped = 0, errors = 0, totalSeen = 0;
    let page = 1;
    const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const normTier = (raw: any, fb = "T1"): string => {
      if (!raw) return fb;
      const s = String(raw).trim().toUpperCase();
      if (s.startsWith("T") && ["T1","T2","T3","T4","T5","T6","TS","TX","TZ"].includes(s)) return s;
      if (/^\d$/.test(s)) return `T${s}`;
      if (s === "S") return "TS";
      if (s === "X") return "TX";
      if (s === "Z") return "TZ";
      return fb;
    };

    const startMs = Date.now();
    try {
      while (true) {
        const url = `${SHOOB_API}/site/api/cards?page=${page}`;
        const apiRes = await fetch(url, {
          headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; RequiemOrderBot/1.0)" },
          signal: AbortSignal.timeout(20000),
        });
        if (!apiRes.ok) break;
        const apiData: any = await apiRes.json();
        const pageCards: any[] = Array.isArray(apiData) ? apiData : (apiData.cards || apiData.data || apiData.results || []);
        if (!pageCards.length) break;
        totalSeen += pageCards.length;

        for (const sc of pageCards) {
          const shoobId = String(sc._id || sc.id || "").trim();
          if (!shoobId) { skipped++; continue; }

          if (runMode === "incremental") {
            const already = await col("shoob_imported_ids").findOne({ shoob_id: shoobId });
            if (already) { skipped++; continue; }
          }

          const cardName = (sc.name || sc.slug || shoobId).trim().replace(/_/g, " ");
          const tier = normTier(sc.tier);
          const series = (Array.isArray(sc.category) && sc.category[0]) ? String(sc.category[0]).trim() : "Shoob";

          const file   = String(sc.file || "").toLowerCase();
          const isGif  = file.endsWith(".gif");
          const isWebm = sc.has_webm === true;
          const animated = (
            isGif || isWebm ||
            sc.has_webp === true ||
            sc.patched === true ||
            ["T6","TS","TX","TZ"].includes(tier)
          ) ? 1 : 0;

          const mediaUrl = isWebm
            ? `${SHOOB_API}/site/api/cardr/${shoobId}?type=webm`
            : `${SHOOB_API}/site/api/cardr/${shoobId}?size=400`;

          const rawJson  = JSON.stringify(sc);
          const fileHash = sc.file || "";
          const hasWebm  = sc.has_webm ? 1 : 0;
          const hasWebp  = sc.has_webp ? 1 : 0;
          const slug     = sc.slug || "";

          const existingByShoobId = await col("cards").findOne({ shoob_id: shoobId });
          if (existingByShoobId) {
            await col("cards").updateOne(
              { _id: existingByShoobId._id },
              { $set: { name: cardName, tier, series, is_animated: animated, raw_data: rawJson, file_hash: fileHash, has_webm: hasWebm, has_webp: hasWebp, slug, source: "shoob" } }
            );
            await col("shoob_imported_ids").updateOne(
              { shoob_id: shoobId },
              { $setOnInsert: { shoob_id: shoobId, local_card_id: existingByShoobId._id } },
              { upsert: true }
            );
            updated++;
            continue;
          }

          let imageData: Buffer | null = null;
          try {
            const mRes = await fetch(mediaUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; RequiemOrderBot/1.0)" },
              signal: AbortSignal.timeout(30000),
            });
            if (mRes.ok) {
              const buf = Buffer.from(await mRes.arrayBuffer());
              if (!isWebm && !isGif) {
                try {
                  const sharp = (await import("sharp")).default;
                  imageData = await sharp(buf).resize(800,1100,{fit:"inside",withoutEnlargement:true}).jpeg({quality:92}).toBuffer();
                } catch { imageData = buf; }
              } else {
                imageData = buf;
              }
            }
          } catch { errors++; }

          const { randomBytes } = await import("crypto");
          let localId = "C" + Date.now().toString(36).toUpperCase();
          for (let a = 0; a < 50; a++) {
            const bytes = randomBytes(8);
            const cand = Array.from(bytes as Buffer).map((b: number) => ID_CHARS[b % ID_CHARS.length]).join("");
            if (!(await col("cards").findOne({ _id: cand }))) { localId = cand; break; }
          }

          try {
            await col("cards").insertOne({
              _id: localId, name: cardName, series, tier, image_data: imageData,
              is_animated: animated, uploaded_by: uploader, source: "shoob",
              shoob_id: shoobId, raw_data: rawJson, file_hash: fileHash,
              has_webm: hasWebm, has_webp: hasWebp, slug,
            });
            await col("shoob_imported_ids").insertOne({ shoob_id: shoobId, local_card_id: localId });
            imported++;
          } catch { errors++; }

          await new Promise(r => setTimeout(r, 100));
        }
        if (pageCards.length < SHOOB_PAGE_SIZE) break;
        page++;
        if (runMode === "incremental" && imported + updated >= 200) break;
      }
    } catch (loopErr: any) {
      logger.warn({ loopErr }, "REST fallback sync loop error");
    }

    const durationMs = Date.now() - startMs;
    await col("shoob_sync_log").insertOne({
      run_type: `rest-${runMode}`, started_by: uploader,
      imported, updated, skipped, errors, total_seen: totalSeen,
      duration_ms: durationMs, ran_at: Math.floor(Date.now() / 1000),
    });

    res.json({
      success: true, method: "rest-fallback", mode: runMode,
      imported, updated, skipped, errors, total_seen: totalSeen, duration_ms: durationMs,
    });
  } catch (err: any) {
    logger.error({ err }, "Scraper run error");
    res.status(500).json({ success: false, message: err?.message || "Scraper run failed" });
  }
});

// ── Mazoku cards from MongoDB (NOT from file — avoids loading 14k cards per request) ──
const MAZOKU_TIER_CONFIG: Record<string, { label: string; order: number }> = {
  "C":   { label: "Common",      order: 1 },
  "R":   { label: "Rare",        order: 2 },
  "SR":  { label: "Super Rare",  order: 3 },
  "SSR": { label: "Super SR",    order: 4 },
  "UR":  { label: "Ultra Rare",  order: 5 },
  "EX":  { label: "Exclusive",   order: 6 },
};

// Reverse map: internal tier → Mazoku original tier (for filter conversion)
const INTERNAL_TO_MAZOKU: Record<string, string> = { T2: "C", T4: "R", T5: "SR", T6: "SSR", TS: "UR" };

router.get("/from-mazoku", async (req, res) => {
  try {
    const { tier, search, page: pageStr, limit: limitStr } = req.query as Record<string, string | undefined>;

    const filter: any = { source: "mazoku" };

    if (tier && tier !== "all") {
      // Accept both Mazoku-native tier (C/R/SR) and internal tier (T2/T4/T5)
      const internalTier = MAZOKU_TIER_MAP[tier] || tier;
      filter.tier = internalTier;
    }

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { series: { $regex: escaped, $options: "i" } },
      ];
    }

    const limit = Math.min(Math.max(parseInt(limitStr || "10", 10) || 10, 1), 200);
    const page  = Math.max(parseInt(pageStr || "1", 10) || 1, 1);
    const skip  = (page - 1) * limit;

    const [total, docs] = await Promise.all([
      col("cards").countDocuments(filter),
      col("cards").find(filter).sort({ tier: -1, name: 1 }).skip(skip).limit(limit).toArray(),
    ]);

    const result = docs.map((c: any) => {
      const isAnimated = c.is_animated === 1 || c.is_animated === true;
      const imageUrl = c.image_url || c.webp_url || `https://cdn7.mazoku.cc/cards/${c.mazoku_id}.webp`;
      return {
        id: c.mazoku_id || String(c._id),
        mazoku_id: c.mazoku_id || "",
        name: c.name || "Unknown",
        tier: c.mazoku_original_tier || INTERNAL_TO_MAZOKU[c.tier] || c.tier || "C",
        series: c.series || "General",
        description: "",
        imageUrl,
        gifUrl: c.gif_url || null,
        webmUrl: c.webm_url || null,
        isAnimated,
        source: "mazoku",
        totalCopies: 0,
        owners: [],
        ownerName: "Unclaimed",
        ownerId: null,
      };
    });

    const tiers = Object.keys(MAZOKU_TIER_CONFIG);
    res.json({ cards: result, total, page, limit, pages: Math.ceil(total / limit), source: "mazoku", tiers });
  } catch (err: any) {
    logger.error({ err }, "Error reading mazoku cards from MongoDB");
    res.status(500).json({ success: false, message: "Failed to read mazoku cards", cards: [], total: 0 });
  }
});

// ── Reload mazoku cards from JSON ─────────────────────────────────────────────
router.post("/reload-mazoku", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { loadMazokuCards } = await import("../../bot/mazoku-cards-loader.js");
    const stats = await loadMazokuCards();
    res.json({ success: true, ...stats });
  } catch (err: any) {
    logger.error({ err }, "reload-mazoku error");
    res.status(500).json({ success: false, message: err?.message || "Reload failed" });
  }
});
