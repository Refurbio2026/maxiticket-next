import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Landmark, RefreshCw, Plug, Download, Link2, Eye } from "lucide-react";
import { toast } from "sonner";
import {
  listAccounts, listTransactions, connectTatraBanka, syncAccount,
  manualMatch, exportCsv, exportXlsx, downloadFile,
  type BankTransaction, type BankAccount, type MatchStatus,
} from "@/lib/bank-db";

export const Route = createFileRoute("/admin/maxiticket/accounting-bank")({
  head: () => ({ meta: [{ title: "Účtovanie · výpisy z banky · vipky.sk" }] }),
  component: Page,
});

function statusBadge(s: MatchStatus) {
  const map: Record<MatchStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    matched: { label: "Spárované", variant: "default" },
    unmatched: { label: "Nespárované", variant: "destructive" },
    pending: { label: "Čaká na kontrolu", variant: "secondary" },
  };
  const v = map[s];
  return <Badge variant={v.variant}>{v.label}</Badge>;
}

function Page() {
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);

  const accounts = useMemo(() => listAccounts(), [tick]);
  const txs = useMemo(() => listTransactions(), [tick]);

  const [filter, setFilter] = useState<"all" | MatchStatus>("all");
  const [query, setQuery] = useState("");
  const [matchTx, setMatchTx] = useState<BankTransaction | null>(null);
  const [orderId, setOrderId] = useState("");
  const [detailTx, setDetailTx] = useState<BankTransaction | null>(null);

  const filtered = txs.filter((t) => {
    if (filter !== "all" && t.matchStatus !== filter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      t.counterpartyName.toLowerCase().includes(q) ||
      t.counterpartyIban.toLowerCase().includes(q) ||
      t.variableSymbol.includes(q) ||
      t.message.toLowerCase().includes(q)
    );
  });

  const handleConnect = () => {
    connectTatraBanka();
    toast.success("Tatra banka pripojená");
    refresh();
  };

  const handleSync = (acc: BankAccount) => {
    const log = syncAccount(acc.id);
    toast.success(`Synchronizácia hotová — pridaných ${log.added} pohybov`);
    refresh();
  };

  const totalUnmatched = txs.filter((t) => t.matchStatus === "unmatched").length;
  const totalToday = txs.filter((t) => new Date(t.date).toDateString() === new Date().toDateString()).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Účtovanie · výpisy z banky</h1>
        <p className="text-sm text-muted-foreground">
          Tatra banka Open Banking — prepojenie účtov, synchronizácia pohybov a párovanie platieb.
        </p>
      </div>

      {/* Accounts */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {accounts.length === 0 && (
          <Card className="md:col-span-2 lg:col-span-3">
            <CardContent className="flex items-center justify-between gap-4 py-6">
              <div className="flex items-center gap-3">
                <Landmark className="h-8 w-8 text-primary" />
                <div>
                  <p className="font-medium">Žiadne pripojené účty</p>
                  <p className="text-sm text-muted-foreground">Pripojte Tatra banka cez Open Banking.</p>
                </div>
              </div>
              <Button onClick={handleConnect}>
                <Plug className="mr-2 h-4 w-4" /> Pripojiť Tatra banka účet
              </Button>
            </CardContent>
          </Card>
        )}
        {accounts.map((a) => (
          <Card key={a.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{a.bankName}</CardTitle>
                  <p className="text-xs text-muted-foreground">{a.accountName}</p>
                </div>
                <Badge variant={a.connected ? "default" : "outline"}>
                  {a.connected ? "Pripojený" : "Odpojený"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="font-mono text-xs">{a.iban}</p>
              <p className="text-2xl font-semibold">
                {a.balance.toLocaleString("sk-SK", { style: "currency", currency: a.currency })}
              </p>
              <p className="text-xs text-muted-foreground">
                Posledná synchronizácia:{" "}
                {a.lastSyncAt ? new Date(a.lastSyncAt).toLocaleString("sk-SK") : "—"}
              </p>
              <Button size="sm" variant="secondary" className="w-full" onClick={() => handleSync(a)}>
                <RefreshCw className="mr-2 h-4 w-4" /> Synchronizovať pohyby
              </Button>
            </CardContent>
          </Card>
        ))}
        {accounts.length > 0 && (
          <Card className="flex items-center justify-center border-dashed">
            <Button variant="ghost" onClick={handleConnect}>
              <Plug className="mr-2 h-4 w-4" /> Pridať ďalší účet
            </Button>
          </Card>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Transakcie</p><p className="text-xl font-semibold">{txs.length}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Dnes</p><p className="text-xl font-semibold">{totalToday}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Nespárované</p><p className="text-xl font-semibold text-destructive">{totalUnmatched}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Účty</p><p className="text-xl font-semibold">{accounts.length}</p></CardContent></Card>
      </div>

      {/* Filters + actions */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">Bankové pohyby</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Hľadať VS, IBAN, meno…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-56"
            />
            {(["all", "matched", "unmatched", "pending"] as const).map((s) => (
              <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)}>
                {s === "all" ? "Všetky" : s === "matched" ? "Spárované" : s === "unmatched" ? "Nespárované" : "Čaká"}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={() => downloadFile(`bank-${Date.now()}.csv`, exportCsv(filtered), "text/csv")}>
              <Download className="mr-2 h-4 w-4" /> CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadFile(`bank-${Date.now()}.xls`, exportXlsx(filtered), "application/vnd.ms-excel")}>
              <Download className="mr-2 h-4 w-4" /> XLSX
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dátum</TableHead>
                  <TableHead className="text-right">Suma</TableHead>
                  <TableHead>Odosielateľ</TableHead>
                  <TableHead>IBAN</TableHead>
                  <TableHead>VS</TableHead>
                  <TableHead>Správa</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead className="text-right">Akcie</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground">Žiadne pohyby. Spustite synchronizáciu.</TableCell></TableRow>
                )}
                {filtered.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs">{new Date(t.date).toLocaleString("sk-SK")}</TableCell>
                    <TableCell className="text-right font-medium">
                      {t.amount.toLocaleString("sk-SK", { style: "currency", currency: t.currency })}
                    </TableCell>
                    <TableCell>{t.counterpartyName}</TableCell>
                    <TableCell className="font-mono text-xs">{t.counterpartyIban}</TableCell>
                    <TableCell className="font-mono text-xs">{t.variableSymbol || "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs">{t.message}</TableCell>
                    <TableCell>{statusBadge(t.matchStatus)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setDetailTx(t)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {t.matchStatus !== "matched" && (
                          <Button size="icon" variant="ghost" onClick={() => { setMatchTx(t); setOrderId(`MT-${t.variableSymbol || ""}`); }}>
                            <Link2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Match dialog */}
      <Dialog open={!!matchTx} onOpenChange={(o) => !o && setMatchTx(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Spárovať objednávku</DialogTitle></DialogHeader>
          {matchTx && (
            <div className="space-y-3 text-sm">
              <p>{matchTx.counterpartyName} — {matchTx.amount.toLocaleString("sk-SK", { style: "currency", currency: matchTx.currency })}</p>
              <Input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Číslo objednávky" />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMatchTx(null)}>Zrušiť</Button>
            <Button onClick={() => {
              if (matchTx && orderId) {
                manualMatch(matchTx.id, orderId);
                toast.success("Platba spárovaná");
                setMatchTx(null);
                refresh();
              }
            }}>Spárovať</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detailTx} onOpenChange={(o) => !o && setDetailTx(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Detail transakcie</DialogTitle></DialogHeader>
          {detailTx && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <span className="text-muted-foreground">Dátum</span><span>{new Date(detailTx.date).toLocaleString("sk-SK")}</span>
                <span className="text-muted-foreground">Suma</span><span>{detailTx.amount.toFixed(2)} {detailTx.currency}</span>
                <span className="text-muted-foreground">Odosielateľ</span><span>{detailTx.counterpartyName}</span>
                <span className="text-muted-foreground">IBAN</span><span className="font-mono text-xs">{detailTx.counterpartyIban}</span>
                <span className="text-muted-foreground">VS</span><span className="font-mono">{detailTx.variableSymbol || "—"}</span>
                <span className="text-muted-foreground">Správa</span><span>{detailTx.message}</span>
                <span className="text-muted-foreground">Stav</span><span>{statusBadge(detailTx.matchStatus)}</span>
                <span className="text-muted-foreground">Objednávka</span><span>{detailTx.matchedOrderId ?? "—"}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
