import { createFileRoute } from "@tanstack/react-router";
import { usePosCashiers } from "@/hooks/use-pos";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/pos/cashiers")({
  head: () => ({ meta: [{ title: "Pokladne · Admin" }] }),
  component: AdminPosCashiersPage,
});

function AdminPosCashiersPage() {
  // Bez zadaného organizátora vráti server adminovi pokladníkov všetkých.
  const { data: list = [], isLoading } = usePosCashiers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Pokladne (všetci pokladníci)</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Prehľad pokladníkov naprieč všetkými organizátormi. Zakladá a mení ich organizátor vo
          svojej pokladni.
        </p>
      </div>
      <Card className="p-5 bg-card/60 border-border/50">
        {isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žiadni pokladníci.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2">Meno</th>
                  <th className="text-left">Organizátor</th>
                  <th className="text-left">Stav</th>
                  <th className="text-left">Smena</th>
                  <th className="text-left">Oprávnenia</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="border-b border-border/30">
                    <td className="py-2 font-medium">
                      {c.display_name}
                      <div className="text-xs text-muted-foreground font-normal">
                        {c.first_name} {c.last_name}
                      </div>
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {c.organizer_name || c.organizer_id}
                    </td>
                    <td>
                      {c.status === "active" ? (
                        <Badge>Aktívny</Badge>
                      ) : (
                        <Badge variant="outline">Neaktívny</Badge>
                      )}
                    </td>
                    <td className="text-xs">
                      {c.open_session_id ? (
                        <span className="text-emerald-600 dark:text-emerald-400">otvorená</span>
                      ) : (
                        <span className="text-muted-foreground">zavretá</span>
                      )}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {c.permissions.length} oprávnení
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
