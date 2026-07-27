import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getEvents, EVENTS_EVENT, type EventItem } from "@/lib/local-db";
import { getSales, POS_EVENT } from "@/lib/pos-db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Plus, Calendar, MapPin, Eye, FileText, Ticket, TrendingUp,
  ShoppingCart, Receipt, ClipboardList, ArrowRight,
} from "lucide-react";

export const Route = createFileRoute("/organizer/")({
  head: () => ({ meta: [{ title: "Organizer dashboard · vipky.sk" }] }),
  component: OrganizerHome,
});

function OrganizerHome() {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [salesCount, setSalesCount] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!user) return;
    setEvents(getEvents().filter((e) => e.organizer_id === user.id || user.role === "admin"));
    setSalesCount(getSales().filter((s) => s.organizer_id === user.id).length);
  }, [user, tick]);

  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener(EVENTS_EVENT, h);
    window.addEventListener(POS_EVENT, h);
    return () => {
      window.removeEventListener(EVENTS_EVENT, h);
      window.removeEventListener(POS_EVENT, h);
    };
  }, []);

  const published = events.filter((e) => e.status === "published");
  const totalCapacity = events.reduce((s, e) => s + e.tickets.reduce((a, t) => a + t.quantity, 0), 0);
  const totalRevenue = events.reduce((s, e) => s + e.tickets.reduce((a, t) => a + t.price * t.quantity, 0), 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-tight">Vitaj, {user?.full_name || "Organizátor"}.</h1>
        <p className="text-muted-foreground mt-1">Spravuj svoje podujatia, otvor pokladňu alebo skontroluj predaje.</p>
      </div>

      {/* Big action cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ActionCard
          to="/organizer/events/new"
          title="Pridať podujatie"
          desc="Vytvor nové podujatie a spusti predaj."
          icon={<Plus className="size-6" />}
        />
        <ActionCard
          to="/organizer/pos"
          title="Otvoriť pokladňu"
          desc="Predaj vstupeniek fyzicky na mieste."
          icon={<ShoppingCart className="size-6" />}
          primary
        />
        <ActionCard
          to="/organizer/pos/sales"
          title="Predaje"
          desc="Zoznam dokladov a storno operácie."
          icon={<Receipt className="size-6" />}
        />
        <ActionCard
          to="/organizer/pos/closing"
          title="Uzávierka"
          desc="Denný report a export tržieb."
          icon={<ClipboardList className="size-6" />}
        />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Moje podujatia" value={events.length.toString()} icon={<Calendar className="size-5 text-primary" />} />
        <Stat label="Publikované" value={published.length.toString()} icon={<Eye className="size-5 text-primary" />} />
        <Stat label="Kapacita" value={totalCapacity.toLocaleString("sk-SK")} icon={<Ticket className="size-5 text-primary" />} />
        <Stat label="Predaje (POS)" value={salesCount.toString()} icon={<TrendingUp className="size-5 text-primary" />} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl font-semibold">Posledné podujatia</h2>
          <Button asChild variant="ghost" size="sm"><Link to="/organizer/events">Všetky →</Link></Button>
        </div>
        {events.length === 0 ? (
          <Card className="p-12 text-center bg-card/60 border-dashed border-border/50">
            <Calendar className="size-10 text-muted-foreground mx-auto mb-3" />
            <div className="font-semibold">Zatiaľ žiadne podujatia</div>
            <p className="text-sm text-muted-foreground mt-1">Začni pridaním prvého podujatia.</p>
            <Button asChild className="mt-5 bg-gradient-flame text-primary-foreground shadow-glow">
              <Link to="/organizer/events/new"><Plus className="size-4 mr-2" /> Pridať podujatie</Link>
            </Button>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {events.slice(0, 6).map((e) => (
              <Card key={e.id} className="overflow-hidden bg-card/60 border-border/50">
                <div className="aspect-video bg-muted bg-cover bg-center" style={e.image_url ? { backgroundImage: `url(${e.image_url})` } : undefined} />
                <div className="p-5 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                      e.status === "published" ? "bg-primary/15 text-primary border-primary/30" : "bg-muted text-muted-foreground border-border/50"
                    }`}>{e.status === "published" ? "Publikované" : "Koncept"}</span>
                    <span className="text-xs text-muted-foreground">{e.category}</span>
                  </div>
                  <h3 className="font-display font-semibold text-lg leading-tight">{e.title}</h3>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Calendar className="size-3.5" /> {e.event_date} · {e.event_time}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5"><MapPin className="size-3.5" /> {e.venue}, {e.city}</div>
                  {e.status === "published" ? (
                    <Button asChild variant="ghost" size="sm" className="mt-2"><Link to="/events/$id" params={{ id: e.id }}><Eye className="size-3.5 mr-1.5" /> Zobraziť</Link></Button>
                  ) : (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-2"><FileText className="size-3.5" /> Verejne neviditeľné</div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      {/* keep revenue used */}
      <div className="sr-only">€{totalRevenue}</div>
    </div>
  );
}

function ActionCard({ to, title, desc, icon, primary }: { to: string; title: string; desc: string; icon: React.ReactNode; primary?: boolean }) {
  return (
    <Link to={to} className="block group">
      <Card className={`p-6 h-full transition border-border/50 ${
        primary
          ? "bg-gradient-flame text-primary-foreground border-transparent shadow-glow hover:shadow-[0_0_50px_hsl(var(--primary)/0.5)]"
          : "bg-card/60 hover:border-primary/50 hover:bg-card"
      }`}>
        <div className={`size-12 rounded-xl grid place-items-center mb-4 ${primary ? "bg-background/15" : "bg-primary/15 text-primary"}`}>
          {icon}
        </div>
        <div className="font-display text-lg font-bold">{title}</div>
        <p className={`text-sm mt-1 ${primary ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{desc}</p>
        <div className={`mt-4 inline-flex items-center gap-1 text-xs font-semibold ${primary ? "" : "text-primary"}`}>
          Otvoriť <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
        </div>
      </Card>
    </Link>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card className="p-5 bg-card/60 border-border/50">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="font-display text-2xl font-bold mt-1">{value}</div>
        </div>
        {icon}
      </div>
    </Card>
  );
}
