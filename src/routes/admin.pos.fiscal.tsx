import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, FileText, Receipt } from "lucide-react";

export const Route = createFileRoute("/admin/pos/fiscal")({
  head: () => ({ meta: [{ title: "VRP2 / eKasa · Admin" }] }),
  component: () => (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">VRP2 / eKasa</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Integrácia s pokladničným systémom Finančnej správy SR.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="p-5 bg-card/60 border-border/50">
          <ShieldCheck className="size-6 text-primary mb-3" />
          <div className="font-display font-semibold">Stav integrácie</div>
          <Badge variant="outline" className="mt-2">Mock režim</Badge>
          <p className="text-xs text-muted-foreground mt-3">
            Reálne napojenie sa konfiguruje cez certifikát eKasa a DKP.
          </p>
        </Card>
        <Card className="p-5 bg-card/60 border-border/50">
          <Receipt className="size-6 text-primary mb-3" />
          <div className="font-display font-semibold">Bloky / doklady</div>
          <div className="text-2xl font-bold mt-2">—</div>
          <p className="text-xs text-muted-foreground mt-1">Počet odoslaných eKasa dokladov</p>
        </Card>
        <Card className="p-5 bg-card/60 border-border/50">
          <FileText className="size-6 text-primary mb-3" />
          <div className="font-display font-semibold">Dokumentácia</div>
          <p className="text-xs text-muted-foreground mt-2">
            Adaptér: <span className="font-mono">src/lib/fiscal-adapter.ts</span><br />
            createFiscalReceipt · sendReceiptToFiscalSystem · cancelFiscalReceipt
          </p>
        </Card>
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        <p className="text-xs text-muted-foreground">
          Reálne napojenie doplníme podľa oficiálnej dokumentácie Finančnej správy SR alebo
          poskytovateľa VRP2 / eKasa brány (napr. cez bridge daemon, REST API alebo SDK).
        </p>
      </Card>
    </div>
  ),
});
