// Údaje o podujatí tak, ako patria na vstupenku, do e-mailu a do skenera.
//
// `events.event_date` je len odtlačok najbližšieho termínu (drží ho trigger
// `trg_event_dates_sync_event`). Vstupenka je ale vždy na konkrétny termín —
// keby sme brali dátum z podujatia, po pridaní reprízy by sa všetkým skôr
// vydaným lístkom „prepísal" deň konania. Preto sa dátum a čas berú z termínu
// a z podujatia len to, čo je pre všetky termíny rovnaké.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type EventInfo = {
  title: string;
  event_date: string;
  event_time: string;
  venue: string;
  city: string;
};

export async function loadEventInfo(
  eventId: string,
  eventDateId?: string | null,
): Promise<EventInfo | null> {
  const { data: event } = await supabaseAdmin
    // Bez `scanner_token` — to je tajomstvo na autorizáciu skenovania.
    .from("events")
    .select("title, event_date, event_time, venue, city")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return null;

  const info: EventInfo = {
    title: event.title,
    event_date: event.event_date,
    event_time: (event.event_time || "").slice(0, 5),
    venue: event.venue,
    city: event.city,
  };
  if (!eventDateId) return info;

  const { data: date } = await supabaseAdmin
    .from("event_dates")
    .select("event_date, event_time")
    .eq("id", eventDateId)
    .maybeSingle();
  if (date) {
    info.event_date = date.event_date;
    info.event_time = (date.event_time || "").slice(0, 5);
  }
  return info;
}
