// Konverzia „nákup" pre Google a Meta.
//
// Spúšťa sa na stránke s potvrdením objednávky, až po tom, čo návštevník
// prijal marketingové cookies — bez súhlasu sa nehlási nič.
//
// Dvakrát sa to počítať nesmie: číslo objednávky ide do `transaction_id`
// (Google) aj `eventID` (Meta), takže obnovenie stránky s potvrdením
// rozpoznajú ako ten istý nákup. Navyše si tu držíme, čo sme už poslali
// počas tohto načítania stránky.
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { verejneMerania } from "@/lib/merania/merania.functions";
import { kodNakupu, maCoMerat } from "@/lib/merania/kody";
import { smieSa, type Suhlas } from "@/lib/merania/suhlas";
import { nacitajSuhlas, UDALOST_ZMENY } from "@/lib/merania/prehliadac";

export function KonverziaNakupu({
  objednavka,
  suma,
  mena,
}: {
  objednavka: string | undefined;
  suma: number | undefined;
  mena?: string;
}) {
  const nacitaj = useServerFn(verejneMerania);
  const { data } = useQuery({
    queryKey: ["merania"],
    queryFn: () => nacitaj({ data: undefined }),
    staleTime: 60 * 60_000,
  });
  const poslane = useRef<string | null>(null);
  const suhlasRef = useRef<Suhlas | null>(null);

  useEffect(() => {
    suhlasRef.current = nacitajSuhlas();
    const zmena = (e: Event) => {
      suhlasRef.current = (e as CustomEvent<Suhlas | null>).detail ?? null;
    };
    window.addEventListener(UDALOST_ZMENY, zmena);
    return () => window.removeEventListener(UDALOST_ZMENY, zmena);
  }, []);

  useEffect(() => {
    if (!data || !objednavka || typeof suma !== "number" || suma <= 0) return;
    if (!maCoMerat(data)) return;
    if (poslane.current === objednavka) return;
    // Nákup je marketingová konverzia; bez súhlasu s marketingom sa nehlási.
    if (!smieSa(nacitajSuhlas(), "marketing")) return;

    const kod = kodNakupu(data, { objednavka, suma, mena });
    if (!kod) return;

    const el = document.createElement("script");
    el.textContent = kod;
    document.head.appendChild(el);
    el.remove();
    poslane.current = objednavka;
  }, [data, objednavka, suma, mena]);

  return null;
}
