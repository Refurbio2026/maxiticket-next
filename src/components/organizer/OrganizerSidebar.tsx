import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, CalendarDays, Plus, ShoppingCart, Receipt,
  ClipboardList, Users, Cpu, Flame, ShieldCheck, Megaphone, UserCog,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/hooks/use-i18n";

type Item = { title: string; url: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean };
type Group = { label: string; items: Item[] };

const groups: Group[] = [
  {
    label: "orgNav.groupOverview",
    items: [{ title: "orgNav.dashboard", url: "/organizer", icon: LayoutDashboard, exact: true }],
  },
  {
    label: "orgNav.groupEvents",
    items: [
      { title: "orgNav.myEvents", url: "/organizer/events", icon: CalendarDays },
      { title: "orgNav.addEvent", url: "/organizer/events/new", icon: Plus },
    ],
  },
  {
    label: "orgNav.groupSales",
    items: [
      { title: "orgNav.pos", url: "/organizer/pos", icon: ShoppingCart, exact: true },
      { title: "orgNav.sales", url: "/organizer/pos/sales", icon: Receipt },
      { title: "orgNav.cashierSales", url: "/organizer/pos/cashier-sales", icon: UserCog },
      { title: "orgNav.dailyClosing", url: "/organizer/pos/closing", icon: ClipboardList },
      { title: "orgNav.cashiers", url: "/organizer/pos/cashiers", icon: Users },
      { title: "orgNav.devices", url: "/organizer/pos/devices", icon: Cpu },
      { title: "orgNav.fiscal", url: "/organizer/pos/fiscal", icon: ShieldCheck },
    ],
  },
  {
    label: "orgNav.groupMarketing",
    items: [
      { title: "orgNav.marketingCenter", url: "/organizer/marketing", icon: Megaphone, exact: true },
      { title: "orgNav.launchAd", url: "/organizer/marketing/new", icon: Plus },
    ],
  },
];

export function OrganizerSidebar() {
  const { t } = useI18n();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const currentPath = useRouterState({ select: (r) => r.location.pathname });

  return (
    <Sidebar collapsible="icon" className="border-r border-border/40">
      <SidebarHeader className="border-b border-border/40 px-4 py-4">
        <Link to="/organizer" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-flame shadow-glow">
            <Flame className="h-5 w-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="font-display text-base font-bold tracking-tight">vipky.sk</span>
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                {t("orgNav.organizerLabel")}
              </span>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2">
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            {!collapsed && (
              <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                {t(group.label)}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = item.exact ? currentPath === item.url : currentPath.startsWith(item.url);
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        className="data-[active=true]:bg-primary/15 data-[active=true]:text-primary data-[active=true]:font-semibold hover:bg-muted/60"
                      >
                        <Link to={item.url} className="flex items-center gap-2.5">
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!collapsed && <span className="truncate text-sm">{t(item.title)}</span>}
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
    </Sidebar>
  );
}
