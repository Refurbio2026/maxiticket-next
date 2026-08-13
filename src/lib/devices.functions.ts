// Zariadenia pri dverách a na pokladni (čítačky, terminály, tlačiarne, kiosky).
//
// Doteraz sa do `ticket_scans.scanner_name` zapisoval natvrdo text „Vstupná
// čítačka", takže sa nedalo povedať, ktoré zariadenie skenovalo. Teraz má
// zariadenie svoj riadok a skener si ho vyberá zo zoznamu.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const DEVICE_TYPES = ["scanner", "terminal", "printer", "kiosk"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export type DeviceRecord = {
  id: string;
  organizer_id: string;
  organizer_name: string | null;
  name: string;
  device_type: DeviceType;
  serial_number: string | null;
  location: string | null;
  event_id: string | null;
  event_title: string | null;
  status: "active" | "inactive";
  note: string | null;
  last_seen_at: string | null;
  /** Koľko skenov zariadenie zaznamenalo (podľa mena v `ticket_scans`). */
  scans_count: number;
  created_at: string;
};

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

export const listDevices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeviceRecord[]> => {
    const admin = await isAdmin(context.userId);

    let q = supabaseAdmin
      .from("scanner_devices")
      .select(
        "id, organizer_id, name, device_type, serial_number, location, event_id, status, note, last_seen_at, created_at",
      )
      .order("created_at", { ascending: false });
    if (!admin) q = q.eq("organizer_id", context.userId);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = rows || [];
    if (list.length === 0) return [];

    const eventIds = [...new Set(list.map((d) => d.event_id).filter(Boolean))] as string[];
    const organizerIds = [...new Set(list.map((d) => d.organizer_id))];

    const [{ data: events }, { data: profiles }, { data: scans }] = await Promise.all([
      eventIds.length
        ? supabaseAdmin.from("events").select("id, title").in("id", eventIds)
        : Promise.resolve({ data: [] as { id: string; title: string }[] }),
      // `profiles` nemá e-mail — ten žije v `auth.users`. Meno stačí.
      supabaseAdmin.from("profiles").select("id, full_name").in("id", organizerIds),
      supabaseAdmin
        .from("ticket_scans")
        .select("scanner_name")
        .in(
          "scanner_name",
          list.map((d) => d.name),
        ),
    ]);

    const eventTitle = new Map((events || []).map((e) => [e.id, e.title]));
    const organizerName = new Map(
      (profiles || []).map((p) => [p.id, p.full_name || "—"]),
    );
    const scanCount = new Map<string, number>();
    for (const s of scans || []) {
      const key = (s.scanner_name as string) || "";
      scanCount.set(key, (scanCount.get(key) || 0) + 1);
    }

    return list.map((d) => ({
      id: d.id,
      organizer_id: d.organizer_id,
      organizer_name: organizerName.get(d.organizer_id) ?? null,
      name: d.name,
      device_type: (DEVICE_TYPES as readonly string[]).includes(d.device_type)
        ? (d.device_type as DeviceType)
        : "scanner",
      serial_number: d.serial_number,
      location: d.location,
      event_id: d.event_id,
      event_title: d.event_id ? (eventTitle.get(d.event_id) ?? null) : null,
      status: d.status === "inactive" ? "inactive" : "active",
      note: d.note,
      last_seen_at: d.last_seen_at,
      scans_count: scanCount.get(d.name) || 0,
      created_at: d.created_at,
    }));
  });

const DeviceInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  device_type: z.enum(DEVICE_TYPES).default("scanner"),
  serial_number: z.string().max(120).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  event_id: z.string().uuid().optional().nullable(),
  status: z.enum(["active", "inactive"]).default("active"),
  note: z.string().max(2000).optional().nullable(),
  /** Len admin: zariadenie cudzieho organizátora. */
  organizer_id: z.string().uuid().optional().nullable(),
});

export type DeviceInputData = z.input<typeof DeviceInput>;

export const upsertDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => DeviceInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const admin = await isAdmin(context.userId);
    // Vlastníka neberieme z klienta — organizátor si vie založiť zariadenie
    // len na seba.
    const organizerId = admin ? (data.organizer_id ?? context.userId) : context.userId;

    const row = {
      organizer_id: organizerId,
      name: data.name.trim(),
      device_type: data.device_type,
      serial_number: data.serial_number || null,
      location: data.location || null,
      event_id: data.event_id || null,
      status: data.status,
      note: data.note || null,
    };

    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("scanner_devices")
        .select("id, organizer_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!existing) throw new Error("Zariadenie sa nenašlo");
      if (!admin && existing.organizer_id !== context.userId) {
        throw new Error("Forbidden: zariadenie patrí inému organizátorovi");
      }
      const { error } = await supabaseAdmin.from("scanner_devices").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: created, error } = await supabaseAdmin
      .from("scanner_devices")
      .insert(row)
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message || "Zariadenie sa nepodarilo uložiť");
    return { id: created.id };
  });

export const deleteDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: device } = await supabaseAdmin
      .from("scanner_devices")
      .select("id, organizer_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!device) throw new Error("Zariadenie sa nenašlo");
    if (device.organizer_id !== context.userId && !(await isAdmin(context.userId))) {
      throw new Error("Forbidden: zariadenie patrí inému organizátorovi");
    }
    const { error } = await supabaseAdmin.from("scanner_devices").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type ScannerDeviceOption = { id: string; name: string; location: string | null };

/**
 * Zoznam čítačiek pre skener pri dverách.
 *
 * Skener beží na tablete a autorizuje sa skenovacím kódom podujatia, nie
 * prihlásením — preto sa aj tu overuje tokenom, nie rolou. Vraciame len meno
 * a umiestnenie, nič citlivé.
 */
export const listScannerDevicesForEvent = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ event_token: z.string().min(10).max(200) }).parse(input))
  .handler(async ({ data }): Promise<ScannerDeviceOption[]> => {
    const { data: event } = await supabaseAdmin
      .from("events")
      .select("id, organizer_id")
      .eq("scanner_token", data.event_token)
      .maybeSingle();
    if (!event) return [];

    const { data: rows } = await supabaseAdmin
      .from("scanner_devices")
      .select("id, name, location, event_id")
      .eq("organizer_id", event.organizer_id)
      .eq("device_type", "scanner")
      .eq("status", "active")
      .order("name", { ascending: true });

    // Zariadenie viazané na iné podujatie sa tu neponúka.
    return (rows || [])
      .filter((d) => !d.event_id || d.event_id === event.id)
      .map((d) => ({ id: d.id, name: d.name, location: d.location }));
  });
