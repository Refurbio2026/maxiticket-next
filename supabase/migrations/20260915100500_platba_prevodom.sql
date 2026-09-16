-- Kanál „platba prevodom": objednávka s variabilným symbolom, ktorú zákazník
-- zaplatí z účtu a dokončí ju až spárovanie bankového výpisu.
--
-- Nie je to nová objednávková vetva, je to iná splatnosť tej istej objednávky.
-- Preto sa tu nezakladá žiadna tabuľka rezervácií:
--
-- - číselný VS už prideľuje `next_payment_ref()`,
-- - `orders.payment_method = 'transfer'` už check pripúšťa (migrácia POS),
-- - lehota je `orders.expires_at` a zrušenie po nej robí `expire_stale_orders()`,
--   ktoré uvoľní sedadlá aj vráti kupón.
--
-- Pribúda teda len to, čo naozaj chýba: počítanie pracovných dní so sviatkami,
-- pripomienka a nastavenie platobných údajov.

-- --- Sviatky a pracovné dni ---------------------------------------------
-- Lehota „2 pracovné dni" sa bez sviatkov počíta zle. Cez Veľkú noc alebo
-- v novoročnom týždni by sa rezervácia zrušila skôr, než mal zákazník šancu
-- zaplatiť — banka medzitým nepracovala.

create table if not exists public.sk_holidays (
  day date primary key,
  name text not null
);

-- Pevné sviatky a dni pracovného pokoja pre roky 2026–2030.
insert into public.sk_holidays (day, name)
select make_date(y, m, d), nazov
from generate_series(2026, 2030) as y,
     (values
       (1, 1, 'Deň vzniku Slovenskej republiky'),
       (1, 6, 'Zjavenie Pána'),
       (5, 1, 'Sviatok práce'),
       (5, 8, 'Deň víťazstva nad fašizmom'),
       (7, 5, 'Sviatok svätého Cyrila a Metoda'),
       (8, 29, 'Výročie SNP'),
       (9, 1, 'Deň Ústavy Slovenskej republiky'),
       (9, 15, 'Sedembolestná Panna Mária'),
       (11, 1, 'Sviatok všetkých svätých'),
       (11, 17, 'Deň boja za slobodu a demokraciu'),
       (12, 24, 'Štedrý deň'),
       (12, 25, 'Prvý sviatok vianočný'),
       (12, 26, 'Druhý sviatok vianočný')
     ) as sviatky(m, d, nazov)
on conflict (day) do nothing;

-- Pohyblivé sviatky sa vypočítať nedajú bez výpočtu Veľkej noci, takže sú
-- vypísané. Po roku 2030 treba doplniť ďalšie — kontrola v Prevádzke na to
-- upozorní skôr, než lehoty začnú byť nepresné.
insert into public.sk_holidays (day, name) values
  ('2026-04-03', 'Veľký piatok'),        ('2026-04-06', 'Veľkonočný pondelok'),
  ('2027-03-26', 'Veľký piatok'),        ('2027-03-29', 'Veľkonočný pondelok'),
  ('2028-04-14', 'Veľký piatok'),        ('2028-04-17', 'Veľkonočný pondelok'),
  ('2029-03-30', 'Veľký piatok'),        ('2029-04-02', 'Veľkonočný pondelok'),
  ('2030-04-19', 'Veľký piatok'),        ('2030-04-22', 'Veľkonočný pondelok')
on conflict (day) do nothing;

create or replace function public.is_business_day(p_day date)
returns boolean
language sql
stable
set search_path = public
as $$
  select extract(isodow from p_day) < 6
     and not exists (select 1 from public.sk_holidays h where h.day = p_day);
$$;

/*
 * Posunie okamih o zadaný počet pracovných dní dopredu. Čas dňa zostáva.
 *
 * Počíta sa nad bratislavským dátumom — polnoc v UTC je u nás ešte
 * predchádzajúci deň a lehota by sa o deň líšila podľa ročného obdobia.
 */
create or replace function public.add_business_days(p_from timestamptz, p_days integer)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_local timestamp := p_from at time zone 'Europe/Bratislava';
  v_date date := v_local::date;
  v_left integer := greatest(p_days, 0);
begin
  while v_left > 0 loop
    v_date := v_date + 1;
    if public.is_business_day(v_date) then
      v_left := v_left - 1;
    end if;
  end loop;
  return (v_date + v_local::time) at time zone 'Europe/Bratislava';
end;
$$;

alter table public.sk_holidays enable row level security;

-- Sviatky nie sú tajomstvo a číta ich aj odhlásený návštevník pri výbere
-- platby prevodom (potrebuje vidieť lehotu splatnosti).
drop policy if exists sk_holidays_read on public.sk_holidays;
create policy sk_holidays_read on public.sk_holidays for select to anon, authenticated using (true);

drop policy if exists sk_holidays_admin_write on public.sk_holidays;
create policy sk_holidays_admin_write on public.sk_holidays
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

grant select on public.sk_holidays to anon, authenticated;
grant insert, update, delete on public.sk_holidays to authenticated;
grant execute on function public.is_business_day(date) to anon, authenticated, service_role;
grant execute on function public.add_business_days(timestamptz, integer) to anon, authenticated, service_role;

-- --- Nastavenie kanála --------------------------------------------------

alter table public.platform_settings
  add column if not exists transfer_enabled boolean not null default false,
  add column if not exists transfer_days_to_reminder smallint not null default 2
    check (transfer_days_to_reminder between 1 and 30),
  add column if not exists transfer_days_to_cancel smallint not null default 2
    check (transfer_days_to_cancel between 1 and 30),
  -- Objednávka na prevod drží sedadlá niekoľko dní. Na sedadlových
  -- podujatiach sa preto prevod zapína vedome, nie mimochodom.
  add column if not exists transfer_seated_allowed boolean not null default false,
  add column if not exists transfer_iban text,
  add column if not exists transfer_holder text,
  add column if not exists transfer_bank_name text;

comment on column public.platform_settings.transfer_seated_allowed is
  'Povoliť platbu prevodom aj pri podujatiach s výberom sedadiel. '
  'Predvolene vypnuté — objednávka drží sedadlá až do vypršania lehoty.';

-- --- Objednávka na prevod -----------------------------------------------

alter table public.orders
  -- Obchodná lehota pre zákazníka a admina. Zrušenie samotné sa riadi
  -- `expires_at`, ktoré už spracúva `expire_stale_orders()`.
  add column if not exists transfer_due_at timestamptz,
  -- Vlastný stĺpec: `reminder_sent_at` patrí pripomienke pred podujatím
  -- a zdieľať sa nesmú, inak by jedna umlčala druhú.
  add column if not exists transfer_reminder_sent_at timestamptz;

comment on column public.orders.transfer_due_at is
  'Dokedy má prísť prevod. Informatívne pre e-mail a admin; lehotu vynucuje expires_at.';
comment on column public.orders.transfer_reminder_sent_at is
  'Kedy odišla pripomienka nezaplatenej platby prevodom.';

-- Cron hľadá nezaplatené objednávky na prevod. Bez indexu by prechádzal
-- všetky objednávky každú hodinu.
create index if not exists orders_prevod_cakajuce_idx
  on public.orders (expires_at)
  where payment_method = 'transfer' and status = 'awaiting_payment';
