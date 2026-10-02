-- Päť funkcií na držanie sedadiel a kupóny prestáva byť volateľných z prehliadača.
--
-- Postgres dáva novej funkcii EXECUTE pre `PUBLIC` (v ACL je to `=X/postgres`),
-- takže sa na ne dostal aj `anon` cez verejný publishable kľúč. Appka ich však
-- volá výhradne na serveri so service-role kľúčom (`supabaseAdmin.rpc(...)`
-- v `event-dates.functions.ts`, `payments.functions.ts`, `pos.functions.ts`
-- a `coupons.server.ts`), takže verejný prístup nikto nepotreboval — a dal sa
-- zneužiť:
--
--   * `hold_seats` a `reserve_seats` berú `p_until` od volajúceho, takže
--     ktokoľvek s verejným kľúčom vedel podržať ľubovoľné sedadlá ľubovoľne
--     dlho a zablokovať predaj celej sály. Limity „najviac 20 sedadiel a 15
--     minút" aj brzda na počet pokusov pritom žijú len v serverovej funkcii —
--     priame RPC ich obišlo.
--   * `release_coupon` zvyšovala zostatok kupónu bez akejkoľvek kontroly.
--
-- POZOR na samotný revoke: `revoke ... from anon, authenticated` sám nestačí,
-- lebo právo drží `PUBLIC`. Preto sa odoberá aj jemu. `service_role` má v ACL
-- vlastný explicitný grant (`service_role=X/postgres`), takže o prístup
-- neprichádza — pre istotu sa nižšie potvrdzuje.
--
-- Cieľový stav ACL je ten istý, aký už majú správne zavreté funkcie
-- (`check_coupon`, `issue_tickets`, `claim_order_paid`): len `postgres`
-- a `service_role`. PostgREST takú funkciu neohlási a vracia 404.
--
-- Vrátiť sa to dá opačným príkazom, ale s rozumom: samotný grant by vrátil aj
-- obchádzanie limitov, ktoré sú v serverovej funkcii.
--
-- Audit 29. 9. 2026.

revoke execute on function public.hold_seats(uuid, uuid, text, jsonb, timestamptz)
  from public, anon, authenticated;

revoke execute on function public.release_holds(uuid, text, text)
  from public, anon, authenticated;

revoke execute on function public.extend_holds(uuid, text, timestamptz)
  from public, anon, authenticated;

revoke execute on function public.reserve_seats(uuid, uuid, uuid, jsonb, timestamptz, text)
  from public, anon, authenticated;

-- Staršie preťaženie bez `p_session`. Verejné právo už nemá, revoke je tu len
-- preto, aby stav nezávisel od poradia, v akom sa migrácie niekde prehrali.
revoke execute on function public.reserve_seats(uuid, uuid, uuid, jsonb, timestamptz)
  from public, anon, authenticated;

revoke execute on function public.release_coupon(uuid, numeric)
  from public, anon, authenticated;

-- Server musí vedieť volať všetkých päť aj po odobraní PUBLIC. Grant je
-- idempotentný; ak tam už je, nič sa nestane.
grant execute on function public.hold_seats(uuid, uuid, text, jsonb, timestamptz) to service_role;
grant execute on function public.release_holds(uuid, text, text) to service_role;
grant execute on function public.extend_holds(uuid, text, timestamptz) to service_role;
grant execute on function public.reserve_seats(uuid, uuid, uuid, jsonb, timestamptz, text) to service_role;
grant execute on function public.reserve_seats(uuid, uuid, uuid, jsonb, timestamptz) to service_role;
grant execute on function public.release_coupon(uuid, numeric) to service_role;
