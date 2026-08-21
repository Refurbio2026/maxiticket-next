-- Indexy na cudzie kľúče, ktoré ich nemali.
--
-- Postgres index k cudziemu kľúču nezakladá sám. Chýbajúci index bolí dvakrát:
-- pri bežnom filtrovaní (`where order_id = …`) a najmä pri mazaní rodičovského
-- riadku — vtedy musí databáza prejsť celú dcérsku tabuľku sekvenčne, aby
-- overila, že naň nič neodkazuje.
--
-- Tabuľky sú dnes malé, takže je to lacné teraz a drahé neskôr.

-- Predaj: rastie najrýchlejšie a `seat_inventory.order_id` sa používa pri
-- každom doplatení, storne aj vrátení peňazí.
create index if not exists seat_inventory_order_id_idx on public.seat_inventory(order_id);
create index if not exists orders_cashier_id_idx on public.orders(cashier_id);
create index if not exists orders_coupon_id_idx on public.orders(coupon_id);
create index if not exists orders_refunded_by_idx on public.orders(refunded_by);
create index if not exists bank_transactions_matched_order_id_idx
  on public.bank_transactions(matched_order_id);

-- Sály a podujatia
create index if not exists events_venue_layout_id_idx on public.events(venue_layout_id);
create index if not exists venues_default_layout_id_idx on public.venues(default_layout_id);
create index if not exists event_price_categories_price_category_id_idx
  on public.event_price_categories(price_category_id);

-- Pokladňa
create index if not exists pos_closings_cashier_id_idx on public.pos_closings(cashier_id);
create index if not exists pos_closings_created_by_idx on public.pos_closings(created_by);
create index if not exists pos_closings_session_id_idx on public.pos_closings(session_id);
create index if not exists pos_documents_created_by_idx on public.pos_documents(created_by);

-- Vyúčtovanie a náklady
create index if not exists settlements_event_id_idx on public.settlements(event_id);
create index if not exists settlements_created_by_idx on public.settlements(created_by);
create index if not exists organizer_costs_event_id_idx on public.organizer_costs(event_id);
create index if not exists organizer_costs_created_by_idx on public.organizer_costs(created_by);

-- Ostatné väzby na používateľa: tabuľky sú malé, ale index tu nestojí prakticky
-- nič a chráni mazanie používateľa pred sekvenčným prechodom.
create index if not exists coupons_created_by_idx on public.coupons(created_by);
create index if not exists order_notes_author_id_idx on public.order_notes(author_id);
create index if not exists email_templates_updated_by_idx on public.email_templates(updated_by);
create index if not exists wallet_settings_updated_by_idx on public.wallet_settings(updated_by);
