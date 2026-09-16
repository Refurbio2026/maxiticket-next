// Nespárované platby — obrazovka supportu.
//
// Sem padá všetko, čo párovací engine nevyriešil sám: nedoplatky, platby na
// zrušené objednávky, platby bez variabilného symbolu. V starom systéme to bol
// zoznam, ktorý sa pri každom zobrazení sám prepisoval (označoval platby ako
// náklad) a všetky akcie viedli cez GET odkazy bez záznamu o tom, kto ich urobil.
//
// Tu je každá akcia POST serverová funkcia, pri zmene VS a pri „náklade" je
// dôvod povinný a všetko sa zapíše do auditu.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Ban, Hash, Link2, Loader2, Search, Ticket, Wand2 } from "lucide-react";
import {
  listBankAccounts,
  listNeedsReview,
  runMatching,
  changeTransactionVs,
  ignoreTransaction,
  setTransactionMatch,
  completeOrderFromTransaction,
  searchOrdersForMatching,
  type BankTransactionRecord,
} from "@/lib/bank.functions";

export const Route = createFileRoute("/admin/eticketo/bank-unmatched")({
  head: () => ({ meta: [{ title: "Nespárované platby · eticketo.eu Admin" }] }),
  component: Page,
});

const eur = (n: number, c = "EUR") =>
  `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

const den = (iso: string) => new Date(iso).toLocaleDateString("sk-SK");

/** Prečo to nejde samo — v reči človeka, nie kódu. */
const DOVODY: Record<string, { text: string; tón: "vážne" | "mierne" }> = {
  underpaid: { text: "Nedoplatok — vstupenky sa nevydali", tón: "vážne" },
  overpaid: { text: "Preplatok", tón: "mierne" },
  already_paid: { text: "Objednávka už bola zaplatená", tón: "vážne" },
  seats_unavailable: { text: "Sedadlá už patria inej objednávke", tón: "vážne" },
  reservation_cancelled: { text: "Objednávka je zrušená", tón: "vážne" },
  currency_mismatch: { text: "Nesedí mena", tón: "vážne" },
  no_vs: { text: "Chýba variabilný symbol", tón: "mierne" },
  no_match: { text: "Nenašla sa objednávka", tón: "mierne" },
  chargeback: { text: "Chargeback", tón: "vážne" },
  dkim_fail: { text: "Neoverený zdroj", tón: "vážne" },
};

type Akcia = "vs" | "naklad" | "priradit" | "vstupenky";

function Page() {
  const qc = useQueryClient();
  const fetchAccounts = useServerFn(listBankAccounts);
  const fetchRows = useServerFn(listNeedsReview);
  const match = useServerFn(runMatching);
  const zmenVs = useServerFn(changeTransactionVs);
  const naNaklad = useServerFn(ignoreTransaction);
  const priradit = useServerFn(setTransactionMatch);
  const dokoncit = useServerFn(completeOrderFromTransaction);
  const hladajObjednavky = useServerFn(searchOrdersForMatching);

  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [dialog, setDialog] = useState<{ akcia: Akcia; tx: BankTransactionRecord } | null>(null);
  const [vs, setVs] = useState("");
  const [dovod, setDovod] = useState("");
  const [hladane, setHladane] = useState("");
  const [vybranaObjednavka, setVybranaObjednavka] = useState<string | null>(null);

  const accounts = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: () => fetchAccounts({ data: undefined as never }),
  });

  const rows = useQuery({
    queryKey: ["bank-needs-review", accountFilter],
    queryFn: () =>
      fetchRows({
        data: { account_id: accountFilter === "all" ? undefined : accountFilter, limit: 200 },
      }),
  });

  const najdene = useQuery({
    queryKey: ["orders-for-matching", hladane],
    queryFn: () => hladajObjednavky({ data: { query: hladane } }),
    enabled: hladane.trim().length >= 3,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["bank-needs-review"] });
    qc.invalidateQueries({ queryKey: ["bank-accounts"] });
    qc.invalidateQueries({ queryKey: ["bank-transactions"] });
  };

  const zavri = () => {
    setDialog(null);
    setVs("");
    setDovod("");
    setHladane("");
    setVybranaObjednavka(null);
  };

  const matchMutation = useMutation({
    mutationFn: () =>
      match({ data: { account_id: accountFilter === "all" ? undefined : accountFilter } }),
    onSuccess: (r) => {
      invalidate();
      toast.success(
        `Prešlo ${r.spracovanych} pohybov · spárovaných ${r.sparovanych} · ` +
          `dokončených objednávok ${r.dokoncenychObjednavok} · na kontrolu ${r.naKontrolu}`,
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Párovanie zlyhalo"),
  });

  const akciaMutation = useMutation({
    mutationFn: async () => {
      if (!dialog) throw new Error("Chýba platba");
      const id = dialog.tx.id;
      if (dialog.akcia === "vs")
        return zmenVs({ data: { transaction_id: id, variable_symbol: vs, reason: dovod } });
      if (dialog.akcia === "naklad")
        return naNaklad({ data: { transaction_id: id, reason: dovod } });
      if (!vybranaObjednavka) throw new Error("Vyber objednávku");
      if (dialog.akcia === "priradit") {
        return priradit({
          data: { transaction_id: id, order_id: vybranaObjednavka, reason: dovod },
        });
      }
      return dokoncit({
        data: { transaction_id: id, order_id: vybranaObjednavka, reason: dovod },
      });
    },
    onSuccess: () => {
      invalidate();
      toast.success("Hotovo");
      zavri();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Akcia zlyhala"),
  });

  const zoznam = rows.data ?? [];
  const mapaUctov = new Map((accounts.data ?? []).map((a) => [a.id, a]));

  // Pri zmene VS a náklade je dôvod povinný — mení sa tým rozhodnutie
  // o peniazoch a bez zdôvodnenia by sa nedalo spätne pochopiť.
  const dovodPovinny = dialog?.akcia === "vs" || dialog?.akcia === "naklad";
  const mozeOdoslat =
    !!dialog &&
    (!dovodPovinny || dovod.trim().length >= 3) &&
    (dialog.akcia !== "vs" || vs.trim().length > 0) &&
    (dialog.akcia === "vs" || dialog.akcia === "naklad" || !!vybranaObjednavka);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Nespárované platby</h1>
          <p className="text-sm text-muted-foreground">
            Platby, ktoré párovanie nevyriešilo samo. Každý zásah sa zapisuje do auditu.
          </p>
        </div>
        <Button onClick={() => matchMutation.mutate()} disabled={matchMutation.isPending}>
          {matchMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Wand2 className="size-4" />
          )}
          Skúsiť spárovať znova
        </Button>
      </div>

      <Select value={accountFilter} onValueChange={setAccountFilter}>
        <SelectTrigger className="w-72">
          <SelectValue placeholder="Všetky účty" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Všetky účty</SelectItem>
          {(accounts.data ?? []).map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.bank_name} · {(a.iban ?? a.psp_key ?? "").slice(-6)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {rows.isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 size-5 animate-spin" />
          Načítavam…
        </Card>
      ) : zoznam.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Žiadna platba nečaká na kontrolu.
        </Card>
      ) : (
        <div className="space-y-3">
          {zoznam.map((t) => {
            const ucet = mapaUctov.get(t.account_id);
            const dovodZaznamu = t.review_reason ? DOVODY[t.review_reason] : undefined;
            return (
              <Card key={t.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold">{eur(t.amount, t.currency)}</span>
                      <span className="text-sm text-muted-foreground">{den(t.booked_at)}</span>
                      {dovodZaznamu && (
                        <Badge variant={dovodZaznamu.tón === "vážne" ? "destructive" : "secondary"}>
                          {dovodZaznamu.text}
                        </Badge>
                      )}
                      {t.status === "parse_error" && (
                        <Badge variant="destructive">Chyba zdroja</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {ucet ? `${ucet.bank_name} · ` : ""}
                      VS {t.vs_normalized ?? "—"}
                      {t.counterparty_name ? ` · ${t.counterparty_name}` : ""}
                      {t.counterparty_iban ? ` · ${t.counterparty_iban}` : ""}
                    </div>
                    {t.message && <div className="text-sm">{t.message}</div>}
                    {t.note && <div className="text-xs text-muted-foreground">{t.note}</div>}
                    {t.matched_order_short && (
                      <div className="text-xs">
                        Navrhovaná objednávka: <strong>{t.matched_order_short}</strong>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDialog({ akcia: "vstupenky", tx: t });
                        setVybranaObjednavka(t.matched_order_id);
                      }}
                    >
                      <Ticket className="size-3.5" />
                      Vydať vstupenky
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDialog({ akcia: "priradit", tx: t })}
                    >
                      <Link2 className="size-3.5" />
                      Priradiť
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDialog({ akcia: "vs", tx: t });
                        setVs(t.variable_symbol ?? "");
                      }}
                    >
                      <Hash className="size-3.5" />
                      Zmeniť VS
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDialog({ akcia: "naklad", tx: t })}
                    >
                      <Ban className="size-3.5" />
                      Náklad
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!dialog} onOpenChange={(o) => !o && zavri()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialog?.akcia === "vs" && "Zmeniť variabilný symbol"}
              {dialog?.akcia === "naklad" && "Vybaviť ako náklad"}
              {dialog?.akcia === "priradit" && "Priradiť objednávku"}
              {dialog?.akcia === "vstupenky" && "Vydať vstupenky z tejto platby"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.akcia === "vs" &&
                "Mení sa tým, ku ktorej objednávke platba patrí. Po uložení sa platba rovno preparuje."}
              {dialog?.akcia === "naklad" &&
                "Platba zmizne zo zoznamu bez spárovania — poplatok, výplata alebo mylná platba."}
              {dialog?.akcia === "priradit" &&
                "Označí platbu za patriacu objednávke. Vstupenky sa tým nevydajú."}
              {dialog?.akcia === "vstupenky" &&
                "Objednávka sa dokončí a vstupenky odídu zákazníkovi. Použi po doplatku alebo po dohode s kupujúcim."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {dialog && (
              <div className="rounded-md border p-3 text-sm">
                <strong>{eur(dialog.tx.amount, dialog.tx.currency)}</strong> ·{" "}
                {den(dialog.tx.booked_at)} · VS {dialog.tx.vs_normalized ?? "—"}
              </div>
            )}

            {dialog?.akcia === "vs" && (
              <div className="space-y-1.5">
                <Label>Nový variabilný symbol</Label>
                <Input
                  value={vs}
                  onChange={(e) => setVs(e.target.value)}
                  placeholder="0015501234"
                />
              </div>
            )}

            {(dialog?.akcia === "priradit" || dialog?.akcia === "vstupenky") && (
              <div className="space-y-1.5">
                <Label>Objednávka</Label>
                <div className="flex items-center gap-2">
                  <Search className="size-4 text-muted-foreground" />
                  <Input
                    value={hladane}
                    onChange={(e) => setHladane(e.target.value)}
                    placeholder="Variabilný symbol alebo e-mail zákazníka"
                  />
                </div>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {(najdene.data ?? []).map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setVybranaObjednavka(o.id)}
                      className={`w-full rounded-md border p-2 text-left text-sm ${
                        vybranaObjednavka === o.id ? "border-primary bg-accent" : ""
                      }`}
                    >
                      <div className="font-medium">
                        {o.customer} · {eur(o.total, o.currency)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        VS {o.vs ?? "—"} · {o.status}
                      </div>
                    </button>
                  ))}
                  {hladane.trim().length >= 3 && (najdene.data ?? []).length === 0 && (
                    <div className="p-2 text-sm text-muted-foreground">Nič sa nenašlo.</div>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>
                Dôvod {dovodPovinny ? <span className="text-destructive">*</span> : "(nepovinný)"}
              </Label>
              <Textarea
                value={dovod}
                onChange={(e) => setDovod(e.target.value)}
                rows={3}
                placeholder="Prečo sa to robí — uvidí to ten, kto bude platbu riešiť po tebe."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={zavri}>
              Zrušiť
            </Button>
            <Button
              onClick={() => akciaMutation.mutate()}
              disabled={!mozeOdoslat || akciaMutation.isPending}
            >
              {akciaMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              Potvrdiť
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
