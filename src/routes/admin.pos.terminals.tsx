import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getDevices, POS_EVENT, type PosDevice } from "@/lib/pos-db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Usb } from "lucide-react";

export const Route = createFileRoute("/admin/pos/terminals")({
  head: () => ({ meta: [{ title: "Terminály · Admin" }] }),
  component: AdminPosTerminalsPage,
});

function AdminPosTerminalsPage() {
  const [list, setList] = useState<PosDevice[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setList(getDevices());
  }, [tick]);
  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener(POS_EVENT, h);
    return () => window.removeEventListener(POS_EVENT, h);
  }, []);
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Platobné terminály (USB)</h1>
      <p className="text-sm text-muted-foreground">
        Mock prehľad. Reálne napojenie cez WebUSB / bridge daemon poskytovateľa.
      </p>
      <Card className="p-5 bg-card/60 border-border/50">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žiadne zariadenia.</p>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((d) => (
              <Card key={d.id} className="p-4 bg-background border-border/50">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-display font-semibold flex items-center gap-2">
                      <Usb className="size-4" /> {d.name}
                    </div>
                    <div className="text-xs text-muted-foreground">{d.location || "—"}</div>
                    <div className="text-[10px] font-mono text-muted-foreground mt-1">
                      org: {d.organizer_id}
                    </div>
                  </div>
                  <Badge
                    variant={d.terminal_connected ? "default" : "outline"}
                    className="text-[10px]"
                  >
                    {d.terminal_connected ? "Online" : "Offline"}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
