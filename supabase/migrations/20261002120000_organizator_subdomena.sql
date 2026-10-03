-- Vlastná subdoména organizátora: `divadlo.eticketo.eu`.
--
-- Drží sa pri profile, nie v samostatnej tabuľke — organizátor je profil
-- s rolou `organizer` a subdoména je jeho vlastnosť, nie vzťah.
--
-- Tvar aj jedinečnosť stráži databáza, nie len aplikácia. Subdoména je verejná
-- adresa, na ktorú sa budú odkazovať plagáty a e-maily; keby ju bolo možné
-- zadať dvakrát alebo s veľkým písmenom, prestala by byť adresou.

alter table public.profiles
  add column if not exists subdomain text;

comment on column public.profiles.subdomain is
  'Slug vlastnej subdomény organizátora bez domény (napr. "bbd" pre bbd.eticketo.eu). NULL = nemá.';

-- Jedinečnosť bez ohľadu na veľkosť písmen. NULL-ov môže byť koľko chce,
-- takže organizátorov bez subdomény to neobmedzuje.
create unique index if not exists profiles_subdomain_unique
  on public.profiles (lower(subdomain))
  where subdomain is not null;

-- Tvar: malé písmená, číslice a spojovník, 3–32 znakov, nezačína ani nekončí
-- spojovníkom. Zodpovedá tomu, čo znesie DNS aj certifikát.
alter table public.profiles
  drop constraint if exists profiles_subdomain_tvar;
alter table public.profiles
  add constraint profiles_subdomain_tvar
  check (subdomain is null or subdomain ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$');

-- Názvy, ktoré sú už adresou alebo by ňou mohli byť. Zoznam je zámerne aj
-- v aplikácii (`organizers.functions.ts`) — tam sa dá rozšíriť bez migrácie,
-- tu je preto, aby sa cez databázu nedali obísť.
alter table public.profiles
  drop constraint if exists profiles_subdomain_rezervovane;
alter table public.profiles
  add constraint profiles_subdomain_rezervovane
  check (
    subdomain is null
    or subdomain not in (
      'www', 'api', 'admin', 'app', 'mail', 'smtp', 'imap', 'ftp', 'ns1', 'ns2',
      'static', 'cdn', 'assets', 'img', 'images', 'files', 'download',
      'scanner', 'organizer', 'checkout', 'account', 'login', 'register',
      'support', 'help', 'status', 'blog', 'shop', 'pay', 'payments',
      'eticketo', 'tticketo', 'maxiticket', 'vipky', 'test', 'dev', 'staging',
      'local', 'localhost'
    )
  );
