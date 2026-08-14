// Kontroly konzistencie predajných dát.
//
// Nie je to to isté ako „Kontrola zostavy" (`checkSettlements`) — tá porovnáva
// zmrazené protokoly s dnešným prepočtom. Tu ide o nezhody vnútri samotného
// predaja: zaplatená objednávka bez vstupeniek, vstupenka bez QR, sedadlo
// predané bez zaplatenej objednávky a podobne.
//
// Každá kontrola vracia počet nálezov a pár príkladov, nech sa dá kliknúť
// do detailu. Žiadna z nich dáta nemení — je to diagnostika.
import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CheckSeverity = "error" | "warning";

export type AccountingCheck = {
  key: string;
  title: string;
  /** Čo nález znamená a čo s ním. */
  explanation: string;
  severity: CheckSeverity;
  count: number;
  /** Krátke popisy prvých pár nálezov. */
  samples: string[];
};

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

const short = (id: string) => id.slice(0, 8).toUpperCase();
const eur = (n: number) => `${n.toFixed(2)} €`;

export const runAccountingChecks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccountingCheck[]> => {
    await assertAdmin(context.userId);

    const [{ data: orders }, { data: items }, { data: tickets }, { data: seats }] =
      await Promise.all([
        supabaseAdmin
          .from("orders")
          .select(
            "id, status, channel, total_amount, discount_amount, refunded_amount, paid_at, created_at, event_id, event_date_id",
          )
          .limit(5000),
        supabaseAdmin.from("order_items").select("order_id, quantity, unit_price").limit(20000),
        supabaseAdmin
          .from("tickets")
          .select("id, order_id, event_id, event_date_id, qr_token, refunded_at, used_at")
          .limit(20000),
        supabaseAdmin
          .from("seat_inventory")
          .select("seat_id, status, order_id, event_date_id")
          .limit(20000),
      ]);

    const orderList = orders || [];
    const orderById = new Map(orderList.map((o) => [o.id, o]));
    const ticketsByOrder = new Map<string, number>();
    for (const t of tickets || []) {
      ticketsByOrder.set(t.order_id, (ticketsByOrder.get(t.order_id) || 0) + 1);
    }
    const itemsByOrder = new Map<string, { qty: number; sum: number }>();
    for (const i of items || []) {
      const cur = itemsByOrder.get(i.order_id) || { qty: 0, sum: 0 };
      cur.qty += i.quantity || 1;
      cur.sum += Number(i.unit_price) * (i.quantity || 1);
      itemsByOrder.set(i.order_id, cur);
    }

    const checks: AccountingCheck[] = [];
    const push = (
      key: string,
      title: string,
      explanation: string,
      severity: CheckSeverity,
      samples: string[],
    ) => checks.push({ key, title, explanation, severity, count: samples.length, samples });

    // 1) Zaplatená objednávka bez vydaných vstupeniek.
    push(
      "paid_without_tickets",
      "Zaplatené objednávky bez vstupeniek",
      "Platba prišla, ale vstupenky sa nevydali. Zákazník nemá čo ukázať pri vstupe — objednávku treba vysporiadať znovu.",
      "error",
      orderList
        .filter((o) => o.status === "paid" && !ticketsByOrder.get(o.id))
        .slice(0, 10)
        .map((o) => `${short(o.id)} · ${eur(Number(o.total_amount))}`),
    );

    // 2) Súčet položiek nesedí so sumou objednávky (po zľave).
    push(
      "total_mismatch",
      "Suma objednávky nesedí s položkami",
      "Súčet položiek mínus zľava sa nerovná celkovej sume. Väčšinou ide o ručný zásah do dát.",
      "error",
      orderList
        .filter((o) => {
          const it = itemsByOrder.get(o.id);
          if (!it) return false;
          const expected = it.sum - Number(o.discount_amount || 0);
          return Math.abs(expected - Number(o.total_amount)) > 0.01;
        })
        .slice(0, 10)
        .map((o) => {
          const it = itemsByOrder.get(o.id)!;
          return `${short(o.id)} · položky ${eur(it.sum - Number(o.discount_amount || 0))} vs. objednávka ${eur(Number(o.total_amount))}`;
        }),
    );

    // 3) Vstupenka bez podpísaného QR tokenu — skener ju neoverí.
    push(
      "ticket_without_qr",
      "Vstupenky bez podpísaného QR",
      "Vstupenka nemá `qr_token`, takže sa nedá overiť podpisom. Pravdepodobne pochádza z importu alebo starého kódu.",
      "error",
      (tickets || [])
        .filter((t) => !t.qr_token)
        .slice(0, 10)
        .map((t) => `${short(t.id)} · objednávka ${short(t.order_id)}`),
    );

    // 4) Refundovaná objednávka s platnými vstupenkami.
    push(
      "refunded_with_valid_tickets",
      "Refundované objednávky s platnou vstupenkou",
      "Objednávka je refundovaná, ale vstupenka nemá `refunded_at` — skener ju pri vstupe pustí dnu.",
      "error",
      (tickets || [])
        .filter((t) => {
          const o = orderById.get(t.order_id);
          return o?.status === "refunded" && !t.refunded_at;
        })
        .slice(0, 10)
        .map((t) => `${short(t.id)} · objednávka ${short(t.order_id)}`),
    );

    // 5) Predané sedadlo bez zaplatenej objednávky.
    push(
      "sold_seat_without_paid_order",
      "Predané sedadlá bez zaplatenej objednávky",
      "Sedadlo je v stave `sold`, ale jeho objednávka nie je zaplatená. Miesto je blokované a nikto zaň nezaplatil.",
      "error",
      (seats || [])
        .filter((s) => {
          if (s.status !== "sold") return false;
          if (!s.order_id) return true;
          const o = orderById.get(s.order_id);
          return !o || (o.status !== "paid" && o.status !== "refunded");
        })
        .slice(0, 10)
        .map(
          (s) =>
            `${s.seat_id}${s.order_id ? ` · objednávka ${short(s.order_id)}` : " · bez objednávky"}`,
        ),
    );

    // 6) Objednávka bez položiek.
    push(
      "order_without_items",
      "Objednávky bez položiek",
      "Objednávka nemá ani jednu položku. Nedá sa z nej vystaviť faktúra ani zistiť, čo si zákazník kúpil.",
      "warning",
      orderList
        .filter((o) => !itemsByOrder.get(o.id))
        .slice(0, 10)
        .map((o) => `${short(o.id)} · ${o.status}`),
    );

    // 7) Zaplatená objednávka bez času platby.
    push(
      "paid_without_paid_at",
      "Zaplatené objednávky bez dátumu platby",
      "Chýba `paid_at`, takže objednávka vypadne z vyúčtovania za obdobie — provízia sa z nej nevypočíta.",
      "warning",
      orderList
        .filter((o) => o.status === "paid" && !o.paid_at)
        .slice(0, 10)
        .map((o) => `${short(o.id)} · ${eur(Number(o.total_amount))}`),
    );

    // 8) Vstupenka priradená inému termínu než objednávka.
    push(
      "ticket_date_mismatch",
      "Vstupenky s iným termínom než objednávka",
      "Vstupenka ukazuje na iný termín než jej objednávka. Na vstupenke aj v skeneri by bol nesprávny dátum.",
      "error",
      (tickets || [])
        .filter((t) => {
          const o = orderById.get(t.order_id);
          return o && o.event_date_id && t.event_date_id !== o.event_date_id;
        })
        .slice(0, 10)
        .map((t) => `${short(t.id)} · objednávka ${short(t.order_id)}`),
    );

    // 9) Refundovaná suma vyššia než samotná objednávka.
    push(
      "over_refunded",
      "Refundované viac, než sa zaplatilo",
      "Súčet vrátených súm presahuje sumu objednávky. Buď sa refundovalo dvakrát, alebo sa suma zapísala ručne.",
      "error",
      orderList
        .filter((o) => Number(o.refunded_amount || 0) > Number(o.total_amount) + 0.01)
        .slice(0, 10)
        .map(
          (o) =>
            `${short(o.id)} · vrátené ${eur(Number(o.refunded_amount))} z ${eur(Number(o.total_amount))}`,
        ),
    );

    return checks;
  });
