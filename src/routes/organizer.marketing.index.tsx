import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useEvents, type EventRecord } from "@/hooks/use-events";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listAdAccounts,
  upsertAdAccount,
  deleteAdAccount,
  getPixelSettings as fetchPixelSettings,
  updatePixelSettings,
  listCampaigns,
  setCampaignStatus as setCampaignStatusFn,
  deleteCampaign as deleteCampaignFn,
} from "@/lib/marketing.functions";
import {
  simulateMetrics,
  type CampaignGoal,
  type Campaign,
  type PixelSettings,
} from "@/lib/marketing-db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Megaphone,
  Sparkles,
  RefreshCw,
  Plug,
  Unplug,
  TrendingUp,
  Target,
  MousePointerClick,
  Eye as EyeIcon,
  Euro,
  Receipt,
  BarChart3,
  Rocket,
  Calendar,
  MapPin,
  Pause,
  Play,
  Trash2,
  Wand2,
  Settings2,
  Facebook,
  ChromeIcon,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/marketing/")({
  head: () => ({ meta: [{ title: "Marketing Center · vipky.sk" }] }),
  component: MarketingCenter,
});

function MarketingCenter() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchAccounts = useServerFn(listAdAccounts);
  const saveAccount = useServerFn(upsertAdAccount);
  const removeAccount = useServerFn(deleteAdAccount);
  const fetchPixels = useServerFn(fetchPixelSettings);
  const savePixels = useServerFn(updatePixelSettings);
  const fetchCampaigns = useServerFn(listCampaigns);
  const changeStatus = useServerFn(setCampaignStatusFn);
  const removeCampaign = useServerFn(deleteCampaignFn);
  const refreshMarketing = () => qc.invalidateQueries({ queryKey: ["marketing"] });

  /**
   * Pripojenie reklamného účtu je zatiaľ evidencia — skutočné OAuth s Google
   * Ads ani Meta nemáme, takže sa len založí riadok s ukážkovým číslom účtu.
   */
  const connectAccount = async (platform: "google" | "meta") => {
    await saveAccount({
      data: {
        platform,
        account_id:
          platform === "google"
            ? `${Math.floor(100 + Math.random() * 899)}-${Math.floor(100 + Math.random() * 899)}-${Math.floor(1000 + Math.random() * 8999)}`
            : `act_${Math.floor(100000000 + Math.random() * 899999999)}`,
        account_name: platform === "google" ? "vipky.sk – Google Ads" : "vipky.sk – Meta Ads",
        status: "connected",
      },
    });
    refreshMarketing();
  };

  const disconnectAccount = async (id?: string) => {
    if (!id) return;
    await removeAccount({ data: { id } });
    refreshMarketing();
  };

  // Hooky musia bežať pri každom renderi, takže guard na neprihláseného
  // používateľa je až pod nimi (react-hooks/rules-of-hooks).
  const { data: events = [] } = useEvents({ scope: "mine" });

  // Kampane aj reklamné účty sú v databáze; server ich vracia sploštené,
  // tu ich prevedieme na tvar, s ktorým už táto stránka pracuje.
  const { data: campaignRows = [] } = useQuery({
    queryKey: ["marketing", "campaigns", user?.id ?? null],
    enabled: !!user,
    queryFn: () => fetchCampaigns({ data: {} }),
  });
  const { data: adAccounts = [] } = useQuery({
    queryKey: ["marketing", "accounts", user?.id ?? null],
    enabled: !!user,
    queryFn: () => fetchAccounts({ data: {} }),
  });
  const { data: pixelRow } = useQuery({
    queryKey: ["marketing", "pixels", user?.id ?? null],
    enabled: !!user,
    queryFn: () => fetchPixels({ data: {} }),
  });

  const campaigns = useMemo(
    () =>
      campaignRows.map((c) => ({
        ...c,
        organizer_name: c.organizer_name ?? undefined,
        goal: c.goal as CampaignGoal,
        event_id: c.event_id ?? "",
        event_title: c.event_title ?? "",
        audience: c.audience as never,
        creative: c.creative as never,
        metrics: {
          impressions: c.impressions,
          clicks: c.clicks,
          spend_eur: c.spend_eur,
          conversions: c.conversions,
          revenue_eur: c.revenue_eur,
          // Konverzia v ticketingu = predaná vstupenka.
          tickets_sold: c.conversions,
          // Odvodené ukazovatele sa nikde neukladajú — počítajú sa z čísel vyššie.
          ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
          cpc: c.clicks > 0 ? c.spend_eur / c.clicks : 0,
          roas: c.spend_eur > 0 ? c.revenue_eur / c.spend_eur : 0,
          updated_at: c.created_at,
        },
      })),
    [campaignRows],
  );

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

  if (!user) return <div className="p-6">{t("orgMktList.loginRequired")}</div>;

  // Stránka očakáva tvar z pôvodného localStorage modelu.
  const googleRow = adAccounts.find((a) => a.platform === "google" && a.status === "connected");
  const metaRow = adAccounts.find((a) => a.platform === "meta" && a.status === "connected");
  const google = googleRow
    ? {
        ...googleRow,
        customer_id: googleRow.account_id,
        account_name: googleRow.account_name ?? "",
        last_sync_at: googleRow.last_sync_at ?? googleRow.connected_at,
      }
    : undefined;
  const meta = metaRow
    ? {
        ...metaRow,
        ad_account_id: metaRow.account_id,
        business_account_id: metaRow.business_account_id ?? "",
        pixel_id: metaRow.pixel_id ?? "",
        page_name: metaRow.page_name ?? "",
        last_sync_at: metaRow.last_sync_at ?? metaRow.connected_at,
      }
    : undefined;
  const pixels = {
    organizer_id: user.id,
    updated_at: pixelRow?.updated_at ?? new Date().toISOString(),
    ga4_measurement_id: pixelRow?.ga4_measurement_id ?? "",
    gtm_id: pixelRow?.gtm_id ?? "",
    google_ads_conversion_id: pixelRow?.google_ads_conversion_id ?? "",
    google_ads_conversion_label: pixelRow?.google_ads_conversion_label ?? "",
    meta_pixel_id: pixelRow?.meta_pixel_id ?? "",
  };
  const auto = pixelRow?.auto_promote ?? false;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-display font-bold tracking-tight">Marketing Center</h1>
          </div>
          <p className="mt-1 text-muted-foreground">{t("orgMktList.subtitle")}</p>
        </div>
        <Button onClick={() => navigate({ to: "/organizer/marketing/new" })} className="gap-2">
          <Rocket className="h-4 w-4" /> {t("orgMktList.launchAd")}
        </Button>
      </header>

      {/* KPI */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI icon={Euro} label={t("orgMktList.kpiSpend")} value={`€${totals.spend.toFixed(2)}`} />
        <KPI icon={TrendingUp} label="ROAS" value={`${roas.toFixed(2)}×`} accent />
        <KPI
          icon={MousePointerClick}
          label={t("orgMktList.kpiClicks")}
          value={totals.clicks.toLocaleString()}
          sub={`CPC €${cpc.toFixed(2)}`}
        />
        <KPI
          icon={Receipt}
          label={t("orgMktList.kpiTickets")}
          value={totals.tickets.toString()}
          sub={`CTR ${ctr.toFixed(2)}%`}
        />
      </div>

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dashboard">{t("orgMktList.tabDashboard")}</TabsTrigger>
          <TabsTrigger value="campaigns">
            {t("orgMktList.tabCampaigns", { count: campaigns.length })}
          </TabsTrigger>
          <TabsTrigger value="google">Google Ads</TabsTrigger>
          <TabsTrigger value="meta">Meta Ads</TabsTrigger>
          <TabsTrigger value="pixels">{t("orgMktList.tabPixels")}</TabsTrigger>
          <TabsTrigger value="automation">{t("orgMktList.tabAutomation")}</TabsTrigger>
        </TabsList>

        {/* DASHBOARD */}
        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" /> {t("orgMktList.chartCampaignDev")}
              </h3>
              {campaigns.length === 0 ? (
                <Empty text={t("orgMktList.emptyCampaignsChart")} />
              ) : (
                <MiniBars
                  data={campaigns.map((c) => ({ label: c.name, value: c.metrics.revenue_eur }))}
                  suffix="€"
                />
              )}
            </Card>
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" /> {t("orgMktList.chartCostPerPurchase")}
              </h3>
              {campaigns.length === 0 ? (
                <Empty text={t("orgMktList.noData")} />
              ) : (
                <MiniBars
                  data={campaigns.map((c) => ({
                    label: c.name,
                    value:
                      c.metrics.tickets_sold > 0 ? c.metrics.spend_eur / c.metrics.tickets_sold : 0,
                  }))}
                  suffix="€"
                />
              )}
            </Card>
          </div>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" /> {t("orgMktList.yourEvents")}
              </h3>
              <Link to="/organizer/events" className="text-sm text-primary hover:underline">
                {t("orgMktList.manageEvents")}
              </Link>
            </div>
            {events.length === 0 ? (
              <Empty text={t("orgMktList.emptyEvents")} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {events.slice(0, 6).map((e) => (
                  <EventPromoCard
                    key={e.id}
                    event={e}
                    onPromote={(id) =>
                      navigate({ to: "/organizer/marketing/new", search: { eventId: id } as any })
                    }
                  />
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* CAMPAIGNS */}
        <TabsContent value="campaigns" className="space-y-3">
          {campaigns.length === 0 ? (
            <Card className="p-10 text-center">
              <Empty text={t("orgMktList.emptyCampaigns")} />
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
                <div className="rounded-lg bg-primary/10 p-3">
                  <ChromeIcon className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Google Ads</h3>
                  <p className="text-sm text-muted-foreground">{t("orgMktList.googleDesc")}</p>
                </div>
              </div>
              {google ? (
                <Badge className="gap-1 bg-emerald-500/15 text-emerald-600">
                  {t("orgMktList.connectedDot")}
                </Badge>
              ) : (
                <Badge variant="outline">{t("orgMktList.notConnected")}</Badge>
              )}
            </div>

            {google ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Info label="Customer ID" value={google.customer_id} />
                <Info label={t("orgMktList.infoAccount")} value={google.account_name} />
                <Info
                  label={t("orgMktList.infoCredit")}
                  value={`€${google.credit_eur.toFixed(2)}`}
                />
                <Info
                  label={t("orgMktList.infoLastSync")}
                  value={new Date(google.last_sync_at).toLocaleString("sk-SK")}
                />
                <Info
                  label={t("orgMktList.infoActiveCampaigns")}
                  value={campaigns
                    .filter((c) => c.platform === "google" && c.status === "active")
                    .length.toString()}
                />
                <Info
                  label={t("orgMktList.infoConnectedSince")}
                  value={new Date(google.connected_at).toLocaleDateString("sk-SK")}
                />
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2">
              {google ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      refreshMarketing();
                      toast.success(t("orgMktList.toastSynced"));
                    }}
                    className="gap-2"
                  >
                    <RefreshCw className="h-4 w-4" /> {t("orgMktList.sync")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void disconnectAccount(googleRow?.id);
                      toast(t("orgMktList.toastDisconnected"));
                    }}
                    className="gap-2"
                  >
                    <Unplug className="h-4 w-4" /> {t("orgMktList.disconnect")}
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => {
                    void connectAccount("google");
                    toast.success(t("orgMktList.toastGoogleConnected"));
                  }}
                  className="gap-2"
                >
                  <Plug className="h-4 w-4" /> {t("orgMktList.connectGoogle")}
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
                <div className="rounded-lg bg-primary/10 p-3">
                  <Facebook className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Meta Ads (Facebook / Instagram)</h3>
                  <p className="text-sm text-muted-foreground">{t("orgMktList.metaDesc")}</p>
                </div>
              </div>
              {meta ? (
                <Badge className="gap-1 bg-emerald-500/15 text-emerald-600">
                  {t("orgMktList.connectedDot")}
                </Badge>
              ) : (
                <Badge variant="outline">{t("orgMktList.notConnected")}</Badge>
              )}
            </div>

            {meta ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Info label="Business Account" value={meta.business_account_id} />
                <Info label="Ad Account" value={meta.ad_account_id} />
                <Info label="Pixel ID" value={meta.pixel_id} />
                <Info label={t("orgMktList.infoPage")} value={meta.page_name} />
                <Info label={t("orgMktList.infoCredit")} value={`€${meta.credit_eur.toFixed(2)}`} />
                <Info
                  label={t("orgMktList.infoLastSync")}
                  value={new Date(meta.last_sync_at).toLocaleString("sk-SK")}
                />
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2">
              {meta ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    void disconnectAccount(metaRow?.id);
                    toast(t("orgMktList.toastDisconnected"));
                  }}
                  className="gap-2"
                >
                  <Unplug className="h-4 w-4" /> {t("orgMktList.disconnect")}
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    void connectAccount("meta");
                    toast.success(t("orgMktList.toastMetaConnected"));
                  }}
                  className="gap-2"
                >
                  <Plug className="h-4 w-4" /> {t("orgMktList.connectMeta")}
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
                <h3 className="font-semibold flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-primary" /> {t("orgMktList.autoPromoteTitle")}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
                  {t("orgMktList.autoPromoteDesc")}
                </p>
              </div>
              <Switch
                checked={auto}
                onCheckedChange={(v) => {
                  void savePixels({ data: { auto_promote: v } }).then(refreshMarketing);
                  toast.success(v ? t("orgMktList.toastAutoOn") : t("orgMktList.toastAutoOff"));
                }}
              />
            </div>
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              {t("orgMktList.autoPromoteNote")}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KPI({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <Card
      className={`p-4 ${accent ? "bg-gradient-flame text-primary-foreground border-transparent" : ""}`}
    >
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

function MiniBars({
  data,
  suffix = "",
}: {
  data: { label: string; value: number }[];
  suffix?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i}>
          <div className="flex justify-between text-xs">
            <span className="truncate">{d.label}</span>
            <span className="font-mono">
              {d.value.toFixed(2)}
              {suffix}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-gradient-flame"
              style={{ width: `${(d.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EventPromoCard({
  event,
  onPromote,
}: {
  event: EventRecord;
  onPromote: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold leading-tight">{event.title}</h4>
        <Badge
          variant={event.status === "published" ? "default" : "outline"}
          className="shrink-0 text-[10px]"
        >
          {event.status === "published"
            ? t("orgMktList.statusPublished")
            : t("orgMktList.statusDraft")}
        </Badge>
      </div>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Calendar className="h-3 w-3" /> {event.event_date}
        </div>
        <div className="flex items-center gap-1">
          <MapPin className="h-3 w-3" /> {event.venue}, {event.city}
        </div>
      </div>
      <Button size="sm" className="mt-3 w-full gap-2" onClick={() => onPromote(event.id)}>
        <Rocket className="h-3.5 w-3.5" /> {t("orgMktList.launchAd")}
      </Button>
    </div>
  );
}

function CampaignRow({ c }: { c: Campaign }) {
  // Vlastné volania servera — komponent je mimo rozsahu hookov nad ním.
  const qc = useQueryClient();
  const changeStatus = useServerFn(setCampaignStatusFn);
  const removeCampaign = useServerFn(deleteCampaignFn);
  const refresh = () => qc.invalidateQueries({ queryKey: ["marketing"] });
  const { t } = useI18n();
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">
              {c.platform === "google" ? "Google Ads" : "Meta Ads"}
            </Badge>
            <Badge
              className={
                c.status === "active"
                  ? "bg-emerald-500/15 text-emerald-600"
                  : c.status === "paused"
                    ? "bg-amber-500/15 text-amber-600"
                    : c.status === "ended"
                      ? "bg-muted text-muted-foreground"
                      : "bg-blue-500/15 text-blue-600"
              }
            >
              {c.status}
            </Badge>
            {c.auto_generated && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Sparkles className="h-3 w-3" /> auto
              </Badge>
            )}
          </div>
          <h4 className="mt-1 font-semibold">{c.name}</h4>
          <div className="text-xs text-muted-foreground">
            {t("orgMktList.campaignMeta", {
              eventTitle: c.event_title,
              goal: c.goal,
              budget: c.budget_eur,
            })}
          </div>
        </div>
        <div className="flex gap-2">
          {c.status === "active" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void changeStatus({ data: { id: c.id, status: "paused" } }).then(refresh);
                toast(t("orgMktList.toastPaused"));
              }}
              className="gap-1"
            >
              <Pause className="h-3.5 w-3.5" /> {t("orgMktList.pause")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void changeStatus({ data: { id: c.id, status: "active" } }).then(refresh);
                toast.success(t("orgMktList.toastActivated"));
              }}
              className="gap-1"
            >
              <Play className="h-3.5 w-3.5" /> {t("orgMktList.start")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              // Výkonnostné čísla zatiaľ nikto nesťahuje z Google ani Meta —
              // tlačidlo preto len znovu načíta, čo je v databáze.
              refresh();
              toast.success(t("orgMktList.toastMetricsUpdated"));
            }}
            className="gap-1"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm(t("orgMktList.confirmDelete"))) {
                void removeCampaign({ data: { id: c.id } }).then(refresh);
                toast(t("orgMktList.toastDeleted"));
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Metric
          icon={EyeIcon}
          label={t("orgMktList.metricImp")}
          value={c.metrics.impressions.toLocaleString()}
        />
        <Metric
          icon={MousePointerClick}
          label={t("orgMktList.metricClicks")}
          value={c.metrics.clicks.toLocaleString()}
        />
        <Metric label="CPC" value={`€${c.metrics.cpc.toFixed(2)}`} />
        <Metric label="CTR" value={`${c.metrics.ctr.toFixed(2)}%`} />
        <Metric label={t("orgMktList.metricConv")} value={c.metrics.conversions.toString()} />
        <Metric
          icon={Receipt}
          label={t("orgMktList.metricTickets")}
          value={c.metrics.tickets_sold.toString()}
        />
        <Metric icon={TrendingUp} label="ROAS" value={`${c.metrics.roas.toFixed(2)}×`} accent />
      </div>
    </Card>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon?: any;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-2 ${accent ? "bg-primary/10 border-primary/30" : "bg-muted/30"}`}
    >
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function PixelForm({ initial, organizerId }: { initial: PixelSettings; organizerId: string }) {
  const qc = useQueryClient();
  const savePixels = useServerFn(updatePixelSettings);
  void organizerId; // meracie kódy sa ukladajú prihlásenému organizátorovi
  const { t } = useI18n();
  const [s, setS] = useState<PixelSettings>(initial);
  const upd = <K extends keyof PixelSettings>(k: K, v: PixelSettings[K]) =>
    setS((p) => ({ ...p, [k]: v }));
  return (
    <Card className="p-6 space-y-5">
      <div>
        <h3 className="font-semibold flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary" /> {t("orgMktList.pixelTitle")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("orgMktList.pixelDesc")}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="GA4 Measurement ID"
          placeholder="G-XXXXXXXXXX"
          value={s.ga4_measurement_id}
          onChange={(v) => upd("ga4_measurement_id", v)}
        />
        <Field
          label="Google Tag Manager ID"
          placeholder="GTM-XXXXXXX"
          value={s.gtm_id}
          onChange={(v) => upd("gtm_id", v)}
        />
        <Field
          label="Google Ads Conversion ID"
          placeholder="AW-123456789"
          value={s.google_ads_conversion_id}
          onChange={(v) => upd("google_ads_conversion_id", v)}
        />
        <Field
          label="Google Ads Conversion Label"
          placeholder="abc123XYZ"
          value={s.google_ads_conversion_label}
          onChange={(v) => upd("google_ads_conversion_label", v)}
        />
        <Field
          label="Meta Pixel ID"
          placeholder="1234567890"
          value={s.meta_pixel_id}
          onChange={(v) => upd("meta_pixel_id", v)}
        />
      </div>
      <Button
        onClick={() => {
          void savePixels({
            data: {
              ga4_measurement_id: s.ga4_measurement_id,
              gtm_id: s.gtm_id,
              google_ads_conversion_id: s.google_ads_conversion_id,
              google_ads_conversion_label: s.google_ads_conversion_label,
              meta_pixel_id: s.meta_pixel_id,
            },
          }).then(() => qc.invalidateQueries({ queryKey: ["marketing"] }));
          toast.success(t("orgMktList.toastSaved"));
        }}
        className="gap-2"
      >
        {t("orgMktList.saveSettings")}
      </Button>
    </Card>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
