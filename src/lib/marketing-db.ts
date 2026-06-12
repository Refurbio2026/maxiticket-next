// Marketing module local "database" (mock).
// Architektúra je pripravená na neskoré napojenie na Google Ads API, Meta Marketing API, GA4 a GTM.

export type Platform = "google" | "meta";
export type CampaignGoal = "sales" | "traffic" | "remarketing" | "awareness";
export type CampaignStatus = "draft" | "active" | "paused" | "ended";

export type GoogleAdsAccount = {
  id: string;
  organizer_id: string;
  customer_id: string;          // 123-456-7890
  account_name: string;
  status: "connected" | "disconnected";
  credit_eur: number;
  last_sync_at: string;
  connected_at: string;
};

export type MetaAdsAccount = {
  id: string;
  organizer_id: string;
  business_account_id: string;
  ad_account_id: string;
  pixel_id: string;
  page_name: string;
  status: "connected" | "disconnected";
  credit_eur: number;
  last_sync_at: string;
  connected_at: string;
};

export type PixelSettings = {
  organizer_id: string;
  ga4_measurement_id?: string;
  gtm_id?: string;
  google_ads_conversion_id?: string;
  google_ads_conversion_label?: string;
  meta_pixel_id?: string;
  updated_at: string;
};

export type CampaignAudience = {
  country: string;          // SK
  cities: string[];
  age_min: number;
  age_max: number;
  gender: "all" | "male" | "female";
  interests: string[];
};

export type CampaignCreative = {
  headlines: string[];      // až 15 (Google)
  descriptions: string[];   // až 4 (Google)
  cta: string;
  image_url?: string;
};

export type CampaignMetrics = {
  impressions: number;
  clicks: number;
  cpc: number;              // €
  ctr: number;              // %
  conversions: number;
  tickets_sold: number;
  revenue_eur: number;
  spend_eur: number;
  roas: number;             // revenue / spend
  updated_at: string;
};

export type Campaign = {
  id: string;
  organizer_id: string;
  organizer_name?: string;
  event_id: string;
  event_title: string;
  platform: Platform;
  name: string;
  goal: CampaignGoal;
  budget_eur: number;
  status: CampaignStatus;
  audience: CampaignAudience;
  creative: CampaignCreative;
  metrics: CampaignMetrics;
  created_at: string;
  auto_generated?: boolean;
};

const GADS_KEY = "mt_google_ads_accounts";
const META_KEY = "mt_meta_ads_accounts";
const PIXEL_KEY = "mt_pixel_settings";
const CAMP_KEY = "mt_campaigns";
const AUTO_KEY = "mt_marketing_auto"; // map organizer_id -> boolean

export const MARKETING_EVENT = "mt:marketing-change";

const isBrowser = () => typeof window !== "undefined";
const read = <T,>(k: string, f: T): T => {
  if (!isBrowser()) return f;
  try {
    const v = window.localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : f;
  } catch {
    return f;
  }
};
const write = <T,>(k: string, v: T) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(k, JSON.stringify(v));
  window.dispatchEvent(new Event(MARKETING_EVENT));
};
const uid = () =>
  isBrowser() && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

// ---------- Google Ads ----------
export const getGoogleAccounts = (): GoogleAdsAccount[] => read(GADS_KEY, []);
export const getGoogleAccountFor = (organizerId: string) =>
  getGoogleAccounts().find((a) => a.organizer_id === organizerId);

export function connectGoogleAds(organizerId: string): GoogleAdsAccount {
  const list = getGoogleAccounts().filter((a) => a.organizer_id !== organizerId);
  const acc: GoogleAdsAccount = {
    id: uid(),
    organizer_id: organizerId,
    customer_id: `${rand(3)}-${rand(3)}-${rand(4)}`,
    account_name: "vstupenky.sk Organizer Ads",
    status: "connected",
    credit_eur: 250,
    last_sync_at: new Date().toISOString(),
    connected_at: new Date().toISOString(),
  };
  list.push(acc);
  write(GADS_KEY, list);
  return acc;
}
export function disconnectGoogleAds(organizerId: string) {
  write(GADS_KEY, getGoogleAccounts().filter((a) => a.organizer_id !== organizerId));
}
export function syncGoogleAds(organizerId: string) {
  const list = getGoogleAccounts();
  const acc = list.find((a) => a.organizer_id === organizerId);
  if (acc) {
    acc.last_sync_at = new Date().toISOString();
    write(GADS_KEY, list);
  }
}

// ---------- Meta Ads ----------
export const getMetaAccounts = (): MetaAdsAccount[] => read(META_KEY, []);
export const getMetaAccountFor = (organizerId: string) =>
  getMetaAccounts().find((a) => a.organizer_id === organizerId);

export function connectMetaAds(organizerId: string): MetaAdsAccount {
  const list = getMetaAccounts().filter((a) => a.organizer_id !== organizerId);
  const acc: MetaAdsAccount = {
    id: uid(),
    organizer_id: organizerId,
    business_account_id: rand(15),
    ad_account_id: `act_${rand(12)}`,
    pixel_id: rand(15),
    page_name: "vstupenky.sk Events",
    status: "connected",
    credit_eur: 180,
    last_sync_at: new Date().toISOString(),
    connected_at: new Date().toISOString(),
  };
  list.push(acc);
  write(META_KEY, list);
  return acc;
}
export function disconnectMetaAds(organizerId: string) {
  write(META_KEY, getMetaAccounts().filter((a) => a.organizer_id !== organizerId));
}

// ---------- Pixel settings ----------
export function getPixelSettings(organizerId: string): PixelSettings {
  const all = read<PixelSettings[]>(PIXEL_KEY, []);
  return (
    all.find((p) => p.organizer_id === organizerId) ?? {
      organizer_id: organizerId,
      updated_at: new Date().toISOString(),
    }
  );
}
export function savePixelSettings(s: PixelSettings) {
  const all = read<PixelSettings[]>(PIXEL_KEY, []).filter((p) => p.organizer_id !== s.organizer_id);
  all.push({ ...s, updated_at: new Date().toISOString() });
  write(PIXEL_KEY, all);
}

// ---------- Campaigns ----------
export const getCampaigns = (): Campaign[] => read(CAMP_KEY, []);
export const getCampaignsFor = (organizerId: string) =>
  getCampaigns().filter((c) => c.organizer_id === organizerId);
export const getCampaign = (id: string) => getCampaigns().find((c) => c.id === id);

export function saveCampaign(c: Campaign) {
  const list = getCampaigns();
  const i = list.findIndex((x) => x.id === c.id);
  if (i >= 0) list[i] = c;
  else list.unshift(c);
  write(CAMP_KEY, list);
}
export function deleteCampaign(id: string) {
  write(CAMP_KEY, getCampaigns().filter((c) => c.id !== id));
}
export function setCampaignStatus(id: string, status: CampaignStatus) {
  const list = getCampaigns();
  const c = list.find((x) => x.id === id);
  if (c) {
    c.status = status;
    write(CAMP_KEY, list);
  }
}

// ---------- Auto-promote toggle ----------
export function getAutoPromote(organizerId: string): boolean {
  const map = read<Record<string, boolean>>(AUTO_KEY, {});
  return !!map[organizerId];
}
export function setAutoPromote(organizerId: string, v: boolean) {
  const map = read<Record<string, boolean>>(AUTO_KEY, {});
  map[organizerId] = v;
  write(AUTO_KEY, map);
}

// ---------- Helpers ----------
function rand(len: number) {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
}

export function generateCreative(event: { title: string; city: string; venue: string; category: string }): CampaignCreative {
  const t = event.title;
  const headlines = [
    `${t} – kúp vstupenku`,
    `${t} v ${event.city}`,
    `Nenechaj si ujsť ${t}`,
    `${t} | ${event.venue}`,
    `Vstupenky na ${t}`,
    `${event.category}: ${t}`,
    `Zažiť ${t} naživo`,
    `Posledné lístky na ${t}`,
    `${t} – obmedzený počet`,
    `Vyber si miesto na ${t}`,
    `${t} – oficiálne vstupenky`,
    `${t} ${event.city} 2026`,
    `Najlepší ${event.category} – ${t}`,
    `Kúp vstupenky online`,
    `${t} – vstupenky.sk`,
  ];
  const descriptions = [
    `Oficiálne vstupenky na ${t} v ${event.venue}. Rýchle a bezpečné platby.`,
    `Zaži ${t} naživo v ${event.city}. Vyber si miesto a kúp online za pár sekúnd.`,
    `${t} čaká na teba. Doruč si lístky priamo do mobilu.`,
    `Obmedzený počet vstupeniek na ${t}. Neváhaj a zarezervuj si miesto.`,
  ];
  return {
    headlines,
    descriptions,
    cta: "Kúpiť vstupenku",
  };
}

export function defaultAudience(): CampaignAudience {
  return {
    country: "SK",
    cities: [],
    age_min: 18,
    age_max: 55,
    gender: "all",
    interests: ["hudba", "koncerty", "kultúra"],
  };
}

export function emptyMetrics(): CampaignMetrics {
  return {
    impressions: 0,
    clicks: 0,
    cpc: 0,
    ctr: 0,
    conversions: 0,
    tickets_sold: 0,
    revenue_eur: 0,
    spend_eur: 0,
    roas: 0,
    updated_at: new Date().toISOString(),
  };
}

// Simulácia výsledkov reklamy – pre potreby mock dashboardu.
export function simulateMetrics(budget: number, daysActive = 7): CampaignMetrics {
  const spend = Math.min(budget, +(budget * (0.4 + Math.random() * 0.6)).toFixed(2));
  const cpc = +(0.18 + Math.random() * 0.42).toFixed(2);
  const clicks = Math.max(1, Math.floor(spend / cpc));
  const impressions = clicks * (60 + Math.floor(Math.random() * 80));
  const ctr = +((clicks / impressions) * 100).toFixed(2);
  const conversionRate = 0.04 + Math.random() * 0.08;
  const conversions = Math.floor(clicks * conversionRate);
  const tickets_sold = conversions;
  const avgPrice = 18 + Math.random() * 20;
  const revenue = +(tickets_sold * avgPrice).toFixed(2);
  const roas = spend > 0 ? +(revenue / spend).toFixed(2) : 0;
  return {
    impressions,
    clicks,
    cpc,
    ctr,
    conversions,
    tickets_sold,
    revenue_eur: revenue,
    spend_eur: spend,
    roas,
    updated_at: new Date().toISOString(),
  };
}
