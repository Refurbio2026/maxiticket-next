// Výplaty organizátora — nastavenie Stripe Connect (Express účet).
//
// Čo tu organizátor rieši: raz prejde formulárom u Stripe (identita, bankový
// účet) a odvtedy mu peniaze za vstupenky chodia priamo, zmenšené o našu
// províziu. My jeho doklady ani číslo účtu nevidíme — zostávajú u Stripe.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BadgeCheck,
  CircleAlert,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  getStavVyplat,
  obnovStavVyplat,
  zacniNastavenieVyplat,
} from "@/lib/stripe-connect.functions";

export const Route = createFileRoute("/organizer/payouts")({
  head: () => ({ meta: [{ title: "Výplaty · eticketo.eu" }] }),
  // Stripe nás po onboardingu vráti s `?hotovo=1`, prípadne s `?obnovit=1`,
  // keď odkaz vypršal.
  validateSearch: (s: Record<string, unknown>): { hotovo?: boolean; obnovit?: boolean } => ({
    hotovo: s.hotovo === "1" || s.hotovo === true ? true : undefined,
    obnovit: s.obnovit === "1" || s.obnovit === true ? true : undefined,
  }),
  component: PayoutsPage,
});

function PayoutsPage() {
  const { hotovo, obnovit } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const fetchStav = useServerFn(getStavVyplat);
  const zacni = useServerFn(zacniNastavenieVyplat);
  const obnov = useServerFn(obnovStavVyplat);

  const stav = useQuery({
    queryKey: ["stripe-vyplaty"],
    queryFn: () => fetchStav({ data: {} }),
  });

  const zacniMut = useMutation({
    mutationFn: () => zacni({ data: {} }),
    onSuccess: ({ url }) => {
      // Stripe formulár otvárame v tej istej karte: po dokončení nás vráti
      // naspäť sem a vo novej karte by sa návrat stratil.
      window.location.href = url;
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Nepodarilo sa začať"),
  });

  const obnovMut = useMutation({
    mutationFn: () => obnov({ data: {} }),
    onSuccess: (s) => {
      qc.setQueryData(["stripe-vyplaty"], s);
      toast.success(
        s.charges_enabled
          ? "Hotovo, Stripe povolil prijímať platby."
          : "Stav obnovený. Stripe ešte niečo potrebuje.",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Obnovenie zlyhalo"),
  });

  // Po návrate od Stripe sa stav dopýta hneď — nečakáme na webhook, nech
  // organizátor nekrúti hlavou, prečo tam ešte svieti „nedokončené".
  useEffect(() => {
    if (!hotovo && !obnovit) return;
    obnovMut.mutate();
    navigate({ to: "/organizer/payouts", search: {}, replace: true });
    // Zámerne len pri príchode z návratovej adresy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotovo, obnovit]);

  const s = stav.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <Toaster />
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
          <Wallet className="size-6 text-primary" /> Výplaty
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Peniaze za vstupenky vám chodia priamo z každej platby, zmenšené o províziu platformy.
          Identitu aj bankový účet overuje Stripe — my vaše doklady ani číslo účtu nevidíme.
        </p>
      </div>

      {stav.isLoading && (
        <Card className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Načítavam stav…
        </Card>
      )}

      {s && !s.branaNastavena && (
        <Card className="border-amber-500/40 bg-amber-500/5 p-5 text-sm">
          <div className="flex gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div>
              Platby cez Stripe zatiaľ nie sú na platforme zapnuté. Ozvite sa nám — kým chýbajú
              prístupy, výplaty nastaviť nejde.
            </div>
          </div>
        </Card>
      )}

      {s && s.branaNastavena && !s.smieNastavovat && (
        <Card className="border-amber-500/40 bg-amber-500/5 p-5 text-sm">
          <div className="flex gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div>Výplaty sa dajú nastaviť až po schválení organizátorského účtu.</div>
          </div>
        </Card>
      )}

      {s && s.branaNastavena && s.smieNastavovat && (
        <Card className="space-y-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-display font-semibold">Stav účtu</div>
            <div className="flex items-center gap-2">
              {s.rezim === "test" && (
                <Badge variant="outline" className="border-amber-500/60 text-amber-600">
                  testovacia prevádzka
                </Badge>
              )}
              {s.charges_enabled ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-600">
                  <BadgeCheck className="mr-1 size-3.5" /> Platby povolené
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <CircleAlert className="mr-1 size-3.5" /> Zatiaľ nedokončené
                </Badge>
              )}
            </div>
          </div>

          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Riadok nazov="Môže prijímať platby" hodnota={s.charges_enabled} />
            <Riadok nazov="Môže dostávať výplaty" hodnota={s.payouts_enabled} />
            <Riadok nazov="Údaje odoslané" hodnota={s.details_submitted} />
            <div className="flex items-center justify-between gap-2 sm:col-span-2">
              <dt className="text-muted-foreground">Účet u Stripe</dt>
              <dd className="font-mono text-xs">{s.ucet ?? "zatiaľ žiadny"}</dd>
            </div>
          </dl>

          {s.chyba.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <div className="mb-1 font-medium">Stripe od vás ešte potrebuje:</div>
              <ul className="list-inside list-disc text-muted-foreground">
                {s.chyba.map((c) => (
                  <li key={c}>{popisPoziadavky(c)}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => zacniMut.mutate()}
              disabled={zacniMut.isPending}
              className="bg-gradient-flame text-primary-foreground shadow-glow"
            >
              {zacniMut.isPending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-1.5 size-4" />
              )}
              {s.ucet ? "Pokračovať u Stripe" : "Nastaviť výplaty"}
            </Button>
            {s.ucet && (
              <Button
                variant="outline"
                onClick={() => obnovMut.mutate()}
                disabled={obnovMut.isPending}
              >
                <RefreshCw
                  className={`mr-1.5 size-4 ${obnovMut.isPending ? "animate-spin" : ""}`}
                />
                Obnoviť stav
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Otvorí sa formulár Stripe. Keď ho dokončíte, vrátime vás sem a stav sa obnoví sám.
            {s.aktualizovane && (
              <> Naposledy overené {new Date(s.aktualizovane).toLocaleString("sk-SK")}.</>
            )}
          </p>
        </Card>
      )}
    </div>
  );
}

function Riadok({ nazov, hodnota }: { nazov: string; hodnota: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{nazov}</dt>
      <dd className={hodnota ? "text-emerald-600" : "text-muted-foreground"}>
        {hodnota ? "áno" : "nie"}
      </dd>
    </div>
  );
}

/** Kódy požiadaviek od Stripe sú strohé; toto z nich spraví vetu. */
function popisPoziadavky(kod: string): string {
  const slovnik: Record<string, string> = {
    external_account: "číslo bankového účtu, na ktorý sa majú posielať peniaze",
    "individual.verification.document": "doklad totožnosti",
    "individual.id_number": "rodné číslo alebo iný identifikátor",
    "business_profile.url": "adresu webu alebo profilu",
    "company.tax_id": "IČO alebo DIČ",
    "tos_acceptance.date": "potvrdenie podmienok Stripe",
  };
  return slovnik[kod] ?? kod;
}
