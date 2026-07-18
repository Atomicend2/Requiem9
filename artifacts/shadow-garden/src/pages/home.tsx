import { useGetCommunityStats } from "@workspace/api-client-react/src/generated/api";
import { Button } from "@/components/ui/button";
import { Users, CreditCard, Shield, Activity, ArrowRight, Sword, Coins, Zap, Dices } from "lucide-react";

export default function Home() {
  const { data: stats, isLoading } = useGetCommunityStats({
    query: { refetchInterval: 30000, retry: 5, retryDelay: 3000 },
  });

  return (
    <div className="min-h-[100dvh]">

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="relative min-h-[92vh] flex items-center justify-center overflow-hidden">

        {/* Subtle grid */}
        <div className="absolute inset-0 grid-overlay opacity-40" />

        {/* Ambient glows — purple-forward, no cyan overload */}
        <div className="absolute top-[-8%] left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full bg-violet-700/[0.06] blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[5%] right-[-10%] w-[350px] h-[350px] rounded-full bg-violet-600/[0.04] blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-background to-transparent pointer-events-none" />

        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">

          {/* Status chip */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-violet-500/20 bg-violet-500/[0.06] text-violet-300 text-[11px] font-mono tracking-[0.2em] uppercase mb-12">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            Active — Join the Order
          </div>

          {/* Main headline */}
          <h1 className="mb-6">
            <span className="block text-[10px] font-mono text-white/20 tracking-[0.6em] uppercase mb-6">
              Est. Community
            </span>
            <span className="block text-6xl sm:text-8xl md:text-9xl font-bold leading-[0.88] tracking-[-0.03em] text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              REQUIEM<br />
              <span className="text-transparent bg-clip-text" style={{ backgroundImage: "linear-gradient(135deg, #a78bfa 0%, #7C3AED 60%, #6d28d9 100%)" }}>
                ORDER
              </span>
            </span>
          </h1>

          <p className="text-base md:text-lg text-white/35 mb-14 max-w-md mx-auto leading-relaxed font-light tracking-wide">
            A card collection community with guilds, economy, and ranked systems. One Order.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a href="https://chat.whatsapp.com/EDDDHxRGNmoEKacTlQQmun" target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto h-12 px-8 bg-violet-600 hover:bg-violet-500 text-white font-bold tracking-wide text-sm rounded-md transition-all duration-200 hover:shadow-[0_0_24px_rgba(124,58,237,0.35)] flex items-center gap-2">
                Join Community
                <ArrowRight className="w-4 h-4" />
              </Button>
            </a>
            <a href="#community" className="w-full sm:w-auto">
              <Button size="lg" variant="outline" className="w-full sm:w-auto h-12 px-8 border-white/10 text-white/55 hover:text-white hover:border-white/20 hover:bg-white/[0.04] font-medium text-sm rounded-md transition-all duration-200">
                Our Groups
              </Button>
            </a>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 opacity-20">
          <div className="w-px h-10 bg-gradient-to-b from-transparent via-violet-400 to-transparent" />
        </div>
      </section>

      {/* ── Stats ──────────────────────────────────────────── */}
      <section id="stats" className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-mono text-violet-400/40 tracking-[0.4em] uppercase mb-2">Live</p>
            <h2 className="text-2xl md:text-3xl font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Community Stats</h2>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1,2,3,4].map(i => <div key={i} className="h-28 glass-card rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={Users}      label="Members"     value={stats?.totalMembers ?? 0}       color="violet" />
              <StatCard icon={CreditCard} label="Cards"       value={stats?.totalCards ?? 0}         color="purple" />
              <StatCard icon={Shield}     label="Guilds"      value={stats?.totalGuilds ?? 0}        color="violet" />
              <StatCard icon={Activity}   label="Bots Online" value={(stats as any)?.totalBots ?? 0} color="purple" />
            </div>
          )}
        </div>
      </section>

      {/* ── Community Groups ──────────────────────────────── */}
      <section id="community" className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-mono text-violet-400/40 tracking-[0.4em] uppercase mb-2">Connect</p>
            <h2 className="text-2xl md:text-3xl font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Our Groups</h2>
            <p className="text-sm text-white/30 mt-3 max-w-xs mx-auto">Join the right group for your playstyle</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {COMMUNITY_GROUPS.map((g) => (
              <a
                key={g.name}
                href={g.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group glass-card rounded-xl p-6 flex flex-col gap-4 hover:border-violet-500/25 transition-all duration-200 hover:shadow-[0_0_28px_rgba(124,58,237,0.08)]"
              >
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg bg-violet-600/10 border border-violet-500/20 flex items-center justify-center group-hover:border-violet-500/35 transition-colors">
                    <g.icon className="w-5 h-5 text-violet-400" />
                  </div>
                  <span className="text-[10px] font-mono text-white/20 tracking-widest uppercase">{g.tag}</span>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white mb-1.5 font-mono tracking-wide" style={{ fontFamily: "inherit" }}>{g.displayName}</h3>
                  <p className="text-xs text-white/35 leading-relaxed">{g.desc}</p>
                </div>
                <div className="flex items-center gap-1.5 text-violet-400 text-xs font-medium mt-auto">
                  <span>Join Group</span>
                  <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────── */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[10px] font-mono text-violet-400/40 tracking-[0.4em] uppercase mb-2">Features</p>
            <h2 className="text-2xl md:text-3xl font-bold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>What You Get</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="glass-card rounded-xl p-5 group cursor-default">
                <div className="w-9 h-9 rounded-lg bg-violet-600/[0.08] border border-violet-500/15 flex items-center justify-center mb-4 group-hover:border-violet-500/30 transition-colors">
                  <f.icon className="w-4 h-4 text-violet-400" />
                </div>
                <h3 className="text-sm font-semibold text-white mb-1.5" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{f.title}</h3>
                <p className="text-xs text-white/35 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────── */}
      <section className="py-24 px-4 text-center relative overflow-hidden">
        <div className="absolute inset-0 grid-overlay opacity-25 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-violet-600/[0.025] to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-xl mx-auto">
          <p className="text-[10px] font-mono text-violet-400/40 tracking-[0.5em] uppercase mb-4">Ready?</p>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Join the Order
          </h2>
          <p className="text-sm text-white/30 mb-8">Enter the community and start building your collection today.</p>
          <a href="https://chat.whatsapp.com/EDDDHxRGNmoEKacTlQQmun" target="_blank" rel="noopener noreferrer">
            <Button size="lg" className="h-12 px-10 bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm tracking-wide rounded-md hover:shadow-[0_0_24px_rgba(124,58,237,0.35)] transition-all flex items-center gap-2 mx-auto">
              <Zap className="w-4 h-4" />
              Join Requiem Order
            </Button>
          </a>
        </div>
      </section>
    </div>
  );
}

const COMMUNITY_GROUPS = [
  {
    icon: Users,
    name: "main",
    displayName: "⦿ Zᴇʀᴏ Rᴇǫᴜɪᴇᴍ ⦿",
    tag: "Main",
    desc: "The central hub. Cards, economy, guilds, and community events all happen here.",
    url: "https://chat.whatsapp.com/EDDDHxRGNmoEKacTlQQmun",
  },
  {
    icon: Sword,
    name: "rpg",
    displayName: "⦿ Rᴇǫᴜɪᴇᴍ Rᴘɢ ⦿",
    tag: "RPG",
    desc: "Dungeon raids, class combat, and character progression in our dedicated RPG group.",
    url: "https://chat.whatsapp.com/Gobh9CiNhMgAwgSP6fX35j?s=cl&p=a&ilr=4",
  },
  {
    icon: Dices,
    name: "gambling",
    displayName: "⦿ Rᴇǫᴜɪᴇᴍ Gᴀᴍʙʟɪɴɢ ⦿",
    tag: "Gambling",
    desc: "Slots, dice, roulette and high-stakes games in the dedicated gambling arena.",
    url: "https://chat.whatsapp.com/EmxlCamVhIu2uzSWYlULgc",
  },
];

const FEATURES = [
  { icon: CreditCard, title: "Card Codex",  desc: "Tiered cards from T1 to TX. Collect, trade, and flex your rarest pulls." },
  { icon: Shield,     title: "Guilds",      desc: "Form alliances, pool resources, and dominate the guild leaderboard together." },
  { icon: Sword,      title: "Combat",      desc: "Dungeon raids, class unlocks, and PvP battles with real stakes." },
  { icon: Coins,      title: "Economy",     desc: "Earn gold, bank wealth, trade on the marketplace, and spin the gacha." },
  { icon: Users,      title: "Community",   desc: "Three dedicated groups: main community, RPG, and gambling." },
  { icon: Zap,        title: "Gacha",       desc: "Exclusive legendary pulls for members only. Chase your next high-tier card." },
];

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: "violet" | "purple" }) {
  const isViolet = color === "violet";
  return (
    <div className="glass-card rounded-xl p-5">
      <Icon className={`w-4 h-4 mb-3 ${isViolet ? "text-violet-400" : "text-purple-400"}`} />
      <p className={`text-2xl font-bold font-mono mb-0.5 ${isViolet ? "text-violet-400" : "text-purple-400"}`}>
        {value.toLocaleString()}
      </p>
      <p className="text-[11px] text-white/30 uppercase tracking-wider">{label}</p>
    </div>
  );
}
