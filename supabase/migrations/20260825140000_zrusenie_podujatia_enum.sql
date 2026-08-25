-- Podujatie sa dá zrušiť. Nová hodnota enumu musí byť vo vlastnej migrácii —
-- Postgres ju nedovolí použiť v tej istej transakcii, v ktorej vznikla.
alter type public.event_status add value if not exists 'cancelled';
