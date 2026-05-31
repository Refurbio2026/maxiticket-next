import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Delete, LogIn, ShieldCheck, UserCircle2, Users } from "lucide-react";
import { toast } from "sonner";
import {
  getActiveCashiersForOrganizer, verifyPin, openSession,
  type Cashier, type CashierSession,
} from "@/lib/cashier-db";

type Props = {
  organizerId: string;
  onAuthed: (cashier: Cashier, session: CashierSession) => void;
};

export function CashierLoginGate({ organizerId, onAuthed }: Props) {
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [selected, setSelected] = useState<Cashier | null>(null);
  const [pin, setPin] = useState("");
  const [openingCash, setOpeningCash] = useState<string>("0");
  const [step, setStep] = useState<"pick" | "pin" | "cash">("pick");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCashiers(getActiveCashiersForOrganizer(organizerId));
  }, [organizerId]);

  const initials = (c: Cashier) =>
    (c.first_name?.[0] ?? "") + (c.last_name?.[0] ?? "") || c.display_name.slice(0, 2);

  const pinKeys = useMemo(() => ["1","2","3","4","5","6","7","8","9","C","0","⌫"], []);

  const pressKey = (k: string) => {
    if (k === "C") return setPin("");
    if (k === "⌫") return setPin((p) => p.slice(0, -1));
    if (pin.length >= 8) return;
    setPin((p) => p + k);
  };

  const submitPin = async () => {
    if (!selected) return;
    if (pin.length < 4) return toast.error("PIN musí mať aspoň 4 znaky");
    setBusy(true);
    try {
      const ok = await verifyPin(pin, selected.pin_hash);
      if (!ok) { toast.error("Nesprávny PIN"); setPin(""); return; }
      setStep("cash");
    } finally {
      setBusy(false);
    }
  };

  const finishLogin = () => {
    if (!selected) return;
    const cash = Number(openingCash || "0");
    const session = openSession({
      cashier_id: selected.id,
      cashier_display_name: selected.display_name,
      organizer_id: organizerId,
      opening_cash_amount: isFinite(cash) ? cash : 0,
    });
    toast.success(`Vitaj, ${selected.display_name}!`);
    onAuthed(selected, session);
  };

  if (cashiers.length === 0) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Card className="p-10 max-w-md text-center bg-card/70 border-dashed border-border/50">
          <Users className="size-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="font-display text-2xl font-bold">Žiadny aktívny pokladník</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Najprv vytvor pokladníka v sekcii <strong>Pokladňa → Pokladníci</strong>.
            Každý pokladník sa prihlasuje vlastným PIN kódom.
          </p>
          <Button asChild className="mt-6 bg-gradient-flame text-primary-foreground shadow-glow">
            <a href="/organizer/pos/cashiers">Spravovať pokladníkov</a>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center py-8">
      <Card className="w-full max-w-3xl p-6 sm:p-10 bg-card/70 border-border/50 shadow-glow">
        {step === "pick" && (
          <>
            <div className="text-center mb-8">
              <ShieldCheck className="size-10 text-primary mx-auto mb-3" />
              <h2 className="font-display text-3xl font-bold tracking-tight">Vyberte pokladníka</h2>
              <p className="text-sm text-muted-foreground mt-2">
                Po výbere zadáte svoj PIN a otvoríte pokladnicu.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {cashiers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setSelected(c); setPin(""); setStep("pin"); }}
                  className="group p-5 rounded-2xl border border-border/50 bg-background hover:border-primary hover:shadow-glow transition text-left"
                >
                  <div className="flex flex-col items-center text-center gap-3">
                    <div className="size-16 rounded-full bg-gradient-flame text-primary-foreground flex items-center justify-center font-display font-bold text-xl uppercase shadow-glow">
                      {initials(c)}
                    </div>
                    <div>
                      <div className="font-semibold">{c.display_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.first_name} {c.last_name}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                        {c.permissions.length} oprávnení
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "pin" && selected && (
          <div className="max-w-sm mx-auto">
            <Button variant="ghost" size="sm" className="-ml-2 mb-4" onClick={() => { setSelected(null); setPin(""); setStep("pick"); }}>
              <ArrowLeft className="size-4 mr-1.5" /> Späť
            </Button>
            <div className="text-center mb-6">
              <div className="size-16 rounded-full bg-gradient-flame text-primary-foreground flex items-center justify-center font-display font-bold text-xl uppercase shadow-glow mx-auto">
                {initials(selected)}
              </div>
              <div className="font-display text-xl font-bold mt-3">{selected.display_name}</div>
              <p className="text-xs text-muted-foreground">Zadajte PIN kód</p>
            </div>

            <div className="flex justify-center gap-2 mb-5" aria-live="polite">
              {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                <span
                  key={i}
                  className={`size-3.5 rounded-full transition ${
                    i < pin.length ? "bg-primary shadow-glow" : "bg-muted-foreground/30"
                  }`}
                />
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {pinKeys.map((k) => (
                <button
                  key={k}
                  onClick={() => pressKey(k)}
                  className="h-14 rounded-xl bg-background border border-border/50 hover:border-primary hover:bg-muted/40 active:scale-95 transition text-xl font-semibold"
                >
                  {k === "⌫" ? <Delete className="size-5 mx-auto" /> : k}
                </button>
              ))}
            </div>

            <Button
              onClick={submitPin}
              disabled={busy || pin.length < 4}
              className="w-full mt-5 h-12 bg-gradient-flame text-primary-foreground shadow-glow"
            >
              <LogIn className="size-4 mr-2" /> Prihlásiť
            </Button>
          </div>
        )}

        {step === "cash" && selected && (
          <div className="max-w-sm mx-auto">
            <div className="text-center mb-6">
              <UserCircle2 className="size-10 text-primary mx-auto mb-2" />
              <h2 className="font-display text-2xl font-bold">{selected.display_name}</h2>
              <p className="text-xs text-muted-foreground">Otvorenie pokladne</p>
            </div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Počiatočná hotovosť v zásuvke (€)</Label>
            <Input
              type="number"
              step="0.01"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              className="h-12 text-lg mt-2"
              autoFocus
            />
            <Button
              onClick={finishLogin}
              className="w-full mt-5 h-12 bg-gradient-flame text-primary-foreground shadow-glow"
            >
              Otvoriť pokladnicu
            </Button>
            <button
              onClick={() => { setStep("pin"); setPin(""); }}
              className="w-full mt-3 text-xs text-muted-foreground hover:text-foreground"
            >
              Späť
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
