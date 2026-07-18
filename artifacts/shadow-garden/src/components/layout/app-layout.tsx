import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useState, useEffect } from "react";
import {
  Home, Map, CreditCard, User, ShoppingCart, Shield, Trophy, LogOut, Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/",            label: "Home",       icon: Home },
  { href: "/world",       label: "World",      icon: Map },
  { href: "/cards",       label: "Cards",      icon: CreditCard },
  { href: "/profile",     label: "Profile",    icon: User },
  { href: "/shop",        label: "Shop",       icon: ShoppingCart },
  { href: "/guilds",      label: "Guilds",     icon: Shield },
  { href: "/leaderboard", label: "Ranks",      icon: Trophy },
];

/** Fetches the auth-gated avatar and returns a local blob URL for use in <img>. */
function useLayoutAvatar(token: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!token) { setUrl(null); return; }
    let cancelled = false;
    fetch(`/api/v1/user/avatar?t=${Date.now()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        setUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return objectUrl; });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);
  return url;
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { isAuthenticated, user, logout, token } = useAuth();
  const isMod = (user as any)?.isMod === 1 || (user as any)?.isOwner === true;
  const displayName = (user as any)?.name || "";
  const initial = displayName.charAt(0).toUpperCase() || "?";
  // Fetch the real avatar so sidebar/mobile header show pp instead of initial letter
  const avatarUrl = useLayoutAvatar(isAuthenticated ? token : null);

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background text-foreground">

      {/* ── Desktop Sidebar ───────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-60 border-r border-white/[0.05] bg-[#07070e]/90 backdrop-blur-xl sticky top-0 h-screen z-40">

        {/* Logo */}
        <div className="px-6 py-5 border-b border-white/[0.05]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-violet-600/10 border border-violet-500/25 flex items-center justify-center">
              {/* R mark */}
              <span className="text-[13px] font-bold text-violet-400" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>R</span>
            </div>
            <div>
              <p className="text-[10px] font-mono text-violet-400/50 tracking-[0.3em] uppercase leading-none mb-0.5">Requiem</p>
              <p className="text-sm font-semibold text-white tracking-wide leading-none" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>ORDER</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} className="block">
                <div className={cn(
                  "relative flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-violet-600/8 text-violet-300"
                    : "text-white/40 hover:text-white/80 hover:bg-white/[0.04]"
                )}>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-violet-400" />
                  )}
                  <item.icon className={cn("w-4 h-4 shrink-0", isActive ? "text-violet-400" : "text-white/30")} />
                  <span>{item.label}</span>
                </div>
              </Link>
            );
          })}

          {isAuthenticated && isMod && (
            <Link href="/admin" className="block mt-3">
              <div className={cn(
                "relative flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                location === "/admin"
                  ? "bg-violet-500/10 text-violet-300"
                  : "text-white/30 hover:text-violet-300/70 hover:bg-violet-500/[0.06]"
              )}>
                {location === "/admin" && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-violet-400" />
                )}
                <Settings className={cn("w-4 h-4 shrink-0", location === "/admin" ? "text-violet-400" : "text-white/30")} />
                <span>Admin</span>
              </div>
            </Link>
          )}
        </nav>

        {/* User panel */}
        <div className="p-3 border-t border-white/[0.05]">
          {isAuthenticated && user ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 px-2 py-2">
                {/* Show profile picture if loaded, otherwise fall back to initial */}
                <div className="w-8 h-8 rounded-full bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-xs font-bold text-violet-400 font-mono shrink-0 overflow-hidden">
                  {avatarUrl
                    ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover rounded-full" />
                    : initial}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{displayName}</p>
                  <p className="text-[11px] text-white/30 font-mono">LVL {(user as any).level ?? 1}</p>
                </div>
              </div>
              <button
                onClick={logout}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-white/30 hover:text-red-400 hover:bg-red-500/[0.06] rounded-md transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign out</span>
              </button>
            </div>
          ) : (
            <Link href="/login" className="block">
              <div className="flex items-center justify-center gap-2 w-full py-2.5 rounded-md bg-violet-600/8 border border-violet-500/20 text-violet-300 text-xs font-semibold tracking-wider uppercase hover:bg-violet-600/12 transition-colors">
                <span className="text-[11px]">⊹</span>
                <span>Sign In</span>
              </div>
            </Link>
          )}
        </div>
      </aside>

      {/* ── Mobile Top Bar ────────────────────────────────── */}
      <header className="md:hidden h-14 border-b border-white/[0.05] bg-[#07070e]/95 backdrop-blur-xl flex items-center justify-between px-4 sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-violet-600/10 border border-violet-500/20 flex items-center justify-center">
            <span className="text-[11px] font-bold text-violet-400" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>R</span>
          </div>
          <span className="text-sm font-semibold tracking-wider text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            REQUIEM<span className="text-violet-400">.</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isAuthenticated && isMod && (
            <Link href="/admin">
              <Settings className={cn("w-4 h-4 transition-colors", location === "/admin" ? "text-violet-400" : "text-white/30")} />
            </Link>
          )}
          {isAuthenticated ? (
            /* Show profile picture in mobile header too */
            <div className="w-7 h-7 rounded-full bg-violet-600/10 border border-violet-500/20 flex items-center justify-center text-xs font-bold text-violet-400 font-mono overflow-hidden">
              {avatarUrl
                ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover rounded-full" />
                : initial}
            </div>
          ) : (
            <Link href="/login">
              <span className="text-xs font-bold text-violet-400 tracking-wider">Sign In</span>
            </Link>
          )}
        </div>
      </header>

      {/* ── Main ──────────────────────────────────────────── */}
      <main className="flex-1 w-full pb-20 md:pb-0 overflow-x-hidden min-h-0">
        {children}
      </main>

      {/* ── Mobile Bottom Nav ─────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 border-t border-white/[0.05] bg-[#07070e]/95 backdrop-blur-xl z-50 flex items-stretch">
        {NAV_ITEMS.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href} className="flex-1">
              <div className="flex flex-col items-center justify-center h-full gap-1">
                <item.icon className={cn("w-4 h-4 transition-all", isActive ? "text-violet-400" : "text-white/25")} />
                <span className={cn("text-[9px] uppercase tracking-wider font-medium", isActive ? "text-violet-400" : "text-white/25")}>
                  {item.label}
                </span>
              </div>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
