import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Scanner, type IDetectedBarcode } from "@yudiel/react-qr-scanner";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Camera,
  Flashlight,
  RefreshCcw,
  Keyboard,
  Ticket as TicketIcon,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ScanResult = "valid" | "duplicate" | "invalid" | "reentry";
type ScanResponse = {
  ok: boolean;
  result: ScanResult;
  message?: string;
  ticket?: any;
  order?: any;
  event?: any;
};

export const Route = createFileRoute("/scanner")({
  component: ScannerPage,
  head: () => ({
    meta: [
      { title: "Čítačka QR vstupeniek — MaxiTicket" },
      { name: "description", content: "Skenovanie a validácia QR vstupeniek na vstupe." },
    ],
  }),
});

function ScannerPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Array<{ id: string; title: string; event_date: string }>>([]);
  const [eventId, setEventId] = useState<string>("");
  const [scanning, setScanning] = useState(true);
  const [torch, setTorch] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [last, setLast] = useState<ScanResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<{ sold: number; used: number; remaining: number; recent: any[] }>({
    sold: 0,
    used: 0,
    remaining: 0,
    recent: [],
  });
  const lockRef = useRef<string>("");
  const lastTokenRef = useRef<string>("");
  const queueRef = useRef<Array<{ token: string; ts: number }>>([]);

  const allowed = useMemo(
    () => !!user && (user.role === "admin" || user.role === "organizer"),
    [user],
  );

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("events")
        .select("id, title, event_date")
        .order("event_date", { ascending: true });
      setEvents((data as any) || []);
      if (data && data.length && !eventId) setEventId((data[0] as any).id);
    })();
  }, []);

  useEffect(() => {
    if (!eventId) return;
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/public/tickets/stats?event_id=${eventId}`);
        if (r.ok && !stop) setStats(await r.json());
      } catch {}
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [eventId]);

  // Online/offline queue replay
  useEffect(() => {
    const replay = async () => {
      if (!navigator.onLine) return;
      const stored = JSON.parse(localStorage.getItem("mt_scan_queue") || "[]");
      if (!stored.length) return;
      const remaining: any[] = [];
      for (const it of stored) {
        try {
          await fetch("/api/public/tickets/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(it),
          });
        } catch {
          remaining.push(it);
        }
      }
      localStorage.setItem("mt_scan_queue", JSON.stringify(remaining));
    };
    window.addEventListener("online", replay);
    replay();
    return () => window.removeEventListener("online", replay);
  }, []);

  async function submitScan(token: string, opts?: { allowReentry?: boolean }) {
    if (!eventId) return;
    if (busy) return;
    setBusy(true);
    const payload = {
      token,
      event_id: eventId,
      scanner_user_id: user?.id,
      scanner_name: user?.full_name || user?.email,
      allow_reentry: opts?.allowReentry || false,
    };
    try {
      if (!navigator.onLine) {
        const q = JSON.parse(localStorage.getItem("mt_scan_queue") || "[]");
        q.push(payload);
        localStorage.setItem("mt_scan_queue", JSON.stringify(q));
        setLast({
          ok: true,
          result: "valid",
          message: "Offline — bude synchronizované",
          ticket: { seat_label: "Offline" },
        } as any);
      } else {
        const r = await fetch("/api/public/tickets/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j: ScanResponse = await r.json();
        setLast(j);
        // haptic + sound
        if (navigator.vibrate) navigator.vibrate(j.result === "valid" || j.result === "reentry" ? 80 : [60, 40, 60]);
      }
    } catch (e) {
      setLast({ ok: false, result: "invalid", message: "Chyba spojenia" });
    } finally {
      setBusy(false);
    }
  }

  function handleDetected(codes: IDetectedBarcode[]) {
    if (!codes?.length) return;
    const raw = codes[0].rawValue;
    if (!raw || raw === lockRef.current) return;
    lockRef.current = raw;
    setTimeout(() => {
      if (lockRef.current === raw) lockRef.current = "";
    }, 1800);
    submitScan(raw);
  }

  if (authLoading) return null;
  if (!allowed) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <Card className="p-8 max-w-md text-center space-y-3">
          <AlertTriangle className="size-10 mx-auto text-amber-500" />
          <h1 className="text-xl font-bold">Prístup zamietnutý</h1>
          <p className="text-sm text-muted-foreground">
            Čítačka QR je dostupná len pre adminov a organizátorov.
          </p>
        </Card>
      </div>
    );
  }

  const resColor =
    last?.result === "valid"
      ? "bg-emerald-500"
      : last?.result === "reentry"
      ? "bg-sky-500"
      : last?.result === "duplicate"
      ? "bg-amber-500"
      : last
      ? "bg-rose-600"
      : "";

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-primary/5 pb-24">
      <div className="max-w-6xl mx-auto px-4 pt-24">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-gradient-flame grid place-items-center shadow-glow">
              <TicketIcon className="size-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-display font-bold">Čítačka QR vstupeniek</h1>
              <p className="text-xs text-muted-foreground">Skenuje vo vstupenkách priradených k podujatiu</p>
            </div>
          </div>
          <div className="flex items-center gap-2 min-w-[260px]">
            <Select value={eventId} onValueChange={setEventId}>
              <SelectTrigger className="rounded-xl"><SelectValue placeholder="Vyber podujatie" /></SelectTrigger>
              <SelectContent>
                {events.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.title} — {new Date(e.event_date).toLocaleDateString("sk")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid md:grid-cols-[1.2fr_1fr] gap-6">
          {/* Scanner */}
          <Card className="overflow-hidden border-border/60 bg-card">
            <div className="relative aspect-square sm:aspect-video bg-black">
              {scanning && eventId ? (
                <Scanner
                  onScan={handleDetected}
                  constraints={{ facingMode: facing }}
                  formats={["qr_code"]}
                  components={{ finder: true, torch: false }}
                  styles={{ container: { height: "100%", width: "100%" } }}
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                  <div className="text-center space-y-2">
                    <Camera className="size-10 mx-auto" />
                    <p>{!eventId ? "Vyber podujatie" : "Kamera vypnutá"}</p>
                  </div>
                </div>
              )}
              {busy && (
                <div className="absolute top-3 right-3 bg-black/60 text-white rounded-full p-2">
                  <Loader2 className="size-4 animate-spin" />
                </div>
              )}
            </div>
            <div className="p-3 flex flex-wrap gap-2 justify-between border-t border-border/40 bg-card">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setScanning((v) => !v)}>
                  <Camera className="size-4 mr-1.5" /> {scanning ? "Stop" : "Štart"}
                </Button>
                <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}>
                  <RefreshCcw className="size-4 mr-1.5" /> Kamera
                </Button>
                <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setTorch((t) => !t)} disabled>
                  <Flashlight className="size-4 mr-1.5" /> Svetlo
                </Button>
              </div>
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setManualOpen((v) => !v)}>
                <Keyboard className="size-4 mr-1.5" /> Ručne
              </Button>
            </div>
            {manualOpen && (
              <div className="p-3 border-t border-border/40 flex gap-2">
                <Input
                  placeholder="MT2.xxxxx.yyyyy"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  className="rounded-xl"
                />
                <Button
                  className="rounded-xl"
                  onClick={() => {
                    if (manualCode.trim()) submitScan(manualCode.trim());
                  }}
                >
                  Overiť
                </Button>
              </div>
            )}
          </Card>

          {/* Side panel */}
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Predané" value={stats.sold} tone="primary" />
              <Stat label="Použité" value={stats.used} tone="emerald" />
              <Stat label="Zostáva" value={stats.remaining} tone="amber" />
            </div>

            <AnimatePresence mode="wait">
              {last && (
                <motion.div
                  key={(last.ticket?.id || "") + (last.result || "") + Math.random()}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <Card className={cn("p-5 border-2", last.result === "valid" && "border-emerald-500/50", last.result === "reentry" && "border-sky-500/50", last.result === "duplicate" && "border-amber-500/50", last.result === "invalid" && "border-rose-500/60")}>
                    <div className="flex items-start gap-4">
                      <div className={cn("size-14 rounded-2xl grid place-items-center text-white shrink-0", resColor)}>
                        {last.result === "valid" || last.result === "reentry" ? (
                          <CheckCircle2 className="size-8" />
                        ) : last.result === "duplicate" ? (
                          <AlertTriangle className="size-8" />
                        ) : (
                          <XCircle className="size-8" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-lg font-bold">
                            {last.result === "valid"
                              ? "Platná vstupenka"
                              : last.result === "reentry"
                              ? "Opätovný vstup povolený"
                              : last.result === "duplicate"
                              ? "Vstupenka už bola použitá"
                              : "Neplatná vstupenka"}
                          </h3>
                          {last.message && <Badge variant="outline">{last.message}</Badge>}
                        </div>
                        {last.ticket && (
                          <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-sm">
                            {last.event?.title && (<><dt className="text-muted-foreground">Podujatie</dt><dd>{last.event.title}</dd></>)}
                            {last.ticket.seat_label && (<><dt className="text-muted-foreground">Sedadlo</dt><dd className="font-medium">{last.ticket.seat_label}</dd></>)}
                            {last.order?.customer_name && (<><dt className="text-muted-foreground">Meno</dt><dd>{last.order.customer_name}</dd></>)}
                            {last.order?.customer_email && (<><dt className="text-muted-foreground">Email</dt><dd className="truncate">{last.order.customer_email}</dd></>)}
                            {last.order?.id && (<><dt className="text-muted-foreground">Objednávka</dt><dd className="font-mono text-xs">{String(last.order.id).slice(0, 8).toUpperCase()}</dd></>)}
                            {last.ticket.last_scan_at && (<><dt className="text-muted-foreground">1. sken</dt><dd>{new Date(last.ticket.last_scan_at).toLocaleString("sk")}</dd></>)}
                            {typeof last.ticket.scan_count === "number" && (<><dt className="text-muted-foreground">Skenov</dt><dd>{last.ticket.scan_count}</dd></>)}
                          </dl>
                        )}
                        <div className="mt-4 flex gap-2 flex-wrap">
                          {last.result === "duplicate" && last.ticket?.id && (
                            <Button size="sm" className="rounded-xl" onClick={() => submitScan(last.ticket?.qr_code || manualCode, { allowReentry: true })}>
                              Povoliť opätovný vstup
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setLast(null)}>
                            Zavrieť
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Posledné skeny</h3>
                <Badge variant="outline">{stats.recent.length}</Badge>
              </div>
              <ul className="space-y-2 max-h-[260px] overflow-auto pr-1 text-sm">
                {stats.recent.length === 0 && <li className="text-muted-foreground text-xs">Zatiaľ žiadne</li>}
                {stats.recent.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 border-b border-border/40 last:border-0 pb-2">
                    <span className={cn("size-2 rounded-full",
                      s.result === "valid" && "bg-emerald-500",
                      s.result === "reentry" && "bg-sky-500",
                      s.result === "duplicate" && "bg-amber-500",
                      s.result === "invalid" && "bg-rose-500")}/>
                    <span className="flex-1 truncate">{s.scanner_name || "—"}</span>
                    <span className="text-muted-foreground text-xs">{new Date(s.created_at).toLocaleTimeString("sk")}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "primary" | "emerald" | "amber" }) {
  const map = {
    primary: "from-primary/20 to-primary/5 text-primary",
    emerald: "from-emerald-500/20 to-emerald-500/5 text-emerald-500",
    amber: "from-amber-500/20 to-amber-500/5 text-amber-500",
  } as const;
  return (
    <Card className={cn("p-4 bg-gradient-to-br border-border/50", map[tone])}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-3xl font-bold mt-1 text-foreground">{value}</div>
    </Card>
  );
}
