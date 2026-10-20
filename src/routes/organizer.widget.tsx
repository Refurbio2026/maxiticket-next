// Widget na web organizátora — generátor úryvku kódu so živou ukážkou.
//
// Ukážka je v `iframe srcdoc` so `sandbox="allow-scripts allow-popups"`, teda
// bez `allow-same-origin`: ukážka má pôvod `null`, takže sa chová presne ako
// cudzí web organizátora a zároveň sa nedostane k našim cookies ani k session.
// Je to naraz vernejšia ukážka aj menšie riziko než vykresliť widget priamo
// do tejto stránky.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Check, ExternalLink, Info } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { getMyOnboarding } from "@/lib/organizer-onboarding.functions";
import { useEvents } from "@/hooks/use-events";
import {
  FARBA_PREDVOLENA,
  POCET_PODUJATI,
  REZIMY,
  VZHLADY,
  coChyba,
  uryvokKodu,
  type Nastavenia,
  type Rezim,
  type Vzhlad,
} from "@/lib/widget";

export const Route = createFileRoute("/organizer/widget")({
  head: () => ({ meta: [{ title: "Widget na web · eticketo.eu" }] }),
  component: WidgetPage,
});

const POPIS_REZIMU: Record<Rezim, string> = {
  zoznam: "Zoznam mojich podujatí",
  podujatie: "Jedno konkrétne podujatie",
  tlacidlo: "Len tlačidlo „Kúpiť“",
};

const POPIS_VZHLADU: Record<Vzhlad, string> = {
  auto: "Podľa nastavenia návštevníka",
  svetly: "Svetlý",
  tmavy: "Tmavý",
};

function WidgetPage() {
  const fetchStav = useServerFn(getMyOnboarding);
  const stav = useQuery({
    queryKey: ["onboarding", "widget"],
    queryFn: () => fetchStav({ data: undefined as never }),
  });
  const podujatia = useEvents({ scope: "mine" });

  const subdomena = stav.data?.profile.subdomain ?? "";
  const [rezim, setRezim] = useState<Rezim>("zoznam");
  const [podujatie, setPodujatie] = useState<string | null>(null);
  const [pocet, setPocet] = useState<number>(POCET_PODUJATI.predvolene);
  const [vzhlad, setVzhlad] = useState<Vzhlad>("auto");
  const [farba, setFarba] = useState<string>(FARBA_PREDVOLENA);
  const [skopirovane, setSkopirovane] = useState(false);

  // Vlastnú adresu berieme z prehliadača, nech úryvok funguje aj na testovacej
  // doméne bez toho, aby ju niekto prepisoval ručne.
  const zaklad = typeof window === "undefined" ? "https://eticketo.eu" : window.location.origin;

  const nastavenia: Nastavenia = useMemo(
    () => ({ rezim, organizator: subdomena, podujatie, pocet, vzhlad, farba }),
    [rezim, subdomena, podujatie, pocet, vzhlad, farba],
  );

  const chyby = coChyba(nastavenia);
  const kod = uryvokKodu(zaklad, nastavenia);

  // Ukážka sa prekreslí len keď je čo zobraziť — inak by `iframe` blikal.
  const ukazka = useMemo(() => {
    if (chyby.length) return null;
    return `<!doctype html><html lang="sk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:16px;background:#fff;font-family:system-ui,sans-serif}
.nadpis{font:600 15px system-ui;color:#555;margin:0 0 12px}</style></head>
<body><p class="nadpis">Takto to bude na vašom webe:</p>
${kod}</body></html>`;
  }, [kod, chyby.length]);

  const zverejnene = (podujatia.data ?? []).filter(
    (e) => e.status === "published" && e.event_date >= new Date().toISOString().slice(0, 10),
  );

  const kopiruj = async () => {
    try {
      await navigator.clipboard.writeText(kod);
      setSkopirovane(true);
      toast.success("Kód skopírovaný. Vložte ho na svoj web.");
      setTimeout(() => setSkopirovane(false), 2500);
    } catch {
      toast.error("Kopírovanie nevyšlo — označte kód a skopírujte ho ručne.");
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <Toaster />
      <div>
        <h1 className="font-display text-2xl font-bold">Widget na váš web</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Vložte dva riadky na svoju stránku a zobrazia sa na nej vaše podujatia s tlačidlom na
          kúpu. Funguje na akomkoľvek webe — WordPress, Wix aj vlastné HTML. Nákup sa otvorí na
          eticketo.eu v novej karte, takže platba beží na našej doméne a nemusíte riešiť nič okolo
          kariet.
        </p>
      </div>

      {!subdomena && (
        <Card className="border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <div className="flex gap-2">
            <Info className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div>
              Najprv si nastavte verejnú adresu profilu (subdoménu) na stránke{" "}
              <a className="underline" href="/organizer/profile">
                Verejný profil
              </a>
              . Widget sa na ňu odvoláva.
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-5 p-5">
          <div className="font-display font-semibold">Nastavenie</div>

          <div className="space-y-2">
            <Label>Čo sa má zobraziť</Label>
            <Select value={rezim} onValueChange={(v) => setRezim(v as Rezim)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REZIMY.map((r) => (
                  <SelectItem key={r} value={r}>
                    {POPIS_REZIMU[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {rezim === "zoznam" ? (
            <div className="space-y-2">
              <Label htmlFor="pocet">Koľko podujatí najviac</Label>
              <Input
                id="pocet"
                type="number"
                min={POCET_PODUJATI.najmenej}
                max={POCET_PODUJATI.najviac}
                value={pocet}
                onChange={(e) => setPocet(Number(e.target.value))}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Podujatie</Label>
              <Select value={podujatie ?? ""} onValueChange={(v) => setPodujatie(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Vyberte podujatie…" />
                </SelectTrigger>
                <SelectContent>
                  {zverejnene.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.title} · {e.event_date}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {zverejnene.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nemáte zverejnené žiadne budúce podujatie, z ktorého by sa dalo vyberať.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Vzhľad</Label>
            <Select value={vzhlad} onValueChange={(v) => setVzhlad(v as Vzhlad)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VZHLADY.map((v) => (
                  <SelectItem key={v} value={v}>
                    {POPIS_VZHLADU[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="farba">Farba tlačidla</Label>
            <div className="flex items-center gap-3">
              <Input
                id="farba"
                type="color"
                value={farba}
                onChange={(e) => setFarba(e.target.value)}
                className="h-10 w-16 p-1"
              />
              <span className="font-mono text-xs text-muted-foreground">{farba}</span>
              {farba !== FARBA_PREDVOLENA && (
                <Button variant="ghost" size="sm" onClick={() => setFarba(FARBA_PREDVOLENA)}>
                  Pôvodná
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div className="font-display font-semibold">Kód na vloženie</div>
            <Button size="sm" onClick={kopiruj} disabled={chyby.length > 0}>
              {skopirovane ? <Check className="size-4" /> : <Copy className="size-4" />}
              <span className="ml-1.5">{skopirovane ? "Skopírované" : "Kopírovať"}</span>
            </Button>
          </div>

          {chyby.length > 0 ? (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {chyby.map((c) => (
                <li key={c}>• {c}</li>
              ))}
            </ul>
          ) : (
            <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed">
              <code>{kod}</code>
            </pre>
          )}

          <div className="space-y-2 text-xs text-muted-foreground">
            <p>
              <strong>WordPress:</strong> vložte to do bloku „Vlastné HTML“, nie do odstavca —
              editor by kód inak zobrazil ako text.
            </p>
            <p>
              Zoznam sa aktualizuje sám. Keď pridáte alebo zrušíte podujatie, na vašom webe sa to
              prejaví do minúty bez toho, aby ste čohokoľvek chytali.
            </p>
          </div>
        </Card>
      </div>

      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <div className="font-display font-semibold">Živá ukážka</div>
          {stav.data?.public_url && (
            <a
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              href={stav.data.public_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Môj verejný profil <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
        {ukazka ? (
          <iframe
            title="Ukážka widgetu"
            // Bez `allow-same-origin`: ukážka má pôvod `null`, teda sa chová ako
            // cudzí web a nedostane sa k našej session.
            sandbox="allow-scripts allow-popups"
            srcDoc={ukazka}
            className="h-[420px] w-full rounded-lg border border-border bg-white"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Ukážka sa zobrazí, keď bude nastavenie úplné.
          </p>
        )}
      </Card>
    </div>
  );
}
