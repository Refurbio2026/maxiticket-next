import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listSitePages,
  upsertSitePage,
  deleteSitePage,
  type SitePage,
} from "@/lib/site-pages.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Loader2, FileCode, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/data/content")({
  head: () => ({ meta: [{ title: "Obsah / stránky · vipky.sk Admin" }] }),
  component: Page,
});

type Form = {
  id?: string;
  slug: string;
  title: string;
  body: string;
  meta_description: string;
  published: boolean;
  show_in_footer: boolean;
  sort_order: string;
};

const emptyForm: Form = {
  slug: "",
  title: "",
  body: "",
  meta_description: "",
  published: false,
  show_in_footer: true,
  sort_order: "100",
};

function Page() {
  const qc = useQueryClient();
  const fetchPages = useServerFn(listSitePages);
  const savePage = useServerFn(upsertSitePage);
  const removePage = useServerFn(deleteSitePage);

  const [editing, setEditing] = useState<Form | null>(null);

  const pages = useQuery({
    queryKey: ["site-pages"],
    queryFn: () => fetchPages({ data: undefined as never }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["site-pages"] });
    // Pätička webu vypisuje publikované stránky.
    qc.invalidateQueries({ queryKey: ["footer-pages"] });
    qc.invalidateQueries({ queryKey: ["site-page"] });
  };

  const save = useMutation({
    mutationFn: (f: Form) =>
      savePage({
        data: {
          id: f.id,
          slug: f.slug,
          title: f.title,
          body: f.body,
          meta_description: f.meta_description || null,
          published: f.published,
          show_in_footer: f.show_in_footer,
          sort_order: Number(f.sort_order) || 100,
        },
      }),
    onSuccess: (_r, f) => {
      invalidate();
      toast.success(f.id ? "Stránka uložená" : "Stránka vytvorená");
      setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removePage({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Zmazané");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo"),
  });

  const rows = pages.data ?? [];
  const empty = rows.filter((p) => !p.body.trim()).length;

  const toForm = (p: SitePage): Form => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    body: p.body,
    meta_description: p.meta_description ?? "",
    published: p.published,
    show_in_footer: p.show_in_footer,
    sort_order: String(p.sort_order),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Obsah / stránky</h1>
          <p className="text-muted-foreground mt-1">
            Textové stránky verejného webu — O nás, obchodné podmienky, ochrana osobných údajov.
            Publikovaná stránka je dostupná na <code className="text-xs">/p/adresa</code> a objaví
            sa v pätičke.
          </p>
        </div>
        <Button
          className="bg-gradient-flame text-primary-foreground shadow-glow"
          onClick={() => setEditing({ ...emptyForm })}
        >
          <Plus className="size-4 mr-1.5" /> Pridať stránku
        </Button>
      </div>

      {empty > 0 && (
        <Card className="p-4 bg-amber-500/10 border-amber-500/40 text-sm">
          <div className="font-semibold">
            {empty} {empty === 1 ? "stránka čaká" : empty < 5 ? "stránky čakajú" : "stránok čaká"}{" "}
            na text
          </div>
          <p className="text-muted-foreground">
            Obchodné podmienky ani ochranu osobných údajov za teba nikto nenapíše — sú to právne
            dokumenty prevádzkovateľa. Kým sú prázdne, na web sa nedostanú.
          </p>
        </Card>
      )}

      {pages.isLoading ? (
        <Card className="p-10 text-center bg-card/60 border-border/50">
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center bg-card/60 border-dashed">
          <FileCode className="mx-auto size-6 text-muted-foreground mb-2" />
          <div className="font-semibold">Žiadne stránky</div>
        </Card>
      ) : (
        <Card className="bg-card/60 border-border/50 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="text-left p-3">Názov</th>
                <th className="text-left p-3">Adresa</th>
                <th className="text-left p-3">Stav</th>
                <th className="text-right p-3">Poradie</th>
                <th className="text-left p-3">Upravené</th>
                <th className="text-right p-3">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-border/20 hover:bg-muted/10">
                  <td className="p-3 font-medium">{p.title}</td>
                  <td className="p-3 font-mono text-xs text-muted-foreground">/p/{p.slug}</td>
                  <td className="p-3 space-x-1 whitespace-nowrap">
                    {p.published ? (
                      <Badge className="bg-emerald-500/15 text-emerald-500 text-[10px]">
                        na webe
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        rozpracované
                      </Badge>
                    )}
                    {!p.body.trim() && (
                      <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px]">
                        bez textu
                      </Badge>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">
                    {p.sort_order}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(p.updated_at).toLocaleDateString("sk-SK")}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap space-x-1">
                    {p.published && (
                      <Button size="sm" variant="ghost" asChild>
                        <a href={`/p/${p.slug}`} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-3.5 mr-1" /> Náhľad
                        </a>
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(toForm(p))}>
                      <Pencil className="size-3.5 mr-1" /> Upraviť
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Zmazať stránku „${p.title}"?`)) remove.mutate(p.id);
                      }}
                    >
                      <Trash2 className="size-3.5 mr-1" /> Zmazať
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Upraviť stránku" : "Nová stránka"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Názov</Label>
                  <Input
                    autoFocus
                    maxLength={300}
                    value={editing.title}
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Adresa</Label>
                  <Input
                    maxLength={200}
                    placeholder="obchodne-podmienky"
                    value={editing.slug}
                    onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Stránka bude na /p/{editing.slug || "adresa"}. Malé písmená, číslice a pomlčky.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Text</Label>
                <Textarea
                  rows={14}
                  maxLength={100000}
                  className="font-mono text-[13px]"
                  value={editing.body}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Prázdny riadok oddeľuje odsek. Riadok začínajúci <code>## </code> je nadpis,
                  riadok začínajúci <code>- </code> je odrážka. HTML sa nevkladá.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Popis pre vyhľadávače</Label>
                <Input
                  maxLength={500}
                  value={editing.meta_description}
                  onChange={(e) => setEditing({ ...editing, meta_description: e.target.value })}
                />
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                  <Label className="cursor-pointer text-sm">Publikovať</Label>
                  <Switch
                    checked={editing.published}
                    onCheckedChange={(v) => setEditing({ ...editing, published: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                  <Label className="cursor-pointer text-sm">V pätičke</Label>
                  <Switch
                    checked={editing.show_in_footer}
                    onCheckedChange={(v) => setEditing({ ...editing, show_in_footer: v })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Poradie</Label>
                  <Input
                    type="number"
                    min={0}
                    value={editing.sort_order}
                    onChange={(e) => setEditing({ ...editing, sort_order: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Zrušiť
            </Button>
            <Button
              onClick={() => editing && save.mutate(editing)}
              disabled={save.isPending || !editing?.title.trim() || !editing?.slug.trim()}
              className="bg-gradient-flame text-primary-foreground shadow-glow"
            >
              {save.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Uložiť
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
