
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS qr_token text,
  ADD COLUMN IF NOT EXISTS scan_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scanned_by uuid,
  ADD COLUMN IF NOT EXISTS last_scan_at timestamptz,
  ADD COLUMN IF NOT EXISTS allow_reentry boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS tickets_qr_token_unique ON public.tickets(qr_token) WHERE qr_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS tickets_event_id_idx ON public.tickets(event_id);

DO $$ BEGIN
  CREATE TYPE public.ticket_scan_result AS ENUM ('valid','duplicate','invalid','reentry');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.ticket_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid,
  event_id uuid,
  qr_token text,
  result public.ticket_scan_result NOT NULL,
  scanned_by uuid,
  scanner_name text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.ticket_scans TO authenticated;
GRANT ALL ON public.ticket_scans TO service_role;

ALTER TABLE public.ticket_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY ticket_scans_admin_select ON public.ticket_scans
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = ticket_scans.event_id AND e.organizer_id = auth.uid())
);

CREATE POLICY ticket_scans_staff_insert ON public.ticket_scans
FOR INSERT TO authenticated
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS ticket_scans_event_idx ON public.ticket_scans(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ticket_scans_ticket_idx ON public.ticket_scans(ticket_id);
