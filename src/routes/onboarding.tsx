// Sprievodca registráciou organizátora.
//
// Vedome mimo `/organizer`: rolu `organizer` prideľuje až admin pri schválení,
// takže žiadateľ by sa do tej časti aplikácie ešte nedostal. Zároveň je
// prerušiteľný — každý krok sa ukladá, takže sa dá dokončiť o dva dni z iného
// zariadenia a človek nestratí, čo už vyplnil.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Flame,
  Loader2,
  Send,
  TriangleAlert,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Toaster } from "@/components/ui/sonner";
import {
  StepAdresa,
  StepFirma,
  StepIdentita,
  StepPodmienky,
  StepSiete,
  StepVyplaty,
} from "@/components/organizer/ProfileSteps";
import {
  formZoStavu,
  prazdnyForm,
  vstupZFormu,
  type ProfileForm,
} from "@/lib/organizer-profile-form";
import {
  getMyOnboarding,
  saveOnboarding,
  submitOrganizerApplication,
} from "@/lib/organizer-onboarding.functions";
import { KROKY, KROK_HOTOVO } from "@/lib/organizer-profile";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Registrácia organizátora · eticketo.eu" }] }),
  component: OnboardingPage,
});

function Hlavicka({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-10">
      <Toaster />
      <div className="mx-auto w-full max-w-3xl">
        <Link to="/" className="mb-8 flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-xl bg-gradient-flame shadow-glow">
            <Flame className="size-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold">
            eticketo<span className="text-gradient-flame">.eu</span>
          </span>
        </Link>
        {children}
      </div>
    </div>
  );
}

function OnboardingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, loading } = useAuth();

  const fetchStav = useServerFn(getMyOnboarding);
  const uloz = useServerFn(saveOnboarding);
  const odosli = useServerFn(submitOrganizerApplication);

  const [krok, setKrok] = useState<number | null>(null);
  const [form, setForm] = useState<ProfileForm>(prazdnyForm);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  const stav = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => fetchStav({ data: undefined as never }),
    enabled: !!user,
  });

  // Formulár sa napĺňa zo stavu servera — teda po načítaní a po každom uložení.
  // Server hodnoty normalizuje (IBAN po štvorčekoch, web s https://), takže je
  // správne prevziať jeho verziu, nie si držať tú vlastnú.
  useEffect(() => {
    if (!stav.data) return;
    setForm(formZoStavu(stav.data));
    setKrok((k) => k ?? Math.min(Math.max(stav.data.profile.onboarding_step, 1), KROKY.length));
  }, [stav.data]);

  const ulozenie = useMutation({
    mutationFn: (dalsi: number) =>
      uloz({
        data: vstupZFormu(
          form,
          !!stav.data?.profile.terms_accepted_at,
          Math.min(dalsi, KROKY.length),
        ),
      }),
    onSuccess: (novy, dalsi) => {
      qc.setQueryData(["onboarding"], novy);
      setKrok(dalsi > KROKY.length ? KROKY.length : dalsi);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const ziadost = useMutation({
    mutationFn: async () => {
      // Najprv uložíme posledný krok, potom žiadame — inak by server
      // vyhodnotil chýbajúce údaje z predošlého stavu.
      const novy = await uloz({
        data: vstupZFormu(form, !!stav.data?.profile.terms_accepted_at, KROK_HOTOVO),
      });
      qc.setQueryData(["onboarding"], novy);
      return odosli({ data: undefined as never });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      toast.success("Žiadosť je odoslaná.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Odoslanie zlyhalo"),
  });

  if (loading || !user || stav.isLoading || krok === null) {
    return (
      <Hlavicka>
        <Card className="grid h-56 place-items-center bg-card/60 border-border/50">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </Card>
      </Hlavicka>
    );
  }

  if (stav.error) {
    return (
      <Hlavicka>
        <Card className="p-8 bg-card/60 border-border/50">
          <p className="text-sm text-destructive">
            {stav.error instanceof Error ? stav.error.message : "Stav sa nepodarilo načítať."}
          </p>
        </Card>
      </Hlavicka>
    );
  }

  const profil = stav.data!.profile;

  // --- stavy, v ktorých sa nevypĺňa -----------------------------------------
  if (profil.organizer_status === "pending") {
    return (
      <Hlavicka>
        <Card className="p-8 bg-card/60 border-border/50 space-y-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-amber-500/15 text-amber-500">
              <Clock className="size-5" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold">Žiadosť čaká na schválenie</h1>
              <p className="text-sm text-muted-foreground">
                Pozrieme si údaje a ozveme sa e-mailom na {stav.data!.email}.
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-border/50 bg-muted/10 p-4 text-sm">
            <div className="font-medium">{profil.display_name}</div>
            <div className="text-muted-foreground">
              {profil.company_name}
              {profil.ico ? ` · IČO ${profil.ico}` : ""}
            </div>
            <div className="mt-2 font-mono text-xs text-muted-foreground">
              eticketo.eu/o/{profil.subdomain}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Kým žiadosť beží, podujatia si môžeš pripraviť ako koncepty — zverejniť sa dajú až po
            schválení.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setKrok(1)}>
              Upraviť údaje
            </Button>
            <Button asChild variant="ghost">
              <Link to="/account">Môj účet</Link>
            </Button>
          </div>
        </Card>
      </Hlavicka>
    );
  }

  if (profil.organizer_status === "approved" && profil.onboarding_step >= KROK_HOTOVO) {
    return (
      <Hlavicka>
        <Card className="p-8 bg-card/60 border-border/50 space-y-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-emerald-500/15 text-emerald-500">
              <BadgeCheck className="size-5" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold">Účet je schválený</h1>
              <p className="text-sm text-muted-foreground">
                Môžeš zakladať a zverejňovať podujatia.
              </p>
            </div>
          </div>
          {stav.data!.public_url && (
            <p className="text-sm">
              Tvoj verejný profil:{" "}
              <a
                className="font-mono text-primary hover:underline"
                href={stav.data!.public_url}
                target="_blank"
                rel="noreferrer"
              >
                {stav.data!.public_url}
              </a>
            </p>
          )}
          {stav.data!.missing_sale.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                <TriangleAlert className="size-4" /> Pred prvým predajom doplň
              </div>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                {stav.data!.missing_sale.map((m) => (
                  <li key={m.pole}>{m.popis}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            {/* Tvrdé načítanie: rolu `organizer` prideľuje admin do databázy, ale
                prihlásená session ju v pamäti ešte nemá. */}
            <Button
              className="bg-gradient-flame text-primary-foreground shadow-glow"
              onClick={() => {
                window.location.href = "/organizer";
              }}
            >
              Prejsť do administrácie
            </Button>
            <Button variant="outline" onClick={() => setKrok(1)}>
              Upraviť profil
            </Button>
          </div>
        </Card>
      </Hlavicka>
    );
  }

  // --- samotný sprievodca ---------------------------------------------------
  const aktualny = KROKY.find((k) => k.cislo === krok) ?? KROKY[0];
  const posledny = krok === KROKY.length;
  const chyba = stav.data!.missing_application;

  return (
    <Hlavicka>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            {profil.organizer_status === "rejected"
              ? "Oprav údaje a pošli znova"
              : "Nastav si účet organizátora"}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Krok {krok} zo {KROKY.length} · {aktualny.nazov} — {aktualny.popis}. Rozpracované sa
            ukladá, môžeš sa vrátiť kedykoľvek.
          </p>
        </div>

        {profil.organizer_status === "rejected" && profil.organizer_review_note && (
          <Card className="border-destructive/40 bg-destructive/5 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <TriangleAlert className="size-4" /> Dôvod zamietnutia
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{profil.organizer_review_note}</p>
          </Card>
        )}

        <Progress value={(krok / KROKY.length) * 100} className="h-1.5" />

        <div className="flex flex-wrap gap-2">
          {KROKY.map((k) => (
            <button
              key={k.cislo}
              type="button"
              onClick={() => setKrok(k.cislo)}
              className={`rounded-lg px-3 py-1.5 text-xs transition ${
                k.cislo === krok
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {k.cislo}. {k.nazov}
            </button>
          ))}
        </div>

        <Card className="p-6 sm:p-8 bg-card/60 border-border/50">
          {krok === 1 && <StepIdentita form={form} setForm={setForm} />}
          {krok === 2 && <StepAdresa form={form} setForm={setForm} />}
          {krok === 3 && <StepSiete form={form} setForm={setForm} />}
          {krok === 4 && <StepFirma form={form} setForm={setForm} />}
          {krok === 5 && <StepVyplaty form={form} setForm={setForm} />}
          {krok === 6 && (
            <StepPodmienky form={form} setForm={setForm} uzOdklikane={!!profil.terms_accepted_at} />
          )}
        </Card>

        {posledny && chyba.length > 0 && (
          <Card className="border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
              <TriangleAlert className="size-4" /> Na odoslanie žiadosti ešte chýba
            </div>
            <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
              {chyba.map((m) => (
                <li key={m.pole}>{m.popis}</li>
              ))}
            </ul>
          </Card>
        )}

        <div className="flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            disabled={krok === 1}
            onClick={() => setKrok((k) => Math.max(1, (k ?? 1) - 1))}
          >
            <ArrowLeft className="size-4 mr-1.5" /> Späť
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={ulozenie.isPending}
              onClick={() => ulozenie.mutate(krok)}
            >
              {ulozenie.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Uložiť a pokračovať neskôr
            </Button>

            {posledny ? (
              <Button
                className="bg-gradient-flame text-primary-foreground shadow-glow"
                disabled={ziadost.isPending || !form.accept_terms}
                onClick={() => ziadost.mutate()}
              >
                {ziadost.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Send className="size-4 mr-2" />
                )}
                Odoslať žiadosť
              </Button>
            ) : (
              <Button
                className="bg-gradient-flame text-primary-foreground shadow-glow"
                disabled={ulozenie.isPending}
                onClick={() => ulozenie.mutate(krok + 1)}
              >
                {ulozenie.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <ArrowRight className="size-4 mr-2" />
                )}
                Pokračovať
              </Button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          <CheckCircle2 className="mr-1 inline size-3" />
          Žiadosť posudzujeme ručne — je to to, čo drží z platformy preč falošných predajcov.
        </p>
      </div>
    </Hlavicka>
  );
}
