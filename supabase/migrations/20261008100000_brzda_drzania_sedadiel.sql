-- Brzda na držanie sedadiel: `hit_rate_limit` dostane váhu.
--
-- `holdSeats` bola jediná cesta, ktorá menila stav sedadiel a nemala žiadny
-- strop: bez prihlásenia, s vlastnou reláciou od volajúceho a bez obmedzenia
-- počtu volaní. Skript teda vedel držať celú sálu natrvalo a nikto iný nekúpil.
-- Migrácia `20260930090000` zavrela priame volanie `hold_seats` pre `anon`,
-- ale cesta cez našu serverovú funkciu ostala otvorená.
--
-- Prečo váha a nie počet volaní: jedno volanie drží až 20 sedadiel, takže
-- strop na volania by útočníkovi stačil. Účtovať treba **sedadlá**. Volať
-- brzdu dvadsaťkrát za požiadavku nejde — je to horúca cesta, pri spustení
-- predaja po nej ide tisíc ľudí a každé volanie je cesta do databázy v inom
-- štáte. Preto jedno volanie s váhou.
--
-- Stará trojparametrová podoba sa zahadzuje a nahrádza štvorparametrovou
-- s predvolenou váhou 1, takže **existujúce volania sa nemenia** a rozlišovanie
-- preťaženej funkcie nevzniká. Celé je to v jednej transakcii, takže medzi
-- `drop` a `create` sa nikto netrafí.

drop function if exists public.hit_rate_limit(text, integer, integer);

create or replace function public.hit_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer,
  -- Koľko sa má zarátať. Pri držaní sedadiel je to počet sedadiel.
  p_weight integer default 1
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count integer;
  v_weight integer;
begin
  -- Záporná ani nulová váha nesmie počítadlo znižovať.
  v_weight := greatest(coalesce(p_weight, 1), 1);

  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits (bucket, window_start, count)
  values (p_bucket, v_window, v_weight)
  on conflict (bucket, window_start)
    do update set count = rate_limits.count + v_weight
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

comment on function public.hit_rate_limit(text, integer, integer, integer) is
  'Okenná brzda. `p_weight` umožňuje zarátať viac než jeden pokus — pri držaní '
  'sedadiel sa účtuje počet sedadiel, nie počet volaní.';

-- Rovnaké práva ako mala trojparametrová podoba: volá ju výhradne server.
revoke execute on function public.hit_rate_limit(text, integer, integer, integer)
  from anon, authenticated, public;
grant execute on function public.hit_rate_limit(text, integer, integer, integer)
  to service_role;
