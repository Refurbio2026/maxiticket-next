// Vkladanie meracích kódov Google a Meta.
//
// PRAVIDLO: kým návštevník nerozhodne, nenačíta sa ani jeden cudzí skript.
// Nie „načítame ho v obmedzenom režime", ale vôbec nie. Pri odmietnutí
// rovnako. Až po súhlase sa vloží to, čo danej kategórii zodpovedá:
//   analytika → Google Analytics (gtag.js)
//   marketing → Google Ads, Meta Pixel
// Tag Manager je mimoriadny prípad: môže v sebe mať oboje, preto sa vkladá
// až keď je povolené aspoň jedno, a Consent Mode mu povie, čo smie.
//
// Rozhodnutie sa prejaví BEZ obnovenia stránky — komponent čaká na udalosť
// z lišty súhlasu.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { verejneMerania } from "@/lib/merania/merania.functions";
import {
  googleAktualizacia,
  googleKonfig,
  googleZaklad,
  gtagUrl,
  gtmSkript,
  maCoMerat,
  metaSkript,
  type Merania as MeraniaIds,
} from "@/lib/merania/kody";
import { googleConsent, smieSa, type Suhlas } from "@/lib/merania/suhlas";
import { nacitajSuhlas, UDALOST_ZMENY, vlozSkript } from "@/lib/merania/prehliadac";

export function Merania() {
  const nacitaj = useServerFn(verejneMerania);
  const { data } = useQuery({
    queryKey: ["merania"],
    queryFn: () => nacitaj({ data: undefined }),
    // Identifikátory sa menia raz za rok; netreba sa pýtať pri každom prechode.
    staleTime: 60 * 60_000,
  });

  const [suhlas, setSuhlas] = useState<Suhlas | null>(null);
  useEffect(() => {
    setSuhlas(nacitajSuhlas());
    const zmena = (e: Event) => setSuhlas((e as CustomEvent<Suhlas | null>).detail ?? null);
    window.addEventListener(UDALOST_ZMENY, zmena);
    return () => window.removeEventListener(UDALOST_ZMENY, zmena);
  }, []);

  useEffect(() => {
    if (!data) return;
    const ids: MeraniaIds = data;
    if (!maCoMerat(ids)) return;

    const analytika = smieSa(suhlas, "analytika");
    const marketing = smieSa(suhlas, "marketing");
    if (!analytika && !marketing) return;

    const stav = googleConsent(suhlas);

    // Google: základ s Consent Mode musí byť PRED gtag.js, inak tag chvíľu
    // beží s predvoleným „granted" a uloží identifikátory ešte pred
    // rozhodnutím.
    const trebaGoogle = (analytika && ids.ga4) || (marketing && ids.googleAds) || ids.gtm;
    if (trebaGoogle) {
      vlozSkript("google-zaklad", { kod: googleZaklad(stav) });

      const hlavneId = (analytika && ids.ga4) || (marketing && ids.googleAds) || null;
      if (hlavneId) {
        vlozSkript("gtag", { src: gtagUrl(hlavneId) });
        vlozSkript("google-konfig", {
          kod: googleKonfig({
            ga4: analytika ? ids.ga4 : null,
            googleAds: marketing ? ids.googleAds : null,
          }),
        });
      }
      if (ids.gtm) vlozSkript("gtm", { kod: gtmSkript(ids.gtm) });
    }

    if (marketing && ids.metaPixel) {
      vlozSkript("meta-pixel", { kod: metaSkript(ids.metaPixel) });
    }

    // Keď sa rozhodnutie zmení počas návštevy (napríklad z odkazu v pätke),
    // už vložený Google tag sa o tom dozvie bez obnovenia stránky.
    if (trebaGoogle && typeof window !== "undefined") {
      const el = document.createElement("script");
      el.textContent = googleAktualizacia(stav);
      document.head.appendChild(el);
      el.remove();
    }
  }, [data, suhlas]);

  return null;
}
