import { useState, useEffect } from "react";
import { useGetShopItems, useBuyShopItem, useGetUserStats, useGetLotteryState } from "@workspace/api-client-react/src/generated/api";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wallet, Sparkles, AlertCircle, Ticket, Users, Crown, Trophy, ChevronRight, Landmark, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

export default function Shop() {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: shopData, isLoading: loadingShop } = useGetShopItems();
  const { data: userStats } = useGetUserStats({ query: { enabled: isAuthenticated } as any });
  const { data: lotteryData, isLoading: lotteryLoading } = useGetLotteryState();

  const buyItemMutation = useBuyShopItem({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Purchase Successful",
          description: data.message,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/v1/user/stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/v1/user/inventory"] });
      },
      onError: (error) => {
        toast({
          title: "Transaction Failed",
          description: error.message || "You do not have enough currency.",
          variant: "destructive",
        });
      }
    }
  });

  const handleBuy = (itemId: number) => {
    if (!isAuthenticated) {
      toast({
        title: "Authentication Required",
        description: "You must be logged in to make purchases.",
        variant: "destructive"
      });
      return;
    }
    buyItemMutation.mutate({ data: { itemId, quantity: 1 } });
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-10 gap-4">
        <div>
          <p className="text-primary/40 font-mono tracking-[0.4em] text-xs uppercase mb-1">反逆</p>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-white neon-text-sky tracking-widest uppercase">Requiem Order Exchange</h1>
          <p className="text-muted-foreground mt-2">Trade your gold for the tools of rebellion. All transactions are final.</p>
        </div>
        
        {isAuthenticated && userStats && (
          <div className="glass-card px-4 py-2 flex items-center gap-3 border-primary/30 rounded-full bg-black/60 shadow-[0_0_15px_rgba(0,0,0,0.5)]">
            <Wallet className="w-4 h-4 text-amber-400" />
            <span className="text-sm text-muted-foreground uppercase tracking-widest">Balance:</span>
            <span className="font-mono text-lg font-bold text-amber-400">{userStats.profile.balance.toLocaleString()}</span>
          </div>
        )}
      </div>

      <div className="space-y-20">

        {/* LOTTERY SECTION */}
        <LotterySection lotteryData={lotteryData} lotteryLoading={lotteryLoading} userStats={userStats} />

        {/* SHOP ITEMS */}
        {loadingShop ? (
          <div className="space-y-12">
            {[1, 2].map(cat => (
              <div key={cat}>
                <div className="h-8 w-48 bg-white/5 rounded animate-pulse mb-6" />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {[1,2,3,4].map(i => (
                    <div key={i} className="h-64 glass-card rounded-xl animate-pulse bg-white/5" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : shopData?.categories ? (
          <div className="space-y-16">
            {shopData.categories.map((category: any) => (
              <div key={category.name}>
                <div className="flex items-center gap-4 mb-8">
                  <h2 className="font-serif text-2xl font-bold text-white capitalize tracking-widest">
                    {category.name === "passive" ? "Bank Notes" : category.name === "lottery" ? "Lottery Tickets" : category.name}
                  </h2>
                  {category.name === "passive" && (
                    <Badge variant="outline" className="text-rose-400 border-rose-400/30 uppercase text-[10px] tracking-widest">
                      Expands Bank Storage
                    </Badge>
                  )}
                  <div className="h-[1px] flex-1 bg-gradient-to-r from-primary/50 to-transparent" />
                </div>

                {category.name === "passive" && (
                  <div className="mb-6 glass-card rounded-lg p-4 border border-rose-400/20 bg-rose-500/5">
                    <div className="flex items-start gap-3">
                      <Landmark className="w-5 h-5 text-rose-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm text-rose-300 font-semibold mb-1">Bank Note System</p>
                        <p className="text-xs text-muted-foreground">Purchasing a Bank Note permanently increases your maximum bank storage capacity. Higher denomination notes grant more storage space. Your current bank max: <span className="text-rose-400 font-bold">{(userStats?.profile as any)?.bankMax?.toLocaleString?.() ?? "50,000"}</span></p>
                      </div>
                    </div>
                  </div>
                )}
                {category.name === "lottery" && (
                  <div className="mb-6 glass-card rounded-lg p-4 border border-amber-400/20 bg-amber-500/5">
                    <div className="flex items-start gap-3">
                      <Ticket className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm text-amber-300 font-semibold mb-1">Lottery Ticket System</p>
                          {userStats && (
                            <span className="text-xs font-mono text-amber-400 font-bold">
                              🎫 {(userStats as any).profile?.lotteryTickets ?? 0} ticket{((userStats as any).profile?.lotteryTickets ?? 0) !== 1 ? "s" : ""} in your wallet
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">Each ticket grants one entry into the Requiem Order 反逆 global lottery. Type <span className="font-mono text-amber-400">.lottery</span> in WhatsApp to enter, or <span className="font-mono text-amber-400">.ll</span> to check the pool. <span className="text-amber-400 font-semibold">Max 5 tickets per day.</span> 3 winners are drawn automatically when 15 operatives enter.</p>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {category.items.map((item: any) => (
                    <ShopItemCard
                      key={item.id}
                      item={item}
                      category={category.name}
                      onBuy={handleBuy}
                      isPending={buyItemMutation.isPending}
                      canAfford={!isAuthenticated || !userStats || userStats.profile.balance >= item.price}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground glass-card rounded-xl">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p>The shop is currently closed. Come back later.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ShopItemCard({ item, category, onBuy, isPending, canAfford }: any) {
  const categoryColor = category.toLowerCase() === "passive" 
    ? { badge: "text-rose-400 border-rose-400/30", btn: "bg-rose-500/10 hover:bg-rose-500/30 text-rose-400 hover:text-white border border-rose-500/50" }
    : category.toLowerCase() === "consumable"
    ? { badge: "text-green-400 border-green-400/30", btn: "bg-green-500/10 hover:bg-green-500/30 text-green-400 hover:text-white border border-green-500/50" }
    : { badge: "text-amber-400 border-amber-400/30", btn: "bg-primary/20 hover:bg-primary text-primary hover:text-white border border-primary/50" };

  return (
    <Card className="glass-card border-white/10 bg-black/40 flex flex-col group hover:border-primary/30 transition-colors">
      <CardHeader className="pb-4">
        <div className="flex justify-between items-start mb-2">
          <Badge variant="outline" className={cn("uppercase tracking-widest text-[10px] border-white/20", categoryColor.badge)}>
            {category}
          </Badge>
        </div>
        <CardTitle className="font-serif text-xl text-white">{item.name}</CardTitle>
        <CardDescription className="text-muted-foreground min-h-[40px]">
          {item.description}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="flex-1 pb-4">
        <div className="bg-black/50 p-3 rounded-lg border border-white/5 mb-4">
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-gray-300 leading-relaxed">{item.effect}</p>
          </div>
        </div>
      </CardContent>
      
      <CardFooter className="pt-0 flex items-center justify-between border-t border-white/5 px-6 py-4">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-lg font-bold text-amber-400">{item.price.toLocaleString()}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Gold</span>
        </div>
        <Button 
          onClick={() => onBuy(item.id)}
          disabled={isPending || !canAfford}
          className={cn("text-xs font-bold tracking-widest uppercase rounded-sm transition-all", categoryColor.btn)}
        >
          {!canAfford ? "Can't Afford" : "Purchase"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function LotterySection({ lotteryData, lotteryLoading, userStats }: any) {
  const [tickerIndex, setTickerIndex] = useState(0);
  const recentWinners = lotteryData?.recentWinners || [];

  useEffect(() => {
    if (recentWinners.length === 0) return;
    const id = setInterval(() => {
      setTickerIndex(i => (i + 1) % recentWinners.length);
    }, 3500);
    return () => clearInterval(id);
  }, [recentWinners.length]);

  const entryCount = lotteryData?.entryCount ?? 0;
  const maxEntries = lotteryData?.maxEntries ?? 15;
  const entries = lotteryData?.entries ?? [];
  const fillPercent = Math.round((entryCount / maxEntries) * 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 mb-2">
        <h2 className="font-serif text-2xl font-bold text-white tracking-widest uppercase flex items-center gap-2">
          <Ticket className="w-6 h-6 text-amber-400" /> Requiem Order Lottery
        </h2>
        {userStats && (
          <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/25 rounded-full px-3 py-1 shrink-0">
            <Ticket className="w-3 h-3 text-amber-400" />
            <span className="text-xs text-amber-300 font-mono font-bold">{(userStats as any).profile?.lotteryTickets ?? 0} tickets</span>
          </div>
        )}
        <div className="h-[1px] flex-1 bg-gradient-to-r from-amber-500/50 to-transparent" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Poll Panel */}
        <div className="lg:col-span-2 glass-card rounded-xl border border-amber-500/20 overflow-hidden">
          <div className="bg-amber-500/10 px-6 py-4 border-b border-amber-500/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Ticket className="w-5 h-5 text-amber-400" />
              <span className="font-serif font-bold text-white tracking-wider">Active Lottery Pool</span>
            </div>
            <Badge className={cn(
              "uppercase text-[10px] tracking-widest font-bold",
              lotteryData?.active ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-muted/20 text-muted-foreground border border-white/10"
            )}>
              {lotteryData?.active ? "● Live" : "Waiting"}
            </Badge>
          </div>

          {lotteryLoading ? (
            <div className="p-6 space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-8 bg-white/5 rounded animate-pulse" />)}
            </div>
          ) : (
            <div className="p-6 space-y-5">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground uppercase tracking-widest text-xs font-semibold">Entries</span>
                  <span className="font-mono text-amber-400 font-bold">{entryCount} / {maxEntries}</span>
                </div>
                {/* WhatsApp poll-style progress */}
                <div className="relative h-10 bg-black/60 rounded-lg overflow-hidden border border-white/10">
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-600/60 to-amber-400/40 transition-all duration-700 rounded-lg"
                    style={{ width: `${fillPercent}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-4 gap-2">
                    <Users className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-bold text-white">{fillPercent}% filled</span>
                    <span className="text-xs text-muted-foreground ml-auto">{maxEntries - entryCount} spots remaining</span>
                  </div>
                </div>
              </div>

              {/* Entry list */}
              {entries.length > 0 ? (
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {entries.map((entry: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 rounded bg-black/30 border border-white/5">
                      <span className="text-xs font-mono text-muted-foreground w-6">#{i+1}</span>
                      <span className="text-sm text-white font-medium flex-1">{entry.name}</span>
                      <span className="text-[10px] text-muted-foreground">joined</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center text-muted-foreground text-sm border border-dashed border-white/10 rounded-lg">
                  No entries yet. Be the first rebel to enter.
                </div>
              )}

              <div className="bg-black/40 rounded-lg p-4 border border-white/5 space-y-2">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="text-amber-400 font-mono font-bold">.lottery</span> — Type in the group to enter the lottery.
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="text-amber-400 font-mono font-bold">.ll</span> — Check how many operatives have entered.
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Once <span className="text-amber-400 font-bold">15 operatives</span> enter, <span className="text-amber-400 font-bold">3 winners</span> are drawn automatically from the pool.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Recent Winners Panel */}
        <div className="glass-card rounded-xl border border-amber-500/20 overflow-hidden">
          <div className="bg-amber-500/10 px-6 py-4 border-b border-amber-500/20 flex items-center gap-2">
            <Crown className="w-5 h-5 text-amber-400" />
            <span className="font-serif font-bold text-white tracking-wider">Recent Winners</span>
          </div>

          <div className="p-4 space-y-3">
            {lotteryLoading ? (
              <div className="space-y-2">
                {[1,2,3,4,5].map(i => <div key={i} className="h-14 bg-white/5 rounded animate-pulse" />)}
              </div>
            ) : recentWinners.length > 0 ? (
              <>
                {/* Animated ticker highlight */}
                <div className="relative overflow-hidden rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 mb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Trophy className="w-4 h-4 text-amber-400" />
                    <span className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">Latest Winner</span>
                  </div>
                  <p className="font-serif font-bold text-white truncate">{recentWinners[tickerIndex]?.name || "Rebel"}</p>
                  <p className="text-xs text-amber-400 font-mono">+{recentWinners[tickerIndex]?.prize?.toLocaleString() || 0} Gold</p>
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {recentWinners.map((winner: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded bg-black/30 border border-white/5">
                      <Trophy className="w-3 h-3 text-amber-400 shrink-0" />
                      <span className="text-sm text-white font-medium flex-1 truncate">{winner.name}</span>
                      <span className="text-xs font-mono text-amber-400">+{winner.prize?.toLocaleString() || 0}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="py-8 text-center text-muted-foreground text-sm">
                <Trophy className="w-10 h-10 mx-auto mb-3 opacity-20" />
                No winners yet. The first lottery draw awaits.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
