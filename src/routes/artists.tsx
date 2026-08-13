import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listPerformers, type PerformerRecord } from "@/lib/performers.functions";
import { pocetPodujati } from "@/lib/plural";
import { PageShell } from "@/components/site/PageShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Star,
  CalendarDays,
  MapPin,
  Music,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";

export const Route = createFileRoute("/artists")({
  head: () => ({
    meta: [
      { title: "Umelci · vipky.sk" },
      {
        name: "description",
        content: "Objavte umelcov, kapely a interpretov vystupujúcich na podujatiach vipky.sk.",
      },
      { property: "og:title", content: "Umelci · vipky.sk" },
      {
        property: "og:description",
        content: "Profily umelcov, nadchádzajúce podujatia a galéria.",
      },
    ],
  }),
  component: ArtistsPage,
});

// Farba karty pre umelca bez fotky. Odvodená z mena, aby sa pri každom
// načítaní nemenila.
const GRADIENTS = [
  "from-orange-500 to-pink-500",
  "from-violet-500 to-blue-500",
  "from-amber-500 to-rose-500",
  "from-emerald-500 to-teal-500",
  "from-rose-500 to-orange-500",
  "from-cyan-500 to-violet-500",
  "from-yellow-500 to-orange-600",
  "from-indigo-500 to-pink-500",
];

function gradientFor(slug: string): string {
  let sum = 0;
  for (let i = 0; i < slug.length; i++) sum = (sum + slug.charCodeAt(i)) % 9973;
  return GRADIENTS[sum % GRADIENTS.length];
}

function ArtistsPage() {
  const fetchPerformers = useServerFn(listPerformers);
  const performers = useQuery({
    queryKey: ["performers", "public"],
    queryFn: () => fetchPerformers({ data: { only_active: true } }),
  });

  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("all");

  const all = useMemo(() => performers.data ?? [], [performers.data]);

  // Filtre skladáme z toho, čo je reálne vyplnené — žáner nie je číselník.
  const genres = useMemo(
    () => [...new Set(all.map((p) => p.genre).filter((g): g is string => !!g))].sort(),
    [all],
  );

  const list = useMemo(
    () =>
      all.filter(
        (p) =>
          (genre === "all" || p.genre === genre) && p.name.toLowerCase().includes(q.toLowerCase()),
      ),
    [all, q, genre],
  );

  const withPhoto = useMemo(() => all.filter((p) => p.image_url), [all]);

  return (
    <PageShell
      eyebrow="Umelci"
      title={
        <>
          Hviezdy, ktoré <span className="text-gradient-flame">tvoria scénu</span>
        </>
      }
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
          {genres.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {[{ id: "all", label: "Všetci" }, ...genres.map((g) => ({ id: g, label: g }))].map(
                (c) => {
                  const active = genre === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setGenre(c.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary shadow-glow"
                          : "bg-card/60 text-muted-foreground border-border/60 hover:text-foreground"
                      }`}
                    >
                      {c.id === "all" ? (
                        <Star className="size-3.5" />
                      ) : (
                        <Music className="size-3.5" />
                      )}
                      {c.label}
                    </button>
                  );
                },
              )}
            </div>
          )}
        </div>

        {performers.isLoading ? (
          <div className="py-20 text-center">
            <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
          </div>
        ) : all.length === 0 ? (
          <Card className="p-16 text-center bg-card/60 border-dashed border-border/60">
            <Music className="mx-auto size-7 text-muted-foreground mb-3" />
            <div className="font-display text-xl font-bold">Zoznam umelcov sa pripravuje</div>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              Zatiaľ tu nikoho nemáme. Pozrite si medzitým podujatia — účinkujúci sú uvedení pri
              každom z nich.
            </p>
            <Button asChild className="mt-5 bg-gradient-flame text-primary-foreground shadow-glow">
              <Link to="/events">Pozrieť podujatia</Link>
            </Button>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {list.map((a) => (
              <ArtistCard key={a.id} artist={a} />
            ))}
            {list.length === 0 && (
              <div className="col-span-full text-center py-16 text-muted-foreground text-sm">
                Žiadni umelci nezodpovedajú filtru.
              </div>
            )}
          </div>
        )}

        {withPhoto.length >= 4 && (
          <Card className="p-8 bg-card/60 border-border/60">
            <div className="flex items-center gap-3 mb-4">
              <ImageIcon className="size-5 text-primary" />
              <h2 className="font-display text-2xl font-bold">Galéria</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {withPhoto.map((p) => (
                <img
                  key={p.id}
                  src={p.image_url as string}
                  alt={p.name}
                  loading="lazy"
                  className="aspect-square w-full rounded-xl object-cover opacity-80 hover:opacity-100 transition-opacity"
                />
              ))}
            </div>
          </Card>
        )}
      </div>
    </PageShell>
  );
}

function ArtistCard({ artist }: { artist: PerformerRecord }) {
  // Najbližšie vystúpenie, na ktoré sa dá kúpiť vstupenka.
  const next = artist.events.find((e) => e.upcoming);

  return (
    <Card className="group overflow-hidden bg-card/60 border-border/60 hover:border-primary/50 transition-all hover:-translate-y-0.5">
      <div className={`relative h-44 bg-gradient-to-br ${gradientFor(artist.slug)}`}>
        {artist.image_url && (
          <img
            src={artist.image_url}
            alt={artist.name}
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        {artist.upcoming_count > 0 && (
          <Badge className="absolute top-3 right-3 bg-background/80 text-foreground text-[10px]">
            {pocetPodujati(artist.upcoming_count)}
          </Badge>
        )}
        <div className="absolute bottom-3 left-4 right-4">
          <div className="font-display text-xl font-bold text-white drop-shadow-lg">
            {artist.name}
          </div>
          <div className="text-xs text-white/80 flex items-center gap-3 mt-0.5">
            {artist.city && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3" /> {artist.city}
              </span>
            )}
            {artist.genre && <span>{artist.genre}</span>}
          </div>
        </div>
      </div>
      <div className="p-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
          <CalendarDays className="size-3.5 shrink-0" />
          <span className="truncate">
            {next ? `${next.event_date} · ${next.city}` : "Zatiaľ bez termínu"}
          </span>
        </div>
        {next && (
          <Link
            to="/events/$id"
            params={{ id: next.id }}
            className="text-xs font-semibold text-primary hover:underline shrink-0"
          >
            Zobraziť →
          </Link>
        )}
      </div>
    </Card>
  );
}
