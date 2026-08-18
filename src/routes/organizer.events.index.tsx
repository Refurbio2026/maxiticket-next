import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import {
  useEvents,
  useUpsertEvent,
  useDeleteEvent,
  toEventInput,
  type EventRecord,
} from "@/hooks/use-events";
import { EventFormDialog } from "@/components/events/EventFormDialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Eye, Trash2, CheckCircle2, FileText, Calendar, MapPin, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/events/")({
  head: () => ({ meta: [{ title: "Moje podujatia · vipky.sk" }] }),
  // `?new=1` otvorí prázdny formulár. Sem presmerúva /organizer/events/new,
  // na ktoré vedie bočné menu aj odkazy z dashboardu a pokladne.
  validateSearch: (s: Record<string, unknown>): { new?: boolean } => ({
    new: s.new === true || s.new === "1" || s.new === "true" ? true : undefined,
  }),
  component: OrganizerEvents,
});

function OrganizerEvents() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  // Vlastné podujatia vrátane konceptov; adminovi server vráti všetky.
  const { data: events = [] } = useEvents({ scope: "mine" });
  const upsert = useUpsertEvent();
  const del = useDeleteEvent();
  // Úprava beží v tom istom formulári ako v adminovi; `event: null` = nové podujatie.
  const [dialog, setDialog] = useState<{ open: boolean; event: EventRecord | null }>({
    open: false,
    event: null,
  });

  // Príchod z /organizer/events/new. Parameter zo záznamu histórie hneď
  // zahodíme, nech sa formulár po zavretí neotvorí znova cez tlačidlo späť.
  useEffect(() => {
    if (!search.new) return;
    setDialog({ open: true, event: null });
    navigate({ to: "/organizer/events", search: {}, replace: true });
  }, [search.new, navigate]);

  const togglePublish = async (e: EventRecord) => {
    const next = e.status === "published" ? "draft" : "published";
    try {
      await upsert.mutateAsync(toEventInput(e, { status: next }));
      toast.success(
        next === "draft" ? t("orgEventsList.toastHidden") : t("orgEventsList.toastPublished"),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Zmena stavu zlyhala");
    }
  };

  const remove = async (id: string) => {
    if (!confirm(t("orgEventsList.confirmDelete"))) return;
    try {
      await del.mutateAsync(id);
      toast.success(t("orgEventsList.toastDeleted"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Zmazanie zlyhalo");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">
            {t("orgEventsList.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("orgEventsList.subtitle")}</p>
        </div>
        <Button
          onClick={() => setDialog({ open: true, event: null })}
          className="bg-gradient-flame text-primary-foreground shadow-glow"
        >
          <Plus className="size-4 mr-2" /> {t("orgEventsList.addButton")}
        </Button>
      </div>

      {events.length === 0 ? (
        <Card className="p-12 text-center bg-card/60 border-dashed border-border/50">
          <Calendar className="size-10 text-muted-foreground mx-auto mb-3" />
          <div className="font-semibold">{t("orgEventsList.emptyTitle")}</div>
          <p className="text-sm text-muted-foreground mt-1">{t("orgEventsList.emptyHint")}</p>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((e) => (
            <Card key={e.id} className="overflow-hidden bg-card/60 border-border/50 flex flex-col">
              <div
                className="aspect-video bg-muted bg-cover bg-center"
                style={e.image_url ? { backgroundImage: `url(${e.image_url})` } : undefined}
              />
              <div className="p-5 space-y-2 flex-1 flex flex-col">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                      e.status === "published"
                        ? "bg-primary/15 text-primary border-primary/30"
                        : "bg-muted text-muted-foreground border-border/50"
                    }`}
                  >
                    {e.status === "published"
                      ? t("orgEventsList.statusPublished")
                      : t("orgEventsList.statusDraft")}
                  </span>
                  <span className="text-xs text-muted-foreground">{e.category}</span>
                </div>
                <h3 className="font-display font-semibold text-lg leading-tight">{e.title}</h3>
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Calendar className="size-3.5" /> {e.event_date} · {e.event_time}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <MapPin className="size-3.5" /> {e.venue}, {e.city}
                </div>
                <div className="flex flex-wrap gap-2 mt-auto pt-3">
                  {e.status === "published" && (
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/events/$id" params={{ id: e.id }}>
                        <Eye className="size-3.5 mr-1.5" /> {t("orgEventsList.view")}
                      </Link>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ open: true, event: e })}
                  >
                    <Pencil className="size-3.5 mr-1.5" /> {t("orgEventsList.edit")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => togglePublish(e)}>
                    {e.status === "published" ? (
                      <>
                        <FileText className="size-3.5 mr-1.5" /> {t("orgEventsList.hide")}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="size-3.5 mr-1.5" /> {t("orgEventsList.publish")}
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(e.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-3.5 mr-1.5" /> {t("orgEventsList.delete")}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <EventFormDialog
        mode="organizer"
        open={dialog.open}
        event={dialog.event}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </div>
  );
}
