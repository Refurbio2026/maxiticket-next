// Katalóg podujatí z databázy (fáza 2 — nahrádza synchronné getEvents()
// z local-db). Dáta ťaháme cez server funkcie, cache rieši TanStack Query.
//
// MIGRAČNÁ POZNÁMKA: pôvodné volania boli synchronné a prekresľovali sa cez
// window event `EVENTS_EVENT`. Tu to nahrádza invalidácia query cache —
// po zápise zavolaj `useInvalidateEvents()`.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listEvents,
  getEventById,
  upsertEvent,
  deleteEvent,
  type EventRecord,
  type EventInputData,
} from "@/lib/events.functions";
import { useAuth } from "@/hooks/use-auth";

export type { EventRecord };

const KEY = ["events"] as const;

/**
 * Zoznam podujatí. Predvolene len publikované (verejný katalóg).
 * `scope: "mine"` vráti podujatia prihláseného organizátora vrátane konceptov,
 * adminovi všetky.
 */
export function useEvents(opts?: { scope?: "public" | "mine" | "all" }) {
  const scope = opts?.scope ?? "public";
  const { user } = useAuth();
  const fn = useServerFn(listEvents);

  return useQuery({
    queryKey: [...KEY, scope, user?.id ?? null, user?.role ?? null],
    enabled: scope === "public" || !!user,
    queryFn: async (): Promise<EventRecord[]> => {
      if (scope === "public") return fn({ data: { status: "published" } });
      if (scope === "all" || user?.role === "admin") return fn({ data: { status: "all" } });
      return fn({ data: { status: "all", organizer_id: user!.id } });
    },
  });
}

/** Detail jedného podujatia. Koncept uvidí len vlastník alebo admin. */
export function useEvent(id: string | undefined) {
  const { user } = useAuth();
  const fn = useServerFn(getEventById);

  return useQuery({
    queryKey: [...KEY, "detail", id ?? null, user?.id ?? null],
    enabled: !!id,
    queryFn: async (): Promise<EventRecord | null> =>
      fn({ data: { id: id!, viewer_id: user?.id } }),
  });
}

/**
 * Prevedie záznam z databázy späť na vstup pre `upsertEvent`. Použi pri
 * čiastočnej úprave (napr. len zmena stavu), aby sa ostatné polia neprepísali.
 */
export function toEventInput(e: EventRecord, patch?: Partial<EventInputData>): EventInputData {
  return {
    id: e.id,
    title: e.title,
    category: e.category,
    event_date: e.event_date,
    event_time: e.event_time,
    venue: e.venue,
    city: e.city,
    address: e.address ?? null,
    description: e.description ?? null,
    image_url: e.image_url ?? null,
    status: e.status,
    sale_type: e.sale_type ?? "standing",
    venue_layout_id: e.venue_layout_id ?? null,
    base_price: e.base_price ?? null,
    total_tickets: e.total_tickets ?? null,
    vip_price: e.vip_price ?? null,
    tickets: e.tickets,
    ...patch,
  };
}

/** Po zápise znovu natiahne všetky zoznamy aj detaily podujatí. */
export function useInvalidateEvents() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

export function useUpsertEvent() {
  const fn = useServerFn(upsertEvent);
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (data: EventInputData) => fn({ data }),
    onSuccess: invalidate,
  });
}

export function useDeleteEvent() {
  const fn = useServerFn(deleteEvent);
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (id: string) => fn({ data: { id } }),
    onSuccess: invalidate,
  });
}
