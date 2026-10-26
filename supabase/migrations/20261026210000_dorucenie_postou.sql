-- Doručenie vstupeniek poštou (ePodací hárok Slovenskej pošty).
--
-- Doteraz existovala jediná cesta: vstupenka s QR kódom e-mailom. Táto
-- migrácia pridáva k objednávke druhú možnosť — obálku na adresu — a stopy
-- po podaji na pošte.
--
-- PREČO NOVÉ STĹPCE A NIE `customer_street`: tie sú fakturačná adresa a
-- idú na faktúru. Doručovacia adresa je iná vec (darček babke, firma
-- fakturuje na sídlo a vstupenky chce na prevádzku) a na faktúre nemá čo robiť.
--
-- PREČO POŠTOVNÉ NIE AKO `order_items`: z položiek objednávky sa generujú
-- vstupenky. Riadok „Poštovné" by sa stal vstupenkou s QR kódom.
-- Preto vlastný stĺpec a na faktúre sa pripočíta ako samostatná položka.

alter table public.orders
  add column if not exists delivery_method text not null default 'email',
  add column if not exists delivery_fee numeric(10, 2) not null default 0,
  add column if not exists delivery_name text,
  add column if not exists delivery_street text,
  add column if not exists delivery_city text,
  add column if not exists delivery_zip text,
  add column if not exists delivery_country text,
  -- Číslo hárku, ktoré vrátila pošta pri importe. Jeden hárok = jeden podaj
  -- s viacerými objednávkami, preto je rovnaké na viacerých riadkoch.
  add column if not exists eph_sheet_id text,
  -- Podacie číslo zásielky. Prideľuje ho pošta, zákazník si ním zásielku
  -- sleduje. Dopĺňa sa až po spracovaní hárku.
  add column if not exists eph_code text,
  add column if not exists posted_at timestamptz;

-- Len to, čo naozaj vieme doručiť. Keby sem klient dostal čokoľvek, pokladňa
-- by prijala objednávku, ktorú nikto nikdy neodošle.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_delivery_method_check'
  ) then
    alter table public.orders
      add constraint orders_delivery_method_check
      check (delivery_method in ('email', 'posta'));
  end if;
end $$;

-- Poštovné nesmie byť záporné — inak by zľavou na doprave vznikla objednávka
-- s nižšou sumou, než je cena vstupeniek.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_delivery_fee_check'
  ) then
    alter table public.orders
      add constraint orders_delivery_fee_check check (delivery_fee >= 0);
  end if;
end $$;

-- Objednávka na poštu musí mať adresu. Kontrola je aj v pokladni, ale tá
-- platí len pre náš kód — toto platí aj pre ruku v admine a pre import.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_delivery_adresa_check'
  ) then
    alter table public.orders
      add constraint orders_delivery_adresa_check
      check (
        delivery_method <> 'posta'
        or (
          coalesce(btrim(delivery_name), '') <> ''
          and coalesce(btrim(delivery_street), '') <> ''
          and coalesce(btrim(delivery_city), '') <> ''
          and coalesce(btrim(delivery_zip), '') <> ''
        )
      );
  end if;
end $$;

comment on column public.orders.delivery_method is
  'email = vstupenka s QR kódom e-mailom (predvolené), posta = obálka na adresu cez ePodací hárok.';
comment on column public.orders.delivery_fee is
  'Poštovné zaplatené zákazníkom. Je súčasťou total_amount a samostatnou položkou na faktúre.';
comment on column public.orders.eph_sheet_id is
  'Číslo ePodacieho hárku od Slovenskej pošty. Jeden hárok pokrýva viac objednávok.';
comment on column public.orders.eph_code is
  'Podacie číslo zásielky od pošty — podľa neho si zákazník zásielku sleduje.';
comment on column public.orders.posted_at is
  'Kedy zásielka išla do hárku. Prázdne pri zaplatenej objednávke = čaká na podaj.';

-- Front na odoslanie: zaplatené, poštou, ešte nepodané. Pri malom počte by
-- stačil seq scan, ale tento zoznam sa v admine otvára často a index je tu
-- lacný — čiastkový, takže z e-mailových objednávok nestojí nič.
create index if not exists orders_na_podaj_idx
  on public.orders (paid_at)
  where delivery_method = 'posta' and posted_at is null;

-- Kontrola, že migrácia naozaj urobila, čo sľubuje.
do $$
declare
  zle text := '';
  chybajuce text;
begin
  select string_agg(c, ', ') into chybajuce
  from unnest(array[
    'delivery_method', 'delivery_fee', 'delivery_name', 'delivery_street',
    'delivery_city', 'delivery_zip', 'delivery_country',
    'eph_sheet_id', 'eph_code', 'posted_at'
  ]) as c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = c
  );
  if chybajuce is not null then
    zle := zle || 'chýbajú stĺpce: ' || chybajuce || '; ';
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'orders_delivery_method_check'
  ) then
    zle := zle || 'chýba kontrola spôsobu doručenia; ';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'orders_delivery_adresa_check'
  ) then
    zle := zle || 'chýba kontrola adresy pri pošte; ';
  end if;
  if not exists (
    select 1 from pg_class where relname = 'orders_na_podaj_idx'
  ) then
    zle := zle || 'chýba index na front podaja; ';
  end if;

  -- Existujúce objednávky musia zostať e-mailové. Keby default neplatil,
  -- starým objednávkam by sa zmenil spôsob doručenia.
  if exists (
    select 1 from public.orders where delivery_method is distinct from 'email'
      and posted_at is null and eph_sheet_id is null and delivery_fee = 0
      and delivery_street is null
  ) then
    zle := zle || 'staré objednávky nezostali e-mailové; ';
  end if;

  if zle <> '' then
    raise exception 'Migrácia doručenia poštou: %', zle;
  end if;
  raise notice 'Doručenie poštou: stĺpce, kontroly aj index v poriadku';
end $$;
