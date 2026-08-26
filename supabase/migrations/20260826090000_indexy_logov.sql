-- Indexy pre prehľad prevádzky.
--
-- Prehľad sa pýta logov vždy rovnako: „chyby za posledné tri dni". Kým boli
-- tabuľky prázdne, nebolo to vidieť; pri ostrom predaji do nich pribúda
-- riadok ku každému e-mailu a každej platbe, a bez indexu by sa pri každom
-- otvorení stránky čítali celé.
create index if not exists payment_logs_chyby_idx
  on public.payment_logs (created_at desc) where status = 'error';
create index if not exists email_logs_chyby_idx
  on public.email_logs (created_at desc) where status = 'error';
create index if not exists superfaktura_logs_chyby_idx
  on public.superfaktura_logs (created_at desc) where status = 'error';

-- Duplicitné platby sa hľadajú podľa prefixu endpointu, nie podľa stavu.
create index if not exists payment_logs_duplicitne_idx
  on public.payment_logs (created_at desc) where endpoint like 'duplicitna_platba%';

-- Prehľad aj dopytovací sken hľadajú „zaplatené od kedy". Samotný status_idx
-- na to nestačí, lebo zaplatených objednávok bude drvivá väčšina.
create index if not exists orders_paid_created_idx
  on public.orders (created_at desc) where status = 'paid';
