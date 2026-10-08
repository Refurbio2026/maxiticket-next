// Asistent založenia organizátora — jeden priechod namiesto dvoch obrazoviek.
//
// Kroky sú zámerne v jednom formulári pod sebou, nie v „ďalej/späť" dialógu:
// obsluha tak vidí, čo všetko konto potrebuje, a nedá sa prejsť do stavu,
// v akom dnes stojí deväť z desiatich organizátorov — bez firmy, bez IBAN-u
// a s platformovou províziou, o ktorej nikto nerozhodol.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, UserPlus, Globe, Mail, Check, AlertTriangle, Copy, Inbox } from "lucide-react";
import {
  createOrganizer,
  checkSubdomain,
  listOrganizerRequests,
  approveOrganizerRequest,
  rejectOrganizerRequest,
  type StavSubdomeny,
  type ZiadostOrganizatora,
} from "@/lib/organizers.functions";
import { getPlatformSettings } from "@/lib/settlements.functions";
import { chybaSubdomeny, navrhSubdomeny } from "@/lib/subdomena";

export const Route = createFileRoute("/admin/eticketo/organizer-new")({
  head: () => ({ meta: [{ title: "Nový organizátor · eticketo.eu Admin" }] }),
  component: Page,
});

type Form = {
  email: string;
  full_name: string;
  company_name: string;
  ico: string;
  dic: string;
  ic_dph: string;
  billing_address: string;
  phone: string;
  payout_iban: string;
  commission_rate: string;
  chce_subdomenu: boolean;
  subdomain: string;
  poslat_pozvanku: boolean;
};

const prazdny: Form = {
  email: "",
  full_name: "",
  company_name: "",
  ico: "",
  dic: "",
  ic_dph: "",
  billing_address: "",
  phone: "",
  payout_iban: "",
  commission_rate: "",
  chce_subdomenu: false,
  subdomain: "",
  poslat_pozvanku: true,
};

const fmtDatum = (s: string) =>
  new Date(s).toLocaleDateString("sk-SK", { day: "numeric", month: "short", year: "numeric" });

function Page() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(prazdny);
  const [hotovo, setHotovo] = useState<{ email: string; odkaz: string | null } | null>(null);

  const zaloz = useServerFn(createOrganizer);
  const over = useServerFn(checkSubdomain);
  const nacitajZiadosti = useServerFn(listOrganizerRequests);
  const schval = useServerFn(approveOrganizerRequest);
  const zamietni = useServerFn(rejectOrganizerRequest);
  const nacitajNastavenia = useServerFn(getPlatformSettings);

  const nastavenia = useQuery({
    queryKey: ["platform-settings"],
    queryFn: () => nacitajNastavenia({ data: undefined as never }),
  });

  const ziadosti = useQuery({
    queryKey: ["organizer-requests"],
    queryFn: () => nacitajZiadosti({ data: undefined as never }),
  });

  // Subdoména sa navrhne z názvu, ale len kým do nej obsluha nezasiahla.
  const [subdomenaRucne, setSubdomenaRucne] = useState(false);
  useEffect(() => {
    if (!form.chce_subdomenu || subdomenaRucne) return;
    const navrh = navrhSubdomeny(form.company_name || form.full_name);
    setForm((f) => (f.subdomain === navrh ? f : { ...f, subdomain: navrh }));
  }, [form.company_name, form.full_name, form.chce_subdomenu, subdomenaRucne]);

  const chybaSlugu = useMemo(
    () => (form.chce_subdomenu && form.subdomain ? chybaSubdomeny(form.subdomain) : null),
    [form.chce_subdomenu, form.subdomain],
  );

  const [stavSubdomeny, setStavSubdomeny] = useState<StavSubdomeny | null>(null);
  const overSubdomenu = useMutation({
    mutationFn: () => over({ data: { subdomain: form.subdomain } }),
    onSuccess: (s) => setStavSubdomeny(s),
    onError: (e: Error) => toast.error(e.message),
  });

  const zalozenie = useMutation({
    mutationFn: () =>
      zaloz({
        data: {
          email: form.email,
          full_name: form.full_name,
          company_name: form.company_name || null,
          ico: form.ico || null,
          dic: form.dic || null,
          ic_dph: form.ic_dph || null,
          billing_address: form.billing_address || null,
          phone: form.phone || null,
          payout_iban: form.payout_iban || null,
          commission_rate: form.commission_rate ? Number(form.commission_rate) : null,
          subdomain: form.chce_subdomenu && form.subdomain ? form.subdomain : null,
          poslat_pozvanku: form.poslat_pozvanku,
        },
      }),
    onSuccess: (v) => {
      if (v.pozvanka === "odoslana") toast.success("Organizátor založený, pozvánka odoslaná");
      else if (v.pozvanka === "mail_nenastaveny")
        toast.warning("Organizátor založený, ale odosielanie e-mailov nie je nastavené");
      else toast.warning("Organizátor založený, pozvánka neodišla — podaj odkaz ručne");
      setHotovo({ email: v.email, odkaz: v.odkaz_na_heslo });
      setForm(prazdny);
      setStavSubdomeny(null);
      setSubdomenaRucne(false);
      qc.invalidateQueries({ queryKey: ["organizer-accounts"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const schvalenie = useMutation({
    mutationFn: (z: ZiadostOrganizatora) => schval({ data: { id: z.id } }),
    onSuccess: () => {
      toast.success("Žiadosť schválená — rola organizátora pridelená");
      qc.invalidateQueries({ queryKey: ["organizer-requests"] });
      qc.invalidateQueries({ queryKey: ["organizer-accounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const zamietnutie = useMutation({
    mutationFn: (z: ZiadostOrganizatora) => zamietni({ data: { id: z.id } }),
    onSuccess: () => {
      toast.success("Žiadosť zamietnutá");
      qc.invalidateQueries({ queryKey: ["organizer-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mozeUlozit =
    form.email.includes("@") &&
    form.full_name.trim().length > 0 &&
    (!form.chce_subdomenu || (!!form.subdomain && !chybaSlugu)) &&
    !zalozenie.isPending;

  const provizia = form.commission_rate
    ? `${form.commission_rate} %`
    : `${nastavenia.data?.default_commission_rate ?? 10} % (platformová)`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Nový organizátor</h1>
        <p className="text-muted-foreground text-sm">
          Konto, fakturačné údaje, provízia a adresa predaja na jeden raz. Heslo si organizátor
          nastaví sám z pozvánky — ty ho nikdy nevidíš.
        </p>
      </div>

      {hotovo && (
        <Card className="p-4 border-primary/40 bg-primary/5">
          <div className="flex items-start gap-3">
            <Check className="h-5 w-5 text-primary mt-0.5" />
            <div className="space-y-2 text-sm flex-1">
              <div className="font-medium">Konto pre {hotovo.email} je založené.</div>
              {hotovo.odkaz && (
                <div className="space-y-1">
                  <div className="text-muted-foreground">
                    Jednorazový odkaz na nastavenie hesla (keby e-mail nedorazil):
                  </div>
                  <div className="flex gap-2">
                    <Input readOnly value={hotovo.odkaz} className="font-mono text-xs" />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        navigator.clipboard.writeText(hotovo.odkaz ?? "");
                        toast.success("Odkaz skopírovaný");
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={() => setHotovo(null)}>
                Zavrieť
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-6 space-y-6">
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <UserPlus className="h-4 w-4" /> 1 · Konto
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>E-mail *</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="divadlo@priklad.sk"
              />
            </div>
            <div className="space-y-2">
              <Label>Názov organizátora *</Label>
              <Input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="Bratislavské bábkové divadlo"
              />
            </div>
          </div>
        </section>

        <section className="space-y-4 border-t border-border/50 pt-6">
          <div className="text-sm font-semibold">2 · Fakturácia a provízia</div>
          <p className="text-xs text-muted-foreground">
            Bez výplatného IBAN-u nemá vyúčtovanie kam poslať peniaze. Dnes ho nemá ani jeden
            organizátor, preto to patrí sem a nie na inú stránku.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Firma</Label>
              <Input
                value={form.company_name}
                onChange={(e) => setForm({ ...form, company_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>IČO</Label>
              <Input value={form.ico} onChange={(e) => setForm({ ...form, ico: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>DIČ</Label>
              <Input value={form.dic} onChange={(e) => setForm({ ...form, dic: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>IČ DPH</Label>
              <Input
                value={form.ic_dph}
                onChange={(e) => setForm({ ...form, ic_dph: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Fakturačná adresa</Label>
              <Input
                value={form.billing_address}
                onChange={(e) => setForm({ ...form, billing_address: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Telefón</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Výplatný IBAN</Label>
              <Input
                value={form.payout_iban}
                onChange={(e) => setForm({ ...form, payout_iban: e.target.value })}
                placeholder="SK00 0000 0000 0000 0000 0000"
              />
            </div>
            <div className="space-y-2">
              <Label>Provízia (%)</Label>
              <Input
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={form.commission_rate}
                onChange={(e) => setForm({ ...form, commission_rate: e.target.value })}
                placeholder={String(nastavenia.data?.default_commission_rate ?? 10)}
              />
              <p className="text-xs text-muted-foreground">Použije sa: {provizia}</p>
            </div>
          </div>
        </section>

        <section className="space-y-4 border-t border-border/50 pt-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Globe className="h-4 w-4" /> 3 · Vlastná adresa predaja
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox
              checked={form.chce_subdomenu}
              onCheckedChange={(v) => {
                const chce = v === true;
                setForm({ ...form, chce_subdomenu: chce, subdomain: chce ? form.subdomain : "" });
                setStavSubdomeny(null);
              }}
            />
            <span className="text-sm">
              Dať organizátorovi vlastnú subdoménu
              <span className="block text-xs text-muted-foreground">
                Na tej adrese sa otvorí ten istý obchod, zúžený na jeho podujatia. Zakliknutie ju
                rovno vytvorí — žiadne ďalšie kroky v DNS ani v nginxe netreba.
              </span>
            </span>
          </label>

          {form.chce_subdomenu && (
            <div className="space-y-3 pl-7">
              <div className="flex items-end gap-2">
                <div className="space-y-2 flex-1">
                  <Label>Subdoména</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={form.subdomain}
                      onChange={(e) => {
                        setSubdomenaRucne(true);
                        setStavSubdomeny(null);
                        setForm({ ...form, subdomain: e.target.value.toLowerCase().trim() });
                      }}
                      placeholder="bbd"
                      className="max-w-[220px]"
                    />
                    <span className="text-sm text-muted-foreground">.eticketo.eu</span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => overSubdomenu.mutate()}
                  disabled={!form.subdomain || !!chybaSlugu || overSubdomenu.isPending}
                >
                  {overSubdomenu.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Overiť adresu"
                  )}
                </Button>
              </div>

              {chybaSlugu && <p className="text-sm text-destructive">{chybaSlugu}</p>}

              {stavSubdomeny && (
                <div
                  className={`text-sm rounded-md border p-3 ${
                    stavSubdomeny.volna
                      ? stavSubdomeny.https_ok
                        ? "border-primary/40 bg-primary/5"
                        : "border-amber-500/40 bg-amber-500/5"
                      : "border-destructive/40 bg-destructive/5"
                  }`}
                >
                  <div className="font-mono text-xs mb-1">{stavSubdomeny.adresa}</div>
                  <div className="flex items-start gap-2">
                    {stavSubdomeny.volna && stavSubdomeny.https_ok ? (
                      <Check className="h-4 w-4 text-primary mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
                    )}
                    <span>{stavSubdomeny.hlaska}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="space-y-3 border-t border-border/50 pt-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Mail className="h-4 w-4" /> 4 · Pozvánka
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox
              checked={form.poslat_pozvanku}
              onCheckedChange={(v) => setForm({ ...form, poslat_pozvanku: v === true })}
            />
            <span className="text-sm">
              Poslať pozvánku e-mailom
              <span className="block text-xs text-muted-foreground">
                Obsahuje jednorazový odkaz, na ktorom si organizátor nastaví vlastné heslo. Odkaz
                dostaneš aj na obrazovku, keby e-mail nedorazil.
              </span>
            </span>
          </label>
        </section>

        <div className="flex justify-end gap-2 border-t border-border/50 pt-6">
          <Button type="button" variant="ghost" onClick={() => setForm(prazdny)}>
            Vyčistiť
          </Button>
          <Button type="button" onClick={() => zalozenie.mutate()} disabled={!mozeUlozit}>
            {zalozenie.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Založiť organizátora
          </Button>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Inbox className="h-4 w-4" /> Žiadosti z registrácie
          {(ziadosti.data?.length ?? 0) > 0 && (
            <Badge variant="secondary">{ziadosti.data?.length}</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Kto sa na <span className="font-mono">/register</span> prihlásil ako organizátor. Rolu
          dostane až tu — samoregistráciou si ju nikto nepridelí.
        </p>

        {ziadosti.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Načítavam…
          </div>
        ) : (ziadosti.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Žiadne čakajúce žiadosti.</p>
        ) : (
          <div className="space-y-2">
            {ziadosti.data?.map((z) => (
              <div
                key={z.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/50 p-3"
              >
                <div className="text-sm">
                  <div className="font-medium">{z.full_name || z.email}</div>
                  <div className="text-muted-foreground text-xs">
                    {z.email}
                    {z.company_name ? ` · ${z.company_name}` : ""}
                    {z.ico ? ` · IČO ${z.ico}` : ""} · {fmtDatum(z.vznik)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => schvalenie.mutate(z)}
                    disabled={schvalenie.isPending}
                  >
                    Schváliť
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => zamietnutie.mutate(z)}
                    disabled={zamietnutie.isPending}
                  >
                    Zamietnuť
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
