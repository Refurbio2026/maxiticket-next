-- Preklopenie objednávky na zaplatenú smie vyhrať práve jeden volajúci.
--
-- Doteraz sa to robilo v dvoch krokoch (pozri stav → zapíš), takže štyri
-- súbežné návraty z brány vydali štvornásobok vstupeniek a štyrikrát sa
-- pokúsili o faktúru. Jediný `update ... where status <> 'paid'` je atomický:
-- druhý súbežný príkaz uvidí už zmenený riadok a upraví nula riadkov.
create or replace function public.claim_order_paid(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_pocet int;
begin
  update public.orders
     set status = 'paid'::order_status,
         paid_at = coalesce(paid_at, now())
   where id = p_order_id
     and status <> 'paid'::order_status;
  get diagnostics v_pocet = row_count;
  -- true znamená „preklopil som ju ja" — vstupenky, faktúru a e-mail teda
  -- vybavuje tento volajúci a nikto iný.
  return v_pocet = 1;
end $$;

revoke all on function public.claim_order_paid(uuid) from public, anon, authenticated;
grant execute on function public.claim_order_paid(uuid) to service_role;
