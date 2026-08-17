// Zostavenie a uloženie dokladov z pokladne.
//
// Dokument vzniká raz a odvtedy sa už len sťahuje z `pos_documents`. Je to
// zámerné: uzávierka aj pokladničný doklad sú účtovné písomnosti, takže musia
// vyzerať navždy rovnako, aj keď sa medzitým zmení šablóna alebo sa v systéme
// niečo doúčtuje.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  generateClosingPdfBase64,
  generateReceiptPdfBase64,
  type ClosingPdfData,
  type ReceiptPdfData,
} from "./pos-pdf.server";

export type StoredDocument = {
  id: string;
  filename: string;
  content_type: string;
  base64: string;
};

async function organizerName(organizerId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("full_name")
    .eq("id", organizerId)
    .maybeSingle();
  if (data?.full_name) return data.full_name;
  const { data: user } = await supabaseAdmin.auth.admin.getUserById(organizerId);
  return user?.user?.email || "Organizátor";
}

async function saveDocument(row: {
  organizer_id: string;
  kind: "closing" | "receipt";
  closing_id?: string | null;
  order_id?: string | null;
  title: string;
  filename: string;
  base64: string;
  created_by?: string | null;
}): Promise<StoredDocument> {
  const payload = {
    organizer_id: row.organizer_id,
    kind: row.kind,
    closing_id: row.closing_id ?? null,
    order_id: row.order_id ?? null,
    title: row.title,
    filename: row.filename,
    content_type: "application/pdf",
    // Skutočná veľkosť súboru, nie dĺžka base64 — to je to, čo používateľ stiahne.
    size_bytes: Math.floor((row.base64.length * 3) / 4),
    content_base64: row.base64,
    created_by: row.created_by ?? null,
  };

  // Jeden doklad na uzávierku a jeden na objednávku. Opakované generovanie
  // (napr. po storne predaja) starý nahradí, nezduplikuje — inak by v zozname
  // boli dve verzie toho istého dokladu a nebolo by jasné, ktorá platí.
  // Zámerne mažeme a vkladáme: `upsert` by potreboval úplný unique index,
  // a ten náš je čiastočný (`where … is not null`), z ktorého PostgREST
  // konflikt odvodiť nevie.
  if (row.closing_id) {
    await supabaseAdmin.from("pos_documents").delete().eq("closing_id", row.closing_id);
  } else if (row.order_id) {
    await supabaseAdmin
      .from("pos_documents")
      .delete()
      .eq("order_id", row.order_id)
      .eq("kind", "receipt");
  }

  const { data, error } = await supabaseAdmin
    .from("pos_documents")
    .insert(payload)
    .select("id, filename, content_type")
    .single();
  if (error || !data) throw new Error(error?.message || "Dokument sa nepodarilo uložiť");
  return { ...data, base64: row.base64 };
}

/** Zostaví PDF uzávierky z uloženého (zmrazeného) riadku a odloží ho. */
export async function buildClosingDocument(
  closingId: string,
  createdBy?: string | null,
): Promise<StoredDocument> {
  const { data: c, error } = await supabaseAdmin
    .from("pos_closings")
    .select("*")
    .eq("id", closingId)
    .maybeSingle();
  if (error || !c) throw new Error(error?.message || "Uzávierka sa nenašla");

  const [orgName, cashier, sales] = await Promise.all([
    organizerName(c.organizer_id),
    c.cashier_id
      ? supabaseAdmin
          .from("pos_cashiers")
          .select("display_name")
          .eq("id", c.cashier_id)
          .maybeSingle()
          .then((r) => r.data?.display_name ?? null)
      : Promise.resolve(null),
    loadSalesForPeriod(c.organizer_id, c.session_id, c.period_from, c.period_to),
  ]);

  const data: ClosingPdfData = {
    id: c.id,
    organizer_name: orgName,
    cashier_name: cashier,
    period_from: c.period_from,
    period_to: c.period_to,
    created_at: c.created_at,
    orders_count: c.orders_count,
    tickets_count: c.tickets_count,
    cash_total: Number(c.cash_total),
    card_total: Number(c.card_total),
    transfer_total: Number(c.transfer_total),
    free_total: Number(c.free_total),
    gross_total: Number(c.gross_total),
    voided_count: c.voided_count,
    voided_total: Number(c.voided_total),
    opening_cash: Number(c.opening_cash),
    // Očakávaná hotovosť sa v tabuľke nedrží — je to počiatočná plus hotovostná tržba.
    expected_cash: Math.round((Number(c.opening_cash) + Number(c.cash_total)) * 100) / 100,
    counted_cash: c.counted_cash === null ? null : Number(c.counted_cash),
    cash_difference: c.cash_difference === null ? null : Number(c.cash_difference),
    note: c.note,
    sales,
  };

  const den = new Date(c.period_from).toLocaleDateString("sk-SK");
  return saveDocument({
    organizer_id: c.organizer_id,
    kind: "closing",
    closing_id: c.id,
    title: `Uzávierka ${den}${cashier ? ` — ${cashier}` : ""}`,
    filename: `uzavierka-${c.period_from.slice(0, 10)}-${c.id.slice(0, 8)}.pdf`,
    base64: generateClosingPdfBase64(data),
    created_by: createdBy,
  });
}

async function loadSalesForPeriod(
  organizerId: string,
  sessionId: string | null,
  from: string,
  to: string,
): Promise<ClosingPdfData["sales"]> {
  const { data: events } = await supabaseAdmin
    .from("events")
    .select("id, title")
    .eq("organizer_id", organizerId);
  const eventIds = (events || []).map((e) => e.id);
  const titleById = new Map((events || []).map((e) => [e.id, e.title]));
  if (eventIds.length === 0) return [];

  let q = supabaseAdmin
    .from("orders")
    .select("receipt_number, created_at, event_id, payment_method, status, total_amount")
    .eq("channel", "pos")
    .in("event_id", eventIds)
    .gte("created_at", from)
    .lte("created_at", to)
    .order("created_at", { ascending: true });
  if (sessionId) q = q.eq("pos_session_id", sessionId);

  const { data: orders } = await q;
  return (orders || []).map((o) => ({
    receipt_number: o.receipt_number || "—",
    created_at: o.created_at,
    event_title: titleById.get(o.event_id) || "—",
    payment_method: o.payment_method || "cash",
    total: Number(o.total_amount || 0),
    status: o.status,
  }));
}

/** Zostaví pokladničný doklad k jednej POS objednávke a odloží ho. */
export async function buildReceiptDocument(
  orderId: string,
  createdBy?: string | null,
): Promise<StoredDocument> {
  const { data: o, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, receipt_number, created_at, event_id, event_date_id, cashier_id, payment_method, status, total_amount, discount_amount, promo_code, channel",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error || !o) throw new Error(error?.message || "Objednávka sa nenašla");

  const { data: event } = await supabaseAdmin
    .from("events")
    .select("id, title, organizer_id")
    .eq("id", o.event_id)
    .maybeSingle();
  if (!event) throw new Error("Podujatie k dokladu sa nenašlo");

  const [{ data: items }, { data: date }, cashier, { data: fiscal }, orgName] = await Promise.all([
    supabaseAdmin.from("order_items").select("label, quantity, unit_price").eq("order_id", o.id),
    supabaseAdmin
      .from("event_dates")
      .select("event_date, event_time")
      .eq("id", o.event_date_id)
      .maybeSingle(),
    o.cashier_id
      ? supabaseAdmin
          .from("pos_cashiers")
          .select("display_name")
          .eq("id", o.cashier_id)
          .maybeSingle()
          .then((r) => r.data?.display_name ?? null)
      : Promise.resolve(null),
    supabaseAdmin
      .from("fiscal_settings")
      .select("ico, dic, ic_dph, cash_register_code, premises_name, premises_address")
      .eq("organizer_id", event.organizer_id)
      .maybeSingle(),
    organizerName(event.organizer_id),
  ]);

  const list = (items || []).map((i) => ({
    label: i.label,
    quantity: i.quantity || 1,
    unit_price: Number(i.unit_price),
  }));
  const subtotal = Math.round(list.reduce((s, i) => s + i.unit_price * i.quantity, 0) * 100) / 100;

  const data: ReceiptPdfData = {
    receipt_number: o.receipt_number || o.id.slice(0, 8).toUpperCase(),
    created_at: o.created_at,
    organizer_name: orgName,
    cashier_name: cashier,
    event_title: event.title,
    // Dátum podujatia po slovensky — na doklade nemá čo hľadať ISO tvar.
    event_date: date
      ? `${new Date(date.event_date).toLocaleDateString("sk-SK")} · ${(date.event_time || "").slice(0, 5)}`
      : null,
    payment_method: o.payment_method || "cash",
    subtotal,
    discount: Number(o.discount_amount || 0),
    total: Number(o.total_amount || 0),
    promo_code: o.promo_code,
    status: o.status,
    items: list,
    fiscal: fiscal ?? null,
  };

  return saveDocument({
    organizer_id: event.organizer_id,
    kind: "receipt",
    order_id: o.id,
    title: `Doklad ${data.receipt_number}`,
    filename: `doklad-${data.receipt_number.replace(/[^\w-]+/g, "-")}.pdf`,
    base64: generateReceiptPdfBase64(data),
    created_by: createdBy,
  });
}
