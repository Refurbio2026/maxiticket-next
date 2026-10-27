-- Príznak „smie ísť na cudzie portály".
--
-- PREČO: feedy pre voľnočasové portály vydávajú to, čo je zverejnené — a to
-- je správne, feed nemá ukazovať nič, čo na webe nie je. Lenže medzi
-- zverejnenými podujatiami je aj skúšobné („SKÚŠKA PLATBY — nekupovať"),
-- ktoré na webe byť musí, aby sa dala otestovať platobná brána. Na
-- kamdomesta.sk mu nie je čo robiť.
--
-- Nerobí sa to podľa názvu: „podujatie, ktoré má v názve SKÚŠKA" je pravidlo,
-- ktoré raz vylúči niečo skutočné (skúška orchestra je verejný koncert).
-- Preto výslovný prepínač.
--
-- Predvolene `true` — existujúce podujatia sa chovajú ako doteraz a nový
-- organizátor nemusí nič zapínať, aby sa dostal na portály.

alter table public.events
  add column if not exists v_exporte boolean not null default true;

comment on column public.events.v_exporte is
  'Smie podujatie ísť do feedov pre cudzie portály (/feed/podujatia.*)? '
  'Vypína sa pri skúšobných podujatiach. Na vlastný web nemá vplyv.';

-- Kontrola: stĺpec existuje, má predvolenú hodnotu a nič sa nevyradilo.
do $$
declare
  zle text := '';
  bez_exportu int;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'v_exporte'
  ) then
    zle := zle || 'chýba events.v_exporte; ';
  end if;

  select count(*) into bez_exportu from public.events where v_exporte is not true;
  if bez_exportu > 0 then
    zle := zle || bez_exportu || ' podujatí ostalo mimo exportu, očakávalo sa 0; ';
  end if;

  if zle <> '' then
    raise exception 'Migrácia v_exporte: %', zle;
  end if;
  raise notice 'v_exporte: stĺpec je, všetky podujatia zostali v exporte';
end $$;
