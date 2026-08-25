import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getPaymentGatewayOverview,
  savePaymentCredentials,
  testPaymentGateway,
  updatePaymentGatewaySettings,
  type PrehladBrany,
  type PrehladFakturacie,
} from "@/lib/payment-settings.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  FileText,
  KeyRound,
  Loader2,
  Plug,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { POVOLENE_SADZBY, POPIS_SADZIEB } from "@/lib/dph";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/error-message";

export const Route = createFileRoute("/admin/system/payments")({
  head: () => ({ meta: [{ title: "Platobné brány · Admin · vipky.sk" }] }),
  component: PaymentGatewaysPage,
});

type IdBrany = "gopay" | "gpwebpay" | "tatrapayplus";

type IdFakturacie = "superfaktura" | "faktero";

type Form = {
  gopay_enabled: boolean;
  gpwebpay_enabled: boolean;
  tatrapayplus_enabled: boolean;
  default_provider: IdBrany | null;
  invoice_provider: IdFakturacie | null;
  default_vat_rate: number;
};

function PaymentGatewaysPage() {
  const qc = useQueryClient();
  const fetchOverview = useServerFn(getPaymentGatewayOverview);
  const save = useServerFn(updatePaymentGatewaySettings);
  const test = useServerFn(testPaymentGateway);
  const saveCreds = useServerFn(savePaymentCredentials);

  const [form, setForm] = useState<Form | null>(null);
  const [testy, setTesty] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const [testuje, setTestuje] = useState<string | null>(null);

  const prehlad = useQuery({
    queryKey: ["payment-gateways"],
    queryFn: () => fetchOverview({ data: undefined as never }),
  });

  useEffect(() => {
    if (!prehlad.data || form) return;
    const najdi = (id: string) => prehlad.data.brany.find((b) => b.id === id)?.zapnuta ?? true;
    setForm({
      gopay_enabled: najdi("gopay"),
      gpwebpay_enabled: najdi("gpwebpay"),
      tatrapayplus_enabled: najdi("tatrapayplus"),
      default_provider: (prehlad.data.predvolena as IdBrany | null) ?? null,
      invoice_provider: (prehlad.data.fakturacnySystem as IdFakturacie | null) ?? null,
      default_vat_rate: prehlad.data.sadzbaDph,
    });
  }, [prehlad.data, form]);

  const ulozit = useMutation({
    mutationFn: (f: Form) => save({ data: f }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payment-gateways"] });
      toast.success("Nastavenia uložené");
    },
    onError: (e) => toast.error(errorMessage(e) || "Uloženie zlyhalo"),
  });

  const otestovat = async (id: string) => {
    setTestuje(id);
    try {
      const r = await test({ data: { provider: id as IdBrany } });
      setTesty((s) => ({ ...s, [id]: r }));
      if (r.ok) toast.success(r.detail);
      else toast.error(r.detail);
    } catch (e) {
      toast.error(errorMessage(e) || "Test zlyhal");
    } finally {
      setTestuje(null);
    }
  };

  const ulozPristupy = async (id: string, values: Record<string, string | null>) => {
    await saveCreds({ data: { provider: id as IdBrany, values } });
    // Zoznam si vypýtame znova — hodnoty sa nevracajú, ale zmení sa to, čo
    // je vyplnené a odkiaľ to pochádza.
    await qc.invalidateQueries({ queryKey: ["payment-gateways"] });
    setTesty((s) => ({ ...s, [id]: undefined as never }));
  };

  if (prehlad.isLoading || !form || !prehlad.data) {
    return (
      <div className="p-10 text-center">
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const data = prehlad.data;
  const kluc = (id: string) => `${id}_enabled` as keyof Form;
  const jeZapnuta = (id: string) => form[kluc(id)] as boolean;
  const vPonukePoUlozeni = data.brany.filter((b) => b.nakonfigurovana && jeZapnuta(b.id));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">
          Platobné brány
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Prístupy sa dajú zadať rovno tu — do databázy sa ukladajú zašifrované a späť do
          prehliadača sa už nikdy nepošlú. Zákazníkovi sa v checkoute ponúknu len brány, ktoré majú
          vyplnené prístupy a sú zapnuté.
        </p>
      </div>

      {data.adresaWebuChyba && (
        <Card className="border-destructive/50 bg-destructive/5 p-4">
          <div className="flex gap-3">
            <AlertTriangle className="size-5 shrink-0 text-destructive" />
            <div className="text-sm">
              <div className="font-medium">Nie je nastavená adresa webu</div>
              <p className="text-muted-foreground mt-1">{data.adresaWebuChyba}</p>
            </div>
          </div>
        </Card>
      )}

      {vPonukePoUlozeni.length === 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5 p-4">
          <div className="flex gap-3">
            <AlertTriangle className="size-5 shrink-0 text-amber-500" />
            <div className="text-sm">
              <div className="font-medium">Zákazník nemá čím zaplatiť</div>
              <p className="text-muted-foreground mt-1">
                Žiadna brána nie je zároveň nastavená aj zapnutá, takže tlačidlo Zaplatiť v
                checkoute skončí chybou.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card className="bg-card/60 border-border/50 p-4">
        <div className="flex gap-3 text-sm">
          <Plug className="size-5 shrink-0 text-primary" />
          <div>
            <div className="font-medium">GP webpay ani tatrapay+ neposielajú notifikáciu</div>
            <p className="text-muted-foreground mt-1">
              Výsledok platby príde len návratom zákazníka do prehliadača. Kto po zaplatení zavrie
              okno, ostal by bez vstupeniek — dotiahne ho až dopytovací sken (
              <code className="text-xs">reconcilePendingPayments</code>), ktorý patrí do cronu. Pri
              prevode z účtu to nie je okrajový prípad: v čase návratu býva platba ešte nezúčtovaná.
            </p>
            <p className="mt-2">
              Momentálne čaká na doplatenie{" "}
              <span className="font-semibold">{data.cakajuceObjednavky}</span>{" "}
              {data.cakajuceObjednavky === 1 ? "objednávka" : "objednávok"}.
            </p>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {data.brany.map((b) => (
          <BranaKarta
            key={b.id}
            brana={b}
            zapnuta={jeZapnuta(b.id)}
            predvolena={form.default_provider === b.id}
            test={testy[b.id]}
            testuje={testuje === b.id}
            onZapnut={(v) =>
              setForm((f) =>
                f
                  ? {
                      ...f,
                      [kluc(b.id)]: v,
                      // Vypnutá brána nemôže zostať predvolená.
                      default_provider:
                        !v && f.default_provider === b.id ? null : f.default_provider,
                    }
                  : f,
              )
            }
            onPredvolena={() =>
              setForm((f) => (f ? { ...f, default_provider: b.id as IdBrany } : f))
            }
            onTest={() => otestovat(b.id)}
            onUlozPristupy={(values) => ulozPristupy(b.id, values)}
          />
        ))}
      </div>

      <div>
        <h2 className="font-display text-xl font-bold tracking-tight mt-6">Fakturácia</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Ktorý systém vystavuje faktúry k objednávkam a k provízii organizátorom. Faktúru vystavuje
          vždy len jeden — ten, ktorý je označený ako používaný.
        </p>
      </div>

      <Card className="bg-card/60 border-border/50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Label className="text-sm">Predvolená sadzba DPH</Label>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Použije sa, keď podujatie nemá vlastnú sadzbu. Vstup na divadlo, do múzea či na
              športové podujatie má 5 %, hudobný koncert základnú sadzbu — nastav to na konkrétnom
              podujatí. Provízia organizátorom je služba a fakturuje sa vždy základnou sadzbou.
            </p>
          </div>
          <Select
            value={String(form.default_vat_rate)}
            onValueChange={(v) => setForm((f) => (f ? { ...f, default_vat_rate: Number(v) } : f))}
          >
            <SelectTrigger className="w-[420px] max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POVOLENE_SADZBY.map((x) => (
                <SelectItem key={x} value={String(x)}>
                  {x} % — {POPIS_SADZIEB[x]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <div className="space-y-4">
        {data.fakturacia.map((f) => (
          <FakturacnaKarta
            key={f.id}
            system={f}
            pouziva={form.invoice_provider ? form.invoice_provider === f.id : f.pouziva}
            test={testy[f.id]}
            testuje={testuje === f.id}
            onPouzivat={() =>
              setForm((x) => (x ? { ...x, invoice_provider: f.id as IdFakturacie } : x))
            }
            onTest={() => otestovat(f.id)}
            onUlozPristupy={(values) => ulozPristupy(f.id, values)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {data.predvolenaZPremennej
            ? `Premenná PAYMENT_PROVIDER je nastavená na „${data.predvolenaZPremennej}"; voľba tu ju prebije.`
            : "Predvolená brána sa použije, keď si zákazník nevyberie."}
          {data.updated_at &&
            ` · Naposledy uložené ${new Date(data.updated_at).toLocaleString("sk")}`}
        </p>
        <Button onClick={() => ulozit.mutate(form)} disabled={ulozit.isPending}>
          {ulozit.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
          Uložiť zapnutie a predvoľbu
        </Button>
      </div>
    </div>
  );
}

function BranaKarta({
  brana,
  zapnuta,
  predvolena,
  test,
  testuje,
  onZapnut,
  onPredvolena,
  onTest,
  onUlozPristupy,
}: {
  brana: PrehladBrany;
  zapnuta: boolean;
  predvolena: boolean;
  test?: { ok: boolean; detail: string };
  testuje: boolean;
  onZapnut: (v: boolean) => void;
  onPredvolena: () => void;
  onTest: () => void;
  onUlozPristupy: (values: Record<string, string | null>) => Promise<void>;
}) {
  // Rozpísané hodnoty. Kľúč, ktorý tu nie je, sa neposiela a teda sa nemení —
  // vďaka tomu netreba heslá opisovať znova pri každom uložení.
  const [zmeny, setZmeny] = useState<Record<string, string | null>>({});
  const [uklada, setUklada] = useState(false);

  // Po načítaní nových údajov zo servera zahodíme rozpísané zmeny, nech sa
  // formulár nerozíde so skutočným stavom.
  useEffect(() => {
    setZmeny({});
  }, [brana]);

  const zmenene = Object.keys(zmeny).length > 0;

  const uloz = async () => {
    setUklada(true);
    try {
      await onUlozPristupy(zmeny);
      setZmeny({});
      toast.success(`Prístupy k ${brana.label} uložené`);
    } catch (e) {
      toast.error(errorMessage(e) || "Uloženie prístupov zlyhalo");
    } finally {
      setUklada(false);
    }
  };

  return (
    <Card className="bg-card/60 border-border/50 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <CreditCard className="size-5 mt-0.5 text-primary shrink-0" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display font-semibold">{brana.label}</h2>
              {brana.nakonfigurovana && zapnuta ? (
                <Badge className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
                  V ponuke
                </Badge>
              ) : !brana.nakonfigurovana ? (
                <Badge variant="outline" className="text-muted-foreground">
                  Chýbajú prístupy
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Vypnutá
                </Badge>
              )}
              {brana.rezim === "test" && (
                <Badge className="bg-amber-500/15 text-amber-500 hover:bg-amber-500/15">
                  Testovacia prevádzka
                </Badge>
              )}
              {predvolena && (
                <Badge variant="secondary" className="gap-1">
                  <Star className="size-3" /> Predvolená
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">{brana.hint}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!predvolena && brana.nakonfigurovana && zapnuta && (
            <Button variant="ghost" size="sm" onClick={onPredvolena} className="gap-1.5">
              <Star className="size-3.5" /> Nastaviť ako predvolenú
            </Button>
          )}
          <Switch checked={zapnuta} onCheckedChange={onZapnut} />
        </div>
      </div>

      <Separator />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <h3 className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <KeyRound className="size-3.5" /> Prístupy
          </h3>

          {brana.konfiguracia.map((k) => (
            <PolePristupu
              key={k.premenna}
              polozka={k}
              hodnota={zmeny[k.premenna]}
              onZmena={(v) => setZmeny((z) => ({ ...z, [k.premenna]: v }))}
              onVratit={() =>
                setZmeny((z) => {
                  const { [k.premenna]: _, ...zvysok } = z;
                  return zvysok;
                })
              }
            />
          ))}

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={uloz} disabled={!zmenene || uklada}>
              {uklada && <Loader2 className="size-4 mr-2 animate-spin" />}
              Uložiť prístupy
            </Button>
            {zmenene && (
              <span className="text-xs text-muted-foreground">
                {Object.keys(zmeny).length} neuložených zmien
              </span>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Adresy</h3>
            <Adresa
              nazov={
                brana.id === "tatrapayplus"
                  ? "Návratová adresa (zaregistruj v portáli banky)"
                  : "Návratová adresa"
              }
              hodnota={brana.navratovaAdresa}
            />
            {brana.notifikacnaAdresa ? (
              <Adresa nazov="Notifikačná adresa" hodnota={brana.notifikacnaAdresa} />
            ) : (
              <p className="text-xs text-muted-foreground mt-2">
                Notifikáciu na server táto brána neposiela — stav sa dopytuje.
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Komunikuje s <code className="text-xs">{brana.endpoint}</code>
            </p>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Refund cez API: {brana.vieRefundovat ? "áno" : "nie, len ručne"}</span>
            <span>Dopyt na stav: {brana.vieDopytStavu ? "áno" : "nie"}</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onTest}
              disabled={testuje || !brana.nakonfigurovana}
            >
              {testuje ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Plug className="size-4 mr-2" />
              )}
              Otestovať spojenie
            </Button>
            {brana.chybaju.length > 0 && (
              <span className="text-xs text-destructive">Chýba: {brana.chybaju.join(", ")}</span>
            )}
          </div>

          {test && (
            <span
              className={cn(
                "flex items-start gap-1.5 text-xs",
                test.ok ? "text-emerald-500" : "text-destructive",
              )}
            >
              {test.ok ? (
                <CheckCircle2 className="size-3.5 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
              )}
              {test.detail}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function PolePristupu({
  polozka,
  hodnota,
  onZmena,
  onVratit,
}: {
  polozka: PrehladBrany["konfiguracia"][number];
  /** `undefined` = nedotknuté, `null` = označené na zmazanie. */
  hodnota: string | null | undefined;
  onZmena: (v: string | null) => void;
  onVratit: () => void;
}) {
  const naZmazanie = hodnota === null;
  const upravene = hodnota !== undefined;

  const zdrojText =
    polozka.zdroj === "admin"
      ? "uložené tu"
      : polozka.zdroj === "server"
        ? "zo servera (.env)"
        : null;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-sm">
          {polozka.nazov}
          {polozka.povinna && <span className="text-destructive"> *</span>}
        </Label>
        {polozka.vyplnena ? (
          <Check className="size-3.5 text-emerald-500" />
        ) : (
          <X
            className={cn(
              "size-3.5",
              polozka.povinna ? "text-destructive" : "text-muted-foreground",
            )}
          />
        )}
        {zdrojText && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
            {zdrojText}
          </Badge>
        )}
        {!polozka.povinna && !zdrojText && (
          <span className="text-[10px] text-muted-foreground">voliteľné</span>
        )}
      </div>

      {polozka.viacriadkova ? (
        <Textarea
          rows={3}
          className="font-mono text-xs"
          value={naZmazanie ? "" : (hodnota ?? (polozka.tajna ? "" : (polozka.hodnota ?? "")))}
          placeholder={
            naZmazanie
              ? "Po uložení sa zmaže"
              : polozka.nahlad
                ? `Uložené: ${polozka.nahlad} — nechaj prázdne, ak sa nemá meniť`
                : "-----BEGIN …-----"
          }
          onChange={(e) => onZmena(e.target.value)}
        />
      ) : (
        <Input
          type={polozka.tajna ? "password" : "text"}
          className={polozka.tajna ? undefined : "font-mono text-xs"}
          value={naZmazanie ? "" : (hodnota ?? (polozka.tajna ? "" : (polozka.hodnota ?? "")))}
          placeholder={
            naZmazanie
              ? "Po uložení sa zmaže"
              : polozka.nahlad
                ? `Uložené: ${polozka.nahlad} — nechaj prázdne, ak sa nemá meniť`
                : polozka.vyplnena
                  ? "Vyplnené"
                  : "Nevyplnené"
          }
          onChange={(e) => onZmena(e.target.value)}
        />
      )}

      <div className="flex items-center gap-3">
        <span className="text-[10px] text-muted-foreground">
          {polozka.popis} · v <code>.env</code> je to <code>{polozka.premenna}</code>
        </span>
        {polozka.zdroj === "admin" && !naZmazanie && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] gap-1 text-muted-foreground"
            onClick={() => onZmena(null)}
          >
            <Trash2 className="size-3" /> Zmazať
          </Button>
        )}
        {upravene && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-muted-foreground"
            onClick={onVratit}
          >
            Vrátiť späť
          </Button>
        )}
      </div>
    </div>
  );
}

function FakturacnaKarta({
  system,
  pouziva,
  test,
  testuje,
  onPouzivat,
  onTest,
  onUlozPristupy,
}: {
  system: PrehladFakturacie;
  pouziva: boolean;
  test?: { ok: boolean; detail: string };
  testuje: boolean;
  onPouzivat: () => void;
  onTest: () => void;
  onUlozPristupy: (values: Record<string, string | null>) => Promise<void>;
}) {
  const [zmeny, setZmeny] = useState<Record<string, string | null>>({});
  const [uklada, setUklada] = useState(false);

  useEffect(() => {
    setZmeny({});
  }, [system]);

  const uloz = async () => {
    setUklada(true);
    try {
      await onUlozPristupy(zmeny);
      setZmeny({});
      toast.success(`Prístupy k ${system.label} uložené`);
    } catch (e) {
      toast.error(errorMessage(e) || "Uloženie prístupov zlyhalo");
    } finally {
      setUklada(false);
    }
  };

  return (
    <Card className="bg-card/60 border-border/50 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <FileText className="size-5 mt-0.5 text-primary shrink-0" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display font-semibold">{system.label}</h3>
              {pouziva && system.nakonfigurovana ? (
                <Badge className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
                  Vystavuje faktúry
                </Badge>
              ) : !system.nakonfigurovana ? (
                <Badge variant="outline" className="text-muted-foreground">
                  Chýbajú prístupy
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Nepoužíva sa
                </Badge>
              )}
              {system.rezim === "test" && (
                <Badge className="bg-amber-500/15 text-amber-500 hover:bg-amber-500/15">
                  Testovacia prevádzka
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">{system.hint}</p>
          </div>
        </div>
        {!pouziva && system.nakonfigurovana && (
          <Button variant="ghost" size="sm" onClick={onPouzivat} className="gap-1.5">
            <Star className="size-3.5" /> Používať tento
          </Button>
        )}
      </div>

      <Separator />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <h4 className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <KeyRound className="size-3.5" /> Prístupy
          </h4>
          {system.konfiguracia.map((k) => (
            <PolePristupu
              key={k.premenna}
              polozka={k}
              hodnota={zmeny[k.premenna]}
              onZmena={(v) => setZmeny((z) => ({ ...z, [k.premenna]: v }))}
              onVratit={() =>
                setZmeny((z) => {
                  const { [k.premenna]: _, ...zvysok } = z;
                  return zvysok;
                })
              }
            />
          ))}
          <Button size="sm" onClick={uloz} disabled={Object.keys(zmeny).length === 0 || uklada}>
            {uklada && <Loader2 className="size-4 mr-2 animate-spin" />}
            Uložiť prístupy
          </Button>
        </div>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Komunikuje s <code className="text-xs">{system.endpoint}</code>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={onTest}
              disabled={testuje || !system.nakonfigurovana}
            >
              {testuje ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Plug className="size-4 mr-2" />
              )}
              Otestovať spojenie
            </Button>
            {system.chybaju.length > 0 && (
              <span className="text-xs text-destructive">Chýba: {system.chybaju.join(", ")}</span>
            )}
          </div>
          {test && (
            <span
              className={cn(
                "flex items-start gap-1.5 text-xs",
                test.ok ? "text-emerald-500" : "text-destructive",
              )}
            >
              {test.ok ? (
                <CheckCircle2 className="size-3.5 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
              )}
              {test.detail}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function Adresa({ nazov, hodnota }: { nazov: string; hodnota: string }) {
  if (!hodnota) {
    return (
      <div className="mt-2 text-xs text-muted-foreground">
        {nazov}: nedá sa poskladať, kým nie je nastavená adresa webu.
      </div>
    );
  }
  return (
    <div className="mt-2">
      <div className="text-xs text-muted-foreground">{nazov}</div>
      <div className="flex items-center gap-2">
        <code className="text-xs break-all">{hodnota}</code>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          onClick={() => {
            navigator.clipboard
              .writeText(hodnota)
              .then(() => toast.success("Skopírované"))
              .catch(() => toast.error("Kopírovanie zlyhalo"));
          }}
        >
          <Copy className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
