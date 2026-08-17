// Stiahnutie pokladničného dokladu k jednej POS objednávke.
//
// Doklad sa generuje až na požiadanie a odkladá k objednávke, takže druhé
// stiahnutie je už len čítanie z databázy. Pri stornovanom predaji si ho
// pýtame nanovo — uložená verzia je ešte spred storna a chýbala by na nej
// pečiatka „STORNOVANÝ DOKLAD".
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getReceiptDocument } from "@/lib/pos-documents.functions";
import { downloadBase64 } from "@/lib/download";

export function ReceiptDownloadButton({
  orderId,
  status,
  label,
}: {
  orderId: string;
  status?: string;
  label?: string;
}) {
  const fetchReceipt = useServerFn(getReceiptDocument);
  const [busy, setBusy] = useState(false);

  const stiahni = async () => {
    setBusy(true);
    try {
      const doc = await fetchReceipt({
        data: { order_id: orderId, refresh: status !== undefined && status !== "paid" },
      });
      downloadBase64(doc.filename, doc.base64);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Doklad sa nepodarilo vytvoriť");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={stiahni} title="Stiahnuť doklad">
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      {label && <span className="ml-1.5">{label}</span>}
    </Button>
  );
}
