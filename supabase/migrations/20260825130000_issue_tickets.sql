-- Vydanie vstupeniek k objednávke ako jedna nedeliteľná operácia.
--
-- Kontrola „existujú už vstupenky?" a samotný zápis boli dva kroky, takže dve
-- súbežné doúčtovania vedeli vydať dvojnásobok. Preklopenie objednávky na
-- zaplatenú to už rieši, ale vydanie musí byť bezpečné aj samo o sebe —
-- opravný sken pre objednávky, ktoré zostali zaplatené bez vstupeniek, beží
-- mimo toho preklopenia.
--
-- `for update` drží zámok na objednávke počas celej funkcie, takže druhý
-- volajúci počká a potom uvidí už vydané vstupenky.
create or replace function public.issue_tickets(p_order_id uuid, p_tickets jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_pocet int;
begin
  perform 1 from public.orders where id = p_order_id for update;

  if exists (select 1 from public.tickets where order_id = p_order_id) then
    -- Vstupenky už niekto vydal; toto volanie nemá čo robiť.
    return 0;
  end if;

  insert into public.tickets (id, order_id, event_id, event_date_id, seat_id, seat_label, qr_code, qr_token)
  select (t->>'id')::uuid,
         p_order_id,
         (t->>'event_id')::uuid,
         (t->>'event_date_id')::uuid,
         nullif(t->>'seat_id', '')::uuid,
         t->>'seat_label',
         t->>'qr_code',
         t->>'qr_token'
    from jsonb_array_elements(p_tickets) as t;

  get diagnostics v_pocet = row_count;
  return v_pocet;
end $$;

revoke all on function public.issue_tickets(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.issue_tickets(uuid, jsonb) to service_role;
