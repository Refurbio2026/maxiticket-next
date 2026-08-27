-- Premenovanie značky vipky.sk → eticketo.sk.
-- Mení len texty a adresy, kde stará značka zostala uložená v databáze;
-- staršie migrácie sa neprepisujú, tie sú záznamom histórie.

-- 1. Názov vydavateľa v Apple/Google peňaženke (vidí ho zákazník na vstupenke).
alter table public.wallet_settings alter column apple_organization_name set default 'eticketo.sk';
alter table public.wallet_settings alter column google_issuer_name set default 'eticketo.sk';
update public.wallet_settings set apple_organization_name = 'eticketo.sk'
  where apple_organization_name = 'vipky.sk';
update public.wallet_settings set google_issuer_name = 'eticketo.sk'
  where google_issuer_name = 'vipky.sk';

-- 2. Ukážkové účty (admin/organizer/user). Heslá zostávajú nezmenené.
update auth.users set email = replace(email, '@vipky.sk', '@eticketo.sk')
  where email like '%@vipky.sk';
update auth.identities
  set identity_data = jsonb_set(identity_data, '{email}',
        to_jsonb(replace(identity_data->>'email', '@vipky.sk', '@eticketo.sk')))
  where identity_data->>'email' like '%@vipky.sk';

-- 3. Kontaktné adresy na existujúcich objednávkach, aby neostali neplatné.
update public.orders set customer_email = replace(customer_email, '@vipky.sk', '@eticketo.sk')
  where customer_email like '%@vipky.sk';
