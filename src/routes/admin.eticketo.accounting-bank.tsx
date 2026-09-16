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
import { Switch } from "@/components/ui/switch";
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
import { Download, Landmark, Link2, Link2Off, Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import {
  listBankAccounts,
  upsertBankAccount,
  deleteBankAccount,
  listBankTransactions,
  runMatching,
  setTransactionMatch,
  type BankAccountRecord,
} from "@/lib/bank.functions";
import {
  listStatementFormats,
  importStatementFile,
  fetchFromSources,
} from "@/lib/bank-ingest.functions";

export const Route = createFileRoute("/admin/eticketo/accounting-bank")({
  head: () => ({ meta: [{ title: "Účtovanie · výpisy z banky · eticketo.eu Admin" }] }),
  component: Page,
});

const eur = (n: number, c = "EUR") =>
  `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

type AccountForm = {
  id?: string;
  bank_name: string;
  account_name: string;
  iban: string;
  currency: string;
  balance: string;
  connected: boolean;
};

const emptyAccount: AccountForm = {
  bank_name: "",
  account_name: "",
  iban: "",
  currency: "EUR",
  balance: "0",
  connected: false,
};

function Page() {
  const qc = useQueryClient();
  const fetchAccounts = useServerFn(listBankAccounts);
  const saveAccount = useServerFn(upsertBankAccount);
  const removeAccount = useServerFn(deleteBankAccount);
  const fetchTransactions = useServerFn(listBankTransactions);
  const autoMatch = useServerFn(runMatching);
  const setMatch = useServerFn(setTransactionMatch);

  const [editing, setEditing] = useState<AccountForm | null>(null);
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "matched" | "unmatched">("all");

  const accounts = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: () => fetchAccounts({ data: undefined as never }),
  });

  const transactions = useQuery({
    queryKey: ["bank-transactions", accountFilter, statusFilter],
    queryFn: () =>
      fetchTransactions({
        data: {
          account_id: accountFilter === "all" ? undefined : accountFilter,
          status: statusFilter,
        },
      }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["bank-accounts"] });
    qc.invalidateQueries({ queryKey: ["bank-transactions"] });
    qc.invalidateQueries({ queryKey: ["bank-report"] });
  };

  const saveMutation = useMutation({
    mutationFn: (f: AccountForm) =>
      saveAccount({
        data: {
          id: f.id,
          bank_name: f.bank_name,
          account_name: f.account_name,
          iban: f.iban,
          currency: f.currency,
          balance: Number(f.balance) || 0,
          connected: f.connected,
        },
      }),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      toast.success("Účet uložený");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeAccount({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Účet zmazaný aj s pohybmi");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo"),
  });

  const matchMutation = useMutation({
    mutationFn: () =>
      autoMatch({ data: { account_id: accountFilter === "all" ? undefined : accountFilter } }),
    onSuccess: (r) => {
      invalidate();
      if (r.spracovanych === 0) {
        toast.info("Žiadne pohyby nečakali na spárovanie.");
        return;
      }
      const casti = [`spárovaných ${r.sparovanych}`];
      if (r.dokoncenychObjednavok > 0)
        casti.push(`dokončených objednávok ${r.dokoncenychObjednavok}`);
      if (r.naKontrolu > 0) casti.push(`na kontrolu ${r.naKontrolu}`);
      if (r.zalozenychVrateni > 0) casti.push(`na vrátenie ${r.zalozenychVrateni}`);
      if (r.chyb > 0) casti.push(`chýb ${r.chyb}`);
      toast.success(`Z ${r.spracovanych} pohybov: ${casti.join(", ")}.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Párovanie zlyhalo"),
  });

  const unmatchMutation = useMutation({
    mutationFn: (id: string) => setMatch({ data: { transaction_id: id, order_id: null } }),
    onSuccess: () => {
      invalidate();
      toast.success("Spárovanie zrušené");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmena zlyhala"),
  });

  const accountRows = accounts.data ?? [];
  const txRows = transactions.data ?? [];
  const unmatchedTotal = accountRows.reduce((s, a) => s + a.unmatched_count, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Účtovanie · výpisy z banky
          </h1>
          <p className="text-muted-foreground mt-1">
            Prijaté platby a ich párovanie s objednávkami. Variabilný symbol je ten istý, ktorý ide
            do platobnej brány aj na faktúru.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => matchMutation.mutate()}
            disabled={matchMutation.isPending || unmatchedTotal === 0}
          >
            {matchMutation.isPending ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Wand2 className="size-4 mr-2" />
            )}
            Spárovať automaticky
          </Button>
          <Button
            onClick={() => setEditing({ ...emptyAccount })}
            className="bg-gradient-flame text-primary-foreground shadow-glow"
          >
            <Plus className="size-4 mr-2" /> Pridať účet
          </Button>
        </div>
      </div>

      <UploadCard accounts={accountRows} onHotovo={invalidate} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.isLoading ? (
          <Card className="p-6 bg-card/60 border-border/50 sm:col-span-2 lg:col-span-3 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </Card>
        ) : accountRows.length === 0 ? (
          <Card className="p-8 bg-card/60 border-dashed sm:col-span-2 lg:col-span-3 text-center text-muted-foreground">
            Zatiaľ žiadny bankový účet. Pridaj prvý tlačidlom hore.
          </Card>
        ) : (
          accountRows.map((a: BankAccountRecord) => (
            <Card key={a.id} className="p-4 bg-card/60 border-border/50">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    <Landmark className="size-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{a.bank_name}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{a.account_name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground mt-1">{a.iban}</div>
                </div>
                <Badge variant={a.connected ? "default" : "outline"} className="text-[10px]">
                  {a.connected ? "pripojený" : "ručne"}
                </Badge>
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="font-display text-xl font-bold">{eur(a.balance, a.currency)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {a.transactions_count} pohybov
                    {a.unmatched_count > 0 && ` · ${a.unmatched_count} nespárovaných`}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setEditing({
                        id: a.id,
                        bank_name: a.bank_name,
                        account_name: a.account_name,
                        iban: a.iban ?? "",
                        currency: a.currency,
                        balance: String(a.balance),
                        connected: a.connected,
                      })
                    }
                  >
                    Upraviť
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Zmazať účet ${a.iban ?? a.psp_key} aj so všetkými pohybmi?`)) {
                        deleteMutation.mutate(a.id);
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={accountFilter} onValueChange={setAccountFilter}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Všetky účty" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Všetky účty</SelectItem>
            {accountRows.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.bank_name} · {(a.iban ?? a.psp_key ?? "").slice(-6)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Všetky pohyby</SelectItem>
            <SelectItem value="unmatched">Nespárované</SelectItem>
            <SelectItem value="matched">Spárované</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{txRows.length} pohybov</span>
      </div>

      <Card className="bg-card/60 border-border/50 overflow-x-auto">
        {transactions.isLoading ? (
          <div className="p-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : txRows.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            Žiadne pohyby. Naimportuj výpis alebo pripoj účet k banke.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Dátum</th>
                <th className="px-4 py-3 font-medium">Protistrana</th>
                <th className="px-4 py-3 font-medium">VS</th>
                <th className="px-4 py-3 font-medium text-right">Suma</th>
                <th className="px-4 py-3 font-medium">Párovanie</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {txRows.map((t) => (
                <tr key={t.id} className="border-b border-border/30 last:border-0">
                  <td className="px-4 py-3 text-xs text-muted-foreground">{t.booked_at}</td>
                  <td className="px-4 py-3">
                    <div className="truncate max-w-[240px]">{t.counterparty_name || "—"}</div>
                    {t.message && (
                      <div className="text-xs text-muted-foreground truncate max-w-[240px]">
                        {t.message}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{t.variable_symbol || "—"}</td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums font-medium ${
                      t.amount < 0 ? "text-destructive" : ""
                    }`}
                  >
                    {eur(t.amount, t.currency)}
                  </td>
                  <td className="px-4 py-3">
                    {t.status === "matched" ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <Link2 className="size-3.5" />
                        <span className="font-mono text-xs">{t.matched_order_short}</span>
                      </span>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        nespárované
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {t.status === "matched" && (
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Zrušiť spárovanie"
                          onClick={() => unmatchMutation.mutate(t.id)}
                        >
                          <Link2Off className="size-3.5" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Upraviť účet" : "Nový bankový účet"}</DialogTitle>
            <DialogDescription>
              Pohyby sa dajú importovať z výpisu; automatické sťahovanie z banky zatiaľ nie je
              napojené.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Banka</Label>
                <Input
                  autoFocus
                  value={editing.bank_name}
                  onChange={(e) => setEditing({ ...editing, bank_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Názov účtu</Label>
                <Input
                  value={editing.account_name}
                  onChange={(e) => setEditing({ ...editing, account_name: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>IBAN</Label>
                <Input
                  value={editing.iban}
                  onChange={(e) => setEditing({ ...editing, iban: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Mena</Label>
                <Input
                  maxLength={3}
                  value={editing.currency}
                  onChange={(e) => setEditing({ ...editing, currency: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Zostatok</Label>
                <Input
                  type="number"
                  step={0.01}
                  value={editing.balance}
                  onChange={(e) => setEditing({ ...editing, balance: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Napojený na banku</Label>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={editing.connected}
                    onCheckedChange={(v) => setEditing({ ...editing, connected: v })}
                  />
                  <span className="text-xs text-muted-foreground">
                    Len príznak pre prehľad — sťahovanie pohybov zatiaľ beží ručne.
                  </span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Zrušiť
            </Button>
            <Button
              onClick={() => editing && saveMutation.mutate(editing)}
              disabled={
                saveMutation.isPending ||
                !editing?.bank_name.trim() ||
                !editing?.account_name.trim() ||
                !editing?.iban.trim()
              }
            >
              {saveMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Uložiť
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Nahratie mesačného výpisu.
 *
 * Formát vyberá účtovník ručne a kontroluje sa obsah, nie prípona názvu —
 * podstrčený súbor s inou príponou tak parser aj tak neprijme.
 */
function UploadCard({
  accounts,
  onHotovo,
}: {
  accounts: BankAccountRecord[];
  onHotovo: () => void;
}) {
  const nacitajFormaty = useServerFn(listStatementFormats);
  const nahraj = useServerFn(importStatementFile);
  const stiahni = useServerFn(fetchFromSources);

  const [ucet, setUcet] = useState<string>("");
  const [format, setFormat] = useState<string>("");
  const [subor, setSubor] = useState<File | null>(null);

  const formaty = useQuery({
    queryKey: ["statement-formats"],
    queryFn: () => nacitajFormaty({ data: undefined as never }),
  });

  const nahratie = useMutation({
    mutationFn: async () => {
      if (!ucet) throw new Error("Vyber účet, na ktorý výpis patrí.");
      if (!format) throw new Error("Vyber formát výpisu.");
      if (!subor) throw new Error("Vyber súbor s výpisom.");
      const buffer = await subor.arrayBuffer();
      // Prevod po blokoch — `String.fromCharCode(...pole)` by pri veľkom
      // súbore prepísal zásobník volaní.
      const bajty = new Uint8Array(buffer);
      let binarne = "";
      for (let i = 0; i < bajty.length; i += 8192) {
        binarne += String.fromCharCode(...bajty.subarray(i, i + 8192));
      }
      return nahraj({
        data: {
          account_id: ucet,
          format,
          file_name: subor.name,
          content_base64: btoa(binarne),
        },
      });
    },
    onSuccess: (r) => {
      onHotovo();
      setSubor(null);
      const casti = [`prečítaných ${r.transakcii}`, `nových ${r.novych}`];
      if (r.parovanie.dokoncenychObjednavok > 0) {
        casti.push(`dokončených objednávok ${r.parovanie.dokoncenychObjednavok}`);
      }
      if (r.parovanie.naKontrolu > 0) casti.push(`na kontrolu ${r.parovanie.naKontrolu}`);
      toast.success(`Výpis nahratý: ${casti.join(", ")}.`);
      if (r.chyb > 0) {
        toast.warning(`${r.chyb} riadkov sa nepodarilo prečítať: ${r.chyby[0] ?? ""}`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Nahratie zlyhalo"),
  });

  const stiahnutie = useMutation({
    mutationFn: () => stiahni({ data: undefined as never }),
    onSuccess: (r) => {
      onHotovo();
      if (r.stiahnute.zdrojov === 0) {
        toast.info("Nie je nastavený žiadny zdroj so sťahovaním cez API.");
        return;
      }
      toast.success(
        `Zo ${r.stiahnute.zdrojov} zdrojov pribudlo ${r.stiahnute.novych} pohybov` +
          (r.stiahnute.chyb > 0 ? `, ${r.stiahnute.chyb} zlyhalo.` : "."),
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Sťahovanie zlyhalo"),
  });

  return (
    <Card className="bg-card/60 border-border/50 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-semibold">Nahrať výpis</h2>
          <p className="text-muted-foreground text-xs mt-1">
            Pohyby sa uložia a rovno sa skúsi párovanie. Ten istý súbor sa dá nahrať opakovane —
            pohyby sa nezdvoja.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => stiahnutie.mutate()}
          disabled={stiahnutie.isPending}
        >
          {stiahnutie.isPending ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Download className="size-4 mr-2" />
          )}
          Stiahnuť cez API
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-sm">Účet</Label>
          <Select value={ucet} onValueChange={setUcet}>
            <SelectTrigger>
              <SelectValue placeholder="Vyber účet" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.bank_name} · {(a.iban ?? a.psp_key ?? "").slice(-6)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Formát</Label>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger>
              <SelectValue placeholder="Vyber formát" />
            </SelectTrigger>
            <SelectContent>
              {(formaty.data ?? []).map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.nazov}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Súbor</Label>
          <Input
            type="file"
            accept=".xml,.csv,.txt"
            onChange={(e) => setSubor(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => nahratie.mutate()} disabled={nahratie.isPending}>
          {nahratie.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
          Nahrať
        </Button>
      </div>
    </Card>
  );
}
