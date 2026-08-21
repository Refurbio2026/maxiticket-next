import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Scanner, type IDetectedBarcode } from "@yudiel/react-qr-scanner";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Camera,
  RefreshCcw,
  Keyboard,
  Ticket as TicketIcon,
  Ban,
  Loader2,
  QrCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { listScannerDevicesForEvent, type ScannerDeviceOption } from "@/lib/devices.functions";

type ScanResult = "valid" | "duplicate" | "invalid" | "reentry" | "refunded";
/**
 * Vstupenka tak, ako ju vracia `/api/public/tickets/scan`. Polia sú voliteľné,
 * lebo offline sken si zostaví len útržok — čítačka musí niečo ukázať aj bez
 * odpovede servera.
 */
type ScannedTicket = {
  id?: string;
  seat_label?: string | null;
  issued_at?: string | null;
  used_at?: string | null;
  scan_count?: number | null;
  last_scan_at?: string | null;
};

/** Z objednávky čítačka ukazuje len meno kupujúceho a skrátené číslo. */
type ScannedOrder = { id?: string; customer_name?: string | null } | null;

/**
 * Podujatie z odpovede skenu. `event_date` je termín TEJ vstupenky, nie
 * najbližší termín podujatia — pri reprízach sa to líši.
 */
type ScannedEvent = {
  id: string;
  title?: string;
  event_date?: string;
  event_time?: string;
} | null;

type ScanResponse = {
  ok: boolean;
  result: ScanResult;
  message?: string;
  ticket?: ScannedTicket;
  order?: ScannedOrder;
  event?: ScannedEvent;
};

/** Posledné skeny z `/api/public/tickets/stats`. */
type RecentScan = {
  id: string;
  created_at: string;
  result: ScanResult;
  scanner_name: string | null;
  ticket_id: string | null;
};

/** Sken odložený, kým je čítačka bez signálu. */
type QueuedScan = {
  token: string;
  event_token: string;
  event_id: string;
  device_id?: string;
  scanner_name: string;
  allow_reentry: boolean;
};
type EventInfo = {
  id: string;
  title: string;
  event_date: string;
  event_time: string;
  venue: string;
  city: string;
  image_url: string | null;
  scanner_token: string;
};

export const Route = createFileRoute("/scanner")({
  // Návratový typ má kľúče voliteľné — inak by TanStack vyžadoval `search`
  // pri každom <Link to="/scanner">.
  validateSearch: (s: Record<string, unknown>): { t?: string; e?: string } => ({
    t: typeof s.t === "string" ? s.t : undefined,
    e: typeof s.e === "string" ? s.e : undefined,
  }),
  component: ScannerPage,
  head: () => ({
    meta: [
      { title: "Čítačka QR vstupeniek — vipky.sk" },
      { name: "description", content: "Skenovanie a validácia QR vstupeniek na vstupe." },
    ],
  }),
});

function ScannerPage() {
  const search = useSearch({ from: "/scanner" });
  const initialToken = (search.t || search.e || "").trim();
  const [eventToken, setEventToken] = useState<string>(initialToken);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [loadingEvent, setLoadingEvent] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [scanning, setScanning] = useState(true);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [last, setLast] = useState<ScanResponse | null>(null);
  const [busy, setBusy] = useState(false);
  // Ktorá čítačka pri dverách toto je. Meno ide ku každému skenu, takže je
  // spätne vidieť, ktorý vchod vstupenku načítal.
  const [devices, setDevices] = useState<ScannerDeviceOption[]>([]);
  const [deviceId, setDeviceId] = useState<string>(() =>
    typeof window === "undefined" ? "" : localStorage.getItem("mt_scanner_device") || "",
  );
  const activeDevice = devices.find((d) => d.id === deviceId);
  const fetchDevices = useServerFn(listScannerDevicesForEvent);
  const [stats, setStats] = useState<{
    sold: number;
    used: number;
    remaining: number;
    recent: RecentScan[];
  }>({
    sold: 0,
    used: 0,
    remaining: 0,
    recent: [],
  });
  const lockRef = useRef<string>("");
  const lastTokenRef = useRef<string>("");

  // Load event by token
  useEffect(() => {
    if (!eventToken) {
      setEvent(null);
      return;
    }
    let cancelled = false;
    setLoadingEvent(true);
    (async () => {
      try {
        const r = await fetch(
          `/api/public/events/by-token?token=${encodeURIComponent(eventToken)}`,
        );
        if (!r.ok) throw new Error("not found");
        const j = await r.json();
        if (!cancelled) setEvent(j.event);
      } catch {
        if (!cancelled) setEvent(null);
      } finally {
        if (!cancelled) setLoadingEvent(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventToken]);

  // Čítačky organizátora pre toto podujatie. Autorizuje sa skenovacím kódom,
  // takže tablet pri dverách nepotrebuje prihlásenie.
  useEffect(() => {
    if (!eventToken) {
      setDevices([]);
      return;
    }
    let cancelled = false;
    fetchDevices({ data: { event_token: eventToken } })
      .then((list) => {
        if (cancelled) return;
        setDevices(list);
        // Keď uložená čítačka pre toto podujatie neplatí, výber sa zruší.
        setDeviceId((current) => (list.some((d) => d.id === current) ? current : ""));
      })
      .catch(() => {
        if (!cancelled) setDevices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [eventToken, fetchDevices]);

  // Výber čítačky si tablet pamätá — obsluha ho nastaví raz za večer.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (deviceId) localStorage.setItem("mt_scanner_device", deviceId);
    else localStorage.removeItem("mt_scanner_device");
  }, [deviceId]);

  // Live stats
  useEffect(() => {
    if (!eventToken || !event) return;
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(
          `/api/public/tickets/stats?event_token=${encodeURIComponent(eventToken)}`,
        );
        if (r.ok && !stop) setStats(await r.json());
      } catch {
        /* Štatistiky sa ťahajú každé 4 s — vypadnutý dotaz dobehne ten ďalší. */
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [eventToken, event]);

  // Offline replay
  useEffect(() => {
    const replay = async () => {
      if (!navigator.onLine) return;
      const stored: QueuedScan[] = JSON.parse(localStorage.getItem("mt_scan_queue") || "[]");
      if (!stored.length) return;
      const remaining: QueuedScan[] = [];
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

  async function submitScan(ticketToken: string, opts?: { allowReentry?: boolean }) {
    if (!eventToken || !event) return;
    lastTokenRef.current = ticketToken;
    if (busy) return;
    setBusy(true);
    const payload = {
      token: ticketToken,
      event_token: eventToken,
      event_id: event.id,
      device_id: deviceId || undefined,
      scanner_name: activeDevice?.name || "Vstupná čítačka",
      allow_reentry: opts?.allowReentry || false,
    };
    try {
      if (!navigator.onLine) {
        const q: QueuedScan[] = JSON.parse(localStorage.getItem("mt_scan_queue") || "[]");
        q.push(payload);
        localStorage.setItem("mt_scan_queue", JSON.stringify(q));
        setLast({
          ok: true,
          result: "valid",
          message: "Offline — bude synchronizované",
          ticket: { seat_label: "Offline" },
        });
      } else {
        const r = await fetch("/api/public/tickets/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j: ScanResponse = await r.json();
        setLast(j);
        if (navigator.vibrate)
          navigator.vibrate(j.result === "valid" || j.result === "reentry" ? 80 : [60, 40, 60]);
      }
    } catch {
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

    // If no event yet, try to interpret as event QR (URL with ?t= or raw token)
    if (!event) {
      const tok = extractEventToken(raw);
      if (tok) setEventToken(tok);
      return;
    }
    submitScan(raw);
  }

  // ----- Event picker view -----
  if (!event) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background via-background to-primary/5">
        <div className="max-w-3xl mx-auto px-4 pt-24 pb-16">
          <div className="flex items-center gap-3 mb-8">
            <div className="size-12 rounded-2xl bg-gradient-flame grid place-items-center shadow-glow">
              <TicketIcon className="size-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-3xl font-display font-bold">Čítačka QR vstupeniek</h1>
              <p className="text-sm text-muted-foreground">
                Naskenuj QR kód podujatia alebo zadaj jeho kód pre spustenie čítačky.
              </p>
            </div>
          </div>

          {loadingEvent && eventToken ? (
            <Card className="p-10 text-center">
              <Loader2 className="size-6 animate-spin mx-auto text-muted-foreground" />
              <p className="text-sm mt-3 text-muted-foreground">Načítavam podujatie…</p>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="overflow-hidden border-border/60">
                <div className="aspect-square bg-black relative">
                  <Scanner
                    onScan={handleDetected}
                    constraints={{ facingMode: "environment" }}
                    formats={["qr_code"]}
                    components={{ finder: true, torch: false }}
                    styles={{ container: { height: "100%", width: "100%" } }}
                  />
                </div>
                <div className="p-3 text-center text-xs text-muted-foreground border-t border-border/40">
                  Nasmeruj kameru na QR kód podujatia
                </div>
              </Card>
              <Card className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <QrCode className="size-5 text-primary" />
                  <h2 className="font-semibold">Zadaj kód podujatia</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Kód získaš od organizátora podujatia. Po zadaní sa otvorí čítačka pre dané
                  podujatie.
                </p>
                <Input
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="napr. K7f-9bX2..."
                  className="rounded-xl"
                />
                <Button
                  className="w-full rounded-xl"
                  onClick={() => tokenInput.trim() && setEventToken(tokenInput.trim())}
                  disabled={!tokenInput.trim()}
                >
                  Načítať podujatie
                </Button>
                {eventToken && !loadingEvent && (
                  <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 text-sm text-rose-500 flex items-start gap-2">
                    <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                    <span>
                      Kód <code className="font-mono">{eventToken}</code> nepatrí žiadnemu
                      podujatiu.
                    </span>
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
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
          : last?.result === "refunded"
            ? "bg-violet-500"
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
              <h1 className="text-2xl font-display font-bold">{event.title}</h1>
              <p className="text-xs text-muted-foreground">
                {new Date(event.event_date).toLocaleDateString("sk")} · {event.event_time} ·{" "}
                {event.venue}, {event.city}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {devices.length > 0 && (
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                className="h-9 rounded-xl border border-border/60 bg-card px-3 text-sm"
                title="Ktorá čítačka toto je"
              >
                <option value="">Bez zariadenia</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.location ? ` · ${d.location}` : ""}
                  </option>
                ))}
              </select>
            )}
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={() => {
                setEvent(null);
                setEventToken("");
                setTokenInput("");
                setLast(null);
              }}
            >
              Zmeniť podujatie
            </Button>
          </div>
        </div>

        <div className="grid md:grid-cols-[1.2fr_1fr] gap-6">
          <Card className="overflow-hidden border-border/60 bg-card">
            <div className="relative aspect-square sm:aspect-video bg-black">
              {scanning ? (
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
                    <p>Kamera vypnutá</p>
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
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => setScanning((v) => !v)}
                >
                  <Camera className="size-4 mr-1.5" /> {scanning ? "Stop" : "Štart"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
                >
                  <RefreshCcw className="size-4 mr-1.5" /> Kamera
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => setManualOpen((v) => !v)}
              >
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
                  <Card
                    className={cn(
                      "p-5 border-2",
                      last.result === "valid" && "border-emerald-500/50",
                      last.result === "reentry" && "border-sky-500/50",
                      last.result === "duplicate" && "border-amber-500/50",
                      last.result === "refunded" && "border-violet-500/60",
                      last.result === "invalid" && "border-rose-500/60",
                    )}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={cn(
                          "size-14 rounded-2xl grid place-items-center text-white shrink-0",
                          resColor,
                        )}
                      >
                        {last.result === "valid" || last.result === "reentry" ? (
                          <CheckCircle2 className="size-8" />
                        ) : last.result === "duplicate" ? (
                          <AlertTriangle className="size-8" />
                        ) : last.result === "refunded" ? (
                          <Ban className="size-8" />
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
                                  : last.result === "refunded"
                                    ? "Vstupenka bola refundovaná"
                                    : "Neplatná vstupenka"}
                          </h3>
                          {last.message && <Badge variant="outline">{last.message}</Badge>}
                        </div>
                        {last.ticket && (
                          <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-sm">
                            {last.ticket.seat_label && (
                              <>
                                <dt className="text-muted-foreground">Sedadlo</dt>
                                <dd className="font-medium">{last.ticket.seat_label}</dd>
                              </>
                            )}
                            {last.order?.customer_name && (
                              <>
                                <dt className="text-muted-foreground">Meno</dt>
                                <dd>{last.order.customer_name}</dd>
                              </>
                            )}
                            {last.order?.id && (
                              <>
                                <dt className="text-muted-foreground">Objednávka</dt>
                                <dd className="font-mono text-xs">
                                  {String(last.order.id).slice(0, 8).toUpperCase()}
                                </dd>
                              </>
                            )}
                            {last.event?.event_date && (
                              <>
                                <dt className="text-muted-foreground">Termín</dt>
                                <dd
                                  className={cn(
                                    "font-medium",
                                    last.event.event_date !== dnesLokalne() && "text-amber-500",
                                  )}
                                >
                                  {new Date(last.event.event_date).toLocaleDateString("sk")}
                                  {last.event.event_time ? ` · ${last.event.event_time}` : ""}
                                  {last.event.event_date !== dnesLokalne() && " — INÝ DEŇ!"}
                                </dd>
                              </>
                            )}
                            {last.ticket.last_scan_at && (
                              <>
                                <dt className="text-muted-foreground">Posl. sken</dt>
                                <dd>{new Date(last.ticket.last_scan_at).toLocaleString("sk")}</dd>
                              </>
                            )}
                            {typeof last.ticket.scan_count === "number" && (
                              <>
                                <dt className="text-muted-foreground">Skenov</dt>
                                <dd>{last.ticket.scan_count}</dd>
                              </>
                            )}
                          </dl>
                        )}
                        <div className="mt-4 flex gap-2 flex-wrap">
                          {last.result === "duplicate" && last.ticket?.id && (
                            <Button
                              size="sm"
                              className="rounded-xl"
                              onClick={() =>
                                submitScan(lastTokenRef.current, { allowReentry: true })
                              }
                            >
                              Povoliť opätovný vstup
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-xl"
                            onClick={() => setLast(null)}
                          >
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
                <h3 className="font-semibold text-sm">QR podujatia</h3>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {event.scanner_token.slice(0, 10)}…
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <div className="bg-white p-2 rounded-lg">
                  <QRCodeSVG
                    value={buildEventScannerUrl(event.scanner_token)}
                    size={96}
                    level="M"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Vytlač a daj obsluhe — naskenovaním tohto QR sa čítačka automaticky napojí na
                  podujatie.
                </p>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Posledné skeny</h3>
                <Badge variant="outline">{stats.recent.length}</Badge>
              </div>
              <ul className="space-y-2 max-h-[220px] overflow-auto pr-1 text-sm">
                {stats.recent.length === 0 && (
                  <li className="text-muted-foreground text-xs">Zatiaľ žiadne</li>
                )}
                {stats.recent.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 border-b border-border/40 last:border-0 pb-2"
                  >
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        s.result === "valid" && "bg-emerald-500",
                        s.result === "reentry" && "bg-sky-500",
                        s.result === "duplicate" && "bg-amber-500",
                        s.result === "refunded" && "bg-violet-500",
                        s.result === "invalid" && "bg-rose-500",
                      )}
                    />
                    <span className="flex-1 truncate">{s.scanner_name || "—"}</span>
                    <span className="text-muted-foreground text-xs">
                      {new Date(s.created_at).toLocaleTimeString("sk")}
                    </span>
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

/** Dnešok ako `YYYY-MM-DD` v miestnom čase — `toISOString()` by posunul deň. */
function dnesLokalne(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const den = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${den}`;
}

function buildEventScannerUrl(token: string) {
  if (typeof window === "undefined") return `/scanner?t=${token}`;
  return `${window.location.origin}/scanner?t=${token}`;
}

function extractEventToken(raw: string): string | null {
  // Accept full URL with ?t= or ?e=, or a bare token string
  try {
    const u = new URL(raw);
    const t = u.searchParams.get("t") || u.searchParams.get("e");
    if (t) return t.trim();
  } catch {
    // not a URL
  }
  // Bare token heuristic: no spaces, reasonable length, not a ticket token (which starts with MT2.)
  if (raw.startsWith("MT2.")) return null;
  if (/^[A-Za-z0-9_-]{16,64}$/.test(raw.trim())) return raw.trim();
  return null;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "primary" | "emerald" | "amber";
}) {
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
