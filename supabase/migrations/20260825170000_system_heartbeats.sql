-- Kedy naposledy zbehla ktorá pravidelná úloha.
--
-- Bez toho sa nedá zistiť, či je cron vôbec nastavený. Dopytovací sken je
-- jediné, čo dotiahne platby cez brány bez webhooku — keď ticho nebeží,
-- zákazníci zostávajú bez vstupeniek a nikde to nesvieti.
create table if not exists public.system_heartbeats (
  name text primary key,
  last_at timestamptz not null default now(),
  detail jsonb
);

alter table public.system_heartbeats enable row level security;
revoke all on table public.system_heartbeats from anon, authenticated;

comment on table public.system_heartbeats is
  'Posledný beh pravidelných úloh. Bez RLS politiky — píše a číta len service role.';

create or replace function public.stamp_heartbeat(p_name text, p_detail jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.system_heartbeats (name, last_at, detail)
  values (p_name, now(), p_detail)
  on conflict (name) do update set last_at = now(), detail = excluded.detail;
$$;

revoke all on function public.stamp_heartbeat(text, jsonb) from public, anon, authenticated;
grant execute on function public.stamp_heartbeat(text, jsonb) to service_role;
