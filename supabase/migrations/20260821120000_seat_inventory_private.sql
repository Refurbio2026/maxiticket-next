-- seat_inventory prestáva byť verejne čitateľná.
--
-- BEZPEČNOSŤ: tabuľka nesie `order_id`, takže politika „číta ktokoľvek"
-- vydávala anonymnému návštevníkovi UUID objednávky ku každému predanému
-- sedadlu. To bola prvá polovica cesty k cudzím vstupenkám — druhou bolo
-- zhrnutie objednávky, ktoré k tomu UUID vrátilo QR kódy (opravené zvlášť
-- v `getOrderSummary`).
--
-- Aplikácia o tento prístup nepríde: na `seat_inventory` siahajú výhradne
-- serverové funkcie cez service-role kľúč, ktorý RLS obchádza. Prehliadač sa
-- priamo pýta len na `orders` a `user_roles`; obsadenosť sály dostáva cez
-- `getSeatAvailability`, ktoré vracia už len zoznam obsadených `seat_id`
-- bez väzby na objednávku.
drop policy if exists "seat_inventory_public_select" on public.seat_inventory;

-- Granty boli plošné (Supabase ich dáva na celú schému a spolieha sa na RLS).
-- Tu ich odoberáme adresne, nech tabuľka nestojí na jedinej línii obrany —
-- TRUNCATE navyše RLS vôbec nepodlieha, drží ho len grant.
revoke all on public.seat_inventory from anon, authenticated;
