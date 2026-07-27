import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { Bell, Search, ChevronRight, Settings, LogOut, User } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";

const labels: Record<string, string> = {
  admin: "Admin",
  maxiticket: "vipky.sk",
  billing: "Zostavy / fakturovanie",
  protocols: "Vyúčtovacie protokoly",
  costs: "Náklady organizátorov",
  organizers: "Organizátori",
  payments: "Platby organizátorom",
  tickets: "Vstupenky organizátorov",
  control: "Kontrola zostavy",
  devices: "Zariadenia / čítačky",
  "accounting-bank": "Účtovanie / banka",
  "accounting-report": "Účtovanie / report",
  "accounting-checks": "Účtovanie / kontroly",
  "refund-types": "Typy refundácií",
  balances: "Bilancie",
  events: "Podujatia",
  dates: "Termíny",
  "hall-layouts": "Rozloženia haly",
  venues: "Miesta konania",
  coupons: "Zľavové kupóny",
  sales: "Predaj",
  cancellations: "Storno",
  notes: "Poznámky",
  data: "Dáta",
  categories: "Kategórie podujatí",
  groups: "Skupiny podujatí",
  "price-categories": "Cenové kategórie",
  "discount-categories": "Kategórie zliav",
  discounts: "Zľavy",
  sectors: "Sektor / Loc1",
  rows: "Rad / Loc2",
  sides: "Strana / Side",
  performers: "Účinkujúci",
  content: "Obsah / stránky",
  finance: "Financie",
  stats: "Štatistiky",
  system: "Systém",
  "email-templates": "Emailové šablóny",
  users: "Používatelia",
  reports: "Reporty",
  avf: "AVF Reporty",
};

export function AdminTopbar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const segments = path.split("/").filter(Boolean);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const initials = (user?.full_name || user?.email || "AD")
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const handleLogout = async () => {
    await signOut();
    toast.success("Odhlásený");
    navigate({ to: "/login", replace: true });
  };


  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border/40 bg-background/80 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 md:px-6">
      <SidebarTrigger className="-ml-1" />

      <Breadcrumb className="hidden md:block">
        <BreadcrumbList>
          {segments.map((seg, i) => {
            const isLast = i === segments.length - 1;
            const url = "/" + segments.slice(0, i + 1).join("/");
            const label = labels[seg] ?? seg;
            return (
              <BreadcrumbItem key={url}>
                {i > 0 && <BreadcrumbSeparator><ChevronRight className="h-3.5 w-3.5" /></BreadcrumbSeparator>}
                {isLast ? (
                  <BreadcrumbPage className="font-medium">{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={url} className="text-muted-foreground hover:text-foreground">
                      {label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative hidden lg:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Hľadať podujatia, organizátorov, objednávky…"
            className="h-9 w-[320px] pl-9 bg-muted/40 border-border/50 focus-visible:ring-primary/40"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 select-none items-center gap-1 rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
            ⌘K
          </kbd>
        </div>

        <ThemeToggle className="h-9 w-9" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-9 w-9">
              <Bell className="h-4 w-4" />
              <Badge className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 bg-primary text-[10px] font-bold text-primary-foreground">
                7
              </Badge>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Upozornenia</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {[
              { t: "Nová refundácia čaká na schválenie", s: "pred 2 min", c: "bg-primary" },
              { t: "Organizátor MeloFest dosiahol limit predaja", s: "pred 14 min", c: "bg-accent" },
              { t: "Bankový výpis spárovaný (98 položiek)", s: "pred 1 h", c: "bg-muted-foreground" },
              { t: "Zariadenie SCAN-04 offline", s: "pred 3 h", c: "bg-destructive" },
            ].map((n, i) => (
              <DropdownMenuItem key={i} className="flex flex-col items-start gap-1 py-3">
                <div className="flex w-full items-start gap-2">
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${n.c}`} />
                  <div className="flex-1 text-sm">{n.t}</div>
                </div>
                <span className="ml-3.5 text-xs text-muted-foreground">{n.s}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-2 py-1 hover:bg-muted/60 transition">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-gradient-flame text-primary-foreground text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden text-left leading-tight md:block">
                <div className="text-xs font-semibold">{user?.full_name || user?.email || "Admin"}</div>
                <div className="text-[10px] text-muted-foreground">{user?.role === "admin" ? "Super Admin" : user?.role ?? ""}</div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Môj účet</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link to="/account"><User className="mr-2 h-4 w-4" />Profil</Link></DropdownMenuItem>
            <DropdownMenuItem><Settings className="mr-2 h-4 w-4" />Nastavenia</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleLogout(); }} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />Odhlásiť sa
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

      </div>
    </header>
  );
}
