import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listOrderNotes } from "@/lib/order-notes.functions";
import { plural } from "@/lib/plural";
import { OrderNotesDialog, type OrderNotesTarget } from "@/components/admin/OrderNotesDialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, StickyNote, Search, Pin } from "lucide-react";

export const Route = createFileRoute("/admin/sales/notes")({
  head: () => ({ meta: [{ title: "Poznámky · vipky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const fetchNotes = useServerFn(listOrderNotes);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [target, setTarget] = useState<OrderNotesTarget | null>(null);

  const q = useQuery({
    queryKey: ["order-notes", "all", applied],
    queryFn: () => fetchNotes({ data: { search: applied || null } }),
  });

  const notes = q.data ?? [];
  const pinned = notes.filter((n) => n.pinned).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Poznámky</h1>
        <p className="text-muted-foreground mt-1">
          Interné poznámky k objednávkam — telefonáty, dohody, sľúbené refundy. Zákazník ich nikdy
          nevidí. Nová poznámka sa pridáva pri objednávke v{" "}
          <Link to="/admin/sales/sales" className="text-primary hover:underline">
            Predaji
          </Link>
          .
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Hľadať v texte, zákazníkovi, podujatí…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setApplied(search)}
            onBlur={() => setApplied(search)}
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {notes.length} {plural(notes.length, "poznámka", "poznámky", "poznámok")}
          {pinned > 0 && ` · ${pinned} ${plural(pinned, "pripnutá", "pripnuté", "pripnutých")}`}
        </div>
      </div>

      {q.isLoading ? (
        <Card className="p-10 text-center bg-card/60 border-border/50">
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        </Card>
      ) : notes.length === 0 ? (
        <Card className="p-12 text-center bg-card/60 border-dashed">
          <StickyNote className="mx-auto size-6 text-muted-foreground mb-2" />
          <div className="font-semibold">
            {applied ? "Nič nezodpovedá hľadaniu" : "Zatiaľ žiadne poznámky"}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {applied
              ? "Skús iné slovo."
              : "Poznámku pridáš pri objednávke v Predaji — tlačidlom Poznámky."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <Card
              key={n.id}
              className={`p-4 cursor-pointer transition-colors hover:border-primary/40 ${
                n.pinned ? "border-primary/40 bg-primary/5" : "bg-card/60 border-border/50"
              }`}
              onClick={() =>
                setTarget({
                  order_id: n.order_id,
                  subtitle: `#${n.order_short} · ${n.customer_name || n.customer_email || "—"} · ${
                    n.event_title ?? "—"
                  }`,
                })
              }
            >
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm whitespace-pre-line flex-1">{n.body}</p>
                {n.pinned && (
                  <Badge variant="outline" className="text-[10px] gap-1 shrink-0">
                    <Pin className="size-2.5" /> pripnuté
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-muted-foreground">
                <span className="font-mono">#{n.order_short}</span>
                <span>·</span>
                <span>{n.customer_name || n.customer_email || "—"}</span>
                <span>·</span>
                <span className="truncate max-w-[220px]">{n.event_title ?? "—"}</span>
                <span>·</span>
                <span>{n.author_name || "—"}</span>
                <span>·</span>
                <span>{new Date(n.created_at).toLocaleString("sk-SK")}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="text-right">
        <Button asChild variant="outline">
          <Link to="/admin/sales/sales">Prejsť do Predaja</Link>
        </Button>
      </div>

      <OrderNotesDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
