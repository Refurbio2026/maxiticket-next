import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { useEvents } from "@/hooks/use-events";
import {
  saveCampaign,
  simulateMetrics,
  generateCreative,
  defaultAudience,
  getGoogleAccountFor,
  getMetaAccountFor,
  type Campaign,
  type CampaignGoal,
  type Platform,
} from "@/lib/marketing-db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sparkles,
  ArrowLeft,
  ArrowRight,
  Rocket,
  Wand2,
  Target,
  Users,
  Eye,
  Calendar,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";

const wizardSearch = z.object({ eventId: z.string().optional() });

export const Route = createFileRoute("/organizer/marketing/new")({
  validateSearch: wizardSearch,
  head: () => ({ meta: [{ title: "Spustiť reklamu · vipky.sk" }] }),
  component: WizardPage,
});

const GOALS: { id: CampaignGoal; labelKey: string; descKey: string }[] = [
  { id: "sales", labelKey: "orgMktNew.goalSalesLabel", descKey: "orgMktNew.goalSalesDesc" },
  { id: "traffic", labelKey: "orgMktNew.goalTrafficLabel", descKey: "orgMktNew.goalTrafficDesc" },
  {
    id: "remarketing",
    labelKey: "orgMktNew.goalRemarketingLabel",
    descKey: "orgMktNew.goalRemarketingDesc",
  },
  {
    id: "awareness",
    labelKey: "orgMktNew.goalAwarenessLabel",
    descKey: "orgMktNew.goalAwarenessDesc",
  },
];

const BUDGETS = [10, 20, 50, 100];

function WizardPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  // Hooky musia bežať pri každom renderi, takže guard na neprihláseného
  // používateľa je až pod nimi (react-hooks/rules-of-hooks).
  const { data: events = [] } = useEvents({ scope: "mine" });

  const [step, setStep] = useState(1);
  const [platform, setPlatform] = useState<Platform>("google");
  const [eventId, setEventId] = useState<string>(search.eventId ?? events[0]?.id ?? "");
  const [budget, setBudget] = useState<number>(20);
  const [goal, setGoal] = useState<CampaignGoal>("sales");
  const [audience, setAudience] = useState(defaultAudience());
  const [creative, setCreative] = useState(() =>
    events[0]
      ? generateCreative(events[0])
      : { headlines: [], descriptions: [], cta: "Kúpiť vstupenku" },
  );

  const event = events.find((e) => e.id === eventId);

  if (!user) return <div className="p-6">{t("orgMktNew.loginRequired")}</div>;

  const google = getGoogleAccountFor(user.id);
  const meta = getMetaAccountFor(user.id);

  const regenerate = () => {
    if (!event) return;
    setCreative(generateCreative(event));
    toast.success(t("orgMktNew.toastCreativeGenerated"));
  };

  const launch = () => {
    if (!event) return toast.error(t("orgMktNew.toastSelectEvent"));
    const platformConnected = platform === "google" ? !!google : !!meta;
    if (!platformConnected) {
      toast.error(
        t("orgMktNew.toastAccountNotConnected", {
          platform: platform === "google" ? "Google Ads" : "Meta Ads",
        }),
      );
      return;
    }
    const c: Campaign = {
      id: crypto.randomUUID(),
      organizer_id: user.id,
      organizer_name: user.full_name ?? user.email,
      event_id: event.id,
      event_title: event.title,
      platform,
      name: `${event.title} · ${platform === "google" ? "Google" : "Meta"}`,
      goal,
      budget_eur: budget,
      status: "active",
      audience,
      creative,
      metrics: simulateMetrics(budget),
      created_at: new Date().toISOString(),
    };
    saveCampaign(c);
    toast.success(t("orgMktNew.toastCampaignLaunched"));
    navigate({ to: "/organizer/marketing" });
  };

  if (events.length === 0) {
    return (
      <div className="p-6">
        <Card className="p-8 text-center space-y-4">
          <h2 className="text-xl font-display font-bold">{t("orgMktNew.noEventsTitle")}</h2>
          <p className="text-muted-foreground">{t("orgMktNew.noEventsDesc")}</p>
          <Button onClick={() => navigate({ to: "/organizer/events/new" })}>
            {t("orgMktNew.addEvent")}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-4xl mx-auto">
      <header className="flex items-center justify-between">
        <div>
          <Link
            to="/organizer/marketing"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t("orgMktNew.backToCenter")}
          </Link>
          <h1 className="text-2xl font-display font-bold mt-1 flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" /> {t("orgMktNew.title")}
          </h1>
        </div>
        <Badge variant="outline">{t("orgMktNew.step", { step })}</Badge>
      </header>

      <Stepper step={step} />

      <Card className="p-6">
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" /> {t("orgMktNew.step1Title")}
            </h3>
            <div className="space-y-2">
              <Label>{t("orgMktNew.labelEvent")}</Label>
              <Select
                value={eventId}
                onValueChange={(v) => {
                  setEventId(v);
                  const ev = events.find((e) => e.id === v);
                  if (ev) setCreative(generateCreative(ev));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {events.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.title} – {e.event_date}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {event && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{event.title}</div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> {event.event_date}
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {event.venue}, {event.city}
                  </span>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("orgMktNew.labelPlatform")}</Label>
              <div className="grid grid-cols-2 gap-2">
                <PlatformBtn
                  active={platform === "google"}
                  onClick={() => setPlatform("google")}
                  title="Google Ads"
                  sub={google ? t("orgMktNew.connected") : t("orgMktNew.notConnected")}
                />
                <PlatformBtn
                  active={platform === "meta"}
                  onClick={() => setPlatform("meta")}
                  title="Meta Ads"
                  sub={meta ? t("orgMktNew.connected") : t("orgMktNew.notConnected")}
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h3 className="font-semibold">{t("orgMktNew.step2Title")}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {BUDGETS.map((b) => (
                <button
                  key={b}
                  onClick={() => setBudget(b)}
                  className={`rounded-lg border p-4 text-center transition ${budget === b ? "border-primary bg-primary/10" : "hover:bg-muted/50"}`}
                >
                  <div className="font-display text-2xl font-bold">€{b}</div>
                  <div className="text-xs text-muted-foreground">{t("orgMktNew.daily")}</div>
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("orgMktNew.customBudget")}</Label>
              <Input
                type="number"
                min={1}
                value={budget}
                onChange={(e) => setBudget(Math.max(1, +e.target.value || 1))}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" /> {t("orgMktNew.step3Title")}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {GOALS.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGoal(g.id)}
                  className={`rounded-lg border p-3 text-left transition ${goal === g.id ? "border-primary bg-primary/10" : "hover:bg-muted/50"}`}
                >
                  <div className="font-medium">{t(g.labelKey)}</div>
                  <div className="text-xs text-muted-foreground">{t(g.descKey)}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> {t("orgMktNew.step4Title")}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("orgMktNew.labelCountry")}</Label>
                <Select
                  value={audience.country}
                  onValueChange={(v) => setAudience({ ...audience, country: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SK">{t("orgMktNew.countrySK")}</SelectItem>
                    <SelectItem value="CZ">{t("orgMktNew.countryCZ")}</SelectItem>
                    <SelectItem value="AT">{t("orgMktNew.countryAT")}</SelectItem>
                    <SelectItem value="HU">{t("orgMktNew.countryHU")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("orgMktNew.labelCities")}</Label>
                <Input
                  placeholder="Bratislava, Košice"
                  value={audience.cities.join(", ")}
                  onChange={(e) =>
                    setAudience({
                      ...audience,
                      cities: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("orgMktNew.ageFrom")}</Label>
                <Input
                  type="number"
                  value={audience.age_min}
                  onChange={(e) => setAudience({ ...audience, age_min: +e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("orgMktNew.ageTo")}</Label>
                <Input
                  type="number"
                  value={audience.age_max}
                  onChange={(e) => setAudience({ ...audience, age_max: +e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("orgMktNew.labelGender")}</Label>
                <Select
                  value={audience.gender}
                  onValueChange={(v: any) => setAudience({ ...audience, gender: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("orgMktNew.genderAll")}</SelectItem>
                    <SelectItem value="male">{t("orgMktNew.genderMale")}</SelectItem>
                    <SelectItem value="female">{t("orgMktNew.genderFemale")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("orgMktNew.labelInterests")}</Label>
                <Input
                  value={audience.interests.join(", ")}
                  onChange={(e) =>
                    setAudience({
                      ...audience,
                      interests: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" /> {t("orgMktNew.step5Title")}
              </h3>
              <Button size="sm" variant="outline" onClick={regenerate} className="gap-2">
                <Wand2 className="h-3.5 w-3.5" /> {t("orgMktNew.generateCreative")}
              </Button>
            </div>

            {event && (
              <div className="rounded-xl border bg-card p-4">
                <div className="flex gap-3">
                  {event.image_url ? (
                    <img
                      src={event.image_url}
                      alt={event.title}
                      className="h-24 w-24 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="h-24 w-24 rounded-lg bg-gradient-flame flex items-center justify-center">
                      <Sparkles className="h-6 w-6 text-primary-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t("orgMktNew.sponsored")}
                    </div>
                    <div className="font-semibold leading-tight">{creative.headlines[0]}</div>
                    <div className="text-sm text-muted-foreground line-clamp-2">
                      {creative.descriptions[0]}
                    </div>
                    <Button size="sm" className="mt-2">
                      {creative.cta}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {t("orgMktNew.headlines", { count: creative.headlines.length })}
                </Label>
                <Textarea
                  rows={8}
                  value={creative.headlines.join("\n")}
                  onChange={(e) =>
                    setCreative({ ...creative, headlines: e.target.value.split("\n") })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {t("orgMktNew.descriptions", { count: creative.descriptions.length })}
                </Label>
                <Textarea
                  rows={8}
                  value={creative.descriptions.join("\n")}
                  onChange={(e) =>
                    setCreative({ ...creative, descriptions: e.target.value.split("\n") })
                  }
                />
                <Label className="text-xs">CTA</Label>
                <Input
                  value={creative.cta}
                  onChange={(e) => setCreative({ ...creative, cta: e.target.value })}
                />
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-between gap-2 border-t pt-4">
          <Button
            variant="outline"
            disabled={step === 1}
            onClick={() => setStep(step - 1)}
            className="gap-1"
          >
            <ArrowLeft className="h-4 w-4" /> {t("orgMktNew.back")}
          </Button>
          {step < 5 ? (
            <Button onClick={() => setStep(step + 1)} className="gap-1">
              {t("orgMktNew.next")} <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={launch} className="gap-2">
              <Rocket className="h-4 w-4" /> {t("orgMktNew.launchCampaign", { budget })}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function PlatformBtn({
  active,
  onClick,
  title,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition ${active ? "border-primary bg-primary/10" : "hover:bg-muted/50"}`}
    >
      <div className="font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </button>
  );
}

function Stepper({ step }: { step: number }) {
  const { t } = useI18n();
  const labels = [
    "orgMktNew.stepEvent",
    "orgMktNew.stepBudget",
    "orgMktNew.stepGoal",
    "orgMktNew.stepAudience",
    "orgMktNew.stepPreview",
  ];
  return (
    <div className="flex items-center gap-2">
      {labels.map((l, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <div key={l} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold
              ${active ? "bg-primary text-primary-foreground" : done ? "bg-emerald-500/20 text-emerald-600" : "bg-muted text-muted-foreground"}`}
            >
              {n}
            </div>
            <span className={`text-xs ${active ? "font-medium" : "text-muted-foreground"}`}>
              {t(l)}
            </span>
            {n < labels.length && (
              <div className={`h-px flex-1 ${done ? "bg-emerald-500/40" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
