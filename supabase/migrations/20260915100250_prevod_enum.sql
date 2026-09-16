-- Platba prevodom na účet ako plnohodnotný poskytovateľ platby.
--
-- Platbu potvrdenú z bankového výpisu treba zapísať do `payments` rovnako ako
-- platbu z brány — inak by sa doúčtovanie nedalo vysledovať a prehľad
-- prevádzky by ju nevidel. Bez vlastnej hodnoty by sa tvárila ako GoPay.
--
-- Vo vlastnej migrácii: Postgres nedovolí použiť novú hodnotu enumu v tej
-- istej transakcii, v ktorej vznikla (rovnaký dôvod ako `20260821160000`).
alter type public.payment_provider add value if not exists 'prevod';
