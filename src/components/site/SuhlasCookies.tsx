// Lišta so súhlasom s cookies.
//
// PREČO VÔBEC: analytické a marketingové kódy sa v tomto projekte dali
// zadať už dávno, ale na web sa nikdy nevkladali — práve preto, že chýbal
// súhlas. Bez neho by Meta Pixel posielal údaje o návštevníkoch mimo EÚ
// bez ich vedomia.
//
// Odmietnutie je rovnako ľahké ako prijatie: dve tlačidlá vedľa seba,
// nie skryté pod „nastaveniami". Lišta nič neblokuje — web sa dá používať
// aj bez rozhodnutia, len sa vtedy nemeria nič.
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { Cookie } from "lucide-react";
import { KATEGORIE, VSETKO_ANO, VSETKO_NIE, type Suhlas } from "@/lib/merania/suhlas";
import { nacitajSuhlas, ulozSuhlas, UDALOST_OTVOR } from "@/lib/merania/prehliadac";

export function SuhlasCookies() {
  // `undefined` = ešte sme sa nepozreli, `null` = nerozhodnuté.
  const [suhlas, setSuhlas] = useState<Suhlas | null | undefined>(undefined);
  const [podrobnosti, setPodrobnosti] = useState(false);
  const [volba, setVolba] = useState({ analytika: true, marketing: true });

  useEffect(() => {
    setSuhlas(nacitajSuhlas());
    const otvor = () => {
      setSuhlas(null);
      setPodrobnosti(true);
    };
    window.addEventListener(UDALOST_OTVOR, otvor);
    return () => window.removeEventListener(UDALOST_OTVOR, otvor);
  }, []);

  const rozhodni = useCallback((v: { analytika: boolean; marketing: boolean }) => {
    setSuhlas(ulozSuhlas(v));
    setPodrobnosti(false);
  }, []);

  // Kým sme sa nepozreli, nevykresľujeme nič — inak lišta blikne každému,
  // kto sa už dávno rozhodol.
  if (suhlas !== null) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4"
      role="dialog"
      aria-label="Súhlas s cookies"
    >
      <Card className="mx-auto max-w-3xl p-4 sm:p-5 bg-card/95 backdrop-blur border-border/60 shadow-lg">
        <div className="flex items-start gap-3">
          <Cookie className="size-5 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-semibold">Súhlas so cookies</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Na chod stránky a predaj vstupeniek používame nutné cookies — tie vypnúť nejde. Navyše
              by sme radi merali návštevnosť a vyhodnocovali reklamu. Bez tvojho súhlasu nespustíme
              ani jedno.{" "}
              <Link
                to="/p/$slug"
                params={{ slug: "ochrana-osobnych-udajov" }}
                className="underline hover:text-foreground"
              >
                Ako spracúvame údaje
              </Link>
            </p>

            {podrobnosti && (
              <div className="mt-4 space-y-2">
                <Riadok nazov={KATEGORIE.nutne} popis="Prihlásenie, košík, bezpečnosť." vzdy />
                <Riadok
                  nazov={KATEGORIE.analytika}
                  popis="Google Analytics — koľko ľudí prišlo a odkiaľ."
                  hodnota={volba.analytika}
                  onZmena={(v) => setVolba((x) => ({ ...x, analytika: v }))}
                />
                <Riadok
                  nazov={KATEGORIE.marketing}
                  popis="Google Ads a Meta Pixel — vyhodnotenie reklamy a remarketing."
                  hodnota={volba.marketing}
                  onZmena={(v) => setVolba((x) => ({ ...x, marketing: v }))}
                />
              </div>
            )}

            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              {podrobnosti ? (
                <Button onClick={() => rozhodni(volba)} className="sm:order-2">
                  Uložiť voľbu
                </Button>
              ) : (
                <Button
                  onClick={() => rozhodni(VSETKO_ANO)}
                  className="bg-gradient-flame text-primary-foreground sm:order-2"
                >
                  Prijať všetko
                </Button>
              )}
              {/* Odmietnutie je rovnako viditeľné ako prijatie — nie schované. */}
              <Button variant="outline" onClick={() => rozhodni(VSETKO_NIE)} className="sm:order-1">
                Odmietnuť
              </Button>
              {!podrobnosti && (
                <Button
                  variant="ghost"
                  onClick={() => setPodrobnosti(true)}
                  className="sm:order-3 sm:ml-auto"
                >
                  Nastaviť podrobne
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Riadok({
  nazov,
  popis,
  hodnota,
  onZmena,
  vzdy,
}: {
  nazov: string;
  popis: string;
  hodnota?: boolean;
  onZmena?: (v: boolean) => void;
  vzdy?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-md border border-border/40 p-3 ${
        vzdy ? "" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={vzdy ? true : !!hodnota}
        disabled={vzdy}
        onChange={(e) => onZmena?.(e.target.checked)}
        className="mt-0.5 accent-primary"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">
          {nazov}
          {vzdy && <span className="text-muted-foreground font-normal"> — vždy zapnuté</span>}
        </span>
        <span className="block text-xs text-muted-foreground">{popis}</span>
      </span>
    </label>
  );
}
