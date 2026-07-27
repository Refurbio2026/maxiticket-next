import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageShell } from "@/components/site/PageShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Music, Mic, Drum, Theater, Star, CalendarDays, MapPin, Image as ImageIcon } from "lucide-react";

export const Route = createFileRoute("/artists")({
  head: () => ({
    meta: [
      { title: "Umelci · vipky.sk" },
      { name: "description", content: "Objavte umelcov, kapely a interpretov vystupujúcich na podujatiach vipky.sk." },
      { property: "og:title", content: "Umelci · vipky.sk" },
      { property: "og:description", content: "Profily umelcov, nadchádzajúce podujatia a galéria." },
    ],
  }),
  component: ArtistsPage,
});

const CATS = [
  { id: "all", label: "Všetci", icon: Star },
  { id: "rock", label: "Rock / Pop", icon: Music },
  { id: "rap", label: "Rap / Hip-hop", icon: Mic },
  { id: "elektro", label: "Elektronika", icon: Drum },
  { id: "divadlo", label: "Divadlo", icon: Theater },
];

const ARTISTS = [
  { id: "ikona", name: "IKONA", cat: "rock", upcoming: 3, city: "Bratislava", color: "from-orange-500 to-pink-500" },
  { id: "nocnyportret", name: "Nočný Portrét", cat: "elektro", upcoming: 5, city: "Košice", color: "from-violet-500 to-blue-500" },
  { id: "mara", name: "MARA", cat: "rap", upcoming: 2, city: "Nitra", color: "from-amber-500 to-rose-500" },
  { id: "kvarteto", name: "Slovenské Kvarteto", cat: "divadlo", upcoming: 4, city: "Žilina", color: "from-emerald-500 to-teal-500" },
  { id: "elenak", name: "Elena K.", cat: "rock", upcoming: 6, city: "Bratislava", color: "from-rose-500 to-orange-500" },
  { id: "subbass", name: "SubBass Trio", cat: "elektro", upcoming: 2, city: "Banská Bystrica", color: "from-cyan-500 to-violet-500" },
  { id: "vincent", name: "Vincent & The Crew", cat: "rap", upcoming: 1, city: "Prešov", color: "from-yellow-500 to-orange-600" },
  { id: "teatro", name: "Teatro Nuova", cat: "divadlo", upcoming: 3, city: "Trnava", color: "from-indigo-500 to-pink-500" },
];

function ArtistsPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const list = useMemo(
    () => ARTISTS.filter((a) => (cat === "all" || a.cat === cat) && a.name.toLowerCase().includes(q.toLowerCase())),
    [q, cat],
  );
  return (
    <PageShell
      eyebrow="Umelci"
      title={<>Hviezdy, ktoré <span className="text-gradient-flame">tvoria scénu</span></>}
      description="Objavte interpretov, kapely a umelcov vystupujúcich na podujatiach vipky.sk. Profily, galéria a nadchádzajúce vystúpenia na jednom mieste."
      cta={
        <Button asChild className="bg-gradient-flame text-primary-foreground shadow-glow">
          <Link to="/events">Pozrieť všetky podujatia</Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Hľadať umelca…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 h-11 bg-card/60 border-border/60"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {CATS.map((c) => {
              const Icon = c.icon;
              const active = cat === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setCat(c.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary shadow-glow"
                      : "bg-card/60 text-muted-foreground border-border/60 hover:text-foreground"
                  }`}
                >
                  <Icon className="size-3.5" /> {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {list.map((a) => (
            <Card key={a.id} className="group overflow-hidden bg-card/60 border-border/60 hover:border-primary/50 transition-all hover:-translate-y-0.5">
              <div className={`relative h-44 bg-gradient-to-br ${a.color}`}>
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <Badge className="absolute top-3 right-3 bg-background/80 text-foreground text-[10px]">
                  {a.upcoming} podujatí
                </Badge>
                <div className="absolute bottom-3 left-4 right-4">
                  <div className="font-display text-xl font-bold text-white drop-shadow-lg">{a.name}</div>
                  <div className="text-xs text-white/80 flex items-center gap-1 mt-0.5">
                    <MapPin className="size-3" /> {a.city}
                  </div>
                </div>
              </div>
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarDays className="size-3.5" /> Nadchádzajúce
                </div>
                <Link to="/events" className="text-xs font-semibold text-primary hover:underline">
                  Zobraziť →
                </Link>
              </div>
            </Card>
          ))}
          {list.length === 0 && (
            <div className="col-span-full text-center py-16 text-muted-foreground text-sm">
              Žiadni umelci nezodpovedajú filtru.
            </div>
          )}
        </div>

        <Card className="p-8 bg-card/60 border-border/60">
          <div className="flex items-center gap-3 mb-4">
            <ImageIcon className="size-5 text-primary" />
            <h2 className="font-display text-2xl font-bold">Galéria</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className={`aspect-square rounded-xl bg-gradient-to-br ${
                  ARTISTS[i % ARTISTS.length].color
                } opacity-80 hover:opacity-100 transition-opacity`}
              />
            ))}
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
