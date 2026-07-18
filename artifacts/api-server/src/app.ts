import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const publicDirCandidates = [
  path.join(__dirname, "public"),
  path.join(process.cwd(), "dist", "public"),
  path.join(process.cwd(), "artifacts", "api-server", "dist", "public"),
];
const publicDir = publicDirCandidates.find((d) => fs.existsSync(d));

// ── Per-page OG meta tag injection ────────────────────────────────────────────
// WhatsApp (and other crawlers) read OG tags from the first HTML response for
// a URL. Since this is a React SPA with a single index.html, every path gets
// the same tags unless we inject page-specific ones server-side. We cache the
// base HTML and patch the OG tags before serving each known route.
const BASE_URL = process.env["PUBLIC_URL"]?.replace(/\/$/, "") || "https://requiem-order.onrender.com";

interface PageMeta { title: string; description: string; image?: string }

const PAGE_META: Record<string, PageMeta> = {
  "/":            { title: "反逆 Requiem Order — Rise. Collect. Dominate.", description: "Hunt ultra-rare cards, wage guild wars, and build your empire. The elite card collection empire on WhatsApp.", image: "/opengraph.jpg" },
  "/shop":        { title: "Shop — 反逆 Requiem Order", description: "Browse items, tools, premium upgrades, and lottery tickets in the Requiem Order shop.", image: "/opengraph.jpg" },
  "/cards":       { title: "Card Catalog — 反逆 Requiem Order", description: "Explore thousands of ultra-rare collectible cards across tiers T1–TX. Hunt, claim, and trade in Requiem Order.", image: "/opengraph.jpg" },
  "/admin":       { title: "Admin Dashboard — 反逆 Requiem Order", description: "Manage players, bots, staff roles, and community settings for Requiem Order.", image: "/opengraph.jpg" },
  "/leaderboard": { title: "Leaderboard — 反逆 Requiem Order", description: "Who dominates the Requiem Order economy? See the top players by balance, cards, and rank.", image: "/opengraph.jpg" },
  "/profile":     { title: "Player Profile — 反逆 Requiem Order", description: "View your Requiem Order profile — cards, stats, guild, dungeon progress, and more.", image: "/opengraph.jpg" },
  "/guilds":      { title: "Guilds — 反逆 Requiem Order", description: "Join or found a guild, wage war on rivals, and climb the guild rankings in Requiem Order.", image: "/opengraph.jpg" },
  "/world":       { title: "World — 反逆 Requiem Order", description: "Explore the Requiem Order world map — dungeons, faction territories, and hidden secrets.", image: "/opengraph.jpg" },
  "/register":    { title: "Register — 反逆 Requiem Order", description: "Create your Requiem Order account and start your journey to legend.", image: "/opengraph.jpg" },
  "/login":       { title: "Login — 反逆 Requiem Order", description: "Sign in to your Requiem Order account.", image: "/opengraph.jpg" },
};

function injectOgTags(html: string, meta: PageMeta, url: string): string {
  const absImage = meta.image
    ? (meta.image.startsWith("http") ? meta.image : `${BASE_URL}${meta.image}`)
    : `${BASE_URL}/opengraph.jpg`;
  const absUrl = `${BASE_URL}${url}`;
  return html
    .replace(/(<meta property="og:title"\s+content=")[^"]*(")/gi,   `$1${meta.title}$2`)
    .replace(/(<meta property="og:description"\s+content=")[^"]*(")/gi, `$1${meta.description}$2`)
    .replace(/(<meta property="og:image"\s+content=")[^"]*(")/gi,   `$1${absImage}$2`)
    .replace(/(<meta property="og:url"\s+content=")[^"]*(")/gi,     `$1${absUrl}$2`)
    .replace(/(<meta name="twitter:title"\s+content=")[^"]*(")/gi,  `$1${meta.title}$2`)
    .replace(/(<meta name="twitter:description"\s+content=")[^"]*(")/gi, `$1${meta.description}$2`)
    .replace(/(<meta name="twitter:image"\s+content=")[^"]*(")/gi,  `$1${absImage}$2`)
    .replace(/(<title>)[^<]*/gi, `$1${meta.title}`);
}

let _cachedHtml: string | null = null;
function getBaseHtml(htmlPath: string): string {
  if (!_cachedHtml) _cachedHtml = fs.readFileSync(htmlPath, "utf8");
  return _cachedHtml;
}

if (publicDir) {
  app.use(express.static(publicDir));
  app.use((req, res) => {
    const htmlPath = path.join(publicDir, "index.html");
    const pagePath = req.path.split("?")[0].replace(/\/+$/, "") || "/";
    const meta = PAGE_META[pagePath];
    if (meta) {
      // Inject page-specific OG tags so WhatsApp previews show meaningful info
      // for each route instead of the homepage defaults.
      try {
        const html = injectOgTags(getBaseHtml(htmlPath), meta, pagePath);
        res.setHeader("Content-Type", "text/html");
        res.send(html);
        return;
      } catch {
        // fallthrough to static send on error
      }
    }
    res.sendFile(htmlPath);
  });
} else {
  app.use((_req, res) => {
    res.json({ status: "ok", message: "Requiem Order API is running. Frontend not found — run the build step first." });
  });
}

export default app;
