// Verejný profil organizátora v jeho administrácii.
//
// Tie isté polia ako sprievodca na `/onboarding`, len všetky pod sebou a s
// jedným uložením — sprievodca je na prvé nastavenie, toto na úpravy.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink, Loader2, Save, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { getMyOnboarding, saveOnboarding } from "@/lib/organizer-onboarding.functions";
import { ORGANIZER_STATUS_LABEL } from "@/lib/organizer-profile";

export const Route = createFileRoute("/organizer/profile")({
  head: () => ({ meta: [{ title: "Verejný profil · eticketo.eu" }] }),
  component: Page,
});

const SEKCIE = [
  { nazov: "Kto si", popis: "Názov, logo a popis, ktoré vidia kupujúci" },
  { nazov: "Adresa", popis: "Vlastná adresa profilu a zobrazenie v katalógu" },
  { nazov: "Sociálne siete", popis: "Odkazy na profil a do pätičky e-mailu" },
  { nazov: "Firma", popis: "Údaje na faktúru" },
  { nazov: "Výplaty", popis: "Kam a ako často posielame tržbu" },
  { nazov: "Podmienky", popis: "Storno, reklamácie a súhlas" },
] as const;

function Page() {
  const qc = useQueryClient();
  const fetchStav = useServerFn(getMyOnboarding);
  const uloz = useServerFn(saveOnboarding);
  const [form, setForm] = useState<ProfileForm>(prazdnyForm);

  const stav = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => fetchStav({ data: undefined as never }),
  });

  useEffect(() => {
    if (stav.data) setForm(formZoStavu(stav.data));
  }, [stav.data]);

  const ulozenie = useMutation({
    mutationFn: () => uloz({ data: vstupZFormu(form, !!stav.data?.profile.terms_accepted_at) }),
    onSuccess: (novy) => {
      qc.setQueryData(["onboarding"], novy);
      toast.success("Profil uložený");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  if (stav.isLoading) {
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const profil = stav.data?.profile;
  const chybaPredajom = stav.data?.missing_sale ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Verejný profil</h1>
          <p className="mt-1 text-muted-foreground">
            Toto o tebe vidia kupujúci. Stav účtu:{" "}
            <span className="text-foreground">
              {profil ? ORGANIZER_STATUS_LABEL[profil.organizer_status] : "—"}
            </span>
            .
          </p>
        </div>
        {stav.data?.public_url && (
          <Button asChild variant="outline">
            <a href={stav.data.public_url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4 mr-1.5" /> Otvoriť profil
            </a>
          </Button>
        )}
      </div>

      {chybaPredajom.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
            <TriangleAlert className="size-4" /> Pred spustením predaja doplň
          </div>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            {chybaPredajom.map((m) => (
              <li key={m.pole}>{m.popis}</li>
            ))}
          </ul>
        </Card>
      )}

      {SEKCIE.map((s, i) => (
        <Card key={s.nazov} className="p-6 bg-card/60 border-border/50">
          <div className="mb-5">
            <h2 className="font-display text-lg font-semibold">{s.nazov}</h2>
            <p className="text-sm text-muted-foreground">{s.popis}</p>
          </div>
          {i === 0 && <StepIdentita form={form} setForm={setForm} />}
          {i === 1 && <StepAdresa form={form} setForm={setForm} />}
          {i === 2 && <StepSiete form={form} setForm={setForm} />}
          {i === 3 && <StepFirma form={form} setForm={setForm} />}
          {i === 4 && <StepVyplaty form={form} setForm={setForm} />}
          {i === 5 && (
            <StepPodmienky
              form={form}
              setForm={setForm}
              uzOdklikane={!!profil?.terms_accepted_at}
            />
          )}
        </Card>
      ))}

      <div className="sticky bottom-4 flex justify-end">
        <Button
          className="bg-gradient-flame text-primary-foreground shadow-glow"
          disabled={ulozenie.isPending}
          onClick={() => ulozenie.mutate()}
        >
          {ulozenie.isPending ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Save className="size-4 mr-2" />
          )}
          Uložiť profil
        </Button>
      </div>
    </div>
  );
}
