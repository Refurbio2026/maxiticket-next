# End-to-End Ticketing Flow

Zostavím kompletný flow: admin vytvorí podujatie (voliteľne s mapou sedenia z Editora hál), zákazník ho vidí na `/events`, vyberie sedadlá, prejde checkoutom a dostane vstupenku s QR kódom.

## 1. Databázové zmeny (migrácia)

Pridám / rozšírim tabuľky:

- **events** — pridám stĺpce: `sale_type` ('standing' | 'seating' | 'seating_map'), `venue_layout_id` (uuid, nullable), `base_price` (numeric), `total_tickets` (int)
- **venue_layouts** — `id`, `name`, `layout_json` (jsonb), `created_by`, timestamps (ak ešte neexistuje plnohodnotná tabuľka — momentálne je v `localStorage`/lokálnej knižnici, presuniem do DB)
- **event_seat_inventory** — `id`, `event_id`, `seat_id` (string z layoutu), `status` ('available' | 'reserved' | 'sold'), `price` (numeric, prepíše base_price pre VIP), `reserved_until`, `reserved_by` (uuid), `order_id`
- **orders** — `id`, `event_id`, `user_id` (nullable pre guest), `customer_name`, `customer_email`, `customer_phone`, `total_amount`, `status` ('pending' | 'paid' | 'cancelled' | 'expired'), `expires_at`, timestamps
- **order_items** — `id`, `order_id`, `seat_id` (nullable pre státie), `label` (napr. „Rad A, Sedadlo 5"), `price`
- **tickets** — `id`, `order_id`, `event_id`, `seat_label` (nullable), `qr_code` (text, unikátny token), `status` ('valid' | 'used' | 'refunded'), `issued_at`
- **payments** — `id`, `order_id`, `amount`, `method` ('demo'), `status` ('succeeded' | 'failed'), `paid_at`

RLS politiky:
- `events`, `venue_layouts`: public read pre publikované; admin/organizer write
- `event_seat_inventory`: public read; authenticated insert/update vlastných rezervácií; service role pre cleanup
- `orders`, `order_items`, `tickets`, `payments`: vlastník (user_id alebo email match) + admin

Funkcie:
- `release_expired_reservations()` — uvoľní sedadlá kde `reserved_until < now()` a status = 'reserved'
- `reserve_seats(event_id, seat_ids[], user_id)` — atomicky rezervuje, vráti error ak nejaké už nie sú dostupné

## 2. Migrácia z localStorage venue_layouts do DB

Editor hál momentálne ukladá do lokálnej knižnice. Prepojím `SeatingEditor` na novú tabuľku `venue_layouts` (Supabase). Zachovám zoznam, ukladanie, načítanie po refreshi.

## 3. Admin: formulár pre podujatie

Na `/admin/events` (nahradím existujúcu stránku ak je placeholder):

- Tlačidlo „Pridať podujatie" → otvorí dialog s formulárom
- Polia: názov, kategória, organizátor (auto = current admin), dátum, čas, miesto, mesto, popis, URL obrázka, status (draft/published), sale_type (3 voľby), venue_layout (select, povinný ak sale_type='seating_map'), base_price, total_tickets
- Submit → insert do `events`
- Tlačidlo „Vytvoriť testovacie podujatie" → predvyplní „Test koncert s mapou sedenia" + posledný venue_layout

## 4. Verejný frontend `/events`

Zoznam publikovaných podujatí — karty s obrázkom, názvom, dátumom, mestom, miestom, cenou od, CTA „Kúpiť vstupenky".

## 5. Detail `/events/$id`

Zobrazí info + tlačidlo „Vybrať vstupenky".

- Ak `sale_type='seating_map'`: načítam `venue_layout.layout_json`, vykreslím **read-only Konva seating map** pre zákazníka (`CustomerSeatingMap` komponent). Sedadlá farebne: voľné (zelené), vybrané (modré), rezervované (žlté), predané (sivé), VIP (zlaté). Klik prepína výber. Predané/rezervované nereagujú.
- Ak `sale_type='seating'` alebo `'standing'`: jednoduchý qty selector.

Sticky panel vpravo: vybrané sedadlá, počet, total, CTA „Pokračovať do checkoutu".

## 6. Rezervácia → checkout

Server function `createOrderAndReserve({ eventId, seatIds, qty })`:
1. INSERT order (status=pending, expires_at = now + 10 min)
2. Pre seating_map: UPSERT do `event_seat_inventory` so status='reserved', reserved_until, reserved_by, order_id. Ak ktorékoľvek sedadlo už nie je available → rollback, error.
3. INSERT order_items
4. Vráti `orderId` → redirect na `/checkout/$orderId`

## 7. Checkout `/checkout/$orderId`

Zhrnutie + form (meno, priezvisko, email, telefón, súhlas s OP). Countdown 10 min.

Tlačidlo „Simulovať úspešnú platbu" → server function `simulatePayment(orderId)`:
1. INSERT payment (status=succeeded)
2. UPDATE order status='paid'
3. UPDATE event_seat_inventory status='sold' pre tento order
4. INSERT tickets (s unikátnym qr_code = UUID/JWT-like token)
5. Redirect na `/checkout/success/$orderId`

## 8. Success `/checkout/success/$orderId`

Ďakovná stránka, číslo objednávky, zoznam vstupeniek s QR kódmi (knižnica `qrcode` alebo `qrcode.react`), tlačidlo „Stiahnuť" (print to PDF / window.print), návrat na `/events`.

## 9. Auto-release expirovaných rezervácií

Pri každom načítaní detailu podujatia (server fn `getEventWithInventory`) najprv zavolám `release_expired_reservations()`. Lacný cleanup bez cron-u.

## 10. Sidebar

Položka „Podujatia → Podujatia" musí smerovať na funkčnú admin stránku so zoznamom a tlačidlom „Pridať podujatie".

## Technické detaily

- Server functions cez `createServerFn` + `requireSupabaseAuth` (auth flows) a `supabaseAdmin` (public reads na detail podujatia + rezervácie pre guest).
- QR kód: `bun add qrcode.react`
- Pre guest checkout (bez prihlásenia) — `reserved_by` môže byť null, miesto toho použijem session id v `orders.customer_email` ako identifikátor. Pre jednoduchosť požiadam o prihlásenie — ale spravím guest path tiež (anon user_id z session).

## Testovanie (po implementácii)

1. Vytvorím venue layout v editore → uloží sa do DB
2. „Vytvoriť testovacie podujatie" → publikované s týmto layoutom
3. Otvorím `/events` → vidím ho
4. Klik na detail → vidím seating map
5. Vyberiem 2 sedadlá → Pokračovať
6. Vyplním checkout → Simulovať platbu
7. Vidím success s QR
8. Vrátim sa na detail → vybrané sedadlá sú „sold" (sivé, neklikateľné)

## Rozsah & čas

Toto je veľký kus práce — ~12-15 nových/upravených súborov + 1 veľká migrácia. Pôjdem inkrementálne v jednom pass-i, najprv DB, potom serverové funkcie, potom UI.
