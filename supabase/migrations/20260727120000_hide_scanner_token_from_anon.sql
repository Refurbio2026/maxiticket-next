-- Fix V1: events.scanner_token must NOT be readable by anonymous clients.
--
-- scanner_token is the shared secret that authorizes ticket scanning. The
-- server reads it via the service-role client (by-token / scan / stats
-- endpoints), so the public anon role never needs it. Previously anon had a
-- table-wide SELECT on events, which leaked scanner_token for every published
-- event.
--
-- We replace the table-level grant with an explicit column grant that lists
-- every column EXCEPT scanner_token. Row visibility is still governed by the
-- existing RLS policy `events_public_published_select`; this only narrows which
-- COLUMNS anon may read. The `authenticated` role keeps its full grant, so
-- organizers/admins still see scanner_token.
--
-- AFTER APPLYING: verify the public events list + detail pages still load for a
-- logged-out visitor. (In this codebase the public catalog currently reads from
-- localStorage, so no anon Supabase query selects scanner_token or `*`.)

revoke select on public.events from anon;

grant select (
  id,
  organizer_id,
  title,
  category,
  event_date,
  event_time,
  venue,
  city,
  description,
  image_url,
  status,
  created_at,
  updated_at
) on public.events to anon;
