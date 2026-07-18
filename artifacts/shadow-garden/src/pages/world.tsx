import { useEffect, useMemo, useState } from "react";
import { Crown, MapPin, Loader2, Swords, Users, Shield, X } from "lucide-react";

interface TerritoryOwner {
  id: string;
  name: string;
  level: number;
}

interface Territory {
  id: string;
  name: string;
  region: string;
  resource: string;
  baseIncome: number;
  x: number;
  y: number;
  owner: TerritoryOwner | null;
  claimedAt: number | null;
  taxRate: number | null;
  dangerLevel: number | null;
}

interface RegionInfo {
  id: string;
  name: string;
  continent: string;
}

interface ContinentInfo {
  id: string;
  name: string;
}

interface TerritoryDetail {
  id: string;
  name: string;
  resource: string;
  baseIncome: number;
  x: number;
  y: number;
  claimedAt: number | null;
  taxRate: number | null;
  dangerLevel: number | null;
  region: { id: string; name: string } | null;
  continent: { id: string; name: string } | null;
  owner: (TerritoryOwner & {
    emblem: string | null;
    description: string;
    leader: { id: string | null; name: string };
    memberCount: number;
  }) | null;
  warHistory: Array<{
    id: string;
    title: string;
    guildName: string | null;
    outcome: string | null;
    actorName: string;
    timestamp: number;
  }>;
}

async function fetchTerritories(): Promise<{ continents: ContinentInfo[]; regions: RegionInfo[]; territories: Territory[] }> {
  const res = await fetch("/api/v1/territories");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchTerritoryDetail(id: string): Promise<{ territory: TerritoryDetail }> {
  const res = await fetch(`/api/v1/territories/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Deterministic color per guild id, so the same guild always shows the same
// marker color everywhere on the map without needing a stored color field.
const GUILD_PALETTE = [
  { dot: "bg-amber-400",  ring: "border-amber-400/30",  text: "text-amber-400",  glow: "rgba(251,191,36,0.8)",  hex: "#fbbf24" },
  { dot: "bg-primary",    ring: "border-primary/30",    text: "text-primary",    glow: "rgba(160,0,26,0.8)",   hex: "#a0001a" },
  { dot: "bg-teal-400",   ring: "border-teal-400/30",   text: "text-teal-400",   glow: "rgba(45,212,191,0.8)", hex: "#2dd4bf" },
  { dot: "bg-sky-400",    ring: "border-sky-400/30",    text: "text-sky-400",    glow: "rgba(56,189,248,0.8)", hex: "#38bdf8" },
  { dot: "bg-violet-400", ring: "border-violet-400/30", text: "text-violet-400", glow: "rgba(167,139,250,0.8)", hex: "#a78bfa" },
  { dot: "bg-emerald-400", ring: "border-emerald-400/30", text: "text-emerald-400", glow: "rgba(52,211,153,0.8)", hex: "#34d399" },
  { dot: "bg-orange-400", ring: "border-orange-400/30", text: "text-orange-400", glow: "rgba(251,146,60,0.8)", hex: "#fb923c" },
];
const UNCLAIMED_STYLE = { dot: "bg-white/25", ring: "border-white/15", text: "text-white/50", glow: "rgba(255,255,255,0.25)", hex: "rgba(255,255,255,0.35)" };

function colorForGuild(guildId: string) {
  let hash = 0;
  for (let i = 0; i < guildId.length; i++) hash = (hash * 31 + guildId.charCodeAt(i)) >>> 0;
  return GUILD_PALETTE[hash % GUILD_PALETTE.length];
}

export default function World() {
  const [data, setData] = useState<{ continents: ContinentInfo[]; regions: RegionInfo[]; territories: Territory[] } | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TerritoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const result = await fetchTerritories();
        if (mounted) setData(result);
      } catch {
        if (mounted) setError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    const interval = setInterval(async () => {
      try {
        const result = await fetchTerritories();
        if (mounted) setData(result);
      } catch { /* keep showing the last good data on a transient failure */ }
    }, 15000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let mounted = true;
    setDetailLoading(true);
    (async () => {
      try {
        const result = await fetchTerritoryDetail(selectedId);
        if (mounted) setDetail(result.territory);
      } catch {
        if (mounted) setDetail(null);
      } finally {
        if (mounted) setDetailLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [selectedId]);

  const regionById = useMemo(() => new Map((data?.regions || []).map((r) => [r.id, r])), [data]);
  const continentById = useMemo(() => new Map((data?.continents || []).map((c) => [c.id, c])), [data]);

  const activeGuilds = useMemo(() => {
    const seen = new Map<string, TerritoryOwner>();
    for (const t of data?.territories || []) {
      if (t.owner && !seen.has(t.owner.id)) seen.set(t.owner.id, t.owner);
    }
    return [...seen.values()];
  }, [data]);

  return (
    <div className="h-screen w-screen relative overflow-hidden flex flex-col bg-[#05050a]">

      <div className="relative z-20 p-4 sm:p-6 md:p-8 pointer-events-none" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.65), transparent)" }}>
        <p className="font-mono tracking-[0.3em] sm:tracking-[0.5em] text-[10px] sm:text-xs uppercase mb-1" style={{ color:"rgba(160,0,26,0.4)" }}>反逆</p>
        <h1 className="font-serif text-xl sm:text-3xl md:text-5xl font-bold text-white tracking-wide sm:tracking-widest uppercase neon-text-sky">Requiem Order World Atlas</h1>
        <p className="hidden sm:block mt-2 max-w-xl text-sm" style={{ color:"rgba(212,201,168,0.45)" }}>
          Live territory control across the known world. Claim territory in-bot with <span className="font-mono">.territory claim</span> and it appears here. Tap a marker for details.
        </p>
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center z-10 gap-2 text-white/40 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading world state...
        </div>
      )}
      {!loading && error && (
        <div className="flex-1 flex items-center justify-center z-10 text-rose-400/70 text-sm">
          Failed to load territory data. Please try again shortly.
        </div>
      )}

      {!loading && !error && data && (
        <div className="flex-1 relative w-full h-full z-10 overflow-hidden select-none">
          {/* Static, full-bleed map — no zoom or pan. The image fills the
              viewport edge-to-edge (object-cover) and markers are positioned
              with the same x/y percentages the API returns, so every
              territory is always visible and tappable at once regardless of
              screen size. */}
          <img
            src="/images/world-map.svg"
            alt="World map"
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
          />

          {data.territories.map((territory) => {
            const style = territory.owner ? colorForGuild(territory.owner.id) : UNCLAIMED_STYLE;
            const region = regionById.get(territory.region);
            const continent = region ? continentById.get(region.continent) : undefined;
            return (
              <div
                key={territory.id}
                className="absolute group/marker cursor-pointer"
                style={{
                  left: `${territory.x}%`,
                  top: `${territory.y}%`,
                  transform: "translate(-50%, -50%)",
                }}
                onClick={() => setSelectedId(territory.id)}
              >
                <div className="relative">
                  {territory.owner && (
                    <>
                      <div className={`absolute inset-0 rounded-full animate-ping opacity-25 ${style.dot}`} style={{ animationDuration: "2.6s" }} />
                      <div className={`absolute inset-0 rounded-full animate-ping opacity-10 scale-[2] ${style.dot}`} style={{ animationDuration: "3.8s" }} />
                    </>
                  )}

                  <div className={`w-7 h-7 sm:w-10 sm:h-10 rounded-full flex items-center justify-center relative z-10 border transition-all duration-300 hover:scale-110 glass-card ${style.text} ${style.ring}`}
                    style={{ background: "rgba(0,0,0,0.55)" }}>
                    {territory.owner ? <Crown className="w-3 h-3 sm:w-4 sm:h-4" /> : <MapPin className="w-3 h-3 sm:w-4 sm:h-4" />}
                  </div>

                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-4 p-4 rounded-xl opacity-0 translate-y-2 pointer-events-none group-hover/marker:opacity-100 group-hover/marker:translate-y-0 transition-all duration-300 z-50 hidden sm:block"
                    style={{ width: 260, background: "rgba(17,17,23,0.92)", border: "1px solid rgba(160,0,26,0.18)", boxShadow: "0 0 30px rgba(160,0,26,0.2)" }}>
                    <div className={`text-[10px] font-mono tracking-widest uppercase mb-1 opacity-60 ${style.text}`}>
                      {continent?.name || "?"} · {region?.name || "?"}
                    </div>
                    <h3 className="font-serif text-base font-bold text-white mb-1.5">{territory.name}</h3>
                    <p className="text-xs leading-relaxed" style={{ color: "rgba(212,201,168,0.55)" }}>
                      Produces <span className="text-white/70">{territory.resource}</span> — {territory.baseIncome.toLocaleString()} gold/day base income.
                    </p>
                    <div className="mt-3 pt-2 text-[10px] font-bold tracking-[0.2em] uppercase text-center" style={{ borderTop: "1px solid rgba(255,255,255,0.05)", color: territory.owner ? "rgba(212,201,168,0.7)" : "rgba(160,0,26,0.6)" }}>
                      {territory.owner
                        ? `Controlled by ${territory.owner.name}${territory.taxRate != null ? ` · ${territory.taxRate}% tax` : ""}`
                        : "Unclaimed — tap for details"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !error && (
        <div className="absolute z-20 p-2.5 sm:p-4 rounded-lg sm:rounded-xl max-w-[140px] sm:max-w-none bottom-3 right-3 sm:bottom-6 sm:right-6" style={{ background:"rgba(17,17,23,0.85)", border:"1px solid rgba(160,0,26,0.15)", boxShadow:"0 0 20px rgba(160,0,26,0.08)" }}>
          <h4 className="text-[8px] sm:text-[10px] font-mono font-bold tracking-[0.15em] sm:tracking-[0.3em] uppercase pb-1.5 sm:pb-2 mb-2 sm:mb-3" style={{ color:"rgba(160,0,26,0.5)", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
            Guild Control
          </h4>
          <ul className="space-y-1.5 sm:space-y-2 text-[10px] sm:text-xs text-white/70 max-h-32 sm:max-h-48 overflow-y-auto pr-1">
            {activeGuilds.length === 0 && <li className="text-white/40 italic">No territories claimed yet</li>}
            {activeGuilds.map((g) => {
              const style = colorForGuild(g.id);
              return (
                <li key={g.id} className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${style.dot}`} style={{ boxShadow: `0 0 6px ${style.glow}` }} />
                  {g.name}
                </li>
              );
            })}
            <li className="flex items-center gap-2 pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${UNCLAIMED_STYLE.dot}`} />
              Unclaimed
            </li>
          </ul>
        </div>
      )}

      {selectedId && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setSelectedId(null)}>
          <div
            className="w-full max-w-md rounded-2xl overflow-hidden"
            style={{ background: "rgba(17,17,23,0.97)", border: "1px solid rgba(160,0,26,0.25)", boxShadow: "0 0 40px rgba(160,0,26,0.25)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <h2 className="font-serif text-lg font-bold text-white">{detail?.name || "Loading…"}</h2>
              <button onClick={() => setSelectedId(null)} className="text-white/40 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 max-h-[70vh] overflow-y-auto space-y-5">
              {detailLoading && (
                <div className="flex items-center justify-center gap-2 text-white/40 text-sm py-8">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading territory details...
                </div>
              )}

              {!detailLoading && detail && (
                <>
                  <div className="flex items-center gap-2 text-xs flex-wrap" style={{ color: "rgba(212,201,168,0.5)" }}>
                    <span>{detail.continent?.name || "?"}</span>
                    <span>·</span>
                    <span>{detail.region?.name || "?"}</span>
                    <span>·</span>
                    <span className="text-white/60">{detail.resource}</span>
                    <span>·</span>
                    <span className="text-white/60">{detail.baseIncome.toLocaleString()} gold/day</span>
                  </div>

                  {detail.owner ? (
                    <div className="rounded-xl p-4" style={{ background: "rgba(0,0,0,0.3)", border: `1px solid ${colorForGuild(detail.owner.id).hex}33` }}>
                      <div className="flex items-center gap-3 mb-3">
                        <div
                          className="w-12 h-12 rounded-full flex items-center justify-center font-serif font-bold text-lg shrink-0"
                          style={{
                            background: detail.owner.emblem ? `url(${detail.owner.emblem}) center/cover` : `${colorForGuild(detail.owner.id).hex}22`,
                            color: colorForGuild(detail.owner.id).hex,
                            border: `2px solid ${colorForGuild(detail.owner.id).hex}55`,
                          }}
                        >
                          {!detail.owner.emblem && detail.owner.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-white truncate">{detail.owner.name}</p>
                          <p className="text-xs" style={{ color: "rgba(212,201,168,0.5)" }}>Guild Level {detail.owner.level}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center gap-1.5" style={{ color: "rgba(212,201,168,0.6)" }}>
                          <Crown className="w-3.5 h-3.5 shrink-0" style={{ color: colorForGuild(detail.owner.id).hex }} />
                          <span className="truncate">Leader: <span className="text-white/80">{detail.owner.leader.name}</span></span>
                        </div>
                        <div className="flex items-center gap-1.5" style={{ color: "rgba(212,201,168,0.6)" }}>
                          <Users className="w-3.5 h-3.5 shrink-0" style={{ color: colorForGuild(detail.owner.id).hex }} />
                          <span>{detail.owner.memberCount} member{detail.owner.memberCount !== 1 ? "s" : ""}</span>
                        </div>
                        {detail.taxRate != null && (
                          <div className="flex items-center gap-1.5" style={{ color: "rgba(212,201,168,0.6)" }}>
                            <Shield className="w-3.5 h-3.5 shrink-0" style={{ color: colorForGuild(detail.owner.id).hex }} />
                            <span>{detail.taxRate}% tax rate</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl p-4 text-center text-sm" style={{ background: "rgba(160,0,26,0.06)", border: "1px solid rgba(160,0,26,0.15)", color: "rgba(160,0,26,0.7)" }}>
                      This territory is unclaimed. Use <span className="font-mono">.territory claim {detail.id}</span> in-bot to take it.
                    </div>
                  )}

                  <div>
                    <h3 className="text-[10px] font-mono font-bold tracking-[0.25em] uppercase mb-2 flex items-center gap-1.5" style={{ color: "rgba(160,0,26,0.6)" }}>
                      <Swords className="w-3 h-3" /> War History
                    </h3>
                    {detail.warHistory.length === 0 ? (
                      <p className="text-xs italic" style={{ color: "rgba(212,201,168,0.35)" }}>No recorded conquests for this territory yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {detail.warHistory.map((h) => (
                          <li key={h.id} className="text-xs rounded-lg p-2.5" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.05)" }}>
                            <p className="text-white/75">{h.title}</p>
                            <p className="mt-0.5" style={{ color: "rgba(212,201,168,0.4)" }}>
                              {new Date(h.timestamp * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}

              {!detailLoading && !detail && (
                <p className="text-sm text-center py-8" style={{ color: "rgba(212,201,168,0.4)" }}>Couldn't load this territory's details.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 font-mono text-[10px] tracking-widest pointer-events-none" style={{ color:"rgba(160,0,26,0.35)" }}>
        REQUIEM ORDER WORLD ATLAS · 反逆 · v2.1
      </div>
    </div>
  );
}
