import { useState } from "react";
import { toast } from "sonner";
import { Wallet, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateApplePass, generateGoogleWalletLink } from "@/lib/wallet-db";
import type { IssuedTicket } from "@/lib/ticketing-db";

type Props = {
  ticket: IssuedTicket;
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
  const click = async () => {
    setLoading(true);
    const res = await generateGoogleWalletLink(ticket);
    setLoading(false);
    if (res.ok) {
      window.open(res.url, "_blank", "noopener,noreferrer");
    } else {
      toast.info(res.message);
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
