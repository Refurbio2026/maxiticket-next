import { useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Wallet, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateApplePass } from "@/lib/wallet-db";
import { getGoogleWalletSaveLink } from "@/lib/wallet.functions";
import type { IssuedTicket } from "@/lib/ticketing-db";

// Optional event context so the wallet pass shows title / date / venue.
export type WalletEventInfo = {
  title?: string;
  event_date?: string;
  event_time?: string;
  venue?: string;
  city?: string;
};

type Props = {
  ticket: IssuedTicket;
  /** @deprecated Údaje na pass si server ťahá z databázy; prop sa ignoruje. */
  event?: WalletEventInfo;
  size?: "default" | "sm";
  compact?: boolean;
};

export function AppleWalletButton({ ticket, size = "default", compact }: Props) {
  const [loading, setLoading] = useState(false);
  const click = async () => {
    setLoading(true);
    const res = await generateApplePass(ticket);
    setLoading(false);
    if (res.ok) {
      window.location.href = res.url;
    } else {
      toast.info(res.message);
    }
  };
  return (
    <Button
      onClick={click}
      disabled={loading}
      size={size}
      className="gap-2 bg-black text-white hover:bg-black/90 border border-black/40"
      aria-label="Pridať do Apple Wallet"
    >
      <Smartphone className="size-4" />
      {compact ? "Apple Wallet" : "Pridať do Apple Wallet"}
    </Button>
  );
}

export function GoogleWalletButton({ ticket, size = "default", compact }: Props) {
  const [loading, setLoading] = useState(false);
  const buildLink = useServerFn(getGoogleWalletSaveLink);

  const click = async () => {
    setLoading(true);
    try {
      // Posielame len QR kód vstupenky — server si podľa neho dohľadá podujatie,
      // sedadlo aj meno držiteľa v databáze a podpíše pass z overených údajov.
      const res = await buildLink({
        data: {
          qrValue: ticket.qr_code,
          originUrl: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      if (res.ok) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        toast.info(res.message);
      }
    } catch {
      toast.error("Google Wallet: generovanie zlyhalo, skús to znova.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={click}
      disabled={loading}
      size={size}
      variant="outline"
      className="gap-2 border-border/60"
      aria-label="Pridať do Google Wallet"
    >
      <Wallet className="size-4" />
      {compact ? "Google Wallet" : "Pridať do Google Wallet"}
    </Button>
  );
}
