import { useGetLeaderboard, useGetMyRank } from "@workspace/api-client-react/src/generated/api";
import { useAuth } from "@/lib/auth";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trophy, Medal, Crown } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Leaderboard() {
  const { isAuthenticated } = useAuth();
  const { data: leaderboard, isLoading } = useGetLeaderboard();
  const { data: myRank } = useGetMyRank({ query: { enabled: isAuthenticated } as any });

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto space-y-8">
      <div className="text-center mb-12">
        <p className="text-primary/40 font-mono tracking-[0.4em] text-xs uppercase mb-2">反逆</p>
        <h1 className="font-serif text-4xl md:text-5xl font-bold text-white neon-text-sky tracking-widest uppercase mb-4">Rebellion Rankings</h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">The most powerful members within Requiem Order. Rank is determined by experience points gained through missions and activity.</p>
      </div>

      <div className="glass-card rounded-xl border border-white/10 overflow-hidden bg-black/40">
        <div className="p-6 border-b border-white/10 bg-primary/5 flex items-center gap-3">
          <Trophy className="w-6 h-6 text-primary" />
          <h2 className="font-serif text-xl font-bold text-white tracking-widest uppercase">Global Rankings</h2>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="h-16 bg-white/5 rounded animate-pulse" />
            ))}
          </div>
        ) : leaderboard?.entries && leaderboard.entries.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="w-[100px] text-center font-serif text-primary">Rank</TableHead>
                  <TableHead className="font-serif text-primary">Operative</TableHead>
                  <TableHead className="font-serif text-primary">Guild</TableHead>
                  <TableHead className="text-right font-serif text-primary">Dungeon Lvl</TableHead>
                  <TableHead className="text-right font-serif text-primary">XP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaderboard.entries.map((entry: any) => (
                  <TableRow 
                    key={entry.userId} 
                    className={cn(
                      "border-white/5 transition-colors",
                      entry.rank === 1 ? "bg-amber-500/10 hover:bg-amber-500/20" :
                      entry.rank === 2 ? "bg-slate-300/10 hover:bg-slate-300/20" :
                      entry.rank === 3 ? "bg-amber-700/10 hover:bg-amber-700/20" : "hover:bg-white/5"
                    )}
                  >
                    <TableCell className="text-center font-mono text-lg font-bold">
                      {entry.rank === 1 ? <Crown className="w-6 h-6 text-amber-400 mx-auto drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]" /> :
                       entry.rank === 2 ? <Medal className="w-6 h-6 text-slate-300 mx-auto" /> :
                       entry.rank === 3 ? <Medal className="w-6 h-6 text-amber-700 mx-auto" /> : 
                       <span className="text-muted-foreground">#{entry.rank}</span>}
                    </TableCell>
                    <TableCell className="font-bold text-white">{entry.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{entry.guildName || "-"}</TableCell>
                    <TableCell className="text-right font-mono text-primary">{entry.level}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{entry.xp.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="p-12 text-center text-muted-foreground">
            No ranking data available.
          </div>
        )}

        {/* User's own rank pinned at the bottom if logged in and not in top 10 */}
        {isAuthenticated && myRank && myRank.rank > 10 && (
          <div className="border-t-2 border-primary border-dashed bg-primary/10">
            <Table>
              <TableBody>
                <TableRow className="border-none hover:bg-primary/20 transition-colors">
                  <TableCell className="w-[100px] text-center font-mono text-lg font-bold text-primary">#{myRank.rank}</TableCell>
                  <TableCell className="font-bold text-white">{myRank.entry.name} <span className="text-xs text-primary ml-2 uppercase tracking-widest">(You)</span></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{myRank.entry.guildName || "-"}</TableCell>
                  <TableCell className="text-right font-mono text-primary">{myRank.entry.level}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{myRank.entry.xp.toLocaleString()}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}