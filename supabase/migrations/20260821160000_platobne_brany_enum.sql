-- Nové hodnoty do enumu platobných brán. Musia byť vo vlastnej migrácii:
-- Postgres nedovolí použiť novú hodnotu enumu v tej istej transakcii,
-- v ktorej vznikla, takže stĺpce a backfill sú až v ďalšom súbore.
alter type public.payment_provider add value if not exists 'gpwebpay';
alter type public.payment_provider add value if not exists 'tatrapayplus';
