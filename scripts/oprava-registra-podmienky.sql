-- Oprava zápisu v obchodnom registri v obchodných podmienkach.
--
-- V texte sú dva rôzne a oba nesprávne údaje:
--   „Okresného súdu Bratislava I, oddiel Sro, vložka č. 14844"
--   „Okresného súdu Bratislava I, oddiel Sro, vložka č. 148442/B"
-- Register (RPO aj ORSR, overené 19. 10. 2026, IČO 53 251 580) uvádza:
--   Mestský súd Bratislava III, oddiel Sro, vložka č. 170046/B
-- Okresné súdy pre obchodný register zanikli 1. 6. 2023.
--
-- Nasucho: psql -f scripts/oprava-registra-podmienky.sql           (rollback)
-- Naostro: psql -v naostro=1 -f scripts/oprava-registra-podmienky.sql
begin;

update site_pages
set body = replace(
      replace(
        body,
        'zapísaná v obchodnom registri Okresného súdu Bratislava I, oddiel Sro, vložka č. 148442/B',
        'zapísaná v obchodnom registri Mestského súdu Bratislava III, oddiel Sro, vložka č. 170046/B'
      ),
      'zapísaná v obchodnom registri Okresného súdu Bratislava I, oddiel Sro, vložka č. 14844',
      'zapísaná v obchodnom registri Mestského súdu Bratislava III, oddiel Sro, vložka č. 170046/B'
    ),
    updated_at = now()
where slug = 'obchodne-podmienky';

select
  (select count(*) from site_pages where slug = 'obchodne-podmienky' and body like '%Okresného súdu Bratislava I%') as zostalo_okresny_sud,
  (select count(*) from site_pages where slug = 'obchodne-podmienky' and body like '%14844%') as zostala_stara_vlozka,
  (select count(*) from site_pages, regexp_matches(body, '170046/B', 'g') where slug = 'obchodne-podmienky') as novych_vyskytov;

\if :{?naostro}
  commit;
\else
  rollback;
\endif
