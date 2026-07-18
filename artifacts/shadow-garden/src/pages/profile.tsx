import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useGetUserStats, useGetUserInventory, useGetUserAchievements } from "@workspace/api-client-react/src/generated/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Trophy, Wallet, Landmark, Shield, Swords, Zap, Activity, Ticket, Layers, Upload, CheckCircle2, ImagePlus, UserCircle2, LogOut, BarChart2, Package, Palette, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react/src/custom-fetch";
import { useRef, useState, useEffect } from "react";

/** Fetch an auth-gated image/video URL and return a local blob URL.
 *  Returns null while loading. Revokes the old blob URL on cleanup. */
function useAuthMedia(apiPath: string | null, token: string | null, cacheBust?: number): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!apiPath || !token) { setBlobUrl(null); return; }
    let cancelled = false;
    const url = cacheBust !== undefined ? `${apiPath}?t=${cacheBust}` : apiPath;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return objectUrl; });
      })
      .catch(() => { if (!cancelled) setBlobUrl(null); });
    return () => { cancelled = true; };
  }, [apiPath, token, cacheBust]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return blobUrl;
}

const PROFILE_TABS = [
  { value: "overview",     label: "Overview",     icon: BarChart2,    desc: "Stats, guild & combat overview" },
  { value: "skills",       label: "Skills",       icon: Zap,          desc: "Allocate skill points" },
  { value: "inventory",    label: "Inventory",    icon: Package,      desc: "Items & collectibles" },
  { value: "frames",       label: "Frames",       icon: Layers,       desc: "Profile picture frames" },
  { value: "appearance",   label: "Appearance",   icon: Palette,      desc: "Avatar & banner image" },
  { value: "achievements", label: "Achievements", icon: Star,         desc: "Badges & milestones" },
] as const;
type ProfileTab = typeof PROFILE_TABS[number]["value"];

export default function Profile() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, user, token, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");

  // Cache-busters live here (in the root component) so the header
  // avatar/banner and the AppearanceTab edit panel both refresh together.
  // Initialise to Date.now() so the image is always fetched fresh on mount /
  // page refresh — a value of 0 caused the hook to skip the fetch on first
  // render because 0 is falsy in the ?t=0 query string path.
  const [ppCacheBust, setPpCacheBust] = useState<number>(() => Date.now());
  const [bgCacheBust, setBgCacheBust] = useState<number>(() => Date.now());

  if (!isAuthenticated) {
    setLocation("/login");
    return null;
  }

  const { data: stats, isLoading: statsLoading } = useGetUserStats({ query: { enabled: isAuthenticated } as any });
  const { data: inventoryData, isLoading: invLoading } = useGetUserInventory({ query: { enabled: isAuthenticated } as any });
  const { data: achievementsData, isLoading: achLoading } = useGetUserAchievements({ query: { enabled: isAuthenticated } as any });

  const avatarUrl = useAuthMedia("/api/v1/user/avatar", token, ppCacheBust);
  const bgUrl = useAuthMedia("/api/v1/user/background", token, bgCacheBust);
  // Frame — fetched separately so it re-renders when equipped/removed
  const { data: myFrameData } = useQuery({
    queryKey: ["my-frame"],
    queryFn: () => customFetch<{ success: boolean; frame: any }>("/api/v1/frames/me"),
    enabled: !!token,
  });
  const equippedFrameId: number | null = myFrameData?.frame?.id ?? null;

  const progressPercentage = stats ? (stats.profile.xp / stats.xpNeeded) * 100 : 0;

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Header Profile Card */}
      <div className="rounded-xl relative overflow-hidden border border-primary/20 shadow-[0_0_60px_rgba(160,0,26,0.08)]">
        {/* Background image banner */}
        <div className="relative h-36 md:h-48 w-full overflow-hidden">
          {bgUrl ? (
            <img
              src={bgUrl}
              alt="profile background"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#050510] via-[#1a0a2e] to-[#0a0005]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/30 to-black/80" />
          <p className="absolute top-4 right-4 text-white/20 font-mono text-4xl font-bold select-none drop-shadow">反逆</p>
          <button
            onClick={logout}
            className="absolute top-4 left-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/40 border border-white/15 text-white/80 text-xs font-bold uppercase tracking-wider hover:bg-rose-500/20 hover:border-rose-400/40 hover:text-rose-300 transition-colors backdrop-blur-sm z-10"
            title="Log out"
          >
            <LogOut className="w-3.5 h-3.5" /> Log Out
          </button>
        </div>

        {/* Content area */}
        <div className="glass-card p-6 md:p-8 relative">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />

        <div className="relative z-10 flex flex-col md:flex-row items-center md:items-start gap-6">
          {/* Avatar + frame ring - pulled up to overlap the banner */}
          <div className="-mt-20 md:-mt-24 shrink-0 relative w-32 h-32 md:w-44 md:h-44 flex items-center justify-center">
            {/* Outer glow shadow ring */}
            <div className="absolute inset-0 rounded-full shadow-[0_0_32px_6px_rgba(160,0,26,0.45)] pointer-events-none z-10" />
            {/* Profile picture — sized smaller than the outer container so an
                equipped frame's ring has real room to sit outside the
                avatar's edge instead of overlapping the face. Without this
                gap the ring and the avatar occupy the exact same box and
                the frame visibly cuts across the portrait instead of
                framing it. */}
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="avatar"
                className="w-24 h-24 md:w-32 md:h-32 rounded-full object-cover border-4 border-black relative z-0"
              />
            ) : (
              <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-black border-4 border-black flex items-center justify-center text-4xl md:text-5xl font-serif text-primary relative z-0">
                {stats?.profile.name?.charAt(0).toUpperCase() ?? "?"}
              </div>
            )}
            {/* Frame ring — fills the full, larger outer container, so its
                ring art sits around the avatar's outer edge rather than on
                top of it. Always goes through our own
                /api/v1/frames/:id/image proxy, never frame.url directly —
                that field can point at an external site (e.g. a community
                frame pack), and serving it straight as an <img src> both
                leaks that source to anyone inspecting the page and breaks
                the image entirely if that site is ever unreachable. */}
            {equippedFrameId !== null && (
              <img
                src={`/api/v1/frames/${equippedFrameId}/image`}
                alt="Equipped frame"
                className="absolute inset-0 w-full h-full object-contain pointer-events-none z-20"
                style={{ filter: "drop-shadow(0 0 6px rgba(160,0,26,0.6))" }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
          </div>
          
          <div className="flex-1 text-center md:text-left w-full">
            <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-2">
              <h1 className="text-3xl md:text-4xl font-serif font-bold text-white tracking-wider">
                {statsLoading ? <span className="inline-block w-40 h-8 bg-white/10 animate-pulse rounded" /> : (stats?.profile.name ?? "—")}
              </h1>
              {stats?.profile.premium === 1 && (
                <span className="px-3 py-1 bg-amber-500/20 text-amber-400 text-xs font-bold uppercase tracking-wider rounded-full border border-amber-500/50 inline-block self-center md:self-auto">
                  Premium
                </span>
              )}
            </div>
            
            <p className="text-muted-foreground text-sm max-w-2xl mb-6">
              {stats?.profile.bio || "No bio yet. Use .bio in the bot to set yours."}
            </p>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 w-full">
              <div className="bg-black/40 p-3 rounded-lg border border-white/5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Dungeon Lvl</p>
                <p className="text-2xl font-serif font-bold text-primary">{stats?.rpg?.dungeonFloor || stats?.rpg?.level || 1}</p>
              </div>
              <div className="bg-black/40 p-3 rounded-lg border border-white/5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1"><Trophy className="w-3 h-3"/> Rank</p>
                <p className="text-2xl font-serif font-bold text-white">#{stats?.rank || "?"}</p>
              </div>
              <div className="bg-black/40 p-3 rounded-lg border border-white/5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1"><Wallet className="w-3 h-3"/> Wallet</p>
                <p className="text-xl font-bold text-amber-400">{stats?.profile.balance?.toLocaleString() || 0}</p>
              </div>
              <div className="bg-black/40 p-3 rounded-lg border border-white/5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1"><Landmark className="w-3 h-3"/> Bank</p>
                <p className="text-xl font-bold text-rose-400">{stats?.profile.bank?.toLocaleString() || 0}</p>
              </div>
              <div className="bg-black/40 p-3 rounded-lg border border-white/5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1"><Ticket className="w-3 h-3 text-amber-400"/> Lottery Tickets</p>
                <p className="text-xl font-bold text-amber-400">{(stats?.profile as any)?.lotteryTickets ?? 0}</p>
              </div>
            </div>

            <div className="mt-6 w-full max-w-xl">
              <div className="flex justify-between text-xs text-muted-foreground mb-2 font-mono">
                <span>XP {stats?.profile.xp || 0}</span>
                <span>Next Level: {stats?.xpNeeded || 100}</span>
              </div>
              <Progress value={progressPercentage} className="h-2 bg-black border border-white/10" />
            </div>
          </div>
        </div>
        </div>{/* /content area */}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ProfileTab)} className="w-full">
        {/* Section navigation grid — shows all sections at a glance (no horizontal scroll required) */}
        <TabsList className="w-full grid grid-cols-3 sm:grid-cols-6 gap-1.5 bg-black/40 border border-white/10 rounded-xl p-2 mb-2 h-auto">
          {PROFILE_TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className={cn(
                "flex flex-col items-center gap-1.5 py-3 px-1 rounded-lg border transition-all h-auto",
                "text-muted-foreground hover:text-white hover:bg-white/5",
                "data-[state=active]:text-primary data-[state=active]:bg-primary/10 data-[state=active]:border-primary/40 data-[state=active]:shadow-[0_0_12px_rgba(160,0,26,0.2)]",
                "border-transparent"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-[10px] uppercase tracking-wider font-semibold leading-tight">{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Active section header — tells the user exactly where they are */}
        {(() => {
          const current = PROFILE_TABS.find(t => t.value === activeTab);
          if (!current) return null;
          const Icon = current.icon;
          return (
            <div className="flex items-center gap-3 px-1 py-3 mb-4 border-b border-primary/10">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h2 className="font-serif font-bold text-white text-base leading-tight">{current.label}</h2>
                <p className="text-xs text-muted-foreground">{current.desc}</p>
              </div>
            </div>
          );
        })()}

        <TabsContent value="overview" className="space-y-6">
          {statsLoading ? (
            <div className="h-64 glass-card rounded-lg animate-pulse" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* RPG Stats */}
              <Card className="glass-card border-white/10 bg-black/20">
                <CardContent className="p-6">
                  <h3 className="font-serif text-xl font-bold text-white mb-6 border-b border-primary/15 pb-4 flex items-center justify-between">
                    <span>Combat Statistics</span>
                    <span className="text-sm font-sans text-primary border border-primary/30 px-3 py-1 rounded-full uppercase tracking-widest bg-primary/10">
                      {stats?.rpg?.class || "Novice"}
                    </span>
                  </h3>
                  
                  <div className="space-y-4">
                    <StatBar icon={Activity} label="Health" value={stats?.rpg?.hp || 100} max={stats?.rpg?.maxHp || 100} color="bg-red-500" />
                    <StatBar icon={Swords} label="Attack" value={stats?.rpg?.attack || 10} max={100} color="bg-orange-500" />
                    <StatBar icon={Shield} label="Defense" value={stats?.rpg?.defense || 10} max={100} color="bg-rose-500" />
                    <StatBar icon={Zap} label="Speed" value={stats?.rpg?.speed || 10} max={100} color="bg-yellow-500" />
                  </div>
                </CardContent>
              </Card>

              {/* Guild Info */}
              <Card className="glass-card border-white/10 bg-black/20">
                <CardContent className="p-6">
                  <h3 className="font-serif text-xl font-bold text-white mb-6 border-b border-primary/15 pb-4">Guild Affiliation</h3>
                  
                  {stats?.guild ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <Shield className="w-16 h-16 text-primary mb-4 opacity-80" />
                      <h4 className="text-2xl font-serif font-bold text-white">{stats.guild.name}</h4>
                      <p className="text-muted-foreground mt-2">Level {stats.guild.level} Guild</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <div className="w-16 h-16 rounded-full border border-dashed border-muted-foreground flex items-center justify-center mb-4">
                        <Shield className="w-8 h-8 text-muted-foreground" />
                      </div>
                      <p className="text-muted-foreground">Not affiliated with any guild.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="skills">
          <SkillsTab token={token} />
        </TabsContent>

        <TabsContent value="inventory">
          <div className="glass-card rounded-xl p-6 border border-white/10">
            <h3 className="font-serif text-xl font-bold text-white mb-6 border-b border-primary/15 pb-4">Your Inventory</h3>
            
            {invLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {[1,2,3,4,5,6].map(i => <div key={i} className="h-32 bg-white/5 animate-pulse rounded-lg" />)}
              </div>
            ) : inventoryData?.items && inventoryData.items.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {inventoryData.items.map((item: any, i: number) => (
                  <div key={i} className="bg-black/40 border border-white/10 rounded-lg p-4 flex flex-col items-center justify-center relative group hover:border-primary/50 transition-colors">
                    <span className="absolute top-2 right-2 bg-primary text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-6 text-center shadow-[0_0_10px_rgba(160,0,26,0.5)]">
                      {item.quantity}
                    </span>
                    <div className="w-12 h-12 rounded-md bg-white/5 mb-3 flex items-center justify-center border border-white/5 group-hover:border-primary/30 transition-colors">
                      <span className="text-xl">📦</span>
                    </div>
                    <p className="text-sm font-medium text-center text-gray-200 line-clamp-2">{item.item}</p>
                    <p className="text-[10px] text-muted-foreground uppercase mt-1">{item.category}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-muted-foreground">
                <p>Your inventory is empty.</p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="frames">
          <FramesTab token={token} userRole={(user as any)?.role} />
        </TabsContent>

        <TabsContent value="appearance">
          <AppearanceTab token={token} onPpUpdate={() => setPpCacheBust(Date.now())} onBgUpdate={() => setBgCacheBust(Date.now())} />
        </TabsContent>

        <TabsContent value="pets">
          <div className="glass-card rounded-xl p-12 border border-white/10 flex flex-col items-center justify-center text-center">
            <div className="w-24 h-24 rounded-full bg-black/50 border border-white/10 flex items-center justify-center mb-6">
              <span className="text-4xl opacity-50">🐾</span>
            </div>
            <h3 className="font-serif text-2xl font-bold text-white mb-2">No companions yet</h3>
            <p className="text-muted-foreground max-w-md">
              The companion system is evolving. Check back as Requiem Order grows.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="achievements">
          <div className="glass-card rounded-xl p-6 border border-white/10">
            <h3 className="font-serif text-xl font-bold text-white mb-6">Achievements</h3>
            
            {achLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1,2,3].map(i => <div key={i} className="h-24 bg-white/5 animate-pulse rounded-lg" />)}
              </div>
            ) : achievementsData?.achievements && achievementsData.achievements.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {achievementsData.achievements.map((ach: any) => (
                  <div key={ach.id} className="bg-black/40 border border-white/10 rounded-lg p-4 flex items-center gap-4 hover:bg-white/5 transition-colors">
                    <div className="w-12 h-12 rounded-full bg-primary/20 border border-primary/50 flex items-center justify-center text-2xl shadow-[0_0_15px_rgba(160,0,26,0.3)] shrink-0">
                      {ach.icon}
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-sm">{ach.name}</h4>
                      <p className="text-xs text-muted-foreground mt-1">{ach.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-muted-foreground border border-dashed border-white/10 rounded-lg">
                <Trophy className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p>No achievements earned yet. Complete missions to earn badges.</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SkillsTab({ token }: { token: string | null }) {
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["skills"],
    queryFn: () => customFetch<any>("/api/v1/user/skills"),
    enabled: !!token,
  });

  const doMutate = (url: string, stat: string, points: number) =>
    customFetch<any>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stat, points }),
    });

  const upgradeMutation = useMutation({
    mutationFn: ({ stat }: { stat: string }) => doMutate("/api/v1/user/skills/assign", stat, 1),
    onSuccess: (res) => {
      setMsg(res.message || "Upgraded!");
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.invalidateQueries({ queryKey: ["user-stats"] });
    },
    onError: (e: any) => setMsg(e?.message || "Failed to upgrade."),
  });

  const downgradeMutation = useMutation({
    mutationFn: ({ stat }: { stat: string }) => doMutate("/api/v1/user/skills/unassign", stat, 1),
    onSuccess: (res) => {
      setMsg(res.message || "Downgraded!");
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.invalidateQueries({ queryKey: ["user-stats"] });
    },
    onError: (e: any) => setMsg(e?.message || "Failed to downgrade."),
  });

  if (isLoading) {
    return <div className="h-64 glass-card rounded-xl animate-pulse" />;
  }

  const sp = data?.skillPoints ?? 0;
  const stats = [
    { key: "attack", label: "Attack", icon: Swords, color: "bg-orange-500", value: data?.attack ?? 20, min: 20 },
    { key: "defense", label: "Defense", icon: Shield, color: "bg-rose-500", value: data?.defense ?? 10, min: 10 },
    { key: "speed", label: "Speed", icon: Zap, color: "bg-yellow-500", value: data?.speed ?? 15, min: 15 },
    { key: "hp", label: "Max HP", icon: Activity, color: "bg-red-500", value: data?.maxHp ?? 100, min: 100 },
  ];

  const isPending = upgradeMutation.isPending || downgradeMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-xl p-6 border border-white/10">
        <div className="flex items-center justify-between mb-6 border-b border-primary/15 pb-4">
          <h3 className="font-serif text-xl font-bold text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            Skill Points
          </h3>
          <span className="px-4 py-2 bg-primary/20 border border-primary/40 text-primary font-bold text-lg rounded-lg font-mono">
            {sp} SP available
          </span>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Use <strong>+</strong> to spend 1 SP and upgrade a stat (+2 per SP, +5 for HP). Use <strong>−</strong> to refund 1 SP and lower a stat back. Stats cannot go below their base value.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {stats.map(({ key, label, icon: Icon, color, value, min }) => (
            <div key={key} className="bg-black/40 border border-white/10 rounded-xl p-5 space-y-3 hover:border-white/20 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="w-5 h-5 text-muted-foreground" />
                  <span className="font-semibold text-white">{label}</span>
                </div>
                <span className="font-mono text-2xl font-bold text-white">{value}</span>
              </div>
              <div className="h-2 w-full bg-black rounded-full overflow-hidden border border-white/5">
                <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(100, (value / (key === "hp" ? 500 : 200)) * 100)}%` }} />
              </div>
              <div className="flex items-center gap-2">
                {/* Downgrade button — always shown when value > min */}
                <button
                  onClick={() => { setMsg(null); downgradeMutation.mutate({ stat: key }); }}
                  disabled={isPending || value <= min}
                  title={value <= min ? `${label} is at minimum (${min})` : `Refund 1 SP from ${label}`}
                  className="flex-none w-9 h-9 flex items-center justify-center rounded-lg border border-white/20 text-white/60 hover:text-white hover:border-white/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-lg font-bold"
                >
                  −
                </button>
                <span className="flex-1 text-center text-xs text-muted-foreground">
                  {key === "hp" ? "+5 HP per SP" : "+2 per SP"}
                </span>
                {/* Upgrade button — shown when SP available */}
                <button
                  onClick={() => { setMsg(null); upgradeMutation.mutate({ stat: key }); }}
                  disabled={isPending || sp < 1}
                  title={sp < 1 ? "No skill points available" : `Spend 1 SP to upgrade ${label}`}
                  className="flex-none w-9 h-9 flex items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-lg font-bold"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>

        {msg && (
          <p className={cn("mt-4 text-sm text-center", msg.toLowerCase().includes("failed") || msg.toLowerCase().includes("error") ? "text-red-400" : "text-green-400")}>{msg}</p>
        )}
        {sp === 0 && (
          <p className="mt-4 text-sm text-center text-muted-foreground">
            No skill points available — level up in the bot to earn more!
          </p>
        )}
      </div>
    </div>
  );
}

function AppearanceTab({ token, onPpUpdate, onBgUpdate }: { token: string | null; onPpUpdate?: () => void; onBgUpdate?: () => void }) {
  const queryClient = useQueryClient();
  const ppRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);
  const [ppPreview, setPpPreview] = useState<string | null>(null);
  const [bgPreview, setBgPreview] = useState<string | null>(null);
  const [ppStatus, setPpStatus] = useState<string | null>(null);
  const [bgStatus, setBgStatus] = useState<string | null>(null);
  const [ppCacheBust, setPpCacheBust] = useState<number>(0);
  const [bgCacheBust, setBgCacheBust] = useState<number>(0);

  const { data: statsData } = useQuery({
    queryKey: ["user-stats"],
    queryFn: () => customFetch<any>("/api/v1/user/stats"),
    enabled: !!token,
  });

  // Always fetch avatar/bg — server now serves an inline SVG-generated default
  // when no custom image is set, so we never get 404 and always show something.
  const currentAvatarUrl = useAuthMedia("/api/v1/user/avatar", token, ppCacheBust);
  const currentBgUrl = useAuthMedia("/api/v1/user/background", token, bgCacheBust);

  const handleUpload = async (type: "pp" | "bg") => {
    const ref = type === "pp" ? ppRef : bgRef;
    const file = ref.current?.files?.[0];
    if (!file) return;
    const setStatus = type === "pp" ? setPpStatus : setBgStatus;
    const endpoint = type === "pp" ? "/api/v1/user/setpp" : "/api/v1/user/setbg";
    const form = new FormData();
    form.append("image", file);
    try {
      setStatus("Uploading...");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = await res.json();
      if (json.success) {
        setStatus("✅ Updated! Your new image is now active.");
        queryClient.invalidateQueries({ queryKey: ["user-stats"] });
        // Clear local preview and bump cache buster to re-fetch from server
        if (type === "pp") {
          setPpPreview(null);
          setPpCacheBust(Date.now());
          onPpUpdate?.();
        } else {
          setBgPreview(null);
          setBgCacheBust(Date.now());
          onBgUpdate?.();
        }
        if (ref.current) ref.current.value = "";
      } else {
        setStatus(json.message || "Upload failed.");
      }
    } catch {
      setStatus("Upload failed.");
    }
  };

  const handleFileChange = (type: "pp" | "bg", file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (type === "pp") setPpPreview(url);
    else setBgPreview(url);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Profile Picture */}
      <div className="glass-card rounded-xl p-6 border border-white/10 space-y-4">
        <h3 className="font-serif text-xl font-bold text-white flex items-center gap-2 border-b border-primary/15 pb-4">
          <UserCircle2 className="w-5 h-5 text-primary" />
          Profile Picture
        </h3>
        <p className="text-sm text-muted-foreground">
          This image appears on your <span className="font-mono text-primary">.p</span> card as your avatar. Recommended: square image, at least 400×400.
        </p>
        <div className="flex items-center gap-4">
          <div className="w-24 h-24 rounded-full overflow-hidden bg-black/50 border-2 border-white/10 flex items-center justify-center shrink-0">
            {ppPreview ? (
              <img src={ppPreview} alt="Preview" className="w-full h-full object-cover" />
            ) : currentAvatarUrl ? (
              <img src={currentAvatarUrl} alt="Current avatar" className="w-full h-full object-cover" />
            ) : (
              <UserCircle2 className="w-12 h-12 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 space-y-2">
            <input
              ref={ppRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => handleFileChange("pp", e.target.files?.[0])}
              className="w-full text-xs text-muted-foreground file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border file:border-white/20 file:bg-white/5 file:text-white file:text-xs file:cursor-pointer"
            />
            <button
              onClick={() => handleUpload("pp")}
              disabled={!ppRef.current?.files?.[0]}
              className="w-full py-2 bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary text-sm font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <ImagePlus className="w-4 h-4" />
              Set Profile Picture
            </button>
          </div>
        </div>
        {ppStatus && (
          <p className={cn("text-sm", ppStatus.includes("!") ? "text-green-400" : "text-muted-foreground")}>{ppStatus}</p>
        )}
      </div>

      {/* Profile Background */}
      <div className="glass-card rounded-xl p-6 border border-white/10 space-y-4">
        <h3 className="font-serif text-xl font-bold text-white flex items-center gap-2 border-b border-primary/15 pb-4">
          <ImagePlus className="w-5 h-5 text-primary" />
          Profile Background
        </h3>
        <p className="text-sm text-muted-foreground">
          This image appears as the background of your <span className="font-mono text-primary">.p</span> card. Recommended: landscape or portrait image.
        </p>
        <div className="space-y-3">
          <div className="w-full h-32 rounded-lg overflow-hidden bg-black/50 border border-white/10 flex items-center justify-center">
            {bgPreview ? (
              <img src={bgPreview} alt="Preview" className="w-full h-full object-cover" />
            ) : currentBgUrl ? (
              <img src={currentBgUrl} alt="Current background" className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center text-muted-foreground">
                <ImagePlus className="w-8 h-8 mb-2 opacity-30" />
                <span className="text-xs">No background set</span>
              </div>
            )}
          </div>
          <input
            ref={bgRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => handleFileChange("bg", e.target.files?.[0])}
            className="w-full text-xs text-muted-foreground file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border file:border-white/20 file:bg-white/5 file:text-white file:text-xs file:cursor-pointer"
          />
          <button
            onClick={() => handleUpload("bg")}
            disabled={!bgRef.current?.files?.[0]}
            className="w-full py-2 bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary text-sm font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Set Background
          </button>
          {bgStatus && (
            <p className={cn("text-sm", bgStatus.includes("!") ? "text-green-400" : "text-muted-foreground")}>{bgStatus}</p>
          )}
        </div>
      </div>
    </div>
  );
}

const THEME_COLORS: Record<string, string> = {
  celestial: "border-rose-500/60 shadow-[0_0_18px_rgba(160,0,26,0.35)]",
  sakura:    "border-pink-500/60 shadow-[0_0_18px_rgba(236,72,153,0.35)]",
  samurai:   "border-amber-500/60 shadow-[0_0_18px_rgba(251,191,36,0.35)]",
  neon:      "border-purple-500/60 shadow-[0_0_18px_rgba(168,85,247,0.35)]",
  dragon:    "border-red-500/60 shadow-[0_0_18px_rgba(239,68,68,0.35)]",
  custom:    "border-white/30 shadow-[0_0_12px_rgba(255,255,255,0.1)]",
};

function FramesTab({ token, userRole }: { token: string | null; userRole?: string }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const isStaff = userRole === "owner" || userRole === "guardian" || userRole === "mod" || userRole === "staff";

  const { data: framesData, isLoading: framesLoading } = useQuery({
    queryKey: ["frames"],
    queryFn: () => customFetch<{ success: boolean; frames: any[] }>("/api/v1/frames"),
  });

  const { data: myFrameData } = useQuery({
    queryKey: ["my-frame"],
    queryFn: () => customFetch<{ success: boolean; frame: any }>("/api/v1/frames/me"),
    enabled: !!token,
  });

  const equipMutation = useMutation({
    mutationFn: (frameId: number | null) =>
      customFetch<{ success: boolean; message: string }>("/api/v1/frames/equip", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frameId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-frame"] });
    },
  });

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !uploadName.trim()) {
      setUploadStatus("Please enter a name and select a PNG file.");
      return;
    }
    const form = new FormData();
    form.append("frame", file);
    form.append("name", uploadName.trim());
    form.append("theme", "custom");
    try {
      setUploadStatus("Uploading...");
      const res = await fetch("/api/v1/frames/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = await res.json();
      if (json.success) {
        setUploadStatus("Frame uploaded!");
        setUploadName("");
        if (fileRef.current) fileRef.current.value = "";
        queryClient.invalidateQueries({ queryKey: ["frames"] });
      } else {
        setUploadStatus(json.message || "Upload failed.");
      }
    } catch {
      setUploadStatus("Upload failed.");
    }
  };

  const equippedId = myFrameData?.frame?.id ?? null;
  const frames: any[] = framesData?.frames ?? [];

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-xl p-6 border border-white/10">
        <div className="flex items-center justify-between mb-6 border-b border-primary/15 pb-4">
          <h3 className="font-serif text-xl font-bold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            Profile Frames
          </h3>
          {equippedId !== null && (
            <button
              onClick={() => equipMutation.mutate(null)}
              disabled={equipMutation.isPending}
              className="text-xs text-muted-foreground hover:text-white border border-white/10 hover:border-white/30 px-3 py-1.5 rounded-md transition-colors"
            >
              Remove Frame
            </button>
          )}
        </div>

        <p className="text-sm text-muted-foreground mb-6">
          Choose a frame to display around your profile picture when others view your card with <span className="font-mono text-primary">.p</span> in the bot.
        </p>

        {framesLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {[1,2,3,4,5].map(i => <div key={i} className="h-48 bg-white/5 animate-pulse rounded-xl" />)}
          </div>
        ) : frames.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No frames available yet.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {frames.map((frame: any) => {
              const isEquipped = frame.id === equippedId;
              const themeClass = THEME_COLORS[frame.theme] ?? THEME_COLORS.custom;
              return (
                <button
                  key={frame.id}
                  onClick={() => !isEquipped && equipMutation.mutate(frame.id)}
                  disabled={equipMutation.isPending}
                  className={cn(
                    "relative group flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all duration-200",
                    isEquipped
                      ? `bg-black/60 ${themeClass}`
                      : "bg-black/30 border-white/10 hover:border-white/30 hover:bg-black/50"
                  )}
                >
                  {isEquipped && (
                    <CheckCircle2 className="absolute top-2 right-2 w-4 h-4 text-green-400" />
                  )}
                  <div className="w-20 h-20 rounded-full overflow-hidden bg-black/50 border border-white/10 flex items-center justify-center">
                    <img
                      src={`/api/v1/frames/${frame.id}/image`}
                      alt={frame.name}
                      className="w-full h-full object-contain"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-white leading-tight">{frame.name}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{frame.theme}</p>
                  </div>
                  {isEquipped ? (
                    <span className="text-xs text-green-400 font-semibold">Equipped</span>
                  ) : (
                    <span className="text-xs text-primary/70 group-hover:text-primary transition-colors">Equip</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {isStaff && (
        <div className="glass-card rounded-xl p-6 border border-amber-500/20">
          <h3 className="font-serif text-lg font-bold text-amber-400 flex items-center gap-2 mb-4">
            <Upload className="w-4 h-4" />
            Upload New Frame
            <span className="text-xs font-sans font-normal text-amber-400/60 ml-1">(Staff Only)</span>
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Upload a 220×220 PNG with a transparent center circle. The frame ring should be in the outer ~30px.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={uploadName}
              onChange={e => setUploadName(e.target.value)}
              placeholder="Frame name (e.g. Sakura Storm)"
              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-amber-500/50"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-amber-500/40 file:bg-amber-500/10 file:text-amber-400 file:text-xs file:cursor-pointer"
            />
            <button
              onClick={handleUpload}
              className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
            >
              Upload Frame
            </button>
          </div>
          {uploadStatus && (
            <p className={cn("mt-3 text-sm", uploadStatus.includes("!") ? "text-green-400" : "text-muted-foreground")}>
              {uploadStatus}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatBar({ icon: Icon, label, value, max, color }: any) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center gap-2 text-sm text-gray-300">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <span className="uppercase tracking-wider text-xs">{label}</span>
        </div>
        <span className="text-xs font-mono">{value} / {max}</span>
      </div>
      <div className="h-2 w-full bg-black rounded-full overflow-hidden border border-white/5">
        <div 
          className={cn("h-full rounded-full", color)} 
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
