import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getEvents, type EventItem } from "@/lib/local-db";
import {
  getGoogleAccountFor, connectGoogleAds, disconnectGoogleAds, syncGoogleAds,
  getMetaAccountFor, connectMetaAds, disconnectMetaAds,
  getPixelSettings, savePixelSettings,
  getCampaignsFor, setCampaignStatus, deleteCampaign,
  getAutoPromote, setAutoPromote,
  MARKETING_EVENT, simulateMetrics, saveCampaign,
  type Campaign, type PixelSettings,
} from "@/lib/marketing-db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Megaphone, Sparkles, RefreshCw, Plug, Unplug, TrendingUp, Target,
  MousePointerClick, Eye as EyeIcon, Euro, Receipt, BarChart3, Rocket,
  Calendar, MapPin, Pause, Play, Trash2, Wand2, Settings2, Facebook, ChromeIcon,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/marketing")({
  head: () => ({ meta: [{ title: "Marketing Center · MAXITICKET" }] }),
  component: MarketingCenter,
});

function MarketingCenter() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener(MARKETING_EVENT, h);
    return () => window.removeEventListener(MARKETING_EVENT, h);
  }, []);

  if (!user) return <div className="p-6">Vyžaduje prihlásenie.</div>;

  const events = useMemo(
    () => getEvents().filter((e) => e.organizer_id === user.id || user.role === "admin"),
    [user, tick],
  );
  const google = getGoogleAccountFor(user.id);
  const meta = getMetaAccountFor(user.id);
  const campaigns = getCampaignsFor(user.id);
  const pixels = getPixelSettings(user.id);
  const auto = getAutoPromote(user.id);

  const totals = useMemo(() => {
    return campaigns.reduce(
      (acc, c) => {
        acc.spend += c.metrics.spend_eur;
        acc.revenue += c.metrics.revenue_eur;
        acc.clicks += c.metrics.clicks;
        acc.impressions += c.metrics.impressions;
        acc.conversions += c.metrics.conversions;
        acc.tickets += c.metrics.tickets_sold;
        return acc;
      },
      { spend: 0, revenue: 0, clicks: 0, impressions: 0, conversions: 0, tickets: 0 },
    );
  }, [campaigns]);
  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-display font-bold tracking-tight">Marketing Center</h1>
          </div>
          <p className="mt-1 text-muted-foreground">
            Spusti reklamu na podujatia priamo z MAXITICKET. Google Ads, Meta Ads, pixel tracking a AI texty.
          </p>
        </div>
        <Button onClick={() => navigate({ to: "/organizer/marketing/new" })} className="gap-2">
          <Rocket className="h-4 w-4" /> Spustiť reklamu
        </Button>
      </header>

      {/* KPI */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI icon={Euro} label="Rozpočet (spend)" value={`€${totals.spend.toFixed(2)}`} />
        <KPI icon={TrendingUp} label="ROAS" value={`${roas.toFixed(2)}×`} accent />
        <KPI icon={MousePointerClick} label="Kliknutia" value={totals.clicks.toLocaleString()} sub={`CPC €${cpc.toFixed(2)}`} />
        <KPI icon={Receipt} label="Predané vstupenky" value={totals.tickets.toString()} sub={`CTR ${ctr.toFixed(2)}%`} />
      </div>

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dashboard">Prehľad</TabsTrigger>
          <TabsTrigger value="campaigns">Kampane ({campaigns.length})</TabsTrigger>
          <TabsTrigger value="google">Google Ads</TabsTrigger>
          <TabsTrigger value="meta">Meta Ads</TabsTrigger>
          <TabsTrigger value="pixels">Pixely a tracking</TabsTrigger>
          <TabsTrigger value="automation">Automatizácia</TabsTrigger>
        </TabsList>

        {/* DASHBOARD */}
        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" /> Vývoj kampaní
              </h3>
              {campaigns.length === 0 ? (
                <Empty text="Zatiaľ žiadne kampane. Spusti svoju prvú reklamu." />
              ) : (
                <MiniBars data={campaigns.map((c) => ({ label: c.name, value: c.metrics.revenue_eur }))} suffix="€" />
              )}
            </Card>
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" /> Cena za nákup
              </h3>
              {campaigns.length === 0 ? (
                <Empty text="Žiadne dáta." />
              ) : (
                <MiniBars
                  data={campaigns.map((c) => ({
                    label: c.name,
                    value: c.metrics.tickets_sold > 0 ? c.metrics.spend_eur / c.metrics.tickets_sold : 0,
                  }))}
                  suffix="€"
                />
              )}
            </Card>
          </div>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" /> Tvoje podujatia
              </h3>
              <Link to="/organizer/events" className="text-sm text-primary hover:underline">Spravovať podujatia</Link>
            </div>
            {events.length === 0 ? (
              <Empty text="Najprv vytvor podujatie, potom ho môžeš propagovať." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {events.slice(0, 6).map((e) => (
                  <EventPromoCard key={e.id} event={e} onPromote={(id) => navigate({ to: "/organizer/marketing/new", search: { eventId: id } as any })} />
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* CAMPAIGNS */}
        <TabsContent value="campaigns" className="space-y-3">
          {campaigns.length === 0 ? (
            <Card className="p-10 text-center">
              <Empty text="Žiadne kampane. Klikni na „Spustiť reklamu“." />
            </Card>
          ) : (
            campaigns.map((c) => <CampaignRow key={c.id} c={c} />)
          )}
        </TabsContent>

        {/* GOOGLE ADS */}
        <TabsContent value="google" className="space-y-4">
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-3"><ChromeIcon className="h-6 w-6 text-primary" /></div>
                <div>
                  <h3 className="text-lg font-semibold">Google Ads</h3>
                  <p className="text-sm text-muted-foreground">Pripoj Google Ads účet a spúšťaj kampane priamo z MaxiTicket.</p>
                </div>
              </div>
              {google ? (
                <Badge className="gap-1 bg-emerald-500/15 text-emerald-600">● Pripojené</Badge>
              ) : (
                <Badge variant="outline">Nepripojené</Badge>
              )}
            </div>

            {google ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Info label="Customer ID" value={google.customer_id} />
                <Info label="Účet" value={google.account_name} />
                <Info label="Kredit" value={`€${google.credit_eur.toFixed(2)}`} />
                <Info label="Posledná synchronizácia" value={new Date(google.last_sync_at).toLocaleString("sk-SK")} />
                <Info label="Aktívne kampane" value={campaigns.filter((c) => c.platform === "google" && c.status === "active").length.toString()} />
                <Info label="Pripojené od" value={new Date(google.connected_at).toLocaleDateString("sk-SK")} />
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2">
              {google ? (
                <>
                  <Button variant="outline" onClick={() => { syncGoogleAds(user.id); toast.success("Synchronizované"); }} className="gap-2">
                    <RefreshCw className="h-4 w-4" /> Synchronizovať
                  </Button>
                  <Button variant="outline" onClick={() => { disconnectGoogleAds(user.id); toast("Odpojené"); }} className="gap-2">
                    <Unplug className="h-4 w-4" /> Odpojiť
                  </Button>
                </>
              ) : (
                <Button onClick={() => { connectGoogleAds(user.id); toast.success("Google Ads pripojené (mock OAuth)"); }} className="gap-2">
                  <Plug className="h-4 w-4" /> Pripojiť Google Ads účet
                </Button>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* META ADS */}
        <TabsContent value="meta" className="space-y-4">
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-3"><Facebook className="h-6 w-6 text-primary" /></div>
                <div>
                  <h3 className="text-lg font-semibold">Meta Ads (Facebook / Instagram)</h3>
                  <p className="text-sm text-muted-foreground">Propaguj podujatia na Facebooku a Instagrame.</p>
                </div>
              </div>
              {meta ? (
                <Badge className="gap-1 bg-emerald-500/15 text-emerald-600">● Pripojené</Badge>
              ) : (
                <Badge variant="outline">Nepripojené</Badge>
              )}
            </div>

            {meta ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Info label="Business Account" value={meta.business_account_id} />
                <Info label="Ad Account" value={meta.ad_account_id} />
                <Info label="Pixel ID" value={meta.pixel_id} />
                <Info label="Stránka" value={meta.page_name} />
                <Info label="Kredit" value={`€${meta.credit_eur.toFixed(2)}`} />
                <Info label="Posledná synchronizácia" value={new Date(meta.last_sync_at).toLocaleString("sk-SK")} />
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2">
              {meta ? (
                <Button variant="outline" onClick={() => { disconnectMetaAds(user.id); toast("Odpojené"); }} className="gap-2">
                  <Unplug className="h-4 w-4" /> Odpojiť
                </Button>
              ) : (
                <Button onClick={() => { connectMetaAds(user.id); toast.success("Meta Ads pripojené (mock OAuth)"); }} className="gap-2">
                  <Plug className="h-4 w-4" /> Pripojiť Facebook / Instagram
                </Button>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* PIXELS */}
        <TabsContent value="pixels">
          <PixelForm initial={pixels} organizerId={user.id} />
        </TabsContent>

        {/* AUTOMATION */}
        <TabsContent value="automation">
          <Card className="p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold flex items-center gap-2"><Wand2 className="h-4 w-4 text-primary" /> Automaticky propagovať podujatie</h3>
                <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
                  Po publikovaní podujatia ti MaxiTicket automaticky pripraví návrh kampane (Google + Meta),
                  vygeneruje reklamné texty a kreatívy. Stačí ich potvrdiť a spustiť.
                </p>
              </div>
              <Switch checked={auto} onCheckedChange={(v) => { setAutoPromote(user.id, v); toast.success(v ? "Auto-propagácia zapnutá" : "Auto-propagácia vypnutá"); }} />
            </div>
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Pri spustení: rozpočet €20 / podujatie, cieľ „Predaj vstupeniek“, lokalita SK,
              kreatíva generovaná z názvu, miesta a kategórie podujatia.
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KPI({ icon: Icon, label, value, sub, accent }: { icon: any; label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className={`p-4 ${accent ? "bg-gradient-flame text-primary-foreground border-transparent" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider opacity-80">{label}</div>
        <Icon className="h-4 w-4 opacity-70" />
      </div>
      <div className="mt-2 text-2xl font-display font-bold">{value}</div>
      {sub && <div className="text-xs opacity-70 mt-1">{sub}</div>}
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm">{value}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function MiniBars({ data, suffix = "" }: { data: { label: string; value: number }[]; suffix?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i}>
          <div className="flex justify-between text-xs">
            <span className="truncate">{d.label}</span>
            <span className="font-mono">{d.value.toFixed(2)}{suffix}</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-gradient-flame" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EventPromoCard({ event, onPromote }: { event: EventItem; onPromote: (id: string) => void }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold leading-tight">{event.title}</h4>
        <Badge variant={event.status === "published" ? "default" : "outline"} className="shrink-0 text-[10px]">
          {event.status === "published" ? "Publikované" : "Koncept"}
        </Badge>
      </div>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {event.event_date}</div>
        <div className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {event.venue}, {event.city}</div>
      </div>
      <Button size="sm" className="mt-3 w-full gap-2" onClick={() => onPromote(event.id)}>
        <Rocket className="h-3.5 w-3.5" /> Spustiť reklamu
      </Button>
    </div>
  );
}

function CampaignRow({ c }: { c: Campaign }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">{c.platform === "google" ? "Google Ads" : "Meta Ads"}</Badge>
            <Badge className={
              c.status === "active" ? "bg-emerald-500/15 text-emerald-600"
              : c.status === "paused" ? "bg-amber-500/15 text-amber-600"
              : c.status === "ended" ? "bg-muted text-muted-foreground"
              : "bg-blue-500/15 text-blue-600"
            }>
              {c.status}
            </Badge>
            {c.auto_generated && <Badge variant="outline" className="gap-1 text-[10px]"><Sparkles className="h-3 w-3" /> auto</Badge>}
          </div>
          <h4 className="mt-1 font-semibold">{c.name}</h4>
          <div className="text-xs text-muted-foreground">{c.event_title} · cieľ: {c.goal} · rozpočet €{c.budget_eur}</div>
        </div>
        <div className="flex gap-2">
          {c.status === "active" ? (
            <Button size="sm" variant="outline" onClick={() => { setCampaignStatus(c.id, "paused"); toast("Pozastavené"); }} className="gap-1">
              <Pause className="h-3.5 w-3.5" /> Pauza
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => { setCampaignStatus(c.id, "active"); toast.success("Aktivované"); }} className="gap-1">
              <Play className="h-3.5 w-3.5" /> Spustiť
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => {
            const next = { ...c, metrics: simulateMetrics(c.budget_eur) };
            saveCampaign(next);
            toast.success("Metriky aktualizované");
          }} className="gap-1">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { if (confirm("Zmazať kampaň?")) { deleteCampaign(c.id); toast("Zmazané"); } }}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Metric icon={EyeIcon} label="Imp." value={c.metrics.impressions.toLocaleString()} />
        <Metric icon={MousePointerClick} label="Kliky" value={c.metrics.clicks.toLocaleString()} />
        <Metric label="CPC" value={`€${c.metrics.cpc.toFixed(2)}`} />
        <Metric label="CTR" value={`${c.metrics.ctr.toFixed(2)}%`} />
        <Metric label="Konv." value={c.metrics.conversions.toString()} />
        <Metric icon={Receipt} label="Vstupenky" value={c.metrics.tickets_sold.toString()} />
        <Metric icon={TrendingUp} label="ROAS" value={`${c.metrics.roas.toFixed(2)}×`} accent />
      </div>
    </Card>
  );
}

function Metric({ icon: Icon, label, value, accent }: { icon?: any; label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-md border p-2 ${accent ? "bg-primary/10 border-primary/30" : "bg-muted/30"}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function PixelForm({ initial, organizerId }: { initial: PixelSettings; organizerId: string }) {
  const [s, setS] = useState<PixelSettings>(initial);
  const upd = <K extends keyof PixelSettings>(k: K, v: PixelSettings[K]) => setS((p) => ({ ...p, [k]: v }));
  return (
    <Card className="p-6 space-y-5">
      <div>
        <h3 className="font-semibold flex items-center gap-2"><Settings2 className="h-4 w-4 text-primary" /> Pixel tracking a analytika</h3>
        <p className="mt-1 text-sm text-muted-foreground">Nastav GA4, GTM, Google Ads konverzie a Meta Pixel. Použité v predajnom flow.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="GA4 Measurement ID" placeholder="G-XXXXXXXXXX" value={s.ga4_measurement_id} onChange={(v) => upd("ga4_measurement_id", v)} />
        <Field label="Google Tag Manager ID" placeholder="GTM-XXXXXXX" value={s.gtm_id} onChange={(v) => upd("gtm_id", v)} />
        <Field label="Google Ads Conversion ID" placeholder="AW-123456789" value={s.google_ads_conversion_id} onChange={(v) => upd("google_ads_conversion_id", v)} />
        <Field label="Google Ads Conversion Label" placeholder="abc123XYZ" value={s.google_ads_conversion_label} onChange={(v) => upd("google_ads_conversion_label", v)} />
        <Field label="Meta Pixel ID" placeholder="1234567890" value={s.meta_pixel_id} onChange={(v) => upd("meta_pixel_id", v)} />
      </div>
      <Button onClick={() => { savePixelSettings({ ...s, organizer_id: organizerId, updated_at: new Date().toISOString() }); toast.success("Uložené"); }} className="gap-2">
        Uložiť nastavenia
      </Button>
    </Card>
  );
}

function Field({ label, placeholder, value, onChange }: { label: string; placeholder?: string; value?: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input placeholder={placeholder} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
