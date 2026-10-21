-- ComGate ako piata platobná brána (CZK a EUR).
--
-- Dva riadky práce: hodnota do enumu a prepínač v admine. Prístupy sa
-- ukladajú šifrovane do `integration_credentials` ako pri ostatných bránach,
-- takže tu k nim nič netreba.
--
-- Bez hodnoty v enume by doúčtovanie spadlo pri zápise `orders.payment_provider`
-- — presne na tom by prvá ostrá platba skončila tým, že peniaze prišli
-- a vstupenka nevznikla.
--
-- `add value` sa v transakcii vykonať smie, ale použiť tú hodnotu až po
-- commite — preto ju kontrola nižšie neskúša vložiť do objednávky.
alter type public.payment_provider add value if not exists 'comgate';

alter table public.payment_settings
  add column if not exists comgate_enabled boolean not null default true;

comment on column public.payment_settings.comgate_enabled is
  'Prepínač brány ComGate v admine. Bez vyplnených prístupov sa neponúkne ani keď je zapnutá.';

-- Kontrola: prepínač existuje a nikto cudzí ho nesmie prepísať.
do $$
declare
  zle text := '';
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_settings'
      and column_name = 'comgate_enabled'
  ) then
    zle := zle || 'chýba payment_settings.comgate_enabled; ';
  end if;

  -- Nastavenia platobných brán smie meniť len server. Pri `anon` to drží RLS
  -- (nemá na tabuľke zápisovú politiku), nie práva po stĺpcoch — tabuľkové
  -- UPDATE od Supabase by odobranie po stĺpcoch neprebilo.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payment_settings'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and roles::text[] && array['anon', 'public']
  ) then
    zle := zle || 'anon má zápisovú politiku na payment_settings; ';
  end if;

  if zle <> '' then
    raise exception 'Migrácia ComGate: %', zle;
  end if;
  raise notice 'ComGate: enum aj prepínač v poriadku';
end $$;
