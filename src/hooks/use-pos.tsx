// Pokladňa nad databázou. Nahrádza `pos-db.ts` / `cashier-db.ts`, ktoré držali
// tržby len v localStorage — druhá pokladňa v tej istej hale o nich nevedela
// a predaj sa nedostal do štatistík ani do vyúčtovania.
//
// V prehliadači ostáva jediná vec: **id otvorenej smeny**. To je naozaj údaj
// o tomto zariadení („na tejto pokladni je prihlásená Zuzka"), nie o firme.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import {
  listCashiers,
  upsertCashier,
  deleteCashier,
  openPosSession,
  closePosSession,
  listPosSessions,
  listPosSales,
  createPosSale,
  voidPosSale,
  previewPosClosing,
  createPosClosing,
  listPosClosings,
  type PosCashierRecord,
  type PosSessionRecord,
  type CashierInput,
  type PosSaleInput,
  type PosClosingInput,
} from "@/lib/pos.functions";

const ACTIVE_SESSION_KEY = "mt_pos_session_id";

export function getActiveSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_SESSION_KEY);
}

export function setActiveSessionId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(ACTIVE_SESSION_KEY, id);
  else window.localStorage.removeItem(ACTIVE_SESSION_KEY);
}

export function usePosCashiers(organizerId?: string) {
  const fn = useServerFn(listCashiers);
  return useQuery({
    queryKey: ["pos", "cashiers", organizerId ?? null],
    queryFn: (): Promise<PosCashierRecord[]> => fn({ data: { organizer_id: organizerId } }),
  });
}

export function useUpsertCashier() {
  const fn = useServerFn(upsertCashier);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CashierInput) => fn({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos", "cashiers"] }),
  });
}

export function useDeleteCashier() {
  const fn = useServerFn(deleteCashier);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos", "cashiers"] }),
  });
}

/**
 * Smena otvorená na tomto zariadení. Id si pamätá prehliadač, ale platnosť
 * potvrdzuje server — smenu mohol medzitým uzavrieť niekto iný.
 */
export function useActivePosSession() {
  const fetchSessions = useServerFn(listPosSessions);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => setSessionId(getActiveSessionId()), []);

  const query = useQuery({
    queryKey: ["pos", "sessions", "open"],
    queryFn: (): Promise<PosSessionRecord[]> => fetchSessions({ data: { status: "open" } }),
  });

  const session = query.data?.find((s) => s.id === sessionId) ?? null;

  // Uzavretú smenu z prehliadača zabudneme, nech pokladňa nezostane visieť
  // v stave „prihlásený, ale nič nejde".
  useEffect(() => {
    if (!query.isSuccess || !sessionId) return;
    if (!session) {
      setActiveSessionId(null);
      setSessionId(null);
    }
  }, [query.isSuccess, sessionId, session]);

  const activate = useCallback((id: string | null) => {
    setActiveSessionId(id);
    setSessionId(id);
  }, []);

  return { session, isLoading: query.isLoading, activate, openSessions: query.data ?? [] };
}

export function useOpenPosSession() {
  const fn = useServerFn(openPosSession);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { cashier_id: string; pin: string; opening_cash: number }) => fn({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos"] }),
  });
}

export function useClosePosSession() {
  const fn = useServerFn(closePosSession);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { session_id: string; closing_cash?: number; note?: string | null }) =>
      fn({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos"] }),
  });
}

export function usePosSales(params?: {
  organizer_id?: string;
  session_id?: string;
  from?: string;
  to?: string;
  limit?: number;
}) {
  const fn = useServerFn(listPosSales);
  return useQuery({
    queryKey: ["pos", "sales", params ?? {}],
    queryFn: () => fn({ data: params ?? {} }),
  });
}

export function useCreatePosSale() {
  const fn = useServerFn(createPosSale);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: PosSaleInput) => fn({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pos"] });
      // Predaj z pokladne mení obsadenosť sály aj pre web.
      qc.invalidateQueries({ queryKey: ["seat-availability"] });
    },
  });
}

export function useVoidPosSale() {
  const fn = useServerFn(voidPosSale);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { order_id: string; session_id: string; reason: string }) => fn({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pos"] });
      qc.invalidateQueries({ queryKey: ["seat-availability"] });
    },
  });
}

export function usePosClosingPreview(params: {
  session_id?: string;
  from?: string;
  to?: string;
  enabled?: boolean;
}) {
  const fn = useServerFn(previewPosClosing);
  const { enabled = true, ...rest } = params;
  return useQuery({
    queryKey: ["pos", "closing-preview", rest],
    enabled,
    queryFn: () => fn({ data: rest }),
  });
}

export function useCreatePosClosing() {
  const fn = useServerFn(createPosClosing);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: PosClosingInput) => fn({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos"] }),
  });
}

export function usePosClosings(organizerId?: string) {
  const fn = useServerFn(listPosClosings);
  return useQuery({
    queryKey: ["pos", "closings", organizerId ?? null],
    queryFn: () => fn({ data: { organizer_id: organizerId } }),
  });
}

export type { PosCashierRecord, PosSessionRecord };
