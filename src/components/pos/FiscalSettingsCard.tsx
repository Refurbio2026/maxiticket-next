// Formulár s údajmi pre finančnú správu (ORP / eKasa).
//
// Pôvodne žil len v organizátorskej sekcii a ukladal sa do localStorage —
// po vymazaní cache boli kódy preč a admin ich nemal kde zadať. Teraz je to
// jeden spoločný komponent nad `fiscal_settings` v databáze; admin ho používa
// s vybraným organizátorom, organizátor sám za seba.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFiscalSettings, updateFiscalSettings } from "@/lib/fiscal.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Loader2, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type FormState = {
  enabled: boolean;
  mode: "mock" | "production";
  fiscal_type: "ORP" | "eKasa";
  provider: string;
  cash_register_code: string;
  ico: string;
  dic: string;
  ic_dph: string;
  premises_code: string;
  premises_name: string;
  premises_address: string;
  endpoint_url: string;
  client_id: string;
  api_key: string;
  client_secret: string;
  note: string;
};

const EMPTY: FormState = {
  enabled: false,
  mode: "mock",
  fiscal_type: "ORP",
  provider: "",
  cash_register_code: "",
  ico: "",
  dic: "",
  ic_dph: "",
  premises_code: "",
  premises_name: "",
  premises_address: "",
  endpoint_url: "",
  client_id: "",
  api_key: "",
  client_secret: "",
  note: "",
};

export function FiscalSettingsCard({ organizerId }: { organizerId?: string }) {
  const qc = useQueryClient();
  const load = useServerFn(getFiscalSettings);
  const save = useServerFn(updateFiscalSettings);

  const settings = useQuery({
    queryKey: ["fiscal-settings", organizerId ?? "me"],
    queryFn: () => load({ data: { organizer_id: organizerId } }),
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  // Či už je kľúč uložený v databáze — do formulára ho nikdy nesťahujeme.
  const [secretsSet, setSecretsSet] = useState({ api_key: false, client_secret: false });

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setForm({
      enabled: s.enabled,
      mode: s.mode,
      fiscal_type: s.fiscal_type,
      provider: s.provider ?? "",
      cash_register_code: s.cash_register_code ?? "",
      ico: s.ico ?? "",
      dic: s.dic ?? "",
      ic_dph: s.ic_dph ?? "",
      premises_code: s.premises_code ?? "",
      premises_name: s.premises_name ?? "",
      premises_address: s.premises_address ?? "",
      endpoint_url: s.endpoint_url ?? "",
      client_id: s.client_id ?? "",
      api_key: "",
      client_secret: "",
      note: s.note ?? "",
    });
    setSecretsSet({ api_key: s.api_key_set, client_secret: s.client_secret_set });
  }, [settings.data]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => save({ data: payload as never }),
    onSuccess: () => {
      toast.success("Nastavenie ORP uložené.");
      qc.invalidateQueries({ queryKey: ["fiscal-settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    mutation.mutate({
      organizer_id: organizerId,
      enabled: form.enabled,
      mode: form.mode,
      fiscal_type: form.fiscal_type,
      provider: form.provider,
      cash_register_code: form.cash_register_code,
      ico: form.ico,
      dic: form.dic,
      ic_dph: form.ic_dph,
      premises_code: form.premises_code,
      premises_name: form.premises_name,
      premises_address: form.premises_address,
      endpoint_url: form.endpoint_url,
      client_id: form.client_id,
      // Prázdne pole = ponechať uložený kľúč; server rozlišuje undefined a "".
      ...(form.api_key ? { api_key: form.api_key } : {}),
      ...(form.client_secret ? { client_secret: form.client_secret } : {}),
      note: form.note,
    });
  };

  // Čo ešte chýba, aby sa dalo prepnúť do ostrej prevádzky.
  const missing = [
    !form.cash_register_code && "DKP (kód pokladnice)",
    !form.ico && "IČO",
    !form.dic && "DIČ",
    !form.premises_code && "kód prevádzky",
    !form.endpoint_url && "URL brány poskytovateľa",
  ].filter(Boolean) as string[];

  if (settings.isLoading) {
    return (
      <Card className="p-8 bg-card/60 border-border/50">
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  return (
    <Card className="p-5 bg-card/60 border-border/50 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-lg font-bold">Údaje pre finančnú správu</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Kódy z registrácie pokladnice. Bez nich sa doklad nedá odoslať do eKasy.
          </p>
        </div>
        <Badge variant={form.mode === "production" ? "default" : "outline"}>
          {form.mode === "production" ? "ostrá prevádzka" : "skúšobný režim"}
        </Badge>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Field label="Režim">
          <NativeSelect
            value={form.mode}
            onChange={(v) => set("mode", v as FormState["mode"])}
            options={[
              { v: "mock", l: "Skúšobný (doklady sa len evidujú)" },
              { v: "production", l: "Ostrý (odosielať poskytovateľovi)" },
            ]}
          />
        </Field>
        <Field label="Typ pokladnice">
          <NativeSelect
            value={form.fiscal_type}
            onChange={(v) => set("fiscal_type", v as FormState["fiscal_type"])}
            options={[
              { v: "ORP", l: "ORP — online registračná pokladnica" },
              { v: "eKasa", l: "eKasa (VRP)" },
            ]}
          />
        </Field>
        <Field label="Poskytovateľ ORP">
          <Input
            value={form.provider}
            onChange={(e) => set("provider", e.target.value)}
            placeholder="napr. Bowa, Elcom…"
          />
        </Field>

        <Field label="DKP — kód pokladnice" hint="Pridelí finančná správa pri registrácii.">
          <Input
            value={form.cash_register_code}
            onChange={(e) => set("cash_register_code", e.target.value)}
            placeholder="88812345678901234567"
            className="font-mono"
          />
        </Field>
        <Field label="IČO">
          <Input
            value={form.ico}
            onChange={(e) => set("ico", e.target.value)}
            placeholder="12345678"
          />
        </Field>
        <Field label="DIČ">
          <Input
            value={form.dic}
            onChange={(e) => set("dic", e.target.value)}
            placeholder="2020000000"
          />
        </Field>
        <Field label="IČ DPH" hint="Nechaj prázdne, ak nie si platiteľ DPH.">
          <Input
            value={form.ic_dph}
            onChange={(e) => set("ic_dph", e.target.value)}
            placeholder="SK2020000000"
          />
        </Field>

        <Field label="Kód prevádzky">
          <Input
            value={form.premises_code}
            onChange={(e) => set("premises_code", e.target.value)}
            placeholder="PREV-001"
          />
        </Field>
        <Field label="Názov prevádzky">
          <Input
            value={form.premises_name}
            onChange={(e) => set("premises_name", e.target.value)}
            placeholder="Pokladňa – hlavný vchod"
          />
        </Field>
        <Field label="Adresa prevádzky" className="md:col-span-2">
          <Input
            value={form.premises_address}
            onChange={(e) => set("premises_address", e.target.value)}
            placeholder="Hlavná 1, 811 01 Bratislava"
          />
        </Field>
      </div>

      <Separator />

      <div className="grid md:grid-cols-2 gap-4">
        <Field label="URL brány poskytovateľa" className="md:col-span-2">
          <Input
            value={form.endpoint_url}
            onChange={(e) => set("endpoint_url", e.target.value)}
            placeholder="https://…"
          />
        </Field>
        <Field label="Client ID">
          <Input
            value={form.client_id}
            onChange={(e) => set("client_id", e.target.value)}
            placeholder="client_id"
          />
        </Field>
        <Field
          label="Client secret"
          hint={secretsSet.client_secret ? "Uložený — vyplň len pri zmene." : undefined}
        >
          <Input
            type="password"
            value={form.client_secret}
            onChange={(e) => set("client_secret", e.target.value)}
            placeholder={secretsSet.client_secret ? "••••••••" : "nezadané"}
          />
        </Field>
        <Field
          label="API kľúč"
          hint={secretsSet.api_key ? "Uložený — vyplň len pri zmene." : undefined}
          className="md:col-span-2"
        >
          <Input
            type="password"
            value={form.api_key}
            onChange={(e) => set("api_key", e.target.value)}
            placeholder={secretsSet.api_key ? "••••••••" : "nezadané"}
          />
        </Field>
        <Field label="Poznámka" className="md:col-span-2">
          <Textarea
            rows={2}
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="Číslo zmluvy, kontakt na poskytovateľa…"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
        <div>
          <Label className="cursor-pointer">Odosielať doklady do eKasy</Label>
          <p className="text-[11px] text-muted-foreground">
            Kým chýba certifikát a zmluva s poskytovateľom, odoslanie je simulované.
          </p>
        </div>
        <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
      </div>

      {missing.length > 0 && (
        <div className="flex items-start gap-2 text-sm rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <ShieldCheck className="size-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Na ostrú prevádzku ešte chýba</div>
            <p className="text-muted-foreground">{missing.join(", ")}.</p>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          onClick={submit}
          disabled={mutation.isPending}
          className="bg-gradient-flame text-primary-foreground shadow-glow"
        >
          {mutation.isPending ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Save className="size-4 mr-2" />
          )}
          Uložiť nastavenie
        </Button>
        {settings.data?.last_check_at && (
          <span className="text-xs text-muted-foreground self-center">
            Naposledy overené: {new Date(settings.data.last_check_at).toLocaleString("sk-SK")}
          </span>
        )}
      </div>
    </Card>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function NativeSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-10 rounded-md bg-background border border-border/50 px-3 text-sm"
    >
      {options.map((o) => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </select>
  );
}
