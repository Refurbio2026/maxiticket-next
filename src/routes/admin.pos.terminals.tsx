import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Usb } from "lucide-react";
import { listDevices } from "@/lib/devices.functions";

export const Route = createFileRoute("/admin/pos/terminals")({
  head: () => ({ meta: [{ title: "Terminály · Admin" }] }),
  component: AdminPosTerminalsPage,
});

const TYPE_LABEL: Record<string, string> = {
  terminal: "Platobný terminál",
  printer: "Tlačiareň",
  kiosk: "Predajný kiosk",
  scanner: "Čítačka vstupeniek",
};

function AdminPosTerminalsPage() {
  // Zariadenia sú jeden register (`scanner_devices`) — tu sa z neho ukazuje
  // len to, čo patrí k pokladni. Čítačky nájdeš v Zariadenia / čítačky.
  const fetchDevices = useServerFn(listDevices);
  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: () => fetchDevices({ data: undefined as never }),
  });

  const rows = (devices.data ?? []).filter((d) =>
    ["terminal", "printer", "kiosk"].includes(d.device_type),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Terminály</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Platobné terminály, tlačiarne a kiosky naprieč organizátormi. Pridávajú sa v{" "}
          <Link to="/admin/maxiticket/devices" className="text-primary hover:underline">
            Zariadeniach
          </Link>
          ; samotné spojenie s terminálom je zatiaľ simulované.
        </p>
      </div>

      <Card className="p-5 bg-card/60 border-border/50 overflow-x-auto">
        {devices.isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Žiadny terminál ani tlačiareň.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border/50">
              <tr>
                <th className="text-left py-2">Zariadenie</th>
                <th className="text-left">Typ</th>
                <th className="text-left">Organizátor</th>
                <th className="text-left">Umiestnenie</th>
                <th className="text-left">Sériové číslo</th>
                <th className="text-left">Naposledy</th>
                <th className="text-left">Stav</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b border-border/30">
                  <td className="py-2 font-medium">
                    <span className="inline-flex items-center gap-2">
                      <Usb className="size-3.5 text-muted-foreground" />
                      {d.name}
                    </span>
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {TYPE_LABEL[d.device_type] ?? d.device_type}
                  </td>
                  <td className="text-xs text-muted-foreground">{d.organizer_name ?? "—"}</td>
                  <td className="text-xs text-muted-foreground">{d.location ?? "—"}</td>
                  <td className="font-mono text-xs text-muted-foreground">
                    {d.serial_number ?? "—"}
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString("sk-SK") : "nikdy"}
                  </td>
                  <td>
                    {d.status === "active" ? (
                      <Badge>v prevádzke</Badge>
                    ) : (
                      <Badge variant="outline">vyradený</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
