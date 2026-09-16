-- Doplnenie šiestich stavov, ktoré `docs/spec-ticket-sync.md` nezaraďuje.
--
-- Číselník `seat_status` má na dev aj na prod RDS **27 hodnôt, nie 28** ako
-- uvádza špecifikácia (id 10 neexistuje) — chyba je v spec-e, opraví sa zvlášť.
-- Migrácia `20260916100000` naplnila 21 stavov z kapitoly 3.1; zvyšných šesť
-- by pri prvom dennom refreshi dostalo `category = 'other'` a čakalo na ručné
-- zaradenie. Tu sú zaradené, takže `category_source` ostáva `'spec'`.
--
-- Všetkých šesť má v OM `ticket = 0` — žiadny z nich nie je vytlačená vstupenka
-- a ani jeden nevstupuje do tržby.

insert into public.om_seat_status (id_seat_status, name, ticket, enabled, category, category_source) values
  -- Miesta vyhradené pre partnera. Predaj ide mimo OM, takže to nie je naša
  -- tržba, ale ani voľná kapacita — inak by sa zdalo, že sa dajú predať.
  (12, 'TicketPortal',                   false, true,  'blocked', 'spec'),
  (16, 'Kontingent',                     false, false, 'blocked', 'spec'),
  -- Rezervácie. Predajom prechádzajú do niektorého zo stavov s `ticket = 1`.
  (3,  'Riaditeľská rezervácia',         false, false, 'pending', 'spec'),
  (4,  'Riaditeľská rezervácia na meno', false, false, 'pending', 'spec'),
  (8,  'Reservácia',                     false, false, 'pending', 'spec'),
  (22, 'OGB reservation',                false, false, 'pending', 'spec')
on conflict (id_seat_status) do update
  set category = excluded.category,
      category_source = excluded.category_source,
      name = coalesce(public.om_seat_status.name, excluded.name);

-- --- Počty musia počítať podľa kategórie ----------------------------------
-- Predošlá verzia rátala `reserved` ako `id_seat_status = 11`, čo bolo zhodné
-- so zdrojovou agregáciou, kým `pending` obsahoval len stavy 11 a 20. Teraz sú
-- v ňom aj 3, 4, 8 a 22, a `blocked` už nie je len stav 2 — keby jedna strana
-- počítala podľa kategórie a druhá podľa vymenovaných stavov, kontrola by
-- hlásila nezhodu na každom pláne, kde je čo i len jedno miesto TicketPortal.
--
-- Worker preto zostavuje zoznamy stavov pre zdrojový dotaz **z tohto číselníka**
-- a tu sa počíta výhradne podľa `category`.

create or replace function public.om_pocty_podla_planu(p_plany bigint[])
returns table (
  id_plan bigint,
  seats bigint,
  sold bigint,
  abo bigint,
  reserved bigint,
  blocked bigint,
  free bigint,
  scanned bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id_plan,
         count(*)                                       as seats,
         count(*) filter (where t.category = 'sold')     as sold,
         count(*) filter (where t.category = 'abo')      as abo,
         count(*) filter (where t.category = 'pending')  as reserved,
         count(*) filter (where t.category = 'blocked')  as blocked,
         count(*) filter (where t.category = 'free')     as free,
         count(*) filter (where t.scan > 0)              as scanned
    from public.om_tickets t
   where t.id_plan = any (p_plany)
     and t.vanished_at is null
   group by t.id_plan;
$$;

revoke all on function public.om_pocty_podla_planu(bigint[]) from public, anon, authenticated;
grant execute on function public.om_pocty_podla_planu(bigint[]) to service_role;

-- Stavy sa preklasifikovali, takže už uložené riadky treba prepočítať. Trigger
-- to spraví sám, stačí ich šťuchnúť. Pri prvom nasadení je tabuľka prázdna.
update public.om_tickets set id_seat_status = id_seat_status
 where id_seat_status in (3, 4, 8, 12, 16, 22);
