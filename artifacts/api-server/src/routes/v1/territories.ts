import { Router, type IRouter } from "express";
import { col } from "../../bot/db/mongo.js";
import { logger } from "../../lib/logger.js";
import { CONTINENTS, REGIONS, TERRITORIES } from "../../bot/atlas.js";
import { getGuildMembers, getTerritoryHistory } from "../../bot/db/queries.js";

const router: IRouter = Router();

/**
 * GET /api/v1/territories
 *
 * Returns the full world atlas with LIVE ownership joined in. Geography
 * (continent/region/territory names, map coordinates, base resource) is
 * static and comes from bot/atlas.ts. Ownership (which guild controls it,
 * when, tax rate, danger level) is live and comes straight from the same
 * `territory_state` collection the .territory bot command writes to —
 * claiming a territory in WhatsApp updates exactly what this endpoint
 * returns, with no separate sync step.
 */
router.get("/", async (_req, res) => {
  try {
    const states = await col("territory_state").find({}).toArray();
    const stateByTerritory = new Map(states.map((s: any) => [s.territory_id, s]));

    const guildIds = [...new Set(states.map((s: any) => s.guild_id).filter(Boolean))];
    const guilds = guildIds.length
      ? await col("guilds").find({ _id: { $in: guildIds as any[] } }).toArray()
      : [];
    const guildById = new Map(guilds.map((g: any) => [String(g._id), g]));

    const territories = TERRITORIES.map((t) => {
      const state = stateByTerritory.get(t.id) as any;
      const guild = state?.guild_id ? guildById.get(String(state.guild_id)) as any : null;
      return {
        id: t.id,
        name: t.name,
        region: t.region,
        resource: t.resource,
        baseIncome: t.baseIncome,
        x: t.x,
        y: t.y,
        owner: guild ? { id: String(guild._id), name: guild.name, level: guild.level || 1 } : null,
        claimedAt: state?.claimed_at || null,
        taxRate: state?.tax_rate ?? null,
        dangerLevel: state?.danger_level ?? null,
      };
    });

    const regions = REGIONS.map((r) => ({
      id: r.id,
      name: r.name,
      continent: r.continent,
      territoryCount: territories.filter((t) => t.region === r.id).length,
    }));

    res.json({
      success: true,
      continents: CONTINENTS,
      regions,
      territories,
    });
  } catch (err: any) {
    logger.error({ err }, "Error fetching territories");
    res.status(500).json({ success: false, message: "Failed to fetch territories", territories: [] });
  }
});

/**
 * GET /api/v1/territories/:id
 * Detail view for a single territory, by its atlas slug — leader, member
 * list, and conquest history for the click-to-open map panel.
 */
router.get("/:id", async (req, res) => {
  try {
    const def = TERRITORIES.find((t) => t.id === req.params.id);
    if (!def) { res.status(404).json({ success: false, message: "Territory not found" }); return; }

    const state = await col("territory_state").findOne({ territory_id: def.id });
    let owner: any = null;
    if (state?.guild_id) {
      const g = await col("guilds").findOne({ _id: state.guild_id as any });
      if (g) {
        const members = await getGuildMembers(String(g._id));
        const leaderPhone = (g as any).owner_id;
        const leaderRow = leaderPhone ? await col("users").findOne({ _id: leaderPhone as any }) : null;
        owner = {
          id: String(g._id),
          name: (g as any).name,
          level: (g as any).level || 1,
          emblem: (g as any).emblem || null,
          description: (g as any).description || "",
          leader: {
            id: leaderPhone || null,
            name: (leaderRow as any)?.name || leaderPhone || "Unknown",
          },
          memberCount: members.length,
        };
      }
    }

    const history = await getTerritoryHistory(def.id, 15);

    const region = REGIONS.find((r) => r.id === def.region);
    const continent = region ? CONTINENTS.find((c) => c.id === region.continent) : null;

    res.json({
      success: true,
      territory: {
        ...def,
        region: region ? { id: region.id, name: region.name } : null,
        continent: continent ? { id: continent.id, name: continent.name } : null,
        owner,
        claimedAt: state?.claimed_at || null,
        taxRate: state?.tax_rate ?? null,
        dangerLevel: state?.danger_level ?? null,
        warHistory: history.map((h: any) => ({
          id: h.id,
          title: h.title,
          guildName: h.guild_name || null,
          outcome: h.outcome || null,
          actorName: h.actor_name,
          timestamp: h.created_at,
        })),
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Error fetching territory detail");
    res.status(500).json({ success: false, message: "Failed to fetch territory" });
  }
});

export { router as territoriesRouter };
