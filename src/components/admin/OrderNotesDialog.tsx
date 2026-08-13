// Poznámky k jednej objednávke. Ten istý dialóg používa Predaj aj Poznámky,
// nech sa nezaložia dve rôzne miesta, kde sa to isté píše inak.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listOrderNotes,
  upsertOrderNote,
  deleteOrderNote,
  type OrderNote,
} from "@/lib/order-notes.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Pin, Trash2, Pencil, X } from "lucide-react";
import { toast } from "sonner";

export type OrderNotesTarget = {
  order_id: string;
  /** Popis objednávky do hlavičky dialógu — čo práve komentujem. */
  subtitle?: string;
};

export function OrderNotesDialog({
  target,
  onClose,
}: {
  target: OrderNotesTarget | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fetchNotes = useServerFn(listOrderNotes);
  const saveNote = useServerFn(upsertOrderNote);
  const removeNote = useServerFn(deleteOrderNote);

  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const notes = useQuery({
    queryKey: ["order-notes", target?.order_id ?? null],
    enabled: !!target,
    queryFn: () => fetchNotes({ data: { order_id: target!.order_id } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["order-notes"] });
    // Počítadlo v zozname objednávok aj prehľad všetkých poznámok.
    qc.invalidateQueries({ queryKey: ["order-note-counts"] });
  };

  const reset = () => {
    setBody("");
    setPinned(false);
    setEditingId(null);
  };

  const save = useMutation({
    mutationFn: () =>
      saveNote({
        data: {
          id: editingId ?? undefined,
          order_id: target!.order_id,
          body,
          pinned,
        },
      }),
    onSuccess: () => {
      invalidate();
      toast.success(editingId ? "Poznámka upravená" : "Poznámka pridaná");
      reset();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeNote({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Poznámka zmazaná");
      reset();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo"),
  });

  const startEdit = (n: OrderNote) => {
    setEditingId(n.id);
    setBody(n.body);
    setPinned(n.pinned);
  };

  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Poznámky k objednávke</DialogTitle>
          <DialogDescription>
            {target?.subtitle ?? "Interné — zákazník ich nikdy nevidí."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            rows={3}
            maxLength={4000}
            placeholder="Napr. zákazník volal, chce presunúť na sobotný termín…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Switch id="note-pinned" checked={pinned} onCheckedChange={setPinned} />
              <Label htmlFor="note-pinned" className="text-sm cursor-pointer">
                Pripnúť navrch
              </Label>
            </div>
            <div className="flex gap-2">
              {editingId && (
                <Button variant="ghost" size="sm" onClick={reset}>
                  <X className="size-4 mr-1" /> Zrušiť úpravu
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => save.mutate()}
                disabled={save.isPending || !body.trim()}
                className="bg-gradient-flame text-primary-foreground shadow-glow"
              >
                {save.isPending && <Loader2 className="size-4 mr-1.5 animate-spin" />}
                {editingId ? "Uložiť" : "Pridať poznámku"}
              </Button>
            </div>
          </div>
        </div>

        <div className="border-t border-border/40 pt-3 space-y-3">
          {notes.isLoading ? (
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          ) : (notes.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              K tejto objednávke zatiaľ nie je žiadna poznámka.
            </p>
          ) : (
            (notes.data ?? []).map((n) => (
              <div
                key={n.id}
                className={`rounded-lg border p-3 ${
                  n.pinned ? "border-primary/40 bg-primary/5" : "border-border/40 bg-card/40"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm whitespace-pre-line flex-1">{n.body}</p>
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" onClick={() => startEdit(n)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove.mutate(n.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground">
                  {n.pinned && (
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <Pin className="size-2.5" /> pripnuté
                    </Badge>
                  )}
                  <span>{n.author_name || "—"}</span>
                  <span>·</span>
                  <span>{new Date(n.created_at).toLocaleString("sk-SK")}</span>
                  {n.updated_at !== n.created_at && <span>· upravené</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
