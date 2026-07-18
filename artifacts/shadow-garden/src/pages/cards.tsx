import { useState, useEffect, useCallback, useRef } from "react";
import { useGetMyCards, useAddCardToWishlist } from "@workspace/api-client-react/src/generated/api";
import { useAuth } from "@/lib/auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, Heart, CreditCard, Lock, Flame, Gavel, Sparkles, Star, ImageOff, Users, AlertCircle, RefreshCw, ChevronLeft, ChevronRight, X, Layers, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const TIER_CONFIG: Record<string, { label: string; bg: string; text: string; border: string; glow: string; rate: string }> = {
  "T1": { label: "Common",    bg: "bg-slate-500/20",  text: "text-slate-300",  border: "border-slate-500/40",  glow: "shadow-[0_0_12px_rgba(148,163,184,0.4)]",  rate: "45%" },
  "T2": { label: "Uncommon",  bg: "bg-emerald-500/20",text: "text-emerald-400",border: "border-emerald-500/40",glow: "shadow-[0_0_12px_rgba(52,211,153,0.4)]",   rate: "30%" },
  "T3": { label: "Rare",      bg: "bg-rose-500/20",    text: "text-rose-400",    border: "border-rose-500/40",    glow: "shadow-[0_0_12px_rgba(160,0,26,0.5)]",   rate: "15%" },
  "T4": { label: "Epic",      bg: "bg-indigo-500/20", text: "text-indigo-300", border: "border-indigo-500/40", glow: "shadow-[0_0_14px_rgba(129,140,248,0.5)]",  rate: "8%"  },
  "T5": { label: "Legendary", bg: "bg-amber-500/20",  text: "text-amber-400",  border: "border-amber-500/50",  glow: "shadow-[0_0_18px_rgba(212,175,55,0.6)]",   rate: "2%"  },
  "T6": { label: "Animated",  bg: "bg-amber-500/20",   text: "text-amber-200",   border: "border-amber-300/50",   glow: "shadow-[0_0_22px_rgba(212,175,55,0.7)]",   rate: "—"   },
  "TS": { label: "Special",   bg: "bg-rose-500/20",   text: "text-rose-400",   border: "border-rose-500/40",   glow: "shadow-[0_0_14px_rgba(251,113,133,0.5)]",  rate: "—"   },
  "TX": { label: "Exclusive", bg: "bg-yellow-500/20",text: "text-yellow-400",border: "border-yellow-500/40",glow: "shadow-[0_0_18px_rgba(250,204,21,0.6)]",  rate: "—"   },
};

const CARDS_PER_PAGE = 10;

async function fetchAuctions(): Promise<any[]> {
  const res = await fetch("/api/v1/auctions");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.auctions || [];
}

async function fetchCardsFromJson(params: { page: number; tier?: string; search?: string; sortBy?: string; spin?: number }, signal?: AbortSignal) {
  const url = new URL("/api/v1/cards/from-json", window.location.origin);
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("limit", String(CARDS_PER_PAGE));
  if (params.tier && params.tier !== "all") url.searchParams.set("tier", params.tier);
  if (params.search) url.searchParams.set("search", params.search);
  if (params.sortBy) url.searchParams.set("sortBy", params.sortBy);
  // Only meaningful when no explicit sort is requested — see /from-json for
  // the full explanation. One value is generated per page mount (below) and
  // reused across pagination within that visit, so pages don't repeat or
  // skip cards; refreshing the page (a fresh mount) picks a new one, which
  // is what gives the "different mix each time you reload" behavior.
  if (!params.sortBy && params.spin !== undefined) url.searchParams.set("spin", String(params.spin));
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchEventCards(
  params: { page: number; event?: string; tier?: string; search?: string; sortBy?: string },
  signal?: AbortSignal
) {
  const url = new URL("/api/events", window.location.origin);
  url.searchParams.set("page", String(params.page));
  url.searchParams.set("limit", String(CARDS_PER_PAGE));
  // "event" is never a fixed list on the frontend — whatever values the API
  // reports in availableEvents (itself derived live from whatever event_name
  // strings actually exist in the database) are what populate the dropdown.
  // Tagging a new card with any event_name, e.g. "lny" or "special", makes
  // it filterable here immediately with no code change on either side.
  if (params.event && params.event !== "all") url.searchParams.set("event", params.event);
  if (params.tier && params.tier !== "all") url.searchParams.set("tier", params.tier);
  if (params.search) url.searchParams.set("search", params.search);
  if (params.sortBy) url.searchParams.set("sortBy", params.sortBy);
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchCardDetail(cardId: string): Promise<any> {
  const res = await fetch(`/api/v1/cards/detail/${encodeURIComponent(cardId)}`);
  if (!res.ok) return null;
  return res.json();
}

export default function Cards() {
  const { isAuthenticated, user } = useAuth();
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const reqIdRef = useRef(0);
  const { toast } = useToast();
  const [selectedCard, setSelectedCard] = useState<any | null>(null);

  // One random rotation point per page visit — reused across pagination so
  // pages 1/2/3 show a consistent, non-repeating slice of the shuffled
  // catalog, but a fresh one is generated on every mount (i.e. every time
  // the Cards page is loaded or the browser tab is refreshed), which is
  // what makes the default "All Cards" view show a different mix each time
  // instead of always the same latest-first order.
  const spinRef = useRef(Math.random());

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [tierFilter]);

  const [allCardsData, setAllCardsData] = useState<{ cards: any[]; total: number; pages: number } | null>(null);
  const [loadingAll, setLoadingAll] = useState(true);
  const [allCardsError, setAllCardsError] = useState<Error | null>(null);

  const loadCards = useCallback(async () => {
    const myId = ++reqIdRef.current;
    setLoadingAll(true);
    setAllCardsError(null);
    const controller = new AbortController();
    try {
      const data = await fetchCardsFromJson({ page, tier: tierFilter, search: debouncedSearch, spin: spinRef.current }, controller.signal);
      if (myId !== reqIdRef.current) return; // stale — a newer request is already running
      setAllCardsData(data);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      if (myId !== reqIdRef.current) return;
      setAllCardsError(err);
    } finally {
      if (myId === reqIdRef.current) setLoadingAll(false);
    }
  }, [page, tierFilter, debouncedSearch]);

  useEffect(() => { loadCards(); }, [loadCards]);

  const { data: myCards, isLoading: loadingMy } = useGetMyCards({
    query: { enabled: isAuthenticated },
  });

  const isPremium = (user as any)?.premium === 1;

  const [activeTab, setActiveTab] = useState("all");

  // ── Auction tab state ─────────────────────────────────────────────────────────
  const [auctionData, setAuctionData] = useState<any[]>([]);
  const [auctionLoading, setAuctionLoading] = useState(false);
  const [auctionLoaded, setAuctionLoaded] = useState(false);
  const [bidModalAuction, setBidModalAuction] = useState<any | null>(null);
  const [bidAmount, setBidAmount] = useState("");
  const [bidLoading, setBidLoading] = useState(false);
  const [auctionTick, setAuctionTick] = useState(0);

  // ── Events tab state ──────────────────────────────────────────────────────────
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [eventsData, setEventsData] = useState<any | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<any | null>(null);
  const [eventPage, setEventPage] = useState(1);
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [eventTierFilter, setEventTierFilter] = useState<string>("all");
  const eventReqIdRef = useRef(0);

  useEffect(() => { setEventPage(1); }, [eventFilter, eventTierFilter]);

  useEffect(() => {
    if (!eventsLoaded) return;
    const myId = ++eventReqIdRef.current;
    const controller = new AbortController();
    setEventsLoading(true);
    setEventsError(null);
    (async () => {
      try {
        const data = await fetchEventCards(
          { page: eventPage, event: eventFilter, tier: eventTierFilter, search: debouncedSearch },
          controller.signal
        );
        if (myId !== eventReqIdRef.current) return;
        setEventsData(data);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        if (myId !== eventReqIdRef.current) return;
        setEventsError(err);
      } finally {
        if (myId === eventReqIdRef.current) setEventsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [eventsLoaded, eventPage, eventFilter, eventTierFilter, debouncedSearch]);

  const loadAuctions = useCallback(async () => {
    setAuctionLoading(true);
    try {
      const auctions = await fetchAuctions();
      setAuctionData(auctions);
    } catch {
    } finally {
      setAuctionLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!auctionLoaded) return;
    loadAuctions();
    const refresh = setInterval(loadAuctions, 30000);
    const tick = setInterval(() => setAuctionTick((v) => v + 1), 1000);
    return () => { clearInterval(refresh); clearInterval(tick); };
  }, [auctionLoaded, loadAuctions]);

  const handleBid = async () => {
    if (!bidModalAuction) return;
    const amount = parseInt(bidAmount, 10);
    if (isNaN(amount) || amount <= 0) { toast({ title: "Invalid amount", variant: "destructive" }); return; }
    setBidLoading(true);
    try {
      const res = await fetch(`/api/v1/auctions/${bidModalAuction.id}/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bid failed");
      toast({ title: "Bid placed!", description: `You bid $${amount.toLocaleString()}` });
      setBidModalAuction(null);
      setBidAmount("");
      loadAuctions();
    } catch (err: any) {
      toast({ title: "Bid failed", description: err.message, variant: "destructive" });
    } finally {
      setBidLoading(false);
    }
  };

  const formatTimeLeft = (endTime: number) => {
    const secs = Math.max(0, endTime - Math.floor(Date.now() / 1000));
    if (secs === 0) return "Ended";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto">
      {selectedCard && (
        <CardModal card={selectedCard} onClose={() => setSelectedCard(null)} />
      )}

      {/* Header */}
      <div className="mb-10">
        <p className="text-primary/40 font-mono tracking-[0.4em] text-xs uppercase mb-1">反逆</p>
        <h1 className="font-serif text-3xl md:text-4xl font-bold text-white neon-text-sky tracking-widest uppercase">Card Codex</h1>
        <p className="text-muted-foreground mt-2">Collect legendary cards from the Requiem Order universe.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex w-full sm:max-w-3xl bg-black/40 border border-primary/10 p-1 gap-1 overflow-x-auto mb-6 justify-start sm:justify-stretch">
          <TabsTrigger value="all" className="shrink-0 sm:flex-1 px-4 data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:neon-border-sky font-bold tracking-wider uppercase text-xs rounded-sm whitespace-nowrap">
            All Cards {allCardsData ? `(${allCardsData.total.toLocaleString()})` : ""}
          </TabsTrigger>
          <TabsTrigger value="my" disabled={!isAuthenticated} className="shrink-0 sm:flex-1 px-4 data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-bold tracking-wider uppercase text-xs rounded-sm whitespace-nowrap">
            My Collection {isAuthenticated && myCards ? `(${myCards.total})` : ""}
          </TabsTrigger>
          <TabsTrigger value="gacha" className="shrink-0 sm:flex-1 px-4 data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-400 font-bold tracking-wider uppercase text-xs rounded-sm whitespace-nowrap">
            Gacha {!isPremium && <Lock className="inline w-3 h-3 ml-1 opacity-60" />}
          </TabsTrigger>
          <TabsTrigger value="fusion" className="shrink-0 sm:flex-1 px-4 data-[state=active]:bg-rose-500/20 data-[state=active]:text-rose-400 font-bold tracking-wider uppercase text-xs rounded-sm whitespace-nowrap">
            Fusion
          </TabsTrigger>
          <TabsTrigger
            value="events"
            className="shrink-0 sm:flex-1 px-4 data-[state=active]:bg-pink-500/20 data-[state=active]:text-pink-400 font-bold tracking-wider uppercase text-xs rounded-sm whitespace-nowrap"
            onClick={() => { if (!eventsLoaded) setEventsLoaded(true); }}
          >
            Events {eventsData ? `(${eventsData.count.toLocaleString()})` : ""}
          </TabsTrigger>
          <TabsTrigger
            value="auction"
            className="shrink-0 sm:flex-1 px-4 data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400 font-bold tracking-wider uppercase text-xs rounded-sm whitespace-nowrap"
            onClick={() => { if (!auctionLoaded) setAuctionLoaded(true); }}
          >
            Auction {auctionData.length > 0 ? `(${auctionData.length})` : ""}
          </TabsTrigger>
        </TabsList>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or series..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-black/40 border-primary/20 text-white focus-visible:ring-primary placeholder:text-muted-foreground"
            />
          </div>
          {activeTab === "events" ? (
            <>
              <Select value={eventFilter} onValueChange={setEventFilter}>
                <SelectTrigger className="w-full sm:w-[180px] bg-black/40 border-primary/20 text-white">
                  <SelectValue placeholder="Filter by Event" />
                </SelectTrigger>
                <SelectContent className="bg-[#0A0A0F] border-primary/20 text-white">
                  <SelectItem value="all">All Events</SelectItem>
                  {/* Populated entirely from what's actually in the database
                      (eventsData.availableEvents, via GET /api/events) — no
                      hardcoded list. Tagging a card with a brand-new
                      event_name makes it show up here automatically. */}
                  {(eventsData?.availableEvents || []).map((ev: string) => (
                    <SelectItem key={ev} value={ev} className="capitalize">{ev}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={eventTierFilter} onValueChange={setEventTierFilter}>
                <SelectTrigger className="w-full sm:w-[180px] bg-black/40 border-primary/20 text-white">
                  <SelectValue placeholder="Filter by Tier" />
                </SelectTrigger>
                <SelectContent className="bg-[#0A0A0F] border-primary/20 text-white">
                  <SelectItem value="all">All Tiers</SelectItem>
                  {Object.entries(TIER_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key}>{key} — {cfg.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          ) : (
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="w-full sm:w-[180px] bg-black/40 border-primary/20 text-white">
                <SelectValue placeholder="Filter by Tier" />
              </SelectTrigger>
              <SelectContent className="bg-[#0A0A0F] border-primary/20 text-white">
                <SelectItem value="all">All Tiers</SelectItem>
                {Object.entries(TIER_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>{key} — {cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* ALL CARDS */}
        <TabsContent value="all" className="mt-0">
          {loadingAll ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {[1,2,3,4,5,6,7,8,9,10].map((i) => <CardSkeleton key={i} />)}
            </div>
          ) : allCardsError ? (
            <ErrorState text="Failed to load cards. Please check your connection and try again." icon={<AlertCircle className="w-8 h-8 text-red-400" />} />
          ) : allCardsData && allCardsData.cards.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground mb-4">
                Showing a shuffled mix of the full catalog — reload the page for a different mix, or use the Tier filter to narrow it down.{" "}
                <span className="text-pink-400/80">Event</span>-tagged cards are exclusive to limited-time events and can only be obtained by playing an active event game while it's running.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {allCardsData.cards.map((card: any) => (
                  <CardDisplay key={card.id || card.shoob_id} card={card} onOpen={setSelectedCard} />
                ))}
              </div>
              {allCardsData.pages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-8">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="bg-black/40 border-primary/20 text-white hover:bg-primary/10"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground font-mono">
                    Page {page} / {allCardsData.pages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.min(allCardsData.pages, p + 1))}
                    disabled={page >= allCardsData.pages}
                    className="bg-black/40 border-primary/20 text-white hover:bg-primary/10"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <Empty text="No cards match your filters. Try adjusting your search or tier selection." />
          )}
        </TabsContent>

        {/* EVENT CARDS */}
        <TabsContent value="events" className="mt-0">
          {!eventsLoaded ? null : eventsLoading && !eventsData ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {[1,2,3,4,5,6,7,8,9,10].map((i) => <CardSkeleton key={i} />)}
            </div>
          ) : eventsError ? (
            <ErrorState text="Failed to load event cards. Please check your connection and try again." icon={<AlertCircle className="w-8 h-8 text-red-400" />} />
          ) : eventsData && eventsData.data.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground mb-4">
                Event cards are exclusive to limited-time events and never appear from normal spawns — these can only be obtained by playing an active event game while it's running.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {eventsData.data.map((card: any) => (
                  <CardDisplay key={card.id} card={card} onOpen={setSelectedCard} />
                ))}
              </div>
              {eventsData.pages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-8">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEventPage(p => Math.max(1, p - 1))}
                    disabled={eventPage <= 1}
                    className="bg-black/40 border-primary/20 text-white hover:bg-primary/10"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground font-mono">
                    Page {eventPage} / {eventsData.pages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEventPage(p => Math.min(eventsData.pages, p + 1))}
                    disabled={eventPage >= eventsData.pages}
                    className="bg-black/40 border-primary/20 text-white hover:bg-primary/10"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <Empty text="No event cards match your filters yet." />
          )}
        </TabsContent>

        {/* MY COLLECTION */}
        <TabsContent value="my" className="mt-0">
          {loadingMy ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {[1,2,3,4].map((i) => <CardSkeleton key={i} />)}
            </div>
          ) : myCards?.cards && myCards.cards.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {myCards.cards.map((uc: any) => (
                <CardDisplay key={uc.userCardId} card={uc.card} showOwned onOpen={setSelectedCard} />
              ))}
            </div>
          ) : (
            <Empty icon={<CreditCard className="w-8 h-8 text-muted-foreground" />} text="No cards collected yet. Use bot commands to claim spawned cards." />
          )}
        </TabsContent>

        {/* GACHA */}
        <TabsContent value="gacha" className="mt-0">
          {!isPremium ? (
            <LockedPanel
              color="amber"
              icon={<Lock className="w-10 h-10 text-amber-400" />}
              title="Requiem Order Gacha"
              desc="The premium gacha is restricted to elite members only. Upgrade your status to pull legendary cards from the vault."
              badge="Premium Members Only"
            />
          ) : (
            <div className="space-y-8">
              <div className="text-center py-12 glass-card rounded-xl border border-amber-500/30 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/8 via-rose-500/5 to-transparent" />
                <div className="relative z-10">
                  <Sparkles className="w-12 h-12 text-amber-400 mx-auto mb-4 animate-pulse" />
                  <h3 className="font-serif text-3xl font-bold text-amber-400 mb-2 neon-text-gold">Requiem Order Gacha</h3>
                  <p className="text-muted-foreground mb-8 max-w-lg mx-auto">Pull from the premium vault and claim legendary cards. Each pull costs <span className="text-amber-400 font-bold">500 Gold</span>.</p>
                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <Button className="bg-amber-500/20 hover:bg-amber-500/40 text-amber-400 border border-amber-500/50 font-bold tracking-widest uppercase px-8 h-12 shadow-[0_0_20px_rgba(245,158,11,0.3)]">
                      <Star className="w-4 h-4 mr-2" /> Single Pull — 500 Gold
                    </Button>
                    <Button className="bg-rose-500/20 hover:bg-rose-500/40 text-rose-400 border border-rose-500/50 font-bold tracking-widest uppercase px-8 h-12 shadow-[0_0_20px_rgba(160,0,26,0.3)]">
                      <Sparkles className="w-4 h-4 mr-2" /> 10x Pull — 4,500 Gold
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-6">Use <span className="text-primary font-mono">.draw</span> in the WhatsApp group to pull via the bot.</p>
                </div>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-7 gap-3">
                {Object.entries(TIER_CONFIG).map(([tier, cfg]) => (
                  <div key={tier} className={cn("glass-card rounded-lg p-3 border text-center", cfg.border)}>
                    <div className={cn("text-sm font-serif font-bold mb-0.5", cfg.text)}>{tier}</div>
                    <div className="text-[10px] text-muted-foreground mb-1">{cfg.label}</div>
                    <div className={cn("text-xs font-bold font-mono", cfg.text)}>{cfg.rate}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* FUSION */}
        <TabsContent value="fusion" className="mt-0">
          <FusionPanel isAuthenticated={isAuthenticated} myCards={myCards} />
        </TabsContent>

        {/* AUCTION */}
        <TabsContent value="auction" className="mt-0">
          {/* Bid modal */}
          {bidModalAuction && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setBidModalAuction(null)}>
              <div className="relative w-full max-w-md rounded-2xl border border-emerald-500/30 bg-[#07070f] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => setBidModalAuction(null)} className="absolute top-4 right-4 w-7 h-7 rounded-full bg-black/60 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-white">
                  <X className="w-4 h-4" />
                </button>
                <div className="flex items-start gap-4 mb-5">
                  {bidModalAuction.card_image_url ? (
                    <img src={bidModalAuction.card_image_url} alt={bidModalAuction.card_name} className="w-16 h-20 object-cover rounded-lg border border-white/10 shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="w-16 h-20 rounded-lg border border-white/10 bg-black/40 flex items-center justify-center shrink-0"><Gavel className="w-6 h-6 text-muted-foreground" /></div>
                  )}
                  <div>
                    <div className={cn("inline-block px-2 py-0.5 rounded-full text-[10px] font-bold mb-1", (TIER_CONFIG[bidModalAuction.card_tier] || TIER_CONFIG["T1"]).bg, (TIER_CONFIG[bidModalAuction.card_tier] || TIER_CONFIG["T1"]).text)}>
                      {bidModalAuction.card_tier} — {(TIER_CONFIG[bidModalAuction.card_tier] || TIER_CONFIG["T1"]).label}
                    </div>
                    <h3 className="font-bold text-white text-lg">{bidModalAuction.card_name}</h3>
                    <p className="text-xs text-muted-foreground">{bidModalAuction.card_series}</p>
                  </div>
                </div>
                <div className="space-y-3 mb-5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Current bid</span><span className="text-white font-bold">${(bidModalAuction.current_bid || bidModalAuction.starting_price || 0).toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Min increment</span><span className="text-white">${(bidModalAuction.min_increment || 100).toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Time left</span><span className="text-emerald-400 font-mono">{formatTimeLeft(bidModalAuction.end_time)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Seller</span><span className="text-white">{bidModalAuction.seller_name || "Unknown"}</span></div>
                  {bidModalAuction.current_bidder_name && <div className="flex justify-between"><span className="text-muted-foreground">Leading</span><span className="text-amber-400">{bidModalAuction.current_bidder_name}</span></div>}
                </div>
                {isAuthenticated ? (
                  <>
                    <Input
                      type="number"
                      placeholder={`Min: $${((bidModalAuction.current_bid || bidModalAuction.starting_price || 0) + (bidModalAuction.min_increment || 100)).toLocaleString()}`}
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                      className="bg-black/40 border-emerald-500/30 text-white mb-3 focus-visible:ring-emerald-500"
                    />
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setBidModalAuction(null)} className="flex-1 bg-black/40 border-white/10 text-white">Cancel</Button>
                      <Button onClick={handleBid} disabled={bidLoading} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white">
                        {bidLoading ? "Bidding..." : "Place Bid"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-center text-sm text-muted-foreground py-2">You must be logged in to place a bid.</p>
                )}
              </div>
            </div>
          )}

          {/* Auction header */}
          <div className="mb-6 p-4 glass-card rounded-xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/5 via-transparent to-teal-500/5">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-3">
                <Gavel className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-emerald-300 mb-0.5">Requiem Order Auction House</p>
                  <p className="text-xs text-muted-foreground">Bid on rare cards listed by staff and recruits. Use <span className="font-mono text-emerald-300">.auctions</span> and <span className="font-mono text-emerald-300">.bid</span> in the bot.</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={loadAuctions} disabled={auctionLoading} className="bg-black/40 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10 shrink-0">
                <RefreshCw className={cn("w-3 h-3 mr-1", auctionLoading && "animate-spin")} /> Refresh
              </Button>
            </div>
          </div>

          {/* Auction grid */}
          {!auctionLoaded ? (
            <div className="text-center py-20">
              <Gavel className="w-12 h-12 text-emerald-400/30 mx-auto mb-4" />
              <p className="text-muted-foreground text-sm">Click the Auction tab to load live auctions</p>
            </div>
          ) : auctionLoading && auctionData.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {[1,2,3].map((i) => <CardSkeleton key={i} />)}
            </div>
          ) : auctionData.length === 0 ? (
            <div className="text-center py-20">
              <Gavel className="w-12 h-12 text-emerald-400/20 mx-auto mb-4" />
              <p className="text-muted-foreground">No active auctions right now.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Staff and recruits can list cards with <span className="font-mono">.listauc</span></p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {auctionData.map((a: any) => {
                const cfg = TIER_CONFIG[a.card_tier] || TIER_CONFIG["T1"];
                const timeLeft = formatTimeLeft(a.end_time);
                const isEnding = Math.max(0, a.end_time - Math.floor(Date.now() / 1000)) < 3600;
                return (
                  <div key={a.id} className={cn("glass-card rounded-xl border overflow-hidden flex flex-col", cfg.border, cfg.glow)}>
                    {/* Card image */}
                    <div className="relative aspect-[3/4] bg-black/40 overflow-hidden">
                      {a.card_image_url ? (
                        <img src={a.card_image_url} alt={a.card_name} loading="eager"
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center opacity-20"><Gavel className="w-8 h-8" /></div>
                      )}
                      <div className={cn("absolute top-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-bold border", cfg.bg, cfg.text, cfg.border)}>
                        {a.card_tier}
                      </div>
                      <div className={cn("absolute top-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-bold", isEnding ? "bg-red-500/80 text-white" : "bg-black/60 text-emerald-400")}>
                        ⏱ {timeLeft}
                      </div>
                    </div>
                    {/* Info */}
                    <div className="p-3 flex flex-col gap-2 flex-1">
                      <div>
                        <p className={cn("text-sm font-bold truncate", cfg.text)}>{a.card_name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{a.card_series || "General"}</p>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Current bid</span>
                        <span className="text-emerald-400 font-bold">${(a.current_bid || a.starting_price || 0).toLocaleString()}</span>
                      </div>
                      {a.current_bidder_name ? (
                        <p className="text-[10px] text-amber-400/80 truncate">Leading: {a.current_bidder_name}</p>
                      ) : (
                        <p className="text-[10px] text-muted-foreground/60">No bids yet</p>
                      )}
                      <p className="text-[10px] text-muted-foreground truncate">By: {a.seller_name || "Unknown"}</p>
                      <Button
                        size="sm"
                        className="mt-auto bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs w-full"
                        onClick={() => { setBidModalAuction(a); setBidAmount(""); }}
                        disabled={a.end_time < Math.floor(Date.now() / 1000)}
                      >
                        <Gavel className="w-3 h-3 mr-1" />
                        {a.end_time < Math.floor(Date.now() / 1000) ? "Ended" : "Place Bid"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CardModal({ card, onClose }: { card: any; onClose: () => void }) {
  const cfg = TIER_CONFIG[card.tier] || TIER_CONFIG["T1"];
  const [detail, setDetail] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();

  const wishlistMutation = useAddCardToWishlist({
    mutation: {
      onSuccess: () => toast({ title: "Added to Wishlist", description: `${card.name} — the owner will be notified.` }),
      onError: () => toast({ title: "Wishlist Failed", description: "Could not add. Please try again.", variant: "destructive" }),
    },
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCardDetail(card.id || card.shoob_id).then((d) => {
      if (!cancelled) { setDetail(d); setLoading(false); }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [card.id, card.shoob_id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const owners: any[] = detail?.owners ?? card.owners ?? [];
  const totalCopies: number = detail?.totalCopies ?? card.totalCopies ?? 0;
  const imageUrl: string = detail?.imageUrl ?? card.imageUrl ?? "";
  const isVideo: boolean = detail?.isVideo ?? card.isVideo ?? false;
  const description: string = detail?.description ?? card.description ?? "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className={cn(
          "relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border bg-[#07070f] shadow-2xl animate-in zoom-in-95 duration-200",
          cfg.border
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-black/60 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Full-size image / video */}
        <div className={cn("relative w-full overflow-hidden rounded-t-2xl", cfg.bg)} style={{ minHeight: 280 }}>
          {imageUrl ? (
            <div className="w-full max-h-[400px] flex items-center justify-center">
              <CardMedia
                imageUrl={imageUrl}
                gifUrl={detail?.gifUrl ?? card.gifUrl ?? imageUrl}
                videoUrl={detail?.videoUrl ?? card.videoUrl ?? null}
                isVideo={isVideo}
                isAnimated={detail?.isAnimated ?? card.isAnimated}
                name={card.name}
                className="w-full object-contain max-h-[400px]"
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 opacity-30">
              <ImageOff className="w-12 h-12" />
            </div>
          )}
          {/* Gradient overlay */}
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#07070f] to-transparent" />
          {/* Tier badge */}
          <div className={cn("absolute top-3 left-3 px-3 py-1 rounded-full font-bold text-sm border font-mono", cfg.bg, cfg.text, cfg.border)}>
            {card.tier} — {cfg.label}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Name + Series */}
          <div>
            <h2 className="font-serif text-2xl font-bold text-white leading-tight">{card.name}</h2>
            <p className="text-sm text-muted-foreground mt-1">{card.series || "General"}</p>
          </div>

          {/* Card ID + copy count stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-black/40 rounded-lg p-3 border border-white/5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                <Copy className="w-3 h-3" /> Card ID
              </p>
              <p className="text-sm font-mono text-white truncate">{card.id || card.shoob_id || "—"}</p>
            </div>
            <div className="bg-black/40 rounded-lg p-3 border border-white/5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                <Layers className="w-3 h-3" /> Total Issues
              </p>
              <p className="text-sm font-bold text-white">{totalCopies.toLocaleString()} in existence</p>
            </div>
          </div>

          {/* Description */}
          {description && (
            <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-primary/30 pl-3">{description}</p>
          )}

          {/* Owners */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                {loading ? "Loading owners…" : `Owners (${owners.length}${owners.length >= 5 ? "+" : ""})`}
              </h3>
            </div>
            {loading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-10 bg-white/5 animate-pulse rounded-lg" />)}
              </div>
            ) : owners.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground text-sm border border-white/5 rounded-lg">
                ⛔ No owners yet — be the first to claim this card in the bot!
              </div>
            ) : (
              <div className="space-y-2">
                {owners.map((o: any, i: number) => (
                  <div key={o.id || i} className="flex items-center gap-3 bg-black/30 rounded-lg px-3 py-2 border border-white/5">
                    <span className="text-xs text-muted-foreground font-mono w-6 text-right shrink-0">#{i + 1}</span>
                    <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                      {(o.name || "S").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{o.name || "Shadow"}</p>
                      {o.id && <p className="text-[10px] text-muted-foreground font-mono truncate">{o.id}</p>}
                    </div>
                  </div>
                ))}
                {owners.length >= 5 && !loading && (
                  <p className="text-center text-xs text-muted-foreground pt-1">Use <span className="font-mono text-primary">.ci {card.name}</span> in the bot to see all owners</p>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="pt-2 flex gap-3">
            <button
              onClick={() => {
                if (!isAuthenticated) {
                  toast({ title: "Login Required", description: "You must be logged in.", variant: "destructive" });
                  return;
                }
                wishlistMutation.mutate({ data: { cardId: card.id || card.shoob_id } });
              }}
              disabled={wishlistMutation.isPending || wishlistMutation.isSuccess}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all",
                wishlistMutation.isSuccess
                  ? "border-rose-500/50 bg-rose-500/10 text-rose-400"
                  : "border-white/10 bg-black/30 text-muted-foreground hover:border-rose-500/40 hover:text-rose-400 hover:bg-rose-500/5"
              )}
            >
              <Heart className={cn("w-4 h-4", wishlistMutation.isSuccess && "fill-rose-400 text-rose-400")} />
              {wishlistMutation.isSuccess ? "On Wishlist" : "Add to Wishlist"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardMedia({
  imageUrl, gifUrl, videoUrl, isVideo, isAnimated, name,
  className, onLoaded, onError,
}: {
  imageUrl: string; gifUrl?: string; videoUrl?: string | null;
  isVideo?: boolean; isAnimated?: boolean; name: string;
  className?: string; onLoaded?: () => void; onError?: () => void;
}) {
  // isVideo = locally stored MP4 blob (served from /api/v1/cards/:id/image)
  if (isVideo && imageUrl) {
    return (
      <video
        src={imageUrl}
        autoPlay muted loop playsInline
        onLoadedData={onLoaded}
        onError={onError}
        className={className}
      />
    );
  }

  // isAnimated + videoUrl: WebM from CDN — GIF/image loads first and is
  // always visible; the WebM plays on top ONCE it has actually loaded, and
  // is hidden again if it errors or times out. Previously the <video> had
  // no onError handler at all, so a broken/slow WebM (common — some CDNs
  // serve WebMs that certain browsers can't decode, or the file 404s) would
  // never fire onLoaded *or* onError, leaving the card stuck on the loading
  // spinner forever with no way for "tap to retry" to do anything, even
  // though the GIF right underneath it had already loaded fine.
  if (isAnimated && videoUrl) {
    return <AnimatedCardMedia imageUrl={imageUrl} gifUrl={gifUrl} videoUrl={videoUrl} name={name} className={className} onLoaded={onLoaded} onError={onError} />;
  }

  // Default: static or GIF image
  // Eager loading is used for all card images on this page (changed from a
  // mixed lazy/eager strategy) — the card grid is the focal content of this
  // page, so deferring offscreen images no longer made sense here.
  return (
    <img
      decoding="async"
      src={isAnimated ? (gifUrl || imageUrl) : imageUrl}
      alt={name}
      loading="eager"
      onLoad={onLoaded}
      onError={onError}
      className={className}
    />
  );
}

function AnimatedCardMedia({
  imageUrl, gifUrl, videoUrl, name, className, onLoaded, onError,
}: {
  imageUrl: string; gifUrl?: string; videoUrl: string; name: string;
  className?: string; onLoaded?: () => void; onError?: () => void;
}) {
  const [gifReady, setGifReady] = useState(false);
  const [gifFailed, setGifFailed] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  // Safety net: if the WebM hasn't loaded (or errored) within a few
  // seconds, stop waiting on it and fall back to the GIF so the card
  // doesn't sit on a spinner forever for a CDN request that will never
  // resolve. The video element is unmounted (not just hidden) once this
  // fires, so a connection that eventually does complete doesn't pop the
  // video back in after the fact.
  useEffect(() => {
    if (videoReady || videoFailed) return;
    const t = setTimeout(() => setVideoFailed(true), 6000);
    return () => clearTimeout(t);
  }, [videoReady, videoFailed]);

  // The GIF and WebM are two independent attempts at showing the same
  // animation, not a primary-plus-fallback pair — either one succeeding is
  // enough to consider the card "loaded". This matters because the GIF URL
  // for shoob-sourced cards is a *constructed* guess (tier + file_hash
  // pieced into a CDN path, not a URL that's actually been confirmed to
  // exist), so it 404s more often than the WebM, which is always a real
  // stored URL. Treating the GIF as a hard dependency — reporting onError
  // and giving up the whole card the moment it fails — was the bug: a
  // guessed GIF URL failing was taking down cards whose WebM was fine.
  // The card is only reported as failed (onError, "No Image") if *both*
  // media fail; onLoaded fires the first time either one succeeds.
  const handleGifLoad = () => { setGifReady(true); onLoaded?.(); };
  const handleGifError = () => {
    setGifFailed(true);
    if (videoFailed) onError?.();
  };
  const handleVideoLoad = () => { setVideoReady(true); onLoaded?.(); };
  const handleVideoError = () => {
    setVideoFailed(true);
    if (gifFailed) { onError?.(); return; }
    if (!gifReady) {
      // Video failed but the GIF hasn't reported success or failure yet
      // (still loading, or there's no gifUrl to try at all) — if there's
      // no GIF to fall back to, this is a real failure; otherwise wait for
      // the GIF's own onLoad/onError to decide.
      if (!gifUrl) onError?.();
    }
  };

  return (
    <div className="relative w-full h-full">
      <img
        decoding="async"
        src={gifUrl || imageUrl}
        alt={name}
        loading="eager"
        onLoad={handleGifLoad}
        onError={handleGifError}
        className={cn("absolute inset-0 w-full h-full object-cover", className, videoReady && "opacity-0")}
      />
      {!videoFailed && (
        <video
          autoPlay loop muted playsInline
          onLoadedData={handleVideoLoad}
          onError={handleVideoError}
          className={cn(
            "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
            videoReady ? "opacity-100" : "opacity-0"
          )}
        >
          <source src={videoUrl} type="video/webm" />
        </video>
      )}
    </div>
  );
}

function CardDisplay({ card, showOwned, onOpen }: { card: any; showOwned?: boolean; onOpen: (card: any) => void }) {
  const cfg = TIER_CONFIG[card.tier] || TIER_CONFIG["T1"];
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 2;

  const handleImgError = () => {
    if (retryCount < MAX_RETRIES) {
      const delay = 1500 * (retryCount + 1);
      setTimeout(() => {
        setRetryCount((c) => c + 1);
        setRetryKey((k) => k + 1);
      }, delay);
    } else {
      setImgError(true);
      setImgLoaded(true);
    }
  };

  const handleManualRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    setImgError(false);
    setImgLoaded(false);
    setRetryCount(0);
    setRetryKey((k) => k + 1);
  };

  const hasImage = !!card.imageUrl;

  return (
    <div className="relative group cursor-pointer" onClick={() => onOpen(card)}>
      <div className={cn(
        "glass-card rounded-xl overflow-hidden border transition-all duration-300 group-hover:-translate-y-2 flex flex-col",
        cfg.border,
        "group-hover:" + cfg.glow
      )}>
        {/* Card Image */}
        <div className={cn("relative w-full aspect-[3/4] overflow-hidden", cfg.bg)}>
          {hasImage && !imgLoaded && !imgError && (
            <div className="absolute inset-0 animate-pulse bg-white/5 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          )}

          {hasImage && !imgError ? (
            <div className={cn(
              "w-full h-full transition-all duration-500 group-hover:scale-105",
              imgLoaded ? "opacity-100" : "opacity-0"
            )}>
              <CardMedia
                key={retryKey}
                imageUrl={card.imageUrl}
                gifUrl={card.gifUrl}
                videoUrl={card.videoUrl}
                isVideo={card.isVideo}
                isAnimated={card.isAnimated}
                name={card.name}
                className="w-full h-full object-cover"
                onLoaded={() => setImgLoaded(true)}
                onError={handleImgError}
              />
            </div>
          ) : (
            <div
              className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-2 cursor-pointer"
              onClick={handleManualRetry}
              title="Tap to retry loading image"
            >
              <ImageOff className="w-8 h-8 opacity-40" />
              <span className="text-[10px] font-mono opacity-40">No Image</span>
              <span className="text-[9px] text-primary/60 font-mono border border-primary/20 rounded px-2 py-0.5 mt-1">tap to retry</span>
            </div>
          )}

          {/* Tier badge */}
          <div className={cn(
            "absolute top-2 left-2 px-2 py-0.5 rounded font-bold text-xs border font-mono",
            cfg.bg, cfg.text, cfg.border
          )}>
            {card.tier}
          </div>

          {/* Series badge */}
          <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/70 rounded border border-white/10 text-[10px] text-white/70 max-w-[60%] truncate">
            {card.series}
          </div>

          {/* Event badge — shown when an event card surfaces in the mixed
              All Cards view, so it's clear at a glance this one is
              event-exclusive rather than from normal spawns. */}
          {card.isEvent && (
            <div className="absolute top-9 right-2 px-2 py-0.5 bg-pink-500/80 rounded text-[9px] text-white font-bold uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5" />
              {card.eventName || "Event"}
            </div>
          )}

          {/* Owned badge */}
          {showOwned && (
            <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-primary/80 rounded text-[10px] text-white font-bold uppercase tracking-wider">
              Owned
            </div>
          )}

          {/* Tap to view hint */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center opacity-0 group-hover:opacity-100">
            <span className="text-xs text-white/80 bg-black/60 px-3 py-1 rounded-full border border-white/10 backdrop-blur-sm">
              View Details
            </span>
          </div>

          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/90 to-transparent" />
        </div>

        {/* Card Footer */}
        <div className="p-3 bg-black/50">
          <h3 className={cn("font-serif font-bold text-white truncate text-sm mb-0.5")}>{card.name}</h3>

          {card.owners && card.owners.length > 0 && (
            <div className="flex items-center gap-1 mb-2">
              <Users className="w-3 h-3 text-muted-foreground shrink-0" />
              <p className="text-[10px] text-muted-foreground truncate">
                {card.owners.slice(0, 2).map((o: any) => typeof o === "string" ? o : (o.name || o.id)).join(", ")}
                {card.owners.length > 2 ? ` +${card.owners.length - 2}` : ""}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            {card.totalCopies > 0
              ? <span className="text-[10px] text-muted-foreground">{card.totalCopies.toLocaleString()} in existence</span>
              : <span className="text-[10px] text-muted-foreground/40 italic">tap to see owners</span>
            }
            <span className="text-[10px] text-primary/60 font-mono">tap to view</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const FUSE_RECIPES: { tier: string; cost: number; next: string }[] = [
  { tier: "T1", cost: 10, next: "T2" },
  { tier: "T2", cost: 8,  next: "T3" },
  { tier: "T3", cost: 6,  next: "T4" },
  { tier: "T4", cost: 5,  next: "T5" },
  { tier: "T5", cost: 5,  next: "T6" },
];

const TIER_LABELS: Record<string, string> = {
  T1:"Common", T2:"Uncommon", T3:"Rare", T4:"Epic", T5:"Legendary", T6:"Animated",
};

function FusionPanel({ isAuthenticated, myCards }: { isAuthenticated: boolean; myCards: any }) {
  const { toast } = useToast();
  const [fusingTier, setFusingTier] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const { token } = useAuth();

  // Card-selection state
  const [stagingTier, setStagingTier] = useState<string | null>(null);
  const [selectedCopyIds, setSelectedCopyIds] = useState<Set<string>>(new Set());

  // Target-card selection state — populated when the API reports more than
  // one possible result card for this tier and needs an explicit choice.
  const [targetOptions, setTargetOptions] = useState<any[] | null>(null);
  const [pendingFuseArgs, setPendingFuseArgs] = useState<{ tier: string; cardIds: string[] } | null>(null);

  // Build per-tier card lists from my collection
  const cardsByTier = (myCards?.cards ?? []).reduce((acc: Record<string, any[]>, uc: any) => {
    const t = uc.card?.tier || uc.tier;
    if (t) {
      if (!acc[t]) acc[t] = [];
      acc[t].push(uc);
    }
    return acc;
  }, {} as Record<string, any[]>);

  const openPicker = (tier: string) => {
    setStagingTier(tier);
    setSelectedCopyIds(new Set());
    setResult(null);
  };

  const closePicker = () => {
    setStagingTier(null);
    setSelectedCopyIds(new Set());
    setTargetOptions(null);
    setPendingFuseArgs(null);
  };

  const toggleCard = (copyId: string, cost: number) => {
    setSelectedCopyIds((prev) => {
      const next = new Set(prev);
      if (next.has(copyId)) {
        next.delete(copyId);
      } else if (next.size < cost) {
        next.add(copyId);
      }
      return next;
    });
  };

  const handleFuse = async (tier: string, cardIds: string[], targetCardId?: string) => {
    setFusingTier(tier);
    setResult(null);
    try {
      const r = await fetch("/api/v1/cards/fuse", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tier, cardIds, targetCardId }),
      });
      const j = await r.json();
      if (j.success) {
        setResult(j.result);
        setTargetOptions(null);
        setPendingFuseArgs(null);
        closePicker();
        toast({ title: "⚗️ Fusion Successful!", description: `You fused a ${j.result.tier} card: ${j.result.name}` });
      } else if (j.needsTargetSelection && Array.isArray(j.options)) {
        // Don't close the picker — show the result-card choices instead.
        setTargetOptions(j.options);
        setPendingFuseArgs({ tier, cardIds });
      } else {
        toast({ title: "Fusion Failed", description: j.message, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Could not reach the server.", variant: "destructive" });
    } finally {
      setFusingTier(null);
    }
  };

  if (!isAuthenticated) {
    return (
      <LockedPanel
        color="sky"
        icon={<Flame className="w-10 h-10 text-rose-400 animate-pulse" />}
        title="Card Fusion"
        desc="Sacrifice lower-tier duplicates to fuse a card of higher power. Log in to access the Fusion Chamber."
        badge="Login Required"
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="glass-card rounded-xl border border-rose-500/20 bg-rose-500/5 p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-rose-500/8 via-transparent to-transparent" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shadow-[0_0_24px_rgba(244,63,94,0.3)]">
            <Flame className="w-7 h-7 text-rose-400 animate-pulse" />
          </div>
          <div>
            <h3 className="font-serif text-2xl font-bold text-white">Fusion Chamber</h3>
            <p className="text-muted-foreground text-sm mt-0.5">Choose which cards to sacrifice — fuse them into a card of higher power.</p>
          </div>
        </div>
      </div>

      {/* Card picker modal */}
      {stagingTier && (() => {
        const recipe = FUSE_RECIPES.find((r) => r.tier === stagingTier)!;
        const tierCards: any[] = cardsByTier[stagingTier] || [];
        const cfg = TIER_CONFIG[stagingTier];
        const nextCfg = TIER_CONFIG[recipe.next];
        const ready = selectedCopyIds.size === recipe.cost;
        const loading = fusingTier === stagingTier;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200" onClick={closePicker}>
            <div
              className={cn("relative w-full max-w-lg rounded-2xl border bg-[#07070f] shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden", cfg?.border)}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className={cn("p-5 border-b", "border-white/5", cfg?.bg)}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={cn("text-xs font-bold uppercase tracking-widest", cfg?.text)}>
                      {stagingTier} → {recipe.next} Fusion
                    </p>
                    <p className="text-white text-lg font-serif font-bold mt-0.5">
                      Select {recipe.cost} cards to sacrifice
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "px-3 py-1 rounded-full text-sm font-bold border font-mono",
                      ready ? "bg-rose-500/20 border-rose-500/50 text-rose-300" : "border-white/10 text-white/40"
                    )}>
                      {selectedCopyIds.size}/{recipe.cost}
                    </div>
                    <button onClick={closePicker} className="w-8 h-8 rounded-full bg-black/60 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-white transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {/* Fusion arrow */}
                <div className="flex items-center gap-2 mt-3">
                  <div className={cn("px-2 py-0.5 rounded text-xs font-bold border", cfg?.bg, cfg?.text, cfg?.border)}>{stagingTier} ×{recipe.cost}</div>
                  <Sparkles className="w-3 h-3 text-rose-400" />
                  <div className={cn("px-2 py-0.5 rounded text-xs font-bold border", nextCfg?.bg, nextCfg?.text, nextCfg?.border)}>{recipe.next} ×1</div>
                  <span className="text-white/30 text-xs ml-1">(random)</span>
                </div>
              </div>

              {/* Card list */}
              <div className="max-h-80 overflow-y-auto p-3 space-y-2">
                {tierCards.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8 text-sm">No {stagingTier} cards in your collection.</p>
                ) : tierCards.map((uc: any) => {
                  const card = uc.card || uc;
                  const copyId = String(uc.userCardId || card.copyId || card.id);
                  const isSelected = selectedCopyIds.has(copyId);
                  const isDisabled = !isSelected && selectedCopyIds.size >= recipe.cost;
                  return (
                    <button
                      key={copyId}
                      onClick={() => toggleCard(copyId, recipe.cost)}
                      disabled={isDisabled}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all",
                        isSelected
                          ? `${cfg?.bg} ${cfg?.border} shadow-md`
                          : isDisabled
                          ? "border-white/5 bg-white/2 opacity-40 cursor-not-allowed"
                          : "border-white/8 bg-black/30 hover:border-white/20 hover:bg-white/5"
                      )}
                    >
                      {/* Checkbox indicator */}
                      <div className={cn(
                        "w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-all",
                        isSelected ? `${cfg?.border} ${cfg?.bg}` : "border-white/20 bg-black/40"
                      )}>
                        {isSelected && <span className={cn("text-xs font-bold", cfg?.text)}>✓</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{card.name}</p>
                        <p className="text-[10px] text-white/40 truncate">{card.series || "General"} · Copy #{copyId}</p>
                      </div>
                      {isSelected && (
                        <span className={cn("text-[10px] font-bold uppercase shrink-0", cfg?.text)}>Selected</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Target-card selection — shown when more than one result is possible */}
              {targetOptions && pendingFuseArgs && (
                <div className="p-4 border-t border-white/5 space-y-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-amber-400 mb-2">
                    Choose which card you receive:
                  </p>
                  <div className="max-h-48 overflow-y-auto space-y-1.5">
                    {targetOptions.map((opt: any) => (
                      <button
                        key={opt.id}
                        onClick={() => handleFuse(pendingFuseArgs.tier, pendingFuseArgs.cardIds, opt.id)}
                        disabled={loading}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-white/10 bg-black/30 hover:border-amber-400/50 hover:bg-amber-400/5 text-left transition-all disabled:opacity-50"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate">{opt.name}</p>
                          {opt.series && <p className="text-[10px] text-white/40 truncate">{opt.series}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => { setTargetOptions(null); setPendingFuseArgs(null); }}
                    className="text-[10px] text-white/40 hover:text-white/70 uppercase tracking-widest mt-1"
                  >
                    ← Back
                  </button>
                </div>
              )}

              {/* Confirm */}
              {!targetOptions && (
              <div className="p-4 border-t border-white/5">
                <Button
                  onClick={() => handleFuse(stagingTier, Array.from(selectedCopyIds))}
                  disabled={!ready || loading}
                  className={cn(
                    "w-full h-11 font-bold uppercase tracking-widest text-xs transition-all",
                    ready
                      ? "bg-rose-500/20 hover:bg-rose-500/40 text-rose-400 border border-rose-500/50 shadow-[0_0_14px_rgba(244,63,94,0.2)]"
                      : "bg-white/5 text-white/20 border border-white/5 cursor-not-allowed"
                  )}
                >
                  {loading ? (
                    <><RefreshCw className="w-3 h-3 mr-2 animate-spin" /> Fusing…</>
                  ) : ready ? (
                    <><Flame className="w-3 h-3 mr-2" /> Confirm Fusion — Sacrifice {recipe.cost} {stagingTier}</>
                  ) : (
                    <>Select {recipe.cost - selectedCopyIds.size} more card{recipe.cost - selectedCopyIds.size !== 1 ? "s" : ""}</>
                  )}
                </Button>
              </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Recipes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {FUSE_RECIPES.map(({ tier, cost, next }) => {
          const tierCardList: any[] = cardsByTier[tier] || [];
          const have = tierCardList.length;
          const canFuse = have >= cost;
          const cfg = TIER_CONFIG[tier];
          const nextCfg = TIER_CONFIG[next];

          return (
            <div key={tier} className={cn(
              "glass-card rounded-xl border p-5 flex flex-col gap-4 transition-all",
              canFuse ? `${cfg?.border} hover:scale-[1.02]` : "border-white/5 opacity-60"
            )}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={cn("text-xs font-bold uppercase tracking-widest mb-0.5", cfg?.text)}>{tier} — {TIER_LABELS[tier]}</p>
                  <p className="text-white/40 text-xs">Requires {cost} cards · you have {have}</p>
                </div>
                <div className={cn("px-2 py-0.5 rounded text-xs font-bold border", canFuse ? `${cfg?.bg} ${cfg?.text} ${cfg?.border}` : "border-white/10 text-white/30")}>
                  {have}/{cost}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className={cn("flex-1 rounded-lg p-2 text-center border", cfg?.border, cfg?.bg)}>
                  <p className={cn("text-lg font-serif font-bold", cfg?.text)}>{tier}</p>
                  <p className="text-[10px] text-white/50">×{cost}</p>
                </div>
                <Sparkles className="w-4 h-4 text-rose-400 shrink-0" />
                <div className={cn("flex-1 rounded-lg p-2 text-center border", nextCfg?.border, nextCfg?.bg)}>
                  <p className={cn("text-lg font-serif font-bold", nextCfg?.text)}>{next}</p>
                  <p className="text-[10px] text-white/50">×1</p>
                </div>
              </div>

              <Button
                onClick={() => canFuse && openPicker(tier)}
                disabled={!canFuse}
                className={cn(
                  "w-full h-10 font-bold uppercase tracking-widest text-xs transition-all",
                  canFuse
                    ? "bg-rose-500/20 hover:bg-rose-500/40 text-rose-400 border border-rose-500/50 shadow-[0_0_14px_rgba(244,63,94,0.2)]"
                    : "bg-white/5 text-white/20 border border-white/5 cursor-not-allowed"
                )}
              >
                <Flame className="w-3 h-3 mr-2" />
                {canFuse ? `Select Cards to Fuse` : `Need ${cost - have} more`}
              </Button>
            </div>
          );
        })}
      </div>

      {/* Result card */}
      {result && (
        <div className="glass-card rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 flex flex-col sm:flex-row items-center gap-6">
          {result.imageUrl && (
            <img
              src={result.imageUrl}
              alt={result.name}
              className="w-32 h-44 object-cover rounded-lg border border-emerald-500/30 shrink-0 shadow-[0_0_24px_rgba(52,211,153,0.3)]"
            />
          )}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-400 mb-1">⚗️ Fusion Result</p>
            <h4 className="font-serif text-xl font-bold text-white">{result.name}</h4>
            <p className={cn("text-sm font-bold mt-1", TIER_CONFIG[result.tier]?.text)}>
              {result.tier} — {TIER_LABELS[result.tier] || result.tier}
            </p>
            <p className="text-xs text-white/40 font-mono mt-2">Copy ID: {result.copyId}</p>
          </div>
        </div>
      )}

      <p className="text-center text-xs text-white/25 font-mono">
        You can also fuse via the bot: <span className="text-white/50">.fuse T1</span>
      </p>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="glass-card rounded-xl overflow-hidden border border-white/5 animate-pulse">
      <div className="w-full aspect-[3/4] bg-white/5" />
      <div className="p-3 bg-black/40 space-y-2">
        <div className="h-4 bg-white/5 rounded w-3/4" />
        <div className="h-3 bg-white/5 rounded w-1/2" />
      </div>
    </div>
  );
}

function Empty({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <div className="py-20 text-center glass-card rounded-xl border border-white/5 flex flex-col items-center gap-4">
      {icon && <div className="w-16 h-16 rounded-full bg-black/50 border border-white/10 flex items-center justify-center">{icon}</div>}
      <p className="text-muted-foreground max-w-md">{text}</p>
    </div>
  );
}

function ErrorState({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <div className="py-20 text-center glass-card rounded-xl border border-red-500/20 bg-red-500/5 flex flex-col items-center gap-4">
      {icon && <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">{icon}</div>}
      <p className="text-red-400/80 max-w-md">{text}</p>
    </div>
  );
}

function LockedPanel({ color, icon, title, desc, badge }: { color: string; icon: React.ReactNode; title: string; desc: string; badge: string }) {
  const colors: Record<string, string> = {
    amber: "border-amber-500/20 bg-amber-500/5",
    sky:   "border-rose-500/20 bg-rose-500/5",
    emerald: "border-emerald-500/20 bg-emerald-500/5",
  };
  const iconBg: Record<string, string> = {
    amber: "bg-amber-500/10 border-amber-500/30 shadow-[0_0_30px_rgba(245,158,11,0.25)]",
    sky:   "bg-rose-500/10 border-rose-500/30 shadow-[0_0_30px_rgba(160,0,26,0.25)]",
    emerald: "bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_30px_rgba(52,211,153,0.25)]",
  };
  const badgeColors: Record<string, string> = {
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    sky:   "border-rose-500/30 bg-rose-500/10 text-rose-400",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  };

  return (
    <div className={cn("py-24 text-center glass-card rounded-xl border flex flex-col items-center relative overflow-hidden", colors[color])}>
      <div className="absolute inset-0 bg-gradient-to-b from-current/5 to-transparent opacity-10" />
      <div className="relative z-10">
        <div className={cn("w-20 h-20 rounded-full border flex items-center justify-center mb-6 mx-auto", iconBg[color])}>
          {icon}
        </div>
        <h3 className="font-serif text-2xl font-bold text-white mb-3">{title}</h3>
        <p className="text-muted-foreground max-w-md mx-auto mb-6">{desc}</p>
        <div className={cn("px-6 py-2 rounded-full border text-sm font-bold tracking-widest uppercase inline-block", badgeColors[color])}>
          {badge}
        </div>
      </div>
    </div>
  );
}
