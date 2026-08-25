// Zápis na čakačku, keď je termín vypredaný.
//
// Vypredané inak znamená koniec: zákazník odíde a organizátor sa ani
// nedozvie, že by sa oplatilo pridať termín.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { joinWaitlist } from "@/lib/waitlist.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BellRing, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/error-message";

export function CakackaBox({
  eventId,
  eventDateId,
  className,
}: {
  eventId: string;
  eventDateId: string | null;
  className?: string;
}) {
  const zapis = useServerFn(joinWaitlist);
  const [email, setEmail] = useState("");
  const [pocet, setPocet] = useState("2");
  const [bezi, setBezi] = useState(false);
  const [hotovo, setHotovo] = useState(false);

  const posli = async () => {
    if (!email.trim()) return;
    setBezi(true);
    try {
      const r = await zapis({
        data: {
          event_id: eventId,
          event_date_id: eventDateId,
          email: email.trim(),
          wanted: Math.max(1, Math.min(20, Number(pocet) || 1)),
        },
      });
      setHotovo(true);
      toast.success(
        r.uzZapisany ? "Už si na čakačke, počet sme upravili." : "Sme dohodnutí, dáme vedieť.",
      );
    } catch (e) {
      toast.error(errorMessage(e) || "Zápis zlyhal");
    } finally {
      setBezi(false);
    }
  };

  if (hotovo) {
    return (
      <div
        className={cn(
          "rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm",
          className,
        )}
      >
        <div className="flex gap-2">
          <Check className="size-4 shrink-0 text-emerald-500 mt-0.5" />
          <div>
            <div className="font-medium">Si na čakačke</div>
            <p className="text-muted-foreground mt-1">
              Keď sa vstupenky uvoľnia, napíšeme ti. Píšeme všetkým naraz, takže kto príde prvý, ten
              kúpi.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-md border border-border/50 bg-card/60 p-4", className)}>
      <div className="flex gap-2 mb-3">
        <BellRing className="size-4 shrink-0 text-primary mt-0.5" />
        <div className="text-sm">
          <div className="font-medium">Vypredané — dáme ti vedieť</div>
          <p className="text-muted-foreground mt-1 text-xs">
            Vstupenky sa uvoľňujú, keď niekto stornuje alebo nedoplatí rezerváciu.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="meno@email.sk"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1"
        />
        <Input
          type="number"
          min={1}
          max={20}
          value={pocet}
          onChange={(e) => setPocet(e.target.value)}
          className="w-20"
          aria-label="Počet vstupeniek"
        />
      </div>
      <Button onClick={posli} disabled={bezi || !email.trim()} className="w-full mt-3" size="lg">
        {bezi && <Loader2 className="size-4 mr-2 animate-spin" />}
        Chcem vedieť
      </Button>
    </div>
  );
}
