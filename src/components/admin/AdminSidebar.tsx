import { useEffect, useState } from "react";
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
  /** Stránka nad generovanými dátami z `admin-mock.ts` — v navigácii skrytá. */
  demo?: boolean;
};
type Group = { label: string; items: Item[] };

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
      {
        title: "Vyúčtovacie protokoly",
        url: "/admin/maxiticket/protocols",
        icon: FileText,
        demo: true,
      },
      { title: "Náklady organizátorov", url: "/admin/maxiticket/costs", icon: Wallet, demo: true },
      { title: "Organizátori", url: "/admin/maxiticket/organizers", icon: Users, demo: true },
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
      { title: "Zariadenia / čítačky", url: "/admin/maxiticket/devices", icon: Scan, demo: true },
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
        demo: true,
      },
      {
        title: "Typy refundácií",
        url: "/admin/maxiticket/refund-types",
        icon: RotateCcw,
        demo: true,
      },
      { title: "Bilancie", url: "/admin/maxiticket/balances", icon: Scale, demo: true },
    ],
  },
  {
    label: "Podujatia",
    items: [
      { title: "Podujatia", url: "/admin/events/events", icon: CalendarDays },
      { title: "Termíny", url: "/admin/events/dates", icon: CalendarClock, demo: true },
      { title: "Editor hál", url: "/admin/events/venue-layouts", icon: LayoutGrid },
      { title: "Miesta konania", url: "/admin/events/venues", icon: MapPin, demo: true },
      { title: "Zľavové kupóny", url: "/admin/events/coupons", icon: Tag, demo: true },
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
      { title: "Terminály", url: "/admin/pos/terminals", icon: Scan },
      { title: "ORP / eKasa", url: "/admin/pos/fiscal", icon: Receipt },
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
      { title: "Účinkujúci", url: "/admin/data/performers", icon: Star, demo: true },
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
    items: [{ title: "Reklamné kampane", url: "/admin/marketing", icon: Megaphone }],
  },
  {
    label: "Systém",
    items: [
      { title: "Wallet nastavenia", url: "/admin/system/wallet", icon: Wallet },
      { title: "Emailové šablóny", url: "/admin/system/email-templates", icon: Mail, demo: true },
      { title: "Používatelia", url: "/admin/system/users", icon: UserCog, demo: true },
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

const DEMO_KEY = "mt_admin_show_demo";

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const currentPath = useRouterState({ select: (r) => r.location.pathname });

  // Stránky nad generovanými dátami z `admin-mock.ts` sú predvolene skryté.
  // Vymyslené čísla v administrácii sú horšie než chýbajúca položka — človek
  // im uverí. Kým sa nenapoja na databázu, zobrazia sa len na požiadanie.
  // Routes samotné ostávajú funkčné, aby uložené odkazy neprestali fungovať.
  const [showDemo, setShowDemo] = useState(false);
  useEffect(() => {
    try {
      setShowDemo(localStorage.getItem(DEMO_KEY) === "1");
    } catch {
      /* súkromný režim prehliadača */
    }
  }, []);
  const toggleDemo = () => {
    setShowDemo((v) => {
      const next = !v;
      try {
        localStorage.setItem(DEMO_KEY, next ? "1" : "0");
      } catch {
        /* ignorujeme */
      }
      return next;
    });
  };

  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => showDemo || !i.demo) }))
    .filter((g) => g.items.length > 0);
  const hiddenCount = groups.reduce((n, g) => n + g.items.filter((i) => i.demo).length, 0);

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
                              {item.demo && (
                                <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  demo
                                </span>
                              )}
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

      {!collapsed && hiddenCount > 0 && (
        <SidebarFooter className="border-t border-border/40 px-3 py-3">
          <button
            type="button"
            onClick={toggleDemo}
            className="w-full rounded-md px-2 py-1.5 text-left text-[11px] leading-snug text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {showDemo ? (
              <>Skryť {hiddenCount} demo sekcií</>
            ) : (
              <>
                Skrytých {hiddenCount} sekcií nad ukážkovými dátami — <u>zobraziť</u>
              </>
            )}
          </button>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
