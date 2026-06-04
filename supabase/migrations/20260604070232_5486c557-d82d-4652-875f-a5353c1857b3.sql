
DROP POLICY IF EXISTS ticket_scans_staff_insert ON public.ticket_scans;
CREATE POLICY ticket_scans_staff_insert ON public.ticket_scans
FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = ticket_scans.event_id AND e.organizer_id = auth.uid())
);
