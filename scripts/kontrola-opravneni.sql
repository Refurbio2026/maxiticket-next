-- Kontrola bezpečnostných kontrol na ostrej schéme.
--
-- Tieto veci sú postavené v migráciách a dokázať sa dajú len na skutočnej
-- databáze: v kóde ich neuvidíš a unit test ich nepokryje. Spusti to po každej
-- migrácii, ktorá sa dotkne práv, triggerov alebo pohľadov.
--
-- Časť 1 pracuje v transakcii, ktorá sa na konci **vráti** — mení stavy
-- profilov a podujatí len nazdanie, aby sa dalo overiť, že trigger naozaj
-- odmietne. Časť 2 je čisté čítanie katalógu práv.
--
-- Čítaj výstup: každý riadok má PRESLO alebo ZLYHALO. Jedno ZLYHALO znamená
-- dieru, nie kozmetiku.
--
--   /opt/maxiticket/restore/psql.sh -f scripts/kontrola-opravneni.sql
--
-- Overené 16. 10. 2026: 6 assertov v transakcii + 9 práv, všetko PRESLO.

begin;

\echo ''
\echo '=== 1) Trigger: neschválený organizátor nesmie zverejniť podujatie ==='
do $$
declare
  org uuid;
  ev  uuid;
  povolene boolean := false;
begin
  select e.organizer_id, e.id into org, ev
    from public.events e
    join public.profiles p on p.id = e.organizer_id
   where e.status = 'draft' and p.organizer_status = 'approved'
     and not public.has_role(e.organizer_id, 'admin')
   limit 1;
  if org is null then raise notice 'PRESKOČENÉ: nenašiel sa koncept schváleného organizátora'; return; end if;

  update public.profiles set organizer_status = 'pending' where id = org;
  begin
    update public.events set status = 'published' where id = ev;
    povolene := true;
  exception when others then
    raise notice 'PRESLO: trigger zverejnenie odmietol (%)', left(sqlerrm, 70);
  end;
  if povolene then raise warning 'ZLYHALO: neschválený organizátor zverejnil podujatie!'; end if;

  update public.profiles set organizer_status = 'approved' where id = org;
  begin
    update public.events set status = 'published' where id = ev;
    raise notice 'PRESLO: schválený organizátor zverejniť môže';
  exception when others then
    raise warning 'ZLYHALO: schválenému to trigger nedovolil (%)', left(sqlerrm, 70);
  end;
end $$;

\echo ''
\echo '=== 2) Brzda: p_weight účtuje sedadlá, nie volania ==='
do $$
declare pred int; po int;
begin
  perform public.hit_rate_limit('test:vaha', 1000, 600, 1);
  select count into pred from public.rate_limits
   where bucket = 'test:vaha' order by window_start desc limit 1;
  perform public.hit_rate_limit('test:vaha', 1000, 600, 5);
  select count into po from public.rate_limits
   where bucket = 'test:vaha' order by window_start desc limit 1;
  if po - pred = 5 then raise notice 'PRESLO: váha 5 pripočítala 5 (% → %)', pred, po;
  else raise warning 'ZLYHALO: váha 5 pripočítala % namiesto 5', po - pred; end if;
end $$;

\echo ''
\echo '=== 3) Pohľad public_organizers skrýva neschválených a skrytých ==='
do $$
declare org uuid; vidno int;
begin
  select id into org from public.profiles
   where organizer_status = 'approved' and listed_in_catalog and subdomain is not null limit 1;
  if org is null then raise notice 'PRESKOČENÉ: nenašiel sa zobrazený organizátor'; return; end if;

  select count(*) into vidno from public.public_organizers where id = org;
  if vidno = 1 then raise notice 'PRESLO: schválený a zobrazený je v pohľade'; end if;

  update public.profiles set organizer_status = 'pending' where id = org;
  select count(*) into vidno from public.public_organizers where id = org;
  if vidno = 0 then raise notice 'PRESLO: po zmene na pending z pohľadu zmizol';
  else raise warning 'ZLYHALO: neschválený je stále v pohľade'; end if;

  update public.profiles set organizer_status = 'approved', listed_in_catalog = false where id = org;
  select count(*) into vidno from public.public_organizers where id = org;
  if vidno = 0 then raise notice 'PRESLO: kto nechce byť v katalógu, v pohľade nie je';
  else raise warning 'ZLYHALO: skrytý organizátor je v pohľade'; end if;
end $$;

\echo ''
\echo '=== 4) Práva po stĺpcoch a funkciách (čisté čítanie) ==='
select x.popis, case when x.ma = x.cakane then 'PRESLO' else 'ZLYHALO' end as stav
from (
  select 'authenticated môže meniť payout_iban' as popis,
         has_column_privilege('authenticated','public.profiles','payout_iban','UPDATE') as ma, true as cakane
  union all select 'authenticated môže meniť display_name',
         has_column_privilege('authenticated','public.profiles','display_name','UPDATE'), true
  -- Toto bola diera: organizátor si vedel z prehliadača nastaviť províziu na nulu.
  union all select 'authenticated NEmôže meniť commission_rate',
         has_column_privilege('authenticated','public.profiles','commission_rate','UPDATE'), false
  -- A s organizer_status by to bolo samoschválenie.
  union all select 'authenticated NEmôže meniť organizer_status',
         has_column_privilege('authenticated','public.profiles','organizer_status','UPDATE'), false
  union all select 'authenticated NEmôže meniť subdomain',
         has_column_privilege('authenticated','public.profiles','subdomain','UPDATE'), false
  union all select 'anon NEsmie spustiť hold_seats',
         has_function_privilege('anon','public.hold_seats(uuid,uuid,text,jsonb,timestamptz)','EXECUTE'), false
  union all select 'anon NEsmie spustiť hit_rate_limit',
         has_function_privilege('anon','public.hit_rate_limit(text,integer,integer,integer)','EXECUTE'), false
  union all select 'anon NEvidí public_organizers',
         has_table_privilege('anon','public.public_organizers','SELECT'), false
  union all select 'service_role vidí public_organizers',
         has_table_privilege('service_role','public.public_organizers','SELECT'), true
) x order by stav, popis;

rollback;
