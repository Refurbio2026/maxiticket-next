-- Samoobslužná registrácia organizátora, verejný profil a schvaľovanie účtu.
--
-- Nadväzuje na `20261002120000_organizator_subdomena.sql`: adresu organizátora
-- drží **`profiles.subdomain`** z tej migrácie a nič tu nezavádza vedľa nej.
-- Jedna hodnota obsluhuje obe cesty — dnes `eticketo.eu/o/<subdomain>`, po
-- zavedení zástupného DNS záznamu a wildcard certifikátu `<subdomain>.eticketo.eu`
-- — takže odkazy, ktoré organizátor rozpošle dnes, ostanú v platnosti.
--
-- Doteraz: asistent v admine vedel organizátora založiť na jeden priechod, ale
-- kto prišiel sám cez `/register`, vyplnil IČO a fakturačnú adresu rovno pri
-- registrácii a `requested_role` sa odložilo do metadát účtu. Verejne o ňom
-- neexistovalo nič okrem mena v detaile podujatia — žiadne logo, popis ani
-- odkazy na siete.
--
-- Odteraz: registrácia je krátka (e-mail, heslo, meno) a zvyšok vypĺňa
-- sprievodca na `/onboarding`. Je prerušiteľný — stav drží `onboarding_step` —
-- a na konci putuje žiadosť adminovi. **Kým účet nie je schválený, podujatie sa
-- nedá zverejniť**, a vynucuje to trigger, nie UI.
--
-- Želaná rola v metadátach (`requested_role`) prestáva byť zdrojom pravdy:
-- stav účtu je stĺpec, takže sa dá filtrovať, auditovať a opierať o neho
-- podmienku v databáze.

-- --- stav organizátorského účtu --------------------------------------------
-- 'none'       bežný kupujúci, o rolu nikdy nepožiadal
-- 'onboarding' prihlásil sa ako organizátor, vypĺňa sprievodcu
-- 'pending'    žiadosť odoslaná, čaká na admina
-- 'approved'   schválený, smie zverejňovať a predávať
-- 'rejected'   zamietnutý s dôvodom; smie údaje opraviť a požiadať znova
-- 'suspended'  pozastavený napriek tomu, že už raz schválený bol
create type public.organizer_status as enum
  ('none', 'onboarding', 'pending', 'approved', 'rejected', 'suspended');

-- --- verejná identita a stav v profile -------------------------------------
-- Adresa (`subdomain`) tu zámerne nie je — pridáva ju predchádzajúca migrácia.
alter table public.profiles
  -- Pod čím organizátor vystupuje na webe. Zámerne iné pole ako `company_name`:
  -- na vstupenke a faktúre musí byť obchodné meno z registra („ABC s. r. o."),
  -- na plagáte chce mať značku („Amfiteáter Zvolen").
  add column if not exists display_name text,
  add column if not exists bio text,
  add column if not exists logo_url text,
  add column if not exists cover_url text,
  add column if not exists website text,
  add column if not exists city text,
  -- Platca DPH. Bez tohto sa pri fakturácii nedá rozhodnúť, či sa sadzba
  -- vôbec uplatňuje; `vat_rate` na podujatí je až o sadzbe.
  add column if not exists vat_payer boolean not null default false,
  -- Nechce byť v katalógu eticketa a chce len vlastnú adresu (whitelabel).
  add column if not exists listed_in_catalog boolean not null default true,
  -- Storno podmienky a kontakt na reklamácie. Pri predaji na diaľku to kupujúci
  -- musí vidieť pred nákupom, takže to patrí k organizátorovi, nie do VOP
  -- platformy — každý má iné.
  add column if not exists cancellation_policy text,
  add column if not exists complaint_contact text,
  add column if not exists payout_frequency text
    check (payout_frequency is null or payout_frequency in ('per_event', 'monthly')),
  -- Dokiaľ sa sprievodca dostal. 0 = nezačatý, 99 = dokončený.
  add column if not exists onboarding_step smallint not null default 0,
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists organizer_status public.organizer_status not null default 'none',
  add column if not exists organizer_requested_at timestamptz,
  add column if not exists organizer_approved_at timestamptz,
  add column if not exists organizer_approved_by uuid references auth.users (id) on delete set null,
  -- Dôvod zamietnutia alebo pozastavenia. Organizátor ho vidí v sprievodcovi,
  -- inak by nevedel, čo opraviť.
  add column if not exists organizer_review_note text,
  -- Ktorú verziu VOP odklikol. Bez verzie je súhlas nedokázateľný.
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

comment on column public.profiles.organizer_status is
  'Stav organizátorského účtu. Nahrádza želanú rolu v metadátach auth — tá sa '
  'nedala filtrovať ani použiť ako podmienka v databáze.';

-- --- sociálne siete --------------------------------------------------------
-- Vlastná tabuľka, nie stĺpce v profile: siete pribúdajú a odchádzajú a každá
-- nová by inak znamenala migráciu. Jeden odkaz na platformu stačí.
create table if not exists public.organizer_links (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in (
    'facebook', 'instagram', 'youtube', 'tiktok', 'x', 'linkedin',
    'spotify', 'bandcamp', 'soundcloud', 'threads', 'telegram'
  )),
  url text not null check (url ~* '^https?://' and length(url) <= 500),
  sort_order smallint not null default 100,
  created_at timestamptz not null default now(),
  unique (organizer_id, platform)
);

create index if not exists organizer_links_organizer_idx
  on public.organizer_links (organizer_id, sort_order);

alter table public.organizer_links enable row level security;
grant select, insert, update, delete on public.organizer_links to authenticated;
grant all on public.organizer_links to service_role;

drop policy if exists organizer_links_owner_all on public.organizer_links;
create policy organizer_links_owner_all on public.organizer_links
  for all to authenticated
  using (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
  with check (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- --- prevod názvu na adresu ------------------------------------------------
-- Rovnaké pravidlo ako `navrhSubdomeny` v `src/lib/subdomena.ts`, len v SQL —
-- potrebuje ho dopočítanie adries existujúcim organizátorom nižšie.
-- `unaccent` je rozšírenie, ktoré tu nemusí byť zapnuté, a na slovenčinu
-- stačí explicitná tabuľka znakov.
create or replace function public.slugify(txt text)
returns text
language sql
immutable
as $$
  select nullif(
    btrim(
      regexp_replace(
        lower(translate(coalesce(txt, ''),
          'áäčďéëěíľĺňóôöőřŕšťúüűůýžÁÄČĎÉËĚÍĽĹŇÓÔÖŐŘŔŠŤÚÜŰŮÝŽ',
          'aacdeeeillnoooorrstuuuuyzaacdeeeillnoooorrstuuuuyz')),
        '[^a-z0-9]+', '-', 'g'),
      '-'),
    '');
$$;

comment on function public.slugify(text) is
  'Názov organizátora na adresu. Slovenská diakritika je mapovaná ručne, '
  'aby funkcia nezávisela od rozšírenia unaccent.';

-- --- existujúci organizátori už predávajú, nech ich trigger nezablokuje -----
-- Bez tohto by podmienka nižšie zhodila najbližšiu úpravu každého z dnešných
-- zverejnených podujatí: ich majitelia majú `organizer_status` = 'none'.
--
-- Adresu dostane len ten, kto ju ešte nemá — subdoménu si už niektorým mohol
-- nastaviť asistent v admine a tú neprepisujeme.
do $$
declare
  r record;
  zaklad text;
  kandidat text;
  i int;
  -- Zrkadlo `profiles_subdomain_rezervovane` z predchádzajúcej migrácie; keby
  -- z názvu vyšlo rezervované slovo, CHECK by zápis odmietol.
  rezervovane text[] := array[
    'www','api','admin','app','mail','smtp','imap','ftp','ns1','ns2',
    'static','cdn','assets','img','images','files','download',
    'scanner','organizer','checkout','account','login','register',
    'support','help','status','blog','shop','pay','payments',
    'eticketo','tticketo','maxiticket','vipky','test','dev','staging',
    'local','localhost'
  ];
begin
  for r in
    select p.id,
           coalesce(nullif(btrim(p.company_name), ''), nullif(btrim(p.full_name), '')) as nazov,
           p.subdomain,
           exists (
             select 1 from public.user_roles ur
              where ur.user_id = p.id and ur.role = 'organizer'
           ) as je_organizator
      from public.profiles p
     where exists (
             select 1 from public.user_roles ur
              where ur.user_id = p.id and ur.role in ('organizer', 'admin')
           )
  loop
    update public.profiles
       set organizer_status = 'approved',
           organizer_approved_at = coalesce(organizer_approved_at, now()),
           onboarding_step = 99,
           onboarding_completed_at = coalesce(onboarding_completed_at, now()),
           display_name = coalesce(display_name, r.nazov)
     where id = r.id
       and organizer_status = 'none';

    -- Adresu dostane len skutočný organizátor. Admin, ktorý nič neorganizuje,
    -- nemá čo robiť vo verejnom zobrazení.
    continue when not r.je_organizator or r.subdomain is not null;

    zaklad := left(coalesce(public.slugify(r.nazov), 'organizator'), 30);
    if length(zaklad) < 3 then
      zaklad := 'organizator';
    end if;
    if zaklad = any (rezervovane) then
      zaklad := zaklad || '-eu';
    end if;

    kandidat := zaklad;
    i := 1;
    while exists (
      select 1 from public.profiles x where lower(x.subdomain) = kandidat
    ) loop
      i := i + 1;
      kandidat := zaklad || '-' || i;
    end loop;

    update public.profiles set subdomain = kandidat where id = r.id and subdomain is null;
  end loop;
end $$;

-- --- zverejniť podujatie smie len schválený organizátor ---------------------
-- V UI by to bola len nápoveda; tu je to podmienka. Admin je schválený vždy,
-- aj keby mu stav v profile nikto nenastavil.
create or replace function public.assert_organizer_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  stav public.organizer_status;
begin
  if new.status <> 'published' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' then
    return new;   -- už zverejnené bolo, úpravu neblokujeme
  end if;

  if public.has_role(new.organizer_id, 'admin') then
    return new;
  end if;

  select p.organizer_status into stav
    from public.profiles p where p.id = new.organizer_id;

  if stav is distinct from 'approved' then
    raise exception
      'Podujatie sa nedá zverejniť: organizátorský účet nie je schválený (stav: %).',
      coalesce(stav::text, 'bez profilu')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.assert_organizer_approved() from anon, authenticated, public;

drop trigger if exists trg_events_organizator_schvaleny on public.events;
create trigger trg_events_organizator_schvaleny
  before insert or update of status on public.events
  for each row execute function public.assert_organizer_approved();

-- --- verejný pohľad na organizátora ----------------------------------------
-- `profiles` obsahuje IBAN na výplatu aj dohodnutú províziu, takže verejná
-- stránka z tej tabuľky nesmie čítať ani náhodou. Tento pohľad má len stĺpce,
-- ktoré môžu byť na plagáte, a vidí výhradne schválených organizátorov, ktorí
-- súhlasili so zobrazením.
create or replace view public.public_organizers
with (security_invoker = true) as
select p.id,
       p.subdomain,
       coalesce(nullif(btrim(p.display_name), ''), p.company_name, p.full_name) as display_name,
       p.company_name,
       p.ico,
       p.bio,
       p.logo_url,
       p.cover_url,
       p.website,
       p.city,
       p.cancellation_policy,
       p.complaint_contact
  from public.profiles p
 where p.organizer_status = 'approved'
   and p.listed_in_catalog
   and p.subdomain is not null;

comment on view public.public_organizers is
  'Verejné stĺpce organizátora pre /o/<subdomain>. Zámerne bez payout_iban, '
  'commission_rate a fakturačnej adresy — tie na verejnú stránku nepatria.';

revoke all on public.public_organizers from anon, authenticated;
grant select on public.public_organizers to service_role;

-- --- čo si organizátor smie prepísať sám -----------------------------------
-- Doteraz platilo `grant update on profiles to authenticated` + politika
-- „vlastný profil", takže organizátor si z prehliadača vedel nastaviť
-- `commission_rate` na nulu. Nikto to nerobil (všetky zápisy idú cez server
-- a service_role), ale dvere boli otvorené — a s `organizer_status` by za nimi
-- bolo samoschválenie.
--
-- `subdomain` v zozname zámerne **nie je**: adresu si organizátor nastavuje
-- v sprievodcovi, ale ten ide cez server, ktorý kontroluje obsadenosť aj tvar.
revoke insert, update on public.profiles from authenticated;
grant insert (
  id, full_name, company_name, ico, dic, ic_dph, billing_address, phone,
  payout_iban, display_name, bio, logo_url, cover_url, website, city,
  vat_payer, listed_in_catalog, cancellation_policy, complaint_contact,
  payout_frequency, onboarding_step, terms_accepted_at, terms_version,
  created_at, updated_at
) on public.profiles to authenticated;
grant update (
  full_name, company_name, ico, dic, ic_dph, billing_address, phone,
  payout_iban, display_name, bio, logo_url, cover_url, website, city,
  vat_payer, listed_in_catalog, cancellation_policy, complaint_contact,
  payout_frequency, onboarding_step, terms_accepted_at, terms_version,
  updated_at
) on public.profiles to authenticated;

-- --- nový používateľ: stav podľa toho, ako prišiel --------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  stav public.organizer_status;
begin
  -- `invited_as` majú účty, ktoré založil admin asistentom — tie sú schválené
  -- tým, že ich založil, a do frontu žiadostí nepatria. `requested_role`
  -- posiela verejná registrácia; rola sa ani v jednom prípade neudeľuje tu.
  stav := case
    when new.raw_user_meta_data ->> 'invited_as' = 'organizer' then 'approved'
    when new.raw_user_meta_data ->> 'requested_role' = 'organizer' then 'onboarding'
    else 'none'
  end;

  insert into public.profiles (
    id, full_name, company_name, ico, dic, ic_dph, billing_address, phone,
    organizer_status, organizer_approved_at
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.raw_user_meta_data ->> 'company_name',
    new.raw_user_meta_data ->> 'ico',
    new.raw_user_meta_data ->> 'dic',
    new.raw_user_meta_data ->> 'ic_dph',
    new.raw_user_meta_data ->> 'billing_address',
    new.raw_user_meta_data ->> 'phone',
    stav,
    case when stav = 'approved' then now() end
  );
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end;
$$;
