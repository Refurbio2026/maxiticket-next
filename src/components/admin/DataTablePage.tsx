import { useMemo, useState } from "react";
import {
  Search,
  Filter,
  Download,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Eye,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export type Column = {
  key: string;
  label: string;
  badge?: boolean;
  badgeMap?: Record<string, "primary" | "accent" | "muted" | "destructive" | "success">;
  align?: "left" | "right" | "center";
  mono?: boolean;
};

type Props = {
  title: string;
  subtitle?: string;
  columns: Column[];
  rows: Record<string, string | number>[];
  filters?: string[];
  createLabel?: string;
};

function exportCsv(filename: string, columns: Column[], rows: Record<string, string | number>[]) {
  const header = columns.map((c) => `"${c.label}"`).join(",");
  const body = rows
    .map((r) => columns.map((c) => `"${String(r[c.key] ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename + ".csv";
  a.click();
  URL.revokeObjectURL(url);
}

const badgeClass: Record<string, string> = {
  primary: "bg-primary/15 text-primary border-primary/30",
  accent: "bg-accent/15 text-accent border-accent/30",
  muted: "bg-muted text-muted-foreground border-border",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

export function DataTablePage({
  title,
  subtitle,
  columns,
  rows,
  filters = ["Všetky", "Aktívne", "Čakajúce", "Ukončené"],
  createLabel = "Vytvoriť",
}: Props) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    let out = rows.filter((r) =>
      !q ? true : Object.values(r).some((v) => String(v).toLowerCase().includes(q)),
    );
    if (sortKey) {
      out = [...out].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = String(av).localeCompare(String(bv), "sk", { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, query, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-6">
      {/*
        Tento komponent používa výhradne 29 admin stránok postavených nad
        generovanými dátami z `admin-mock.ts`. Kým sa nenapoja na databázu,
        musí byť na prvý pohľad zrejmé, že čísla nie sú skutočné — inak im
        človek uverí a spraví podľa nich rozhodnutie.
        Až budú dáta reálne, zmaž tento banner spolu s `admin-mock.ts`.
      */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <p className="text-sm text-amber-900 dark:text-amber-200">
          <span className="font-semibold">Ukážkové dáta.</span> Táto sekcia zatiaľ nie je napojená
          na databázu — čísla aj riadky sú vygenerované a nezodpovedajú skutočnej prevádzke.
        </p>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              exportCsv(title, columns, filtered);
              toast.success("Export CSV pripravený");
            }}
          >
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button
            size="sm"
            className="bg-gradient-flame text-primary-foreground hover:opacity-90"
            onClick={() => toast.info("Otvorí sa formulár vytvorenia")}
          >
            <Plus className="mr-2 h-4 w-4" /> {createLabel}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border/50 bg-card shadow-card-premium">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/40 p-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Vyhľadať…"
              className="h-9 pl-9 bg-muted/30 border-border/50"
            />
          </div>
          <Select defaultValue={filters[0]}>
            <SelectTrigger className="h-9 w-[160px] bg-muted/30 border-border/50">
              <Filter className="mr-2 h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {filters.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="outline" className="ml-auto text-xs">
            {filtered.length} záznamov
          </Badge>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border/40 hover:bg-transparent">
                {columns.map((c) => (
                  <TableHead
                    key={c.key}
                    className={`text-xs font-semibold uppercase tracking-wider text-muted-foreground ${
                      c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""
                    }`}
                  >
                    <button
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => {
                        if (sortKey === c.key) setSortDir(sortDir === "asc" ? "desc" : "asc");
                        else {
                          setSortKey(c.key);
                          setSortDir("asc");
                        }
                      }}
                    >
                      {c.label}
                      <ArrowUpDown className="h-3 w-3 opacity-50" />
                    </button>
                  </TableHead>
                ))}
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length + 1}
                    className="h-32 text-center text-sm text-muted-foreground"
                  >
                    Žiadne výsledky
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((row, idx) => (
                  <TableRow key={idx} className="border-border/30 hover:bg-muted/30">
                    {columns.map((c) => {
                      const v = row[c.key];
                      const cls =
                        c.align === "right"
                          ? "text-right"
                          : c.align === "center"
                            ? "text-center"
                            : "";
                      if (c.badge) {
                        const tone = c.badgeMap?.[String(v)] ?? "muted";
                        return (
                          <TableCell key={c.key} className={cls}>
                            <Badge
                              variant="outline"
                              className={`${badgeClass[tone]} text-xs font-medium`}
                            >
                              {v}
                            </Badge>
                          </TableCell>
                        );
                      }
                      return (
                        <TableCell
                          key={c.key}
                          className={`${cls} ${c.mono ? "font-mono text-xs" : "text-sm"}`}
                        >
                          {v}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => toast.info("Otvoriť detail")}>
                            <Eye className="mr-2 h-4 w-4" /> Detail
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toast.info("Upraviť záznam")}>
                            <Pencil className="mr-2 h-4 w-4" /> Upraviť
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => toast.error("Záznam zmazaný")}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Zmazať
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between border-t border-border/40 p-4">
          <div className="text-xs text-muted-foreground">
            Strana {page} z {pageCount}
          </div>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
