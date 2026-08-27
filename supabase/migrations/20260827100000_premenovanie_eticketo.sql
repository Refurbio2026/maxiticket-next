-- Premenovanie značky vipky.sk → eticketo.eu.
-- Mení len texty a adresy, kde stará značka zostala uložená v databáze;
-- staršie migrácie sa neprepisujú, tie sú záznamom histórie.

-- 1. Názov vydavateľa v Apple/Google peňaženke (vidí ho zákazník na vstupenke).
alter table public.wallet_settings alter column apple_organization_name set default 'eticketo.eu';
alter table public.wallet_settings alter column google_issuer_name set default 'eticketo.eu';
update public.wallet_settings set apple_organization_name = 'eticketo.eu'
  where apple_organization_name in ('vipky.sk', 'eticketo.sk');
update public.wallet_settings set google_issuer_name = 'eticketo.eu'
  where google_issuer_name in ('vipky.sk', 'eticketo.sk');

-- 2. Ukážkové účty (admin/organizer/user). Heslá zostávajú nezmenené.
update auth.users set email = replace(replace(email, '@vipky.sk', '@eticketo.eu'), '@eticketo.sk', '@eticketo.eu')
  where email like '%@vipky.sk' or email like '%@eticketo.sk';
update auth.identities
  set identity_data = jsonb_set(identity_data, '{email}',
        to_jsonb(replace(replace(identity_data->>'email', '@vipky.sk', '@eticketo.eu'),
                         '@eticketo.sk', '@eticketo.eu')))
  where identity_data->>'email' like '%@vipky.sk' or identity_data->>'email' like '%@eticketo.sk';

-- 3. Kontaktné adresy na existujúcich objednávkach, aby neostali neplatné.
update public.orders set customer_email = replace(customer_email, '@vipky.sk', '@eticketo.eu')
  where customer_email like '%@vipky.sk';
