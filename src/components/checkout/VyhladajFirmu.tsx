// Vyhľadanie firmy pri nákupe na firmu.
//
// Zákazník zadá IČO, IČ DPH alebo názov a údaje sa doplnia z registra, nech
// ich neprepisuje z výpisu ručne.
//
// ZÁMERNE NEBLOKUJE: register bol pri písaní nedostupný. Keď nejde, povie sa
// to jednou vetou a polia nižšie zostanú normálne vyplniteľné rukou. Preto to
// nie je povinné pole ani automatické vyhľadávanie pri písaní — je to pomôcka
// na kliknutie.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search, Building2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { najdiFirmu } from "@/lib/firmy.functions";
import { adresaJedenRiadok, naFormular, type Firma } from "@/lib/firmy/firmy";

type Props = {
  /** Doplní nájdené údaje do formulára objednávky. */
  onVybrana: (udaje: ReturnType<typeof naFormular>) => void;
};

export function VyhladajFirmu({ onVybrana }: Props) {
  const hladaj = useServerFn(najdiFirmu);
  const [dotaz, setDotaz] = useState("");
  const [hlada, setHlada] = useState(false);
  const [firmy, setFirmy] = useState<Firma[]>([]);
  const [sprava, setSprava] = useState<string | null>(null);
  const [vybrane, setVybrane] = useState<string | null>(null);

  const spusti = async () => {
    const t = dotaz.trim();
    if (t.length < 2) return;
    setHlada(true);
    setSprava(null);
    setVybrane(null);
    try {
      const v = await hladaj({ data: { dotaz: t } });
      setFirmy(v.firmy);
      setSprava(v.sprava);
      // Jediný výsledok netreba vyberať klikom.
      if (v.firmy.length === 1) vyber(v.firmy[0]);
    } catch (e) {
      setFirmy([]);
      setSprava(e instanceof Error ? e.message : "Hľadanie sa nepodarilo.");
    } finally {
      setHlada(false);
    }
  };

  const vyber = (f: Firma) => {
    onVybrana(naFormular(f));
    setVybrane(f.ico || f.nazov);
    setFirmy([]);
  };

  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="flex gap-2">
        <Input
          value={dotaz}
          onChange={(e) => setDotaz(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Inak by Enter odoslal celý checkout.
              e.preventDefault();
              void spusti();
            }
          }}
          placeholder="IČO, IČ DPH alebo názov firmy"
          aria-label="Vyhľadať firmu v registri"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => void spusti()}
          disabled={hlada || dotaz.trim().length < 2}
        >
          {hlada ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          <span className="ml-1.5 hidden sm:inline">Nájsť</span>
        </Button>
      </div>

      {vybrane && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600">
          <Check className="size-3.5" /> Údaje doplnené z registra. Skontroluj ich prosím nižšie.
        </p>
      )}

      {sprava && <p className="mt-2 text-xs text-muted-foreground">{sprava}</p>}

      {firmy.length > 0 && (
        <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-md border border-border/60 bg-background">
          {firmy.map((f) => (
            <li key={`${f.ico}-${f.nazov}`}>
              <button
                type="button"
                onClick={() => vyber(f)}
                className="flex w-full items-start gap-2 p-2.5 text-left text-sm hover:bg-muted/60"
              >
                <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="font-medium">{f.nazov}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[f.ico ? `IČO ${f.ico}` : null, adresaJedenRiadok(f)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        Hľadá sa v registri právnických osôb. DIČ a IČ DPH register nedáva — tie doplň sám.
      </p>
    </div>
  );
}
