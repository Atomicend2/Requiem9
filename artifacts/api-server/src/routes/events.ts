import { Router, type IRouter } from "express";
import { col } from "../bot/db/mongo.js";
import { logger } from "../lib/logger.js";
import { mongoDocToFrontendCard } from "./v1/cards.js";

const router: IRouter = Router();

/**
 * GET /api/events
 *
 * Returns event-exclusive cards — Christmas, Halloween, Gala, and more.
 * These are sourced from both shoob and mazoku, tagged with is_event / event_name
 * in unified_cards.jsonl, and synced into the `cards` collection like any
 * other card. Event cards never appear in normal spawns (see
 * getWeightedRandomCard in bot/utils.ts) — this endpoint is the only way to
 * browse them outside of an actual event game.
 *
 * Query params (all optional, combinable):
 *   event    — exact event name, e.g. "christmas", "halloween", "summer"
 *   tier     — exact tier, e.g. "T3", "TS"
 *   search   — case-insensitive substring match on name or series
 *   page     — 1-indexed page number (default 1)
 *   limit    — page size, 1-200 (default 20)
 *   sortBy   — "name" | "tier" | "series" | "created_at" (default "created_at")
 *   sortDir  — "asc" | "desc" (default "desc")
 */
router.get("/", async (req, res) => {
  try {
    const { event, tier, search, sortBy, sortDir, page: pageStr, limit: limitStr } =
      req.query as Record<string, string | undefined>;

    const filter: any = { is_event: 1 };
    if (event && event !== "all") filter.event_name = event.toLowerCase().trim();
    if (tier && tier !== "all") filter.tier = tier;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name:   { $regex: escaped, $options: "i" } },
        { series: { $regex: escaped, $options: "i" } },
      ];
    }

    const limit = Math.min(Math.max(parseInt(limitStr || "20", 10) || 20, 1), 200);
    const page  = Math.max(parseInt(pageStr  || "1",  10) || 1, 1);
    const skip  = (page - 1) * limit;

    const SORTABLE_FIELDS = new Set(["name", "tier", "series", "created_at"]);
    const sortField = sortBy && SORTABLE_FIELDS.has(sortBy) ? sortBy : "created_at";
    const dir = sortDir === "asc" ? 1 : -1;
    const sortSpec: Record<string, 1 | -1> = { [sortField]: dir, _id: 1 };

    const [total, docs, availableEvents] = await Promise.all([
      col("cards").countDocuments(filter),
      col("cards").find(filter).sort(sortSpec).skip(skip).limit(limit).toArray(),
      col("cards").distinct("event_name", { is_event: 1 }),
    ]);

    const cards = docs.map(mongoDocToFrontendCard);

    res.json({
      success: true,
      count: total,
      page,
      limit,
      pages: total === 0 ? 0 : Math.ceil(total / limit),
      availableEvents: (availableEvents as (string | null)[]).filter(Boolean).sort(),
      data: cards,
    });
  } catch (err: any) {
    logger.error({ err }, "Error fetching event cards");
    res.status(500).json({ success: false, message: "Failed to fetch event cards", data: [] });
  }
});

export { router as eventsRouter };
