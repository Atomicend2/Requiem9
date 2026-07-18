import React, { useState, useEffect, useCallback, useRef, Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Users, CreditCard, Shield, Wifi, WifiOff, Crown, Ban,
  Trophy, Bot, AlertTriangle, RefreshCw, Lock, Plus, Trash2,
  Eye, EyeOff, Search, X, ChevronRight, Wallet, Coins,
  Star, Zap, RotateCcw, Download, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Error boundary: catches React render crashes and shows a recovery UI ─── */
class AdminErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="glass-card rounded-xl p-8 max-w-md text-center border border-rose-500/30">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-rose-400 text-2xl">!</span>
            </div>
            <h2 className="font-serif text-xl text-white mb-2">Dashboard Error</h2>
            <p className="text-muted-foreground text-sm mb-6 font-mono break-all">{(this.state.error as Error).message}</p>
            <button
              onClick={() => this.setState({ error: null })}
              className="px-6 py-2 rounded border border-primary/30 text-primary text-sm font-bold uppercase tracking-widest hover:bg-primary/10 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const ADMIN_TOKEN_KEY = "requiem_order_admin_token";
function getAdminToken(): string | null { return localStorage.getItem(ADMIN_TOKEN_KEY); }
function setAdminToken(t: string) { localStorage.setItem(ADMIN_TOKEN_KEY, t); }
function clearAdminToken() { localStorage.removeItem(ADMIN_TOKEN_KEY); }
function useAdminToken() {
  const [token, setToken] = useState<string | null>(() => getAdminToken());
  const save = (t: string) => { setAdminToken(t); setToken(t); };
  const clear = () => { clearAdminToken(); setToken(null); };
  return { token, save, clear };
}

function useAdminAuthMedia(apiPath: string | null, token: string | null): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!apiPath || !token) { setBlobUrl(null); return; }
    let cancelled = false;
    fetch(apiPath, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok || cancelled) { if (!cancelled) setBlobUrl(null); return; }
        const blob = await res.blob();
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return objectUrl; });
      })
      .catch(() => { if (!cancelled) setBlobUrl(null); });
    return () => { cancelled = true; };
  }, [apiPath, token]);

  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return blobUrl;
}

/** Player avatar for the admin search list/detail panel. Falls back to an
 *  initial-letter badge — same as the web profile page's own placeholder —
 *  for players who haven't uploaded a picture, or while it's loading. */
function PlayerAvatar({ playerId, name, base, token, size = 36 }: { playerId: string; name?: string | null; base: string; token: string | null; size?: number }) {
  const url = useAdminAuthMedia(playerId ? `${base}/api/v1/admin/players/${encodeURIComponent(playerId)}/avatar` : null, token);
  const initial = (name || playerId || "?").charAt(0).toUpperCase();
  if (url) {
    return (
      <img
        src={url}
        alt={name || "player avatar"}
        className="rounded-full object-cover border border-white/10 shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full border border-primary/30 bg-primary/10 flex items-center justify-center text-primary font-serif font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initial}
    </div>
  );
}

export default function Admin() {
  const { token, save: saveToken, clear: clearToken } = useAdminToken();
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const { toast } = useToast();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch(`${base}/api/v1/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await res.json();
      if (j.success && j.token) { saveToken(j.token); setPassword(""); }
      else setLoginError(j.message || "Invalid password.");
    } catch { setLoginError("Could not reach the server."); }
    finally { setLoginLoading(false); }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="glass-card rounded-2xl p-10 w-full max-w-sm border border-primary/15 shadow-2xl">
          <div className="text-center mb-8">
            <p className="text-primary/40 font-mono tracking-[0.4em] text-xs uppercase mb-2">反逆</p>
            <h1 className="font-serif text-3xl font-bold text-white neon-text-sky mb-1">Admin Panel</h1>
            <p className="text-muted-foreground text-sm">Enter your admin password to continue</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoFocus
                className="w-full pl-10 pr-10 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 font-mono text-sm"
              />
              <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {loginError && <p className="text-rose-400 text-sm text-center">{loginError}</p>}
            <button
              type="submit"
              disabled={loginLoading || !password}
              className="w-full py-3 rounded-lg bg-primary/20 border border-primary/40 text-primary font-bold uppercase tracking-widest text-sm hover:bg-primary/30 transition-colors disabled:opacity-50"
            >
              {loginLoading ? "Checking…" : "Enter"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <AdminErrorBoundary>
      <AdminDashboard token={token} base={base} onLogout={clearToken} toast={toast} />
    </AdminErrorBoundary>
  );
}

type Tab = "overview" | "players" | "bots" | "cards" | "frames";

function AdminDashboard({ token, base, onLogout, toast }: {
  token: string; base: string; onLogout: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [data, setData] = useState<any>(null);
  const [bots, setBots] = useState<any[]>([]);
  const [personas, setPersonas] = useState<{ key: string; displayName: string; shortLabel: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [actionPending, setActionPending] = useState(false);

  // Bot manager state
  const [newBotName, setNewBotName] = useState("");
  const [newBotPhone, setNewBotPhone] = useState("");
  const [pairingPhones, setPairingPhones] = useState<Record<string, string>>({});
  const [pairingLoading, setPairingLoading] = useState<Record<string, boolean>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Player search state
  const [playerQuery, setPlayerQuery] = useState("");
  const [playerResults, setPlayerResults] = useState<any[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<any>(null);
  const [playerDetail, setPlayerDetail] = useState<any>(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [coinAmount, setCoinAmount] = useState("");
  const [coinTarget, setCoinTarget] = useState<"wallet" | "bank">("wallet");
  const [roleValue, setRoleValue] = useState("user");

  const authHeader = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 25000);
    try {
      const [statsRes, botsRes] = await Promise.all([
        fetch(`${base}/api/v1/admin/stats`,       { headers: authHeader, signal: controller.signal }),
        fetch(`${base}/api/v1/admin/bots/status`, { headers: authHeader, signal: controller.signal }),
      ]);
      clearTimeout(timeoutId);
      if (statsRes.status === 401 || statsRes.status === 403) { onLogout(); return; }
      if (!statsRes.ok) {
        if (statsRes.status >= 500) {
          setData({
            botConnected: false, pairingCode: null, isOwner: false,
            stats: { totalUsers: 0, totalBots: 0, totalCards: 0, totalGuilds: 0, totalBanned: 0, totalStaff: 0 },
            recentUsers: [], staffList: [], topUsers: [],
            _warning: `Server error (${statsRes.status}) — database may be unavailable`,
          });
          try { const bj = await botsRes.json(); if (bj.success) setBots(Array.isArray(bj.bots) ? bj.bots : []); } catch {}
          return;
        }
        let msg = `Server error (${statsRes.status})`;
        try { const j = await statsRes.json(); msg = j.message || msg; } catch {}
        setError(msg); return;
      }
      const statsJson = await statsRes.json();
      if (!statsJson?.stats) { setError(statsJson?.message || "Unexpected response from admin API."); return; }
      setData(statsJson);
      try { const bj = await botsRes.json(); if (bj.success) setBots(Array.isArray(bj.bots) ? bj.bots : []); } catch {}
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e?.name === "AbortError") {
        setError("Request timed out. MongoDB may still be starting up — please wait a moment and retry.");
      } else {
        setError(e?.message || "Could not reach admin API. Is the server running?");
      }
    } finally { setLoading(false); }
  }, [token]);

  const fetchBotStatuses = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/v1/admin/bots/status`, { headers: authHeader });
      const j = await r.json();
      if (j.success) setBots(Array.isArray(j.bots) ? j.bots : []);
    } catch {}
  }, [token]);

  const fetchPersonas = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/v1/admin/personas`, { headers: authHeader });
      const j = await r.json();
      if (j.success) setPersonas(j.personas || []);
    } catch {}
  }, [token]);

  useEffect(() => { fetchPersonas(); }, [fetchPersonas]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Poll primary bot connection status every 5 s using the lightweight /status
  // endpoint (zero DB queries) instead of the full /stats endpoint which now
  // has a 30-second server-side cache and is expensive to compute fresh.
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`${base}/api/v1/admin/status`, { headers: authHeader });
        if (r.ok) {
          const j = await r.json();
          setData((prev: any) => prev ? { ...prev, botConnected: j.botConnected, pairingCode: j.pairingCode } : prev);
        }
      } catch {}
    };
    statusPollRef.current = setInterval(poll, 5000);
    return () => { if (statusPollRef.current) clearInterval(statusPollRef.current); };
  }, [token]);

  useEffect(() => {
    if (activeTab === "bots") {
      fetchBotStatuses();
      pollRef.current = setInterval(fetchBotStatuses, 3000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeTab, fetchBotStatuses]);

  const searchPlayers = async (q: string) => {
    if (!q.trim()) { setPlayerResults([]); return; }
    setPlayerLoading(true);
    try {
      const r = await fetch(`${base}/api/v1/admin/players?q=${encodeURIComponent(q)}`, { headers: authHeader });
      const j = await r.json();
      setPlayerResults(j.players || []);
    } finally { setPlayerLoading(false); }
  };

  const loadPlayerDetail = async (id: string) => {
    setPlayerDetail(null);
    try {
      const r = await fetch(`${base}/api/v1/admin/players/${encodeURIComponent(id)}`, { headers: authHeader });
      const j = await r.json();
      if (j.success) setPlayerDetail(j);
    } catch {}
  };

  const selectPlayer = (p: any) => {
    setSelectedPlayer(p);
    loadPlayerDetail(p.id);
  };

  const playerAction = async (path: string, body: any, label: string) => {
    if (!selectedPlayer) return;
    setActionPending(true);
    try {
      const r = await fetch(`${base}/api/v1/admin/players/${encodeURIComponent(selectedPlayer.id)}/${path}`, {
        method: "POST", headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      toast({ title: j.success ? "Done" : "Error", description: j.message });
      if (j.success) {
        await loadPlayerDetail(selectedPlayer.id);
        searchPlayers(playerQuery);
      }
    } finally { setActionPending(false); }
  };

  const deleteCard = async (ucId: string, cardName: string) => {
    if (!selectedPlayer) return;
    if (!window.confirm(`Remove "${cardName}" from ${selectedPlayer.name || "this player"}'s collection? This cannot be undone.`)) return;
    setActionPending(true);
    try {
      const r = await fetch(`${base}/api/v1/admin/players/${encodeURIComponent(selectedPlayer.id)}/cards/${ucId}`, {
        method: "DELETE", headers: { ...authHeader },
      });
      const j = await r.json();
      toast({ title: j.success ? "Card Removed" : "Error", description: j.message });
      if (j.success) await loadPlayerDetail(selectedPlayer.id);
    } finally { setActionPending(false); }
  };

  const clearAllCards = async () => {
    if (!selectedPlayer) return;
    if (!window.confirm(`Clear ${selectedPlayer.name || "this player"}'s ENTIRE card collection? This is irreversible.`)) return;
    setActionPending(true);
    try {
      const r = await fetch(`${base}/api/v1/admin/players/${encodeURIComponent(selectedPlayer.id)}/cards`, {
        method: "DELETE", headers: { ...authHeader },
      });
      const j = await r.json();
      toast({ title: j.success ? "Collection Cleared" : "Error", description: j.message });
      if (j.success) await loadPlayerDetail(selectedPlayer.id);
    } finally { setActionPending(false); }
  };

  const deletePlayer = async () => {
    if (!selectedPlayer) return;
    const label = selectedPlayer.name || selectedPlayer.id;
    // Full account deletion is permanent and wipes everything (cards,
    // currency, RPG progress, roles, history) — a plain confirm() is too
    // easy to click through by accident for something this destructive.
    // Require the admin to type the player's id to proceed.
    const typed = window.prompt(
      `This will PERMANENTLY delete ${label} and ALL of their data (cards, currency, RPG progress, roles, history). This cannot be undone.\n\nType the player's ID (${selectedPlayer.id}) to confirm:`
    );
    if (typed !== selectedPlayer.id) {
      if (typed !== null) toast({ title: "Cancelled", description: "ID didn't match — player was not deleted." });
      return;
    }
    setActionPending(true);
    try {
      const r = await fetch(`${base}/api/v1/admin/players/${encodeURIComponent(selectedPlayer.id)}`, {
        method: "DELETE", headers: { ...authHeader },
      });
      const j = await r.json();
      toast({ title: j.success ? "Player Deleted" : "Error", description: j.message });
      if (j.success) {
        setSelectedPlayer(null);
        searchPlayers(playerQuery);
      }
    } finally { setActionPending(false); }
  };

  const requestPairingCode = async (botId: string) => {
    const phone = pairingPhones[botId]?.trim();
    if (!phone) { toast({ title: "Error", description: "Enter a phone number first." }); return; }
    setPairingLoading((prev) => ({ ...prev, [botId]: true }));
    try {
      const r = await fetch(`${base}/api/v1/admin/bots/${botId}/request-pairing`, {
        method: "POST", headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const j = await r.json();
      toast({ title: j.success ? "Pairing Code Requested" : "Error", description: j.message });
      if (j.success) fetchBotStatuses();
    } catch { toast({ title: "Error", description: "Failed to request pairing code." }); }
    finally { setPairingLoading((prev) => ({ ...prev, [botId]: false })); }
  };

  const botAction = async (id: string, action: string, label: string) => {
    setActionPending(true);
    try {
      const r = await fetch(`${base}/api/v1/admin/bots/${id}/${action}`, {
        method: "POST", headers: { ...authHeader, "Content-Type": "application/json" },
      });
      const j = await r.json();
      toast({ title: j.success ? label : "Error", description: j.message });
      fetchBotStatuses();
    } finally { setActionPending(false); }
  };

  const addBot = async () => {
    if (!newBotName.trim()) return;
    try {
      const r = await fetch(`${base}/api/v1/admin/bots`, {
        method: "POST", headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ name: newBotName, phone: newBotPhone }),
      });
      const j = await r.json();
      toast({ title: j.success ? "Bot added" : "Error", description: j.message });
      if (j.success) { setNewBotName(""); setNewBotPhone(""); fetchBotStatuses(); }
    } catch { toast({ title: "Error", description: "Failed to add bot." }); }
  };

  const removeBot = async (id: string, name: string) => {
    if (!confirm(`Remove bot "${name}"?`)) return;
    try {
      const r = await fetch(`${base}/api/v1/admin/bots/${id}`, { method: "DELETE", headers: authHeader });
      const j = await r.json();
      toast({ title: j.success ? "Removed" : "Error", description: j.message });
      if (j.success) fetchBotStatuses();
    } catch { toast({ title: "Error", description: "Failed." }); }
  };

  const uploadMenuImage = async (botId: string, file: File) => {
    const form = new FormData();
    form.append("image", file);
    try {
      const r = await fetch(`${base}/api/v1/admin/bots/${botId}/menu-image`, {
        method: "POST",
        headers: authHeader,
        body: form,
      });
      const j = await r.json();
      toast({ title: j.success ? "Image Uploaded" : "Error", description: j.message });
    } catch { toast({ title: "Error", description: "Upload failed." }); }
  };

  const toggleBotRole = async (bot: any, role: string) => {
    const roles: string[] = (() => { try { return JSON.parse(bot.roles || "[]"); } catch { return []; } })();
    const next = roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role];
    try {
      const r = await fetch(`${base}/api/v1/admin/bots/${bot.id}/roles`, {
        method: "POST", headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ roles: next }),
      });
      const j = await r.json();
      toast({ title: j.success ? "Updated" : "Error", description: j.message });
      if (j.success) fetchBotStatuses();
    } catch {}
  };

  const setBotPersonaChoice = async (botId: string, persona: string) => {
    try {
      const r = await fetch(`${base}/api/v1/admin/bots/${botId}/persona`, {
        method: "POST", headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ persona }),
      });
      const j = await r.json();
      toast({ title: j.success ? "Persona Updated" : "Error", description: j.message });
      if (j.success) fetchBotStatuses();
    } catch { toast({ title: "Error", description: "Failed to update persona." }); }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto" />
        <p className="text-muted-foreground font-mono text-sm tracking-widest">Loading…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass-card rounded-xl p-8 max-w-md text-center border border-rose-500/30">
        <AlertTriangle className="w-12 h-12 text-rose-400 mx-auto mb-4" />
        <h2 className="font-serif text-xl text-white mb-2">Error</h2>
        <p className="text-muted-foreground mb-6">{error}</p>
        <button onClick={fetchData} className="px-6 py-2 rounded border border-primary/30 text-primary text-sm font-bold uppercase tracking-widest hover:bg-primary/10 transition-colors">Retry</button>
      </div>
    </div>
  );

  const s = data?.stats;

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-8">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-primary/40 font-mono tracking-[0.4em] text-xs uppercase mb-1">反逆</p>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-white neon-text-sky tracking-widest uppercase">Admin Panel</h1>
          <p className="text-muted-foreground mt-1 text-sm">Requiem Order Operational Command Centre</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className={cn(
            "px-3 py-1 rounded-full border text-xs font-bold uppercase tracking-widest flex items-center gap-1.5",
            (Array.isArray(bots) && bots.some(b => b.status === "connected")) ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" : "bg-rose-500/15 border-rose-500/30 text-rose-400"
          )}>
            {Array.isArray(bots) && bots.some(b => b.status === "connected") ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {Array.isArray(bots) ? bots.filter(b => b.status === "connected").length : 0}/{Array.isArray(bots) ? bots.length : 0} Bot{(!Array.isArray(bots) || bots.length !== 1) ? "s" : ""} Online
          </div>
          <button onClick={fetchData} className="px-3 py-1 rounded-full bg-primary/10 border border-primary/25 text-primary text-xs font-bold uppercase tracking-widest hover:bg-primary/20 transition-colors flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          <button onClick={onLogout} className="px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/25 text-rose-400 text-xs font-bold uppercase tracking-widest hover:bg-rose-500/20 transition-colors flex items-center gap-1.5">
            <Lock className="w-3 h-3" /> Logout
          </button>
        </div>
      </div>

      {/* Database warning banner */}
      {data?._warning && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{data._warning}. Set <code className="font-mono text-xs bg-black/30 px-1 rounded">MONGODB_URI</code> in Secrets to see live data.</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-white/5 overflow-x-auto">
        {(["overview", "players", "bots", "cards", "frames"] as Tab[]).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={cn(
              "px-5 py-2.5 text-sm font-bold uppercase tracking-widest border-b-2 -mb-px transition-colors whitespace-nowrap",
              activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-white"
            )}>
            {tab === "overview" ? "Overview" : tab === "players" ? "Players" : tab === "bots" ? "Bot Manager" : tab === "frames" ? "Frames" : "Card Sync"}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === "overview" && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
            <StatTile icon={Users}      label="Members"  value={s?.totalUsers}  color="text-primary" />
            <StatTile icon={Bot}        label="Bots"     value={s?.totalBots}   color="text-teal-400" />
            <StatTile icon={CreditCard} label="Cards"    value={s?.totalCards}  color="text-rose-400" />
            <StatTile icon={Shield}     label="Guilds"   value={s?.totalGuilds} color="text-amber-400" />
            <StatTile icon={Crown}      label="Staff"    value={s?.totalStaff}  color="text-primary/70" />
            <StatTile icon={Ban}        label="Banned"   value={s?.totalBanned} color="text-rose-400" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Recent Members */}
            <section>
              <h2 className="font-serif text-xl font-bold text-white mb-4 flex items-center gap-2 border-b border-primary/15 pb-3">
                <Users className="w-5 h-5 text-primary" /> Recent Members
              </h2>
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1 custom-scroll">
                {data?.recentUsers?.length ? data.recentUsers.map((u: any) => (
                  <div key={u.id} onClick={() => { setActiveTab("players"); setPlayerQuery(u.phone || u.id.split("@")[0]); searchPlayers(u.phone || u.id.split("@")[0]); selectPlayer(u); }}
                    className="glass-card rounded-lg px-4 py-3 border border-white/5 flex items-center justify-between gap-3 hover:border-primary/20 transition-colors cursor-pointer">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-serif font-bold text-sm shrink-0">
                        {u.name?.charAt(0)?.toUpperCase() || "?"}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate">{u.name || "—"}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{u.display_id ? `#${u.display_id}` : (u.phone || u.id?.split("@")[0])}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono text-rose-400">Lv.{u.level}</span>
                      {u.role && <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border border-white/15 text-white/60">{u.role}</span>}
                      {u.is_banned ? <Ban className="w-3 h-3 text-rose-400" /> : null}
                    </div>
                  </div>
                )) : <div className="py-12 text-center text-muted-foreground">No members yet.</div>}
              </div>
            </section>

            <div className="space-y-8">
              {/* Top Players */}
              <section>
                <h2 className="font-serif text-xl font-bold text-white mb-4 flex items-center gap-2 border-b border-primary/15 pb-3">
                  <Trophy className="w-5 h-5 text-amber-400" /> Top Players
                </h2>
                <div className="space-y-2">
                  {data?.topUsers?.length ? data.topUsers.map((u: any, i: number) => (
                    <div key={u.id} className="glass-card rounded-lg px-4 py-3 border border-white/5 flex items-center justify-between hover:border-amber-400/20 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className={cn("font-mono text-sm font-bold w-6 text-center", [0,1,2].includes(i) ? ["text-amber-400","text-slate-300","text-amber-700"][i] : "text-muted-foreground")}>{i + 1}</span>
                        <p className="text-sm font-bold text-white">{u.name || "—"}</p>
                      </div>
                      <div className="flex items-center gap-3 text-xs font-mono">
                        <span className="text-rose-400">Lv.{u.level}</span>
                        <span className="text-amber-400">{(u.balance || 0).toLocaleString()}g</span>
                      </div>
                    </div>
                  )) : <p className="text-muted-foreground text-sm text-center py-4">No players yet.</p>}
                </div>
              </section>

              {/* Staff Roster */}
              <section>
                <h2 className="font-serif text-xl font-bold text-white mb-4 flex items-center gap-2 border-b border-primary/15 pb-3">
                  <Crown className="w-5 h-5 text-primary/70" /> Staff Roster
                </h2>
                <div className="space-y-2">
                  {data?.staffList?.length ? data.staffList.map((st: any, i: number) => (
                    <div key={i} className="glass-card rounded-lg px-4 py-3 border border-white/5 flex items-center justify-between hover:border-white/15 transition-colors">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate">{st.name || st.user_id?.split("@")[0] || "—"}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{st.phone || "—"}</p>
                      </div>
                      <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded border border-white/15 text-white/60 bg-white/5 shrink-0">{st.role}</span>
                    </div>
                  )) : <p className="text-muted-foreground text-sm text-center py-4">No staff assigned yet.</p>}
                </div>
              </section>
            </div>
          </div>

          {/* Danger Zone */}
          <section className="glass-card rounded-xl p-6 border border-rose-500/25 bg-rose-500/5">
            <h2 className="font-serif text-xl font-bold text-rose-400 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" /> Danger Zone
            </h2>
            <p className="text-sm text-muted-foreground mb-6">These actions are irreversible.</p>
            <div className="flex flex-wrap gap-4">
              <button disabled={actionPending}
                onClick={async () => {
                  if (!confirm("Reset ALL user balances to zero?")) return;
                  setActionPending(true);
                  try {
                    const r = await fetch(`${base}/api/v1/admin/reset-balance`, { method: "POST", headers: { ...authHeader, "Content-Type": "application/json" }, body: JSON.stringify({}) });
                    const j = await r.json();
                    toast({ title: j.success ? "Done" : "Error", description: j.message });
                  } finally { setActionPending(false); }
                }}
                className="px-6 py-2 rounded border border-rose-500/50 text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 text-sm font-bold uppercase tracking-widest transition-colors disabled:opacity-50">
                Reset All Balances
              </button>
            </div>
          </section>
        </>
      )}

      {/* ── PLAYERS TAB ── */}
      {activeTab === "players" && (
        <div className="space-y-6">
          {/* Search bar */}
          <section className="glass-card rounded-xl p-5 border border-primary/15">
            <h2 className="font-serif text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Search className="w-5 h-5 text-primary" /> Player Search
            </h2>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={playerQuery}
                  onChange={(e) => { setPlayerQuery(e.target.value); searchPlayers(e.target.value); }}
                  placeholder="Search by name or phone number…"
                  className="w-full pl-10 pr-4 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 text-sm"
                />
              </div>
              {playerQuery && (
                <button onClick={() => { setPlayerQuery(""); setPlayerResults([]); setSelectedPlayer(null); setPlayerDetail(null); }}
                  className="p-2.5 rounded-lg border border-white/10 text-muted-foreground hover:text-white hover:border-white/20 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Results list */}
            <div className="lg:col-span-2 space-y-2 max-h-[600px] overflow-y-auto pr-1 custom-scroll">
              {playerLoading && <p className="text-center text-muted-foreground text-sm py-8">Searching…</p>}
              {!playerLoading && playerResults.length === 0 && playerQuery && (
                <p className="text-center text-muted-foreground text-sm py-8">No players found.</p>
              )}
              {!playerLoading && playerResults.length === 0 && !playerQuery && (
                <p className="text-center text-muted-foreground text-sm py-8">Enter a name or phone number above.</p>
              )}
              {playerResults.map((p) => (
                <div key={p.id} onClick={() => selectPlayer(p)}
                  className={cn(
                    "glass-card rounded-lg px-4 py-3 border cursor-pointer transition-colors",
                    selectedPlayer?.id === p.id ? "border-primary/50 bg-primary/5" : "border-white/5 hover:border-primary/20"
                  )}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <PlayerAvatar playerId={p.id} name={p.name} base={base} token={token} size={32} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-white truncate">{p.name || "—"}</p>
                          {p.is_banned ? <Ban className="w-3 h-3 text-rose-400 shrink-0" /> : null}
                          {!p.registered ? <span className="text-[9px] text-yellow-400 border border-yellow-400/30 px-1 rounded">unregistered</span> : null}
                        </div>
                        <p className="text-[10px] text-muted-foreground font-mono">{p.display_id ? `#${p.display_id}` : (p.phone || p.id?.split("@")[0])}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono text-rose-400">Lv.{p.dungeonFloor ?? p.level ?? 1}</span>
                      {p.role && <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border border-white/15 text-white/60">{p.role}</span>}
                      <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Player detail panel */}
            <div className="lg:col-span-3">
              {!selectedPlayer ? (
                <div className="glass-card rounded-xl border border-white/5 h-full flex items-center justify-center p-12">
                  <p className="text-muted-foreground text-sm text-center">Select a player to view details and actions.</p>
                </div>
              ) : (
                <div className="glass-card rounded-xl border border-primary/15 p-5 space-y-5">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <PlayerAvatar playerId={selectedPlayer.id} name={playerDetail?.player?.name || selectedPlayer.name} base={base} token={token} size={48} />
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-serif text-xl font-bold text-white">{playerDetail?.player?.name || selectedPlayer.name || "—"}</h3>
                          {(playerDetail?.player?.is_banned || selectedPlayer.is_banned) ? (
                            <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded border border-rose-500/30 text-rose-400 bg-rose-500/10">Banned</span>
                          ) : (
                            <span className="text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-400 bg-emerald-500/10">Active</span>
                          )}
                          {(playerDetail?.player?.staff_role || selectedPlayer.role) && (
                            <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded border border-white/15 text-white/60">{playerDetail?.player?.staff_role || selectedPlayer.role}</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono mt-1">{selectedPlayer.display_id ? `#${selectedPlayer.display_id}` : (selectedPlayer.phone || selectedPlayer.id?.split("@")[0])}</p>
                      </div>
                    </div>
                    <button onClick={() => loadPlayerDetail(selectedPlayer.id)} className="p-1.5 rounded text-muted-foreground hover:text-primary transition-colors">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Stats */}
                  {playerDetail && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <MiniStat label="Dungeon Lvl" value={`${playerDetail.player?.dungeonFloor ?? playerDetail.player?.level ?? 1}`} color="text-rose-400" />
                      <MiniStat label="XP" value={(playerDetail.player?.xp || 0).toLocaleString()} color="text-teal-400" />
                      <MiniStat label="Wallet" value={`$${(playerDetail.player?.balance || 0).toLocaleString()}`} color="text-amber-400" />
                      <MiniStat label="Bank" value={`$${(playerDetail.player?.bank || 0).toLocaleString()}`} color="text-amber-300" />
                    </div>
                  )}

                  {/* Cards — full list with per-card removal */}
                  {playerDetail && (
                    <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Cards ({playerDetail.cards?.length || 0})</p>
                        {playerDetail.cards?.length > 0 && (
                          <button onClick={clearAllCards} disabled={actionPending}
                            className="text-[10px] uppercase tracking-widest font-bold text-rose-400 hover:text-rose-300 disabled:opacity-50">
                            Clear All
                          </button>
                        )}
                      </div>
                      <div className="max-h-64 overflow-y-auto custom-scroll space-y-1">
                        {playerDetail.cards?.map((c: any) => (
                          <div key={c.uc_id} className="flex items-center justify-between gap-2 text-xs bg-black/20 rounded px-2 py-1.5 border border-white/5">
                            <p className="text-white/80 truncate">
                              {c.name || "Unknown card"} <span className="text-primary/60">[{c.tier || "?"}]</span>
                              {c.series && <span className="text-muted-foreground/60"> · {c.series}</span>}
                            </p>
                            <button onClick={() => deleteCard(c.uc_id, c.name || "this card")} disabled={actionPending}
                              className="shrink-0 p-1 rounded text-muted-foreground hover:text-rose-400 transition-colors disabled:opacity-50" title="Remove this card">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        {!playerDetail.cards?.length && <p className="text-muted-foreground/60 text-xs">None</p>}
                      </div>
                    </div>
                  )}

                  {/* Inventory + Warnings quick view */}
                  {playerDetail && (
                    <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                      <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                        <p className="text-[10px] uppercase tracking-widest mb-1">Inventory ({playerDetail.inventory?.length || 0})</p>
                        {playerDetail.inventory?.slice(0, 3).map((i: any, idx: number) => (
                          <p key={idx} className="text-white/70 truncate">{i.item} <span className="text-primary/60">×{i.quantity}</span></p>
                        ))}
                        {playerDetail.inventory?.length > 3 && <p className="text-primary/50">+{playerDetail.inventory.length - 3} more</p>}
                        {!playerDetail.inventory?.length && <p className="text-muted-foreground/60">None</p>}
                      </div>
                      <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                        <p className="text-[10px] uppercase tracking-widest mb-1">Warnings ({playerDetail.warnings?.length || 0})</p>
                        {playerDetail.warnings?.slice(0, 3).map((w: any, i: number) => (
                          <p key={i} className="text-rose-400/70 truncate">{w.reason || "No reason"}</p>
                        ))}
                        {!playerDetail.warnings?.length && <p className="text-muted-foreground/60">None</p>}
                      </div>
                    </div>
                  )}

                  {/* Admin actions */}
                  <div className="border-t border-white/5 pt-4 space-y-4">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Admin Actions</p>

                    {/* Ban / Unban */}
                    <div className="flex gap-2 flex-wrap">
                      {(playerDetail?.player?.is_banned || selectedPlayer.is_banned) ? (
                        <ActionBtn icon={<Shield className="w-3.5 h-3.5" />} label="Unban" color="emerald"
                          onClick={() => playerAction("unban", {}, "Unban")} disabled={actionPending} />
                      ) : (
                        <ActionBtn icon={<Ban className="w-3.5 h-3.5" />} label="Ban" color="rose"
                          onClick={() => playerAction("ban", { reason: "Admin ban" }, "Ban")} disabled={actionPending} />
                      )}
                      <ActionBtn icon={<RotateCcw className="w-3.5 h-3.5" />} label="Clear Cooldowns" color="sky"
                        onClick={() => playerAction("clear-cooldowns", {}, "Clear Cooldowns")} disabled={actionPending} />
                      <ActionBtn icon={<Zap className="w-3.5 h-3.5" />} label="Reset Economy" color="amber"
                        onClick={() => { if (confirm("Reset balance and inventory?")) playerAction("reset", {}, "Reset"); }} disabled={actionPending} />
                    </div>

                    {/* Add / Remove Coins */}
                    <div className="flex gap-2 items-center flex-wrap">
                      <input type="number" placeholder="Amount (neg. to remove)"
                        value={coinAmount} onChange={(e) => setCoinAmount(e.target.value)}
                        className="w-44 px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-primary/50 font-mono" />
                      <select value={coinTarget} onChange={(e) => setCoinTarget(e.target.value as any)}
                        className="px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-primary/50">
                        <option value="wallet">Wallet</option>
                        <option value="bank">Bank</option>
                      </select>
                      <button disabled={actionPending || !coinAmount}
                        onClick={() => { playerAction("coins", { amount: Number(coinAmount), target: coinTarget }, "Coins updated"); setCoinAmount(""); }}
                        className="px-4 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary text-sm font-bold uppercase tracking-wider hover:bg-primary/20 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5" /> Apply
                      </button>
                    </div>

                    {/* Change Role */}
                    <div className="flex gap-2 items-center flex-wrap">
                      <select value={roleValue} onChange={(e) => setRoleValue(e.target.value)}
                        className="px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-primary/50">
                        <option value="user">User</option>
                        <option value="guardian">Guardian</option>
                        <option value="mod">Mod</option>
                        <option value="owner">Owner</option>
                      </select>
                      <button disabled={actionPending}
                        onClick={() => playerAction("role", { role: roleValue }, "Role updated")}
                        className="px-4 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary text-sm font-bold uppercase tracking-wider hover:bg-primary/20 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                        <Crown className="w-3.5 h-3.5" /> Set Role
                      </button>
                    </div>

                    {/* Danger Zone — full account deletion, kept visually
                        separate from routine actions since it's permanent
                        and cannot be reversed. */}
                    <div className="border-t border-rose-500/20 pt-4">
                      <p className="text-[10px] uppercase tracking-widest text-rose-400/70 mb-2">Danger Zone</p>
                      <button disabled={actionPending} onClick={deletePlayer}
                        className="px-4 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-400 text-sm font-bold uppercase tracking-wider hover:bg-rose-500/20 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                        <Trash2 className="w-3.5 h-3.5" /> Delete Player Permanently
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── BOT MANAGER TAB ── */}
      {activeTab === "bots" && (
        <div className="space-y-6">
          {/* Register new bot */}
          <section className="glass-card rounded-xl p-6 border border-primary/15">
            <h2 className="font-serif text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" /> Register New Bot (max 5)
            </h2>
            <div className="flex flex-col sm:flex-row gap-3">
              <input type="text" placeholder="Bot name (e.g. REQUIEM ORDER Main)"
                value={newBotName} onChange={(e) => setNewBotName(e.target.value)}
                className="flex-1 px-4 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 text-sm" />
              <input type="text" placeholder="Phone number (with country code)"
                value={newBotPhone} onChange={(e) => setNewBotPhone(e.target.value)}
                className="w-full sm:w-56 px-4 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 text-sm font-mono" />
              <button onClick={addBot} disabled={!newBotName.trim()}
                className="px-6 py-2.5 rounded-lg bg-primary/20 border border-primary/40 text-primary font-bold uppercase tracking-widest text-sm hover:bg-primary/30 transition-colors disabled:opacity-50 shrink-0">
                Add Bot
              </button>
            </div>
          </section>

          {/* Bot list */}
          <section>
            <h2 className="font-serif text-xl font-bold text-white mb-4 flex items-center gap-2 border-b border-primary/15 pb-3">
              <Bot className="w-5 h-5 text-teal-400" /> Registered Bots ({bots.length}/5)
            </h2>
            <p className="text-xs text-muted-foreground mb-4 -mt-2">
              Each linked WhatsApp number is its own bot with its own AI companion personality. Assign a persona below — Echidna or Euphemia — independently per bot.
            </p>
            {bots.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">No bots registered yet. Add one above.</div>
            ) : (
              <div className="space-y-4">
                {bots.map((bot) => {
                  const roles: string[] = Array.isArray(bot.roles) ? bot.roles : [];
                  const hasOtp = roles.includes("otp");
                  const statusColor = bot.status === "connected" ? "emerald" : bot.status === "pairing" ? "amber" : bot.status === "connecting" ? "sky" : "rose";
                  const statusLabel = bot.status === "connected" ? "Connected" : bot.status === "pairing" ? "Pairing" : bot.status === "connecting" ? "Connecting…" : "Offline";
                  return (
                    <div key={bot.id} className="glass-card rounded-xl px-5 py-5 border border-white/5 hover:border-primary/20 transition-colors space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p className="text-base font-bold text-white">{bot.name}</p>
                            {bot.isPrimary && (
                              <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-primary/40 text-primary bg-primary/10 font-bold flex items-center gap-0.5">
                                <Star className="w-2.5 h-2.5" /> Primary
                              </span>
                            )}
                            <span className={cn(
                              "text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border font-bold",
                              statusColor === "emerald" ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" :
                              statusColor === "amber"   ? "border-white/20 text-white/70 bg-white/5" :
                              statusColor === "sky"     ? "border-rose-500/30 text-rose-400 bg-rose-500/10" :
                                                         "border-rose-500/30 text-rose-400 bg-rose-500/10"
                            )}>{statusLabel}</span>
                            <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-white/15 text-white/50 bg-white/5 font-bold">
                              {(personas.find(p => p.key === (bot.persona || "echidna"))?.shortLabel) || bot.persona || "Echidna"}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground font-mono">{bot.phone || "No phone set"} · ID: {bot.id}</p>
                        </div>
                        <button onClick={() => removeBot(bot.id, bot.name)}
                          className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0" title="Remove bot">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Pairing code display */}
                      {bot.pairingCode && (
                        <div className="bg-primary/5 border border-primary/30 rounded-lg px-4 py-3">
                          <p className="text-[10px] uppercase tracking-widest text-primary/60 mb-1">Enter this code in WhatsApp → Linked Devices → Link a Device</p>
                          <p className="font-mono text-2xl font-bold text-primary tracking-[0.4em]">{bot.pairingCode}</p>
                        </div>
                      )}

                      {/* Request pairing code (when connected or no pairing code showing) */}
                      {!bot.pairingCode && bot.status !== "connected" && (
                        <div className="bg-white/3 border border-white/10 rounded-lg px-4 py-3 space-y-2">
                          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Request Pairing Code</p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="Phone with country code e.g. 2348144550593"
                              value={pairingPhones[bot.id] || ""}
                              onChange={(e) => setPairingPhones((prev) => ({ ...prev, [bot.id]: e.target.value }))}
                              className="flex-1 px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 text-xs font-mono"
                            />
                            <button
                              onClick={() => requestPairingCode(bot.id)}
                              disabled={pairingLoading[bot.id] || !pairingPhones[bot.id]?.trim()}
                              className="px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs font-bold uppercase tracking-wider hover:bg-primary/20 disabled:opacity-50 transition-colors whitespace-nowrap">
                              {pairingLoading[bot.id] ? "Requesting…" : "Get Code"}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex flex-wrap gap-2">
                        {(bot.status === "disconnected" || bot.status === "offline") && (
                          <button onClick={() => botAction(bot.id, "start", "Bot starting")} disabled={actionPending}
                            className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 text-white/80 font-bold uppercase tracking-wider hover:bg-white/10 disabled:opacity-50 transition-colors">
                            Start / Pair
                          </button>
                        )}
                        {(bot.status === "connected" || bot.status === "connecting" || bot.status === "pairing") && (
                          <button onClick={() => botAction(bot.id, "stop", "Bot stopped")} disabled={actionPending}
                            className="text-xs px-3 py-1.5 rounded-lg bg-rose-400/10 border border-rose-400/30 text-rose-400 font-bold uppercase tracking-wider hover:bg-rose-400/20 disabled:opacity-50 transition-colors">
                            Stop
                          </button>
                        )}
                        {!bot.isPrimary && (
                          <button onClick={() => botAction(bot.id, "set-primary", "Primary set")} disabled={actionPending}
                            className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 text-white/70 font-bold uppercase tracking-wider hover:bg-white/10 disabled:opacity-50 transition-colors flex items-center gap-1">
                            <Star className="w-3 h-3" /> Set Primary
                          </button>
                        )}
                        <button onClick={() => toggleBotRole(bot, "otp")} disabled={actionPending}
                          className={cn(
                            "text-xs px-3 py-1.5 rounded-lg border font-bold uppercase tracking-wider transition-colors",
                            hasOtp ? "bg-rose-400/10 border-rose-400/30 text-rose-400 hover:bg-rose-400/20" : "bg-white/5 border-white/10 text-muted-foreground hover:border-white/20 hover:text-white"
                          )}>
                          {hasOtp ? "✓ OTP Role" : "+ OTP Role"}
                        </button>
                        <label className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 text-white/70 font-bold uppercase tracking-wider hover:bg-white/10 transition-colors cursor-pointer">
                          📷 Menu Image
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) { uploadMenuImage(bot.id, file); e.target.value = ""; }
                          }} />
                        </label>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-400/5 border border-rose-400/20">
                          <span className="text-[10px] uppercase tracking-widest text-rose-400/70 font-bold whitespace-nowrap">Persona</span>
                          <select
                            value={bot.persona || "echidna"}
                            onChange={(e) => setBotPersonaChoice(bot.id, e.target.value)}
                            disabled={actionPending}
                            className="bg-black/40 border border-rose-400/30 rounded text-rose-300 text-xs font-bold px-2 py-1 focus:outline-none focus:border-rose-400/60"
                          >
                            {(personas.length ? personas : [{ key: "echidna", shortLabel: "Echidna", displayName: "Echidna" }, { key: "euphemia", shortLabel: "Euphemia", displayName: "Euphemia li Britannia" }]).map((p) => (
                              <option key={p.key} value={p.key} className="bg-black text-white">{p.shortLabel}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── CARDS TAB ── */}
      {activeTab === "cards" && (
        <div className="space-y-6">
          <CardSyncPanel />
        </div>
      )}

      {/* ── FRAMES TAB ── */}
      {activeTab === "frames" && (
        <div className="space-y-6">
          <AdminFramesPanel token={token} base={base} toast={toast} />
        </div>
      )}
    </div>
  );
}


function AdminFramesPanel({ token, base, toast }: { token: string; base: string; toast: ReturnType<typeof useToast>["toast"] }) {
  const [frames, setFrames] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadTheme, setUploadTheme] = useState("custom");
  const fileRef = useRef<HTMLInputElement>(null);
  const authHeader = { Authorization: `Bearer ${token}` };

  const fetchFrames = useCallback(async () => {
    try {
      const r = await fetch(`${base}/api/v1/frames`, { headers: authHeader });
      const j = await r.json();
      if (j.success) setFrames(j.frames || []);
    } catch {} finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchFrames(); }, [fetchFrames]);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !uploadName.trim()) {
      toast({ title: "Missing info", description: "Enter a name and select a PNG file.", variant: "destructive" });
      return;
    }
    setUploading(true);
    const form = new FormData();
    form.append("frame", file);
    form.append("name", uploadName.trim());
    form.append("theme", uploadTheme.trim() || "custom");
    try {
      const res = await fetch(`${base}/api/v1/frames/upload`, { method: "POST", headers: authHeader, body: form });
      const j = await res.json();
      if (j.success) {
        toast({ title: "✅ Frame Uploaded", description: `"${uploadName}" added to the frame library.` });
        setUploadName(""); setUploadTheme("custom");
        if (fileRef.current) fileRef.current.value = "";
        fetchFrames();
      } else {
        toast({ title: "Upload Failed", description: j.message || "Could not upload frame.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Upload request failed.", variant: "destructive" });
    } finally { setUploading(false); }
  };

  const deleteFrame = async (id: string, name: string) => {
    if (!window.confirm(`Delete frame "${name}"?`)) return;
    try {
      const res = await fetch(`${base}/api/v1/frames/${id}`, { method: "DELETE", headers: authHeader });
      const j = await res.json();
      if (j.success) {
        toast({ title: "Deleted", description: `Frame "${name}" removed.` });
        fetchFrames();
      } else {
        toast({ title: "Error", description: j.message || "Could not delete frame.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Delete request failed.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload new frame */}
      <section className="glass-card rounded-xl p-6 border border-white/8">
        <h2 className="font-serif text-xl font-bold text-white mb-1 flex items-center gap-2">
          <Plus className="w-5 h-5 text-primary/70" /> Upload New Frame
        </h2>
        <p className="text-muted-foreground text-sm mb-5">
          Upload a 220×220 PNG with transparent interior — the ring/border occupies the outer ~30px.
          The transparent center lets the user's profile picture show through.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <input
            type="text"
            placeholder="Frame name (e.g. Rainbow Ring)"
            value={uploadName}
            onChange={e => setUploadName(e.target.value)}
            className="px-3 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 text-sm"
          />
          <input
            type="text"
            placeholder="Theme tag (e.g. neon, sakura, custom)"
            value={uploadTheme}
            onChange={e => setUploadTheme(e.target.value)}
            className="px-3 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 text-sm"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="text-sm text-muted-foreground file:mr-3 file:py-2 file:px-3 file:rounded-md file:border file:border-white/20 file:bg-white/5 file:text-white/70 file:text-xs file:cursor-pointer"
          />
        </div>
        <button
          onClick={handleUpload}
          disabled={uploading || !uploadName.trim()}
          className="px-6 py-2.5 rounded-lg bg-primary/20 border border-primary/40 text-primary font-bold uppercase tracking-widest text-sm hover:bg-primary/30 transition-colors disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload Frame"}
        </button>
      </section>

      {/* Frame library */}
      <section className="glass-card rounded-xl p-6 border border-primary/15">
        <div className="flex items-center justify-between mb-5 border-b border-primary/15 pb-4">
          <h2 className="font-serif text-xl font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" /> Frame Library ({frames.length})
          </h2>
          <button onClick={fetchFrames} className="text-xs text-muted-foreground hover:text-white border border-white/10 hover:border-white/30 px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {[1,2,3,4,5].map(i => <div key={i} className="h-48 bg-white/5 animate-pulse rounded-xl" />)}
          </div>
        ) : frames.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No frames uploaded yet.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {frames.map((frame: any) => (
              <div key={frame.id} className="relative group flex flex-col items-center gap-3 p-4 rounded-xl border border-white/10 bg-black/30 hover:border-primary/30 transition-all duration-200">
                <div className="w-20 h-20 rounded-full overflow-hidden bg-black/50 border border-white/10 flex items-center justify-center">
                  <img
                    src={`${base}/api/v1/frames/${frame.id}/image`}
                    alt={frame.name}
                    className="w-full h-full object-contain"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
                  />
                </div>
                <div className="text-center flex-1">
                  <p className="text-sm font-semibold text-white leading-tight">{frame.name}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{frame.theme}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">ID: #{frame.id}</p>
                  {frame.isSystem && (
                    <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-primary/30 text-primary bg-primary/10 font-bold mt-1 inline-block">
                      {frame.isProtected ? "Default" : "Bulk Import"}
                    </span>
                  )}
                </div>
                {!frame.isProtected && (
                  <button
                    onClick={() => deleteFrame(frame.id, frame.name)}
                    className="absolute top-2 right-2 p-1.5 rounded-md text-rose-400 bg-black/50 border border-rose-500/30 hover:bg-rose-500/20 hover:border-rose-500/60 transition-all"
                    title="Delete frame"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-4">
          Users equip frames from their <span className="font-mono text-primary">Profile → Frames</span> tab on the web, or via <span className="font-mono text-primary">.frame &lt;id&gt;</span> in the bot.
        </p>
      </section>
    </div>
  );
}


function CardSyncPanel() {
  const { toast } = useToast();
  const token = getAdminToken();
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [dbCount, setDbCount] = useState<number | null>(null);
  const [eventCount, setEventCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);

  const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

  const fetchCount = async () => {
    setCountLoading(true);
    try {
      const [cardsRes, eventsRes] = await Promise.all([
        fetch("/api/v1/cards/from-json?limit=1"),
        fetch("/api/events?limit=1"),
      ]);
      const cardsJ = await cardsRes.json();
      const eventsJ = await eventsRes.json();
      setDbCount(typeof cardsJ.total === "number" ? cardsJ.total : null);
      setEventCount(typeof eventsJ.count === "number" ? eventsJ.count : null);
    } catch {
      setDbCount(null);
      setEventCount(null);
    } finally {
      setCountLoading(false);
    }
  };

  useEffect(() => { fetchCount(); }, []);

  const [syncStatus, setSyncStatus] = useState<any>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollStatus = async () => {
    try {
      const res = await fetch("/api/v1/cards/reload-status", { headers: authHeader });
      const j = await res.json();
      setSyncStatus(j);
      if (!j.running) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setSyncing(false);
        if (j.lastError) {
          toast({ title: "❌ Sync Failed", description: j.lastError, variant: "destructive" });
        } else if (j.lastResult) {
          setLastResult({ success: true, ...j.lastResult });
          toast({ title: "✅ Sync Complete", description: `Imported ${j.lastResult.imported ?? 0}, updated ${j.lastResult.updated ?? 0}, skipped ${j.lastResult.skipped ?? 0}.` });
        }
        fetchCount();
      }
    } catch {
      // transient — keep polling, don't tear down on one failed check
    }
  };

  useEffect(() => {
    // On mount, check if a sync is already running (e.g. the admin
    // reloaded the page mid-sync) and resume polling instead of letting
    // them think nothing is happening.
    (async () => {
      try {
        const res = await fetch("/api/v1/cards/reload-status", { headers: authHeader });
        const j = await res.json();
        if (j.running) {
          setSyncing(true);
          setSyncStatus(j);
          pollRef.current = setInterval(pollStatus, 2000);
        }
      } catch { /* ignore */ }
    })();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setLastResult(null);
    setSyncStatus(null);
    try {
      const res = await fetch("/api/v1/cards/reload-from-json", {
        method: "POST",
        headers: { ...authHeader },
      });
      const j = await res.json();
      if (j.alreadyRunning) {
        toast({ title: "Sync already running", description: "Tracking the in-progress sync instead of starting a new one." });
      } else if (!j.success) {
        toast({ title: "❌ Sync Failed", description: j.message || "Reload failed.", variant: "destructive" });
        setSyncing(false);
        return;
      }
      // The request returns immediately now — the actual sync runs in the
      // background on the server. Poll for progress instead of waiting on
      // this one request, which is what used to time out on anything but
      // a tiny card catalog.
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(pollStatus, 2000);
      pollStatus();
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Request failed", variant: "destructive" });
      setSyncing(false);
    }
  };

  const [wiping, setWiping] = useState(false);
  const handleWipe = async () => {
    if (!window.confirm(
      "This will permanently delete every card document from the database (not cards players already own — just the catalog). " +
      "Only do this if a normal re-sync isn't fixing a stuck count. Continue?"
    )) return;
    setWiping(true);
    try {
      const res = await fetch("/api/v1/cards/wipe-cards", { method: "POST", headers: { ...authHeader } });
      const j = await res.json();
      toast({
        title: j.success ? "🗑️ Cards Wiped" : "❌ Wipe Failed",
        description: j.message,
        variant: j.success ? undefined : "destructive",
      });
      if (j.success) {
        await fetchCount();
        setWiping(false);
        // Kick off the re-sync the same fire-and-poll way as the normal
        // button, rather than awaiting one long-lived request.
        handleSync();
        return;
      }
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "Request failed", variant: "destructive" });
    }
    setWiping(false);
  };

  return (
    <div className="space-y-6">
      <section className="glass-card rounded-xl p-6 border border-white/8">
        <h2 className="font-serif text-xl font-bold text-white mb-1 flex items-center gap-2">
          <Download className="w-5 h-5 text-primary/70" /> Card Database Sync
        </h2>
        <p className="text-muted-foreground text-sm mb-6">
          Cards are managed by editing <code className="text-primary/80">cards.json</code> / <code className="text-primary/80">mazoku_cards.json</code> and
          running <code className="text-primary/80">merge_cards.js</code> to regenerate <code className="text-primary/80">unified_cards.jsonl</code>. Pushing
          that file to the server does NOT update the live database by itself — the server only re-reads it automatically on a fresh boot. Use this button
          to re-sync the database immediately after a deploy, without waiting for or forcing a restart.
        </p>

        <div className="flex items-center gap-4 mb-6">
          <div className="glass-card rounded-lg px-4 py-3 border border-white/8">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Cards currently in database</p>
            <p className="text-2xl font-bold text-white">
              {countLoading ? "…" : dbCount !== null ? dbCount.toLocaleString() : "Unknown"}
            </p>
          </div>
          <div className="glass-card rounded-lg px-4 py-3 border border-pink-500/20">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Event cards live</p>
            <p className="text-2xl font-bold text-pink-400">
              {countLoading ? "…" : eventCount !== null ? eventCount.toLocaleString() : "Unknown"}
            </p>
          </div>
          <Button variant="outline" onClick={fetchCount} disabled={countLoading} className="border-white/10">
            <RefreshCw className={`w-4 h-4 ${countLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleSync} disabled={syncing || wiping} className="bg-primary hover:bg-primary/90">
            {syncing ? "Syncing…" : "Re-sync Now from unified_cards.jsonl"}
          </Button>
          <Button onClick={handleWipe} disabled={syncing || wiping} variant="outline" className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10">
            {wiping ? "Wiping…" : "⚠️ Wipe & Re-sync"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground/70 mt-2">
          Only use "Wipe & Re-sync" if a normal re-sync keeps showing 0 imported/updated despite the file having changed — it clears the card catalog
          completely (never touches cards players already own) and immediately rebuilds it from scratch.
        </p>

        {syncing && syncStatus?.running && (
          <div className="mt-4 pt-4 border-t border-white/8">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span>Syncing — this can take a few minutes for the full catalog, no need to press the button again</span>
              <span>{syncStatus.processed?.toLocaleString() ?? 0}{syncStatus.total ? ` / ~${syncStatus.total.toLocaleString()}` : ""}</span>
            </div>
            <div className="h-2 rounded-full bg-black/40 overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{
                  width: syncStatus.total ? `${Math.min(100, (syncStatus.processed / syncStatus.total) * 100)}%` : "30%",
                }}
              />
            </div>
          </div>
        )}

        {lastResult && !syncing && (
          <div className="mt-4 text-sm text-muted-foreground border-t border-white/8 pt-4">
            {lastResult.success ? (
              <p>Imported: <span className="text-white">{lastResult.imported ?? 0}</span> · Updated: <span className="text-white">{lastResult.updated ?? 0}</span> · Skipped: <span className="text-white">{lastResult.skipped ?? 0}</span></p>
            ) : (
              <p className="text-red-400">{lastResult.message || "Sync failed."}</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, color }: { icon: any; label: string; value: any; color: string }) {
  return (
    <div className="glass-card rounded-xl p-5 border border-primary/8 hover:border-primary/20 transition-all">
      <Icon className={cn("w-5 h-5 mb-3", color)} />
      <p className={cn("text-2xl font-mono font-bold mb-1", color)}>{value ?? 0}</p>
      <p className="text-xs text-muted-foreground uppercase tracking-widest">{label}</p>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-black/20 rounded-lg p-3 border border-white/5 text-center">
      <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">{label}</p>
      <p className={cn("text-sm font-mono font-bold", color)}>{value}</p>
    </div>
  );
}

function ActionBtn({ icon, label, color, onClick, disabled }: {
  icon: React.ReactNode; label: string; color: string; onClick: () => void; disabled?: boolean;
}) {
  const cls = color === "rose"    ? "bg-rose-400/10 border-rose-400/30 text-rose-400 hover:bg-rose-400/20"
            : color === "emerald" ? "bg-emerald-400/10 border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/20"
            : color === "sky"     ? "bg-rose-400/10 border-rose-400/30 text-rose-400 hover:bg-rose-400/20"
            :                       "bg-amber-400/10 border-amber-400/30 text-amber-400 hover:bg-amber-400/20";
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn("text-xs px-3 py-1.5 rounded-lg border font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 disabled:opacity-50", cls)}>
      {icon} {label}
    </button>
  );
}
