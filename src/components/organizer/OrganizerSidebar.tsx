import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, CalendarDays, Plus, ShoppingCart, Receipt,
  ClipboardList, Users, Cpu, Flame, ShieldCheck,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";

type Item = { title: string; url: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean };
type Group = { label: string; items: Item[] };

const groups: Group[] = [
  {
    label: "Prehľad",
    items: [{ title: "Dashboard", url: "/organizer", icon: LayoutDashboard, exact: true }],
  },
  {
    label: "Podujatia",
    items: [
      { title: "Moje podujatia", url: "/organizer/events", icon: CalendarDays },
      { title: "Pridať podujatie", url: "/organizer/events/new", icon: Plus },
    ],
  },
  {
    label: "Predaj",
    items: [
      { title: "Pokladňa (POS)", url: "/organizer/pos", icon: ShoppingCart, exact: true },
      { title: "Predaje", url: "/organizer/pos/sales", icon: Receipt },
      { title: "Denné uzávierky", url: "/organizer/pos/closing", icon: ClipboardList },
      { title: "Pokladníci", url: "/organizer/pos/cashiers", icon: Users },
      { title: "Zariadenia", url: "/organizer/pos/devices", icon: Cpu },
      { title: "ORP / eKasa", url: "/organizer/pos/fiscal", icon: ShieldCheck },
    ],
  },
];

export function OrganizerSidebar() {
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
              <span className="font-display text-base font-bold tracking-tight">MAXITICKET</span>
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Organizer
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
                {group.label}
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
                          {!collapsed && <span className="truncate text-sm">{item.title}</span>}
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
