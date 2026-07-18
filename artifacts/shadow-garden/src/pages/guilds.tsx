import { useGetGuilds } from "@workspace/api-client-react/src/generated/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Shield, Search, Users, Calendar, ChevronRight } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";

export default function Guilds() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useGetGuilds({ search: search ? search : undefined });

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-white neon-text-purple tracking-widest uppercase">Factions</h1>
          <p className="text-muted-foreground mt-2">The organizations operating within the shadows.</p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input 
          placeholder="Search for a guild..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 h-12 bg-black/40 border-primary/30 text-white focus-visible:ring-primary rounded-sm"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="h-40 glass-card rounded-lg animate-pulse bg-white/5" />
          ))}
        </div>
      ) : data?.guilds && data.guilds.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.guilds.map((guild: any) => (
            <div key={guild.id} className="glass-card bg-black/40 border-white/10 rounded-xl p-6 group hover:border-primary/50 transition-all duration-300 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/4 group-hover:bg-primary/10 transition-colors" />
              
              <div className="flex items-start justify-between mb-4 relative z-10">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
                    <Shield className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-serif text-xl font-bold text-white leading-tight group-hover:text-primary transition-colors">{guild.name}</h3>
                    <p className="text-xs text-muted-foreground tracking-widest uppercase">Lvl {guild.level}</p>
                  </div>
                </div>
              </div>
              
              <p className="text-sm text-gray-400 mb-6 line-clamp-2 h-10 relative z-10">
                {guild.description || "No description provided by the guild master."}
              </p>
              
              <div className="grid grid-cols-2 gap-4 border-t border-white/5 pt-4 relative z-10">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Master</p>
                  <p className="text-sm text-white font-medium truncate">{guild.ownerName}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 flex items-center gap-1">
                    <Users className="w-3 h-3" /> Members
                  </p>
                  <p className="text-sm text-white font-medium">{guild.memberCount}</p>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-white/5 flex justify-end relative z-10">
                <Button variant="ghost" size="sm" className="text-primary hover:text-white hover:bg-primary/20 text-xs font-bold uppercase tracking-widest gap-1">
                  Details <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 glass-card rounded-xl border border-white/5">
          <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="font-serif text-xl text-white mb-2">No Guilds Found</h3>
          <p className="text-muted-foreground">The shadows are empty in this sector.</p>
        </div>
      )}
    </div>
  );
}