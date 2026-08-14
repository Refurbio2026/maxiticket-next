import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getWalletSettings, updateWalletSettings } from "@/lib/wallet-settings.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Smartphone, Wallet, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/system/wallet")({
  head: () => ({ meta: [{ title: "Wallet nastavenia · Admin · vipky.sk" }] }),
  component: WalletSettingsPage,
});

type Form = {
  apple_enabled: boolean;
  apple_pass_type_identifier: string;
  apple_team_identifier: string;
  apple_organization_name: string;
  google_enabled: boolean;
  google_issuer_id: string;
  google_issuer_name: string;
};

function WalletSettingsPage() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getWalletSettings);
  const save = useServerFn(updateWalletSettings);
  const [form, setForm] = useState<Form | null>(null);

  const settings = useQuery({
    queryKey: ["wallet-settings"],
    queryFn: () => fetchSettings({ data: undefined as never }),
  });

  // Formulár napĺňame až z odpovede servera, nech sa needituje prázdny stav.
  useEffect(() => {
    if (!settings.data || form) return;
    setForm({
      apple_enabled: settings.data.apple.enabled,
      apple_pass_type_identifier: settings.data.apple.pass_type_identifier,
      apple_team_identifier: settings.data.apple.team_identifier,
      apple_organization_name: settings.data.apple.organization_name,
      google_enabled: settings.data.google.enabled,
      google_issuer_id: settings.data.google.issuer_id,
      google_issuer_name: settings.data.google.issuer_name,
    });
  }, [settings.data, form]);

  const saveMutation = useMutation({
    mutationFn: (f: Form) => save({ data: f }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wallet-settings"] });
      toast.success("Nastavenia uložené");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  if (settings.isLoading || !form) {
    return (
      <div className="p-10 text-center">
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const appleCert = settings.data?.apple.cert_configured ?? false;
  const googleSa = settings.data?.google.service_account_configured ?? false;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Wallet nastavenia</h1>
        <p className="text-muted-foreground mt-1">
          Vstupenka v Apple alebo Google Wallet. Nastavenie je spoločné pre celú platformu.
        </p>
      </div>

      <Card className="p-6 bg-card/60 border-border/50 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Smartphone className="size-5 text-primary" />
            <h2 className="font-display text-xl font-semibold">Apple Wallet</h2>
          </div>
          <Switch
            checked={form.apple_enabled}
            onCheckedChange={(v) => setForm({ ...form, apple_enabled: v })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pass Type Identifier">
            <Input
              placeholder="pass.sk.vipky.ticket"
              value={form.apple_pass_type_identifier}
              onChange={(e) => setForm({ ...form, apple_pass_type_identifier: e.target.value })}
            />
          </Field>
          <Field label="Team Identifier">
            <Input
              value={form.apple_team_identifier}
              onChange={(e) => setForm({ ...form, apple_team_identifier: e.target.value })}
            />
          </Field>
          <Field label="Názov organizácie" className="sm:col-span-2">
            <Input
              value={form.apple_organization_name}
              onChange={(e) => setForm({ ...form, apple_organization_name: e.target.value })}
            />
          </Field>
        </div>

        <StatusLine
          ok={appleCert}
          okText="Podpisový certifikát je na serveri."
          missingText="Podpisový certifikát (.p12) na serveri nie je — passy sa nedajú podpísať. Patrí do secrets, nie sem."
        />
      </Card>

      <Card className="p-6 bg-card/60 border-border/50 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Wallet className="size-5 text-primary" />
            <h2 className="font-display text-xl font-semibold">Google Wallet</h2>
          </div>
          <Switch
            checked={form.google_enabled}
            onCheckedChange={(v) => setForm({ ...form, google_enabled: v })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Issuer ID">
            <Input
              value={form.google_issuer_id}
              onChange={(e) => setForm({ ...form, google_issuer_id: e.target.value })}
            />
          </Field>
          <Field label="Názov vydavateľa">
            <Input
              value={form.google_issuer_name}
              onChange={(e) => setForm({ ...form, google_issuer_name: e.target.value })}
            />
          </Field>
        </div>

        <StatusLine
          ok={googleSa}
          okText="Servisný účet je na serveri."
          missingText="Servisný účet (JSON) na serveri nie je — passy sa nevygenerujú. Doplň ho do secrets ako GOOGLE_WALLET_SERVICE_ACCOUNT_JSON."
        />
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button
          onClick={() => saveMutation.mutate(form)}
          disabled={saveMutation.isPending}
          className="bg-gradient-flame text-primary-foreground shadow-glow"
        >
          {saveMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
          Uložiť nastavenia
        </Button>
      </div>
    </div>
  );
}

function StatusLine({
  ok,
  okText,
  missingText,
}: {
  ok: boolean;
  okText: string;
  missingText: string;
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded-md border p-3 text-xs ${
        ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
      }`}
    >
      {ok ? (
        <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
      ) : (
        <AlertCircle className="size-4 shrink-0 mt-0.5" />
      )}
      <span>{ok ? okText : missingText}</span>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
