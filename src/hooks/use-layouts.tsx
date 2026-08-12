// Rozloženia sál z databázy. Nahrádza synchronné `listLayouts()` z layouts-db,
// ktoré čítalo localStorage — sála vytvorená na jednom počítači tak neexistovala
// nikde inde a server o nej nevedel vôbec.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listLayouts,
  getLayoutById,
  upsertLayout,
  deleteLayout,
  type LayoutInputData,
} from "@/lib/layouts.functions";
import type { HallLayout } from "@/lib/layout-types";

const KEY = ["venue-layouts"] as const;

export function useLayouts() {
  const fn = useServerFn(listLayouts);
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<HallLayout[]> => fn({ data: undefined }),
  });
}

export function useLayout(id: string | undefined) {
  const fn = useServerFn(getLayoutById);
  return useQuery({
    queryKey: [...KEY, "detail", id ?? null],
    enabled: !!id,
    queryFn: async (): Promise<HallLayout | null> => fn({ data: { id: id! } }),
  });
}

export function useInvalidateLayouts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

/** Prevedie záznam na vstup pre uloženie (pri čiastočnej úprave). */
export function toLayoutInput(l: HallLayout, patch?: Partial<LayoutInputData>): LayoutInputData {
  return {
    id: l.id,
    name: l.name,
    type: l.type,
    city: l.city ?? null,
    address: l.address ?? null,
    note: l.note ?? null,
    capacity: l.capacity ?? null,
    shapes: l.shapes as LayoutInputData["shapes"],
    curveGroups: (l.curveGroups ?? []) as LayoutInputData["curveGroups"],
    ...patch,
  };
}

export function useUpsertLayout() {
  const fn = useServerFn(upsertLayout);
  const invalidate = useInvalidateLayouts();
  return useMutation({
    mutationFn: (data: LayoutInputData) => fn({ data }),
    onSuccess: invalidate,
  });
}

export function useDeleteLayout() {
  const fn = useServerFn(deleteLayout);
  const invalidate = useInvalidateLayouts();
  return useMutation({
    mutationFn: (id: string) => fn({ data: { id } }),
    onSuccess: invalidate,
  });
}
