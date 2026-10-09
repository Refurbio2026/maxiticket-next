// Košík v hlavičke.
//
// Doteraz bol výber vidieť len na stránke podujatia: kto odišiel na inú
// stránku, nemal ako zistiť, že má niečo vybrané, ani sa k tomu vrátiť.
//
// Obsah sa neberie z prehliadača, ale zo servera — zo sedadiel, ktoré databáza
// drží pod id relácie. Košík teda prežije obnovenie stránky aj prechod inam
// a vždy zodpovedá tomu, čo je naozaj zarezervované.
//
// Ukazuje sa len vtedy, keď v ňom niečo je. Prázdna ikonka na každej stránke
// by bola len šum.
//
// Státie tu nie je: pri podujatí bez sedadiel sa nič nerezervuje, kým nevznikne
// objednávka, takže o takom výbere databáza nevie. Stratiť „3 ks" pri odchode
// zo stránky je ale nesúmerne menšia vec než stratiť vybrané miesta — číslo
// človek zadá znova.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock, ShoppingCart, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getCart, type CartGroup } from "@/lib/cart.functions";
import { releaseHolds } from "@/lib/event-dates.functions";
import { getCartSessionId } from "@/lib/ticketing-db";

const eur = (n: number) =>
  `€ ${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Koľko minút ostáva do konca držania. `null`, keď to už nemá zmysel ukazovať. */
function minutDoKonca(until: string | null, teraz: number): number | null {
  if (!until) return null;
  const zostava = Math.ceil((new Date(until).getTime() - teraz) / 60_000);
  return zostava > 0 ? zostava : 0;
}

export function CartButton({ className }: { className?: string }) {
  const qc = useQueryClient();
  // Id relácie je v `sessionStorage`, čiže na serveri neexistuje. Kým sa
  // komponenta nepripojí, nesmie nič vykresliť — inak by SSR a prehliadač
  // nesúhlasili. Rovnako to robí `ThemeProvider` aj `I18nProvider`.
  const [sid, setSid] = useState<string | null>(null);
  const [teraz, setTeraz] = useState(() => 0);

  useEffect(() => {
    setSid(getCartSessionId());
    setTeraz(Date.now());
    // Odpočet nemusí tikať po sekundách — ide o minúty.
    const t = setInterval(() => setTeraz(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const fetchCart = useServerFn(getCart);
  const uvolni = useServerFn(releaseHolds);

  const kosik = useQuery({
    queryKey: ["cart", sid],
    queryFn: () => fetchCart({ data: { session: sid as string } }),
    enabled: !!sid && sid !== "ssr" && sid !== "anon",
    // Držanie vyprší samo, takže sa treba pozerať znova — a pri návrate na
    // kartu hneď, nech človek nevidí košík, ktorý už neexistuje.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const vyhod = useMutation({
    mutationFn: (g: CartGroup) =>
      uvolni({ data: { event_date_id: g.event_date_id, session: sid as string } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cart", sid] }),
  });

  const data = kosik.data;
  if (!sid || !data || data.count === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={`relative rounded-xl text-sm ${className ?? ""}`}
          aria-label={`Košík, ${data.count} vstupeniek`}
        >
          <ShoppingCart className="size-4" />
          <span
            className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-gradient-flame text-[11px] font-bold text-primary-foreground shadow-glow"
            aria-hidden
          >
            {data.count}
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border/50 px-4 py-3">
          <div className="text-sm font-semibold">Vybrané vstupenky</div>
          <div className="text-xs text-muted-foreground">
            Miesta sú pre teba podržané. Keď čas vyprší, uvoľnia sa ostatným.
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {data.groups.map((g) => {
            const minuty = minutDoKonca(g.reserved_until, teraz);
            return (
              <div
                key={g.event_date_id}
                className="border-b border-border/30 px-4 py-3 last:border-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      to="/events/$id"
                      params={{ id: g.event_id }}
                      className="block truncate text-sm font-medium hover:text-primary"
                    >
                      {g.title}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(g.event_date).toLocaleDateString("sk-SK")} ·{" "}
                      {g.event_time?.slice(0, 5)} · {g.city}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="Vyhodiť z košíka"
                    disabled={vyhod.isPending}
                    onClick={() => vyhod.mutate(g)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>

                <div className="mt-2 text-xs text-foreground/80">
                  {g.seats.length} {g.seats.length === 1 ? "miesto" : "miest"}
                  {g.seats[0]?.label
                    ? ` · ${g.seats
                        .map((s) => s.label)
                        .filter(Boolean)
                        .join(", ")}`
                    : ""}
                </div>

                <div className="mt-2 flex items-center justify-between">
                  <span className="font-display text-sm font-bold">{eur(g.total)}</span>
                  {minuty !== null && (
                    <span
                      className={`inline-flex items-center gap-1 text-xs ${
                        minuty <= 2 ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      <Clock className="size-3" />
                      {minuty > 0 ? `${minuty} min` : "už vypršalo"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/50 px-4 py-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Spolu </span>
            <span className="font-display font-bold">{eur(data.total)}</span>
          </div>
          {/* Zaplatiť sa dá vždy za jedno podujatie — jedna objednávka je jeden
              termín jedného podujatia, preto odkaz vedie naň a nie do pokladne. */}
          <Button
            asChild
            size="sm"
            className="bg-gradient-flame text-primary-foreground shadow-glow"
          >
            <Link to="/events/$id" params={{ id: data.groups[0].event_id }}>
              Dokončiť nákup
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
