import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Receipt,
  FileText,
  Wallet,
  Users,
  CreditCard,
  Ticket,
  ShieldCheck,
  Scan,
  Landmark,
  ClipboardList,
  CheckSquare,
  RotateCcw,
  Scale,
  CalendarDays,
  CalendarClock,
  LayoutGrid,
  MapPin,
  Tag,
  ShoppingCart,
  Ban,
  StickyNote,
  Layers,
  FolderTree,
  DollarSign,
  Percent,
  PercentSquare,
  Grid3x3,
  Rows,
  SplitSquareHorizontal,
  Star,
  FileCode,
  BarChart3,
  Mail,
  UserCog,
  FileBarChart,
  TrendingUp,
  Flame,
  Megaphone,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

type Item = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Stránka nad generovanými dátami z `admin-mock.ts` — treba ju ešte dorobiť. */
  demo?: boolean;
  /**
   * Stránka funguje, ale ukladá do localStorage prehliadača, nie do databázy.
   * Iný počítač = iné dáta, server o nich nevie.
   */
  local?: boolean;
};
type Group = { label: string; items: Item[] };

/** Bodka za názvom hovorí, v akom stave stránka je. Demo stránky bodku nemajú. */
function StatusDot({ item }: { item: Item }) {
  if (item.demo) return null;
  return (
    <span
      className={
        item.local
          ? "ml-auto size-1.5 shrink-0 rounded-full border border-amber-500"
          : "ml-auto size-1.5 shrink-0 rounded-full bg-emerald-500"
      }
      title={
        item.local
          ? "Funguje, ale dáta sa ukladajú len do tohto prehliadača"
          : "Hotové — beží na databáze"
      }
    />
  );
}

const groups: Group[] = [
  {
    label: "Prehľad",
    items: [{ title: "Dashboard", url: "/admin", icon: LayoutDashboard }],
  },
  {
    label: "vipky.sk",
    items: [
      {
        title: "Zostavy / fakturovanie",
        url: "/admin/maxiticket/billing",
        icon: Receipt,
        demo: true,
      },
      { title: "Vyúčtovacie protokoly", url: "/admin/maxiticket/protocols", icon: FileText },
      { title: "Náklady organizátorov", url: "/admin/maxiticket/costs", icon: Wallet, demo: true },
      { title: "Organizátori", url: "/admin/maxiticket/organizers", icon: Users },
      {
        title: "Platby organizátorom",
        url: "/admin/maxiticket/payments",
        icon: CreditCard,
        demo: true,
      },
      {
        title: "Vstupenky organizátorov",
        url: "/admin/maxiticket/tickets",
        icon: Ticket,
        demo: true,
      },
      {
        title: "Kontrola zostavy",
        url: "/admin/maxiticket/control",
        icon: ShieldCheck,
        demo: true,
      },
      { title: "Zariadenia / čítačky", url: "/admin/maxiticket/devices", icon: Scan },
      {
        title: "Účtovanie / výpisy z banky",
        url: "/admin/maxiticket/accounting-bank",
        icon: Landmark,
        local: true,
      },
      {
        title: "Účtovanie / report",
        url: "/admin/maxiticket/accounting-report",
        icon: ClipboardList,
        local: true,
      },
      {
        title: "Účtovanie / kontroly",
        url: "/admin/maxiticket/accounting-checks",
        icon: CheckSquare,
        demo: true,
      },
      {
        title: "Typy refundácií",
        url: "/admin/maxiticket/refund-types",
        icon: RotateCcw,
      },
      { title: "Bilancie", url: "/admin/maxiticket/balances", icon: Scale, demo: true },
    ],
  },
  {
    label: "Podujatia",
    items: [
      { title: "Podujatia", url: "/admin/events/events", icon: CalendarDays },
      { title: "Termíny", url: "/admin/events/dates", icon: CalendarClock },
      { title: "Editor hál", url: "/admin/events/venue-layouts", icon: LayoutGrid },
      { title: "Miesta konania", url: "/admin/events/venues", icon: MapPin },
      { title: "Zľavové kupóny", url: "/admin/events/coupons", icon: Tag },
    ],
  },
  {
    label: "Predaj",
    items: [
      { title: "Predaj", url: "/admin/sales/sales", icon: ShoppingCart },
      { title: "Storno", url: "/admin/sales/cancellations", icon: Ban, demo: true },
      { title: "Poznámky", url: "/admin/sales/notes", icon: StickyNote, demo: true },
    ],
  },
  {
    label: "POS / Pokladňa",
    items: [
      { title: "Pokladne", url: "/admin/pos/cashiers", icon: Users },
      { title: "Predaje", url: "/admin/pos/sales", icon: ShoppingCart },
      { title: "Uzávierky", url: "/admin/pos/closings", icon: ClipboardList },
      { title: "Terminály", url: "/admin/pos/terminals", icon: Scan, local: true },
      { title: "ORP / eKasa", url: "/admin/pos/fiscal", icon: Receipt, local: true },
    ],
  },
  {
    label: "Dáta",
    items: [
      { title: "Kategórie podujatí", url: "/admin/data/categories", icon: Layers },
      { title: "Skupiny podujatí", url: "/admin/data/groups", icon: FolderTree, demo: true },
      {
        title: "Cenové kategórie",
        url: "/admin/data/price-categories",
        icon: DollarSign,
        demo: true,
      },
      {
        title: "Kategórie zliav",
        url: "/admin/data/discount-categories",
        icon: Percent,
        demo: true,
      },
      { title: "Zľavy", url: "/admin/data/discounts", icon: PercentSquare, demo: true },
      { title: "Sektor / Loc1", url: "/admin/data/sectors", icon: Grid3x3, demo: true },
      { title: "Rad / Loc2", url: "/admin/data/rows", icon: Rows, demo: true },
      { title: "Strana / Side", url: "/admin/data/sides", icon: SplitSquareHorizontal, demo: true },
      { title: "Účinkujúci", url: "/admin/data/performers", icon: Star },
      { title: "Obsah / stránky", url: "/admin/data/content", icon: FileCode, demo: true },
    ],
  },
  {
    label: "Financie",
    items: [
      { title: "Platby (GoPay)", url: "/admin/finance/payments", icon: CreditCard },
      { title: "Štatistiky", url: "/admin/finance/stats", icon: BarChart3 },
    ],
  },
  {
    label: "Marketing",
    items: [{ title: "Reklamné kampane", url: "/admin/marketing", icon: Megaphone, local: true }],
  },
  {
    label: "Systém",
    items: [
      { title: "Wallet nastavenia", url: "/admin/system/wallet", icon: Wallet, local: true },
      { title: "Emailové šablóny", url: "/admin/system/email-templates", icon: Mail },
      { title: "Používatelia", url: "/admin/system/users", icon: UserCog },
    ],
  },
  {
    label: "Reporty",
    items: [
      { title: "AVF Reporty", url: "/admin/reports/avf", icon: FileBarChart, demo: true },
      { title: "Reporty predajov", url: "/admin/reports/sales", icon: TrendingUp, demo: true },
    ],
  },
];

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const currentPath = useRouterState({ select: (r) => r.location.pathname });

  // Nič sa neskrýva — skrytá položka sa ľahko zabudne. Stav je vidieť na bodke
  // za názvom: plná = beží na databáze, dutá = ukladá len do prehliadača,
  // žiadna = stránka nad ukážkovými dátami, ktorú treba dorobiť.
  const visibleGroups = groups;
  const all = groups.flatMap((g) => g.items);
  const demoCount = all.filter((i) => i.demo).length;
  const localCount = all.filter((i) => i.local).length;
  const liveCount = all.length - demoCount - localCount;

  return (
    <Sidebar collapsible="icon" className="border-r border-border/40">
      <SidebarHeader className="border-b border-border/40 px-4 py-4">
        <Link to="/admin" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-flame shadow-glow">
            <Flame className="h-5 w-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="font-display text-base font-bold tracking-tight">vipky.sk</span>
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Admin Console
              </span>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2">
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.label}>
            {!collapsed && (
              <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active =
                    item.url === "/admin"
                      ? currentPath === "/admin"
                      : currentPath.startsWith(item.url);
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        className="data-[active=true]:bg-primary/15 data-[active=true]:text-primary data-[active=true]:font-semibold hover:bg-muted/60"
                      >
                        <Link to={item.url} className="flex items-center gap-2.5">
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!collapsed && (
                            <>
                              <span className="truncate text-sm">{item.title}</span>
                              <StatusDot item={item} />
                            </>
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {!collapsed && (
        <SidebarFooter className="border-t border-border/40 px-3 py-3">
          <div className="space-y-1.5 px-2 text-[11px] leading-snug text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
              <span>
                <span className="font-semibold text-foreground">{liveCount}</span> hotových — bežia
                na databáze
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="size-1.5 shrink-0 rounded-full border border-amber-500" />
              <span>
                <span className="font-semibold text-foreground">{localCount}</span> len v
                prehliadači — dáta sa neukladajú na server
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="size-1.5 shrink-0 rounded-full border border-dashed border-border" />
              <span>
                <span className="font-semibold text-foreground">{demoCount}</span> bez bodky —
                ukážkové dáta, treba dorobiť
              </span>
            </div>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
