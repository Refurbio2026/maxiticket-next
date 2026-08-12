import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getWalletSettings,
  setWalletSettings,
  isAppleConfigured,
  isGoogleConfigured,
  type WalletSettings,
} from "@/lib/wallet-db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Smartphone, Wallet, ShieldCheck, CheckCircle2, AlertCircle, Upload } from "lucide-react";

export const Route = createFileRoute("/admin/system/wallet")({
  head: () => ({ meta: [{ title: "Wallet nastavenia · Admin · vipky.sk" }] }),
  component: WalletSettingsPage,
});

function WalletSettingsPage() {
  const [s, setS] = useState<WalletSettings | null>(null);

  useEffect(() => {
    setS(getWalletSettings());
  }, []);

  if (!s) return null;

  const save = (next: WalletSettings) => {
    setS(next);
    setWalletSettings(next);
    toast.success("Nastavenia uložené");
  };

  const fakeUpload = (which: "apple_cert" | "apple_wwdr" | "google_sa") => {
    if (which === "apple_cert") {
      save({ ...s, apple: { ...s.apple, cert_uploaded: true } });
    } else if (which === "apple_wwdr") {
      save({ ...s, apple: { ...s.apple, wwdr_uploaded: true } });
    } else {
      save({ ...s, google: { ...s.google, service_account_uploaded: true } });
    }
    toast.info("Demo režim — reálne nahratie certifikátu sa aktivuje vo Fáze 2/3");
  };

  const appleOk = isAppleConfigured(s);
  const googleOk = isGoogleConfigured(s);

  return (
    <div className="p-6 lg:p-10 max-w-4xl mx-auto space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Wallet nastavenia</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Konfigurácia Apple Wallet a Google Wallet pre digitálne vstupenky. Reálne podpisovanie sa
          aktivuje po dodaní certifikátov a service accountu.
        </p>
      </header>

      {/* Apple Wallet */}
      <Card className="p-6 bg-card/60 border-border/50 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-xl bg-foreground/5 grid place-items-center">
              <Smartphone className="size-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold">Apple Wallet</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                .pkpass podpísané Pass Type ID certifikátom (PKCS#7)
              </p>
            </div>
          </div>
          <StatusBadge ok={appleOk} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Aktivovať Apple Wallet</Label>
            <p className="text-xs text-muted-foreground">
              Po aktivácii sa pri vstupenkách zobrazí tlačidlo „Pridať do Apple Wallet".
            </p>
          </div>
          <Switch
            checked={s.apple.enabled}
            onCheckedChange={(v) => save({ ...s, apple: { ...s.apple, enabled: v } })}
          />
        </div>

        <Separator />

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Pass Type Identifier" hint="napr. pass.com.vstupenky.event">
            <Input
              value={s.apple.pass_type_identifier}
              onChange={(e) =>
                save({ ...s, apple: { ...s.apple, pass_type_identifier: e.target.value } })
              }
              placeholder="pass.com.vstupenky.event"
            />
          </Field>
          <Field label="Team Identifier" hint="10-znakové ID z Apple Developer">
            <Input
              value={s.apple.team_identifier}
              onChange={(e) =>
                save({ ...s, apple: { ...s.apple, team_identifier: e.target.value } })
              }
              placeholder="ABCDE12345"
            />
          </Field>
          <Field label="Organization Name" hint="zobrazí sa na vstupenke">
            <Input
              value={s.apple.organization_name}
              onChange={(e) =>
                save({ ...s, apple: { ...s.apple, organization_name: e.target.value } })
              }
            />
          </Field>
        </div>

        <Separator />

        <div className="space-y-3">
          <CertRow
            label="Pass Type ID certifikát (.p12)"
            uploaded={s.apple.cert_uploaded}
            onUpload={() => fakeUpload("apple_cert")}
            onRemove={() => save({ ...s, apple: { ...s.apple, cert_uploaded: false } })}
          />
          <CertRow
            label="Apple WWDR G4 certifikát"
            uploaded={s.apple.wwdr_uploaded}
            onUpload={() => fakeUpload("apple_wwdr")}
            onRemove={() => save({ ...s, apple: { ...s.apple, wwdr_uploaded: false } })}
          />
        </div>

        <div className="text-xs text-muted-foreground bg-muted/40 border border-border/50 rounded-md p-3">
          <strong className="text-foreground">Ako získať certifikáty:</strong> developer.apple.com →
          Certificates → Pass Type ID Certificate. Vyžaduje Apple Developer účet ($99/rok).
        </div>
      </Card>

      {/* Google Wallet */}
      <Card className="p-6 bg-card/60 border-border/50 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-xl bg-foreground/5 grid place-items-center">
              <Wallet className="size-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold">Google Wallet</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                JWT podpísaný service accountom (RS256)
              </p>
            </div>
          </div>
          <StatusBadge ok={googleOk} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Aktivovať Google Wallet</Label>
            <p className="text-xs text-muted-foreground">
              Po aktivácii sa zobrazí tlačidlo „Pridať do Google Wallet".
            </p>
          </div>
          <Switch
            checked={s.google.enabled}
            onCheckedChange={(v) => save({ ...s, google: { ...s.google, enabled: v } })}
          />
        </div>

        <Separator />

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Issuer ID" hint="schvaľuje Google (pay.google.com/business/console)">
            <Input
              value={s.google.issuer_id}
              onChange={(e) => save({ ...s, google: { ...s.google, issuer_id: e.target.value } })}
              placeholder="3388000000022..."
            />
          </Field>
          <Field label="Issuer Name" hint="zobrazí sa v Google Wallet">
            <Input
              value={s.google.issuer_name}
              onChange={(e) => save({ ...s, google: { ...s.google, issuer_name: e.target.value } })}
            />
          </Field>
        </div>

        <Separator />

        <CertRow
          label="Service Account JSON"
          uploaded={s.google.service_account_uploaded}
          onUpload={() => fakeUpload("google_sa")}
          onRemove={() => save({ ...s, google: { ...s.google, service_account_uploaded: false } })}
        />

        <div className="text-xs text-muted-foreground bg-muted/40 border border-border/50 rounded-md p-3">
          <strong className="text-foreground">Ako získať Issuer ID:</strong>{" "}
          pay.google.com/business/console → Žiadosť o Issuer account. Trvá 1–3 dni.
        </div>
      </Card>

      {/* Test */}
      <Card className="p-6 bg-card/60 border-border/50">
        <div className="flex items-center gap-3 mb-3">
          <ShieldCheck className="size-5 text-primary" />
          <h2 className="font-display text-lg font-semibold">Test</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Vygeneruj testovaciu vstupenku a over že sa otvorí v Apple/Google Wallet.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!appleOk}
            onClick={() => toast.info("Reálne podpisovanie sa aktivuje vo Fáze 3")}
          >
            <Smartphone className="size-4 mr-2" /> Test Apple Wallet
          </Button>
          <Button
            variant="outline"
            disabled={!googleOk}
            onClick={() => toast.info("Reálne JWT podpisovanie sa aktivuje vo Fáze 2")}
          >
            <Wallet className="size-4 mr-2" /> Test Google Wallet
          </Button>
        </div>
      </Card>
    </div>
  );
}

function StatusBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-3 py-1">
      <CheckCircle2 className="size-3.5" /> Aktívne
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-full px-3 py-1">
      <AlertCircle className="size-3.5" /> Nenakonfigurované
    </span>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CertRow({
  label,
  uploaded,
  onUpload,
  onRemove,
}: {
  label: string;
  uploaded: boolean;
  onUpload: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/50 p-3">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={
            "size-8 rounded-md grid place-items-center shrink-0 " +
            (uploaded ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground")
          }
        >
          {uploaded ? <CheckCircle2 className="size-4" /> : <Upload className="size-4" />}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{label}</div>
          <div className="text-[11px] text-muted-foreground">
            {uploaded ? "Nahraté" : "Chýba certifikát"}
          </div>
        </div>
      </div>
      {uploaded ? (
        <Button size="sm" variant="ghost" onClick={onRemove}>
          Odstrániť
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={onUpload}>
          <Upload className="size-3.5 mr-1.5" /> Nahrať
        </Button>
      )}
    </div>
  );
}
