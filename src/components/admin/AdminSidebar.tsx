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
  /**
   * Stránka funguje, ale ukladá do localStorage prehliadača, nie do databázy.
   * Iný počítač = iné dáta, server o nich nevie.
   */
  local?: boolean;
};
type Group = { label: string; items: Item[] };

/** Bodka za názvom hovorí, či stránka beží na databáze, alebo len v prehliadači. */
function StatusDot({ item }: { item: Item }) {
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
      { title: "Zostavy / fakturovanie", url: "/admin/maxiticket/billing", icon: Receipt },
      { title: "Vyúčtovacie protokoly", url: "/admin/maxiticket/protocols", icon: FileText },
      { title: "Náklady organizátorov", url: "/admin/maxiticket/costs", icon: Wallet },
      { title: "Organizátori", url: "/admin/maxiticket/organizers", icon: Users },
      { title: "Platby organizátorom", url: "/admin/maxiticket/payments", icon: CreditCard },
      { title: "Vstupenky organizátorov", url: "/admin/maxiticket/tickets", icon: Ticket },
      { title: "Kontrola zostavy", url: "/admin/maxiticket/control", icon: ShieldCheck },
      { title: "Zariadenia / čítačky", url: "/admin/maxiticket/devices", icon: Scan },
      {
        title: "Účtovanie / výpisy z banky",
        url: "/admin/maxiticket/accounting-bank",
        icon: Landmark,
      },
      {
        title: "Účtovanie / report",
        url: "/admin/maxiticket/accounting-report",
        icon: ClipboardList,
      },
      {
        title: "Účtovanie / kontroly",
        url: "/admin/maxiticket/accounting-checks",
        icon: CheckSquare,
      },
      {
        title: "Typy refundácií",
        url: "/admin/maxiticket/refund-types",
        icon: RotateCcw,
      },
      { title: "Bilancie", url: "/admin/maxiticket/balances", icon: Scale },
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
      { title: "Storno", url: "/admin/sales/cancellations", icon: Ban },
      { title: "Poznámky", url: "/admin/sales/notes", icon: StickyNote },
    ],
  },
  {
    label: "POS / Pokladňa",
    items: [
      { title: "Pokladne", url: "/admin/pos/cashiers", icon: Users },
      { title: "Predaje", url: "/admin/pos/sales", icon: ShoppingCart },
      { title: "Uzávierky", url: "/admin/pos/closings", icon: ClipboardList },
      { title: "Terminály", url: "/admin/pos/terminals", icon: Scan },
      { title: "ORP / eKasa", url: "/admin/pos/fiscal", icon: Receipt },
    ],
  },
  {
    label: "Dáta",
    items: [
      { title: "Kategórie podujatí", url: "/admin/data/categories", icon: Layers },
      { title: "Skupiny podujatí", url: "/admin/data/groups", icon: FolderTree },
      { title: "Cenové kategórie", url: "/admin/data/price-categories", icon: DollarSign },
      { title: "Účinkujúci", url: "/admin/data/performers", icon: Star },
      { title: "Obsah / stránky", url: "/admin/data/content", icon: FileCode },
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
      { title: "Wallet nastavenia", url: "/admin/system/wallet", icon: Wallet },
      { title: "Emailové šablóny", url: "/admin/system/email-templates", icon: Mail },
      { title: "Používatelia", url: "/admin/system/users", icon: UserCog },
    ],
  },
  {
    label: "Reporty",
    items: [{ title: "Reporty predajov", url: "/admin/reports/sales", icon: TrendingUp }],
  },
];

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const currentPath = useRouterState({ select: (r) => r.location.pathname });

  // Nič sa neskrýva — skrytá položka sa ľahko zabudne. Stav je vidieť na bodke
  // za názvom: plná = beží na databáze, dutá = ukladá len do prehliadača.
  const visibleGroups = groups;
  const all = groups.flatMap((g) => g.items);
  const localCount = all.filter((i) => i.local).length;
  const liveCount = all.length - localCount;

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
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
