-- Jedna platba u poskytovateľa = jeden riadok v `payments`.
--
-- Doteraz na `payments` žiadny unikátny kľúč nebol, takže opakovaná
-- notifikácia z brány alebo opakovaný beh párovania vedeli tú istú platbu
-- zapísať viackrát. Na stave objednávky to nebolo vidieť (`claim_order_paid`
-- ju preklopí len raz), ale súčty platieb a prehľad prevádzky tým klamali:
-- „dve prijaté platby za jednu objednávku" je kontrola, ktorá má odhaľovať
-- skutočné dvojité platby, nie vlastné duplikáty.
--
-- Vďaka tomuto kľúču sa doúčtovanie z bankového výpisu dá zapísať ako upsert.

create unique index if not exists payments_zamer_key
  on public.payments (order_id, provider, provider_payment_id)
  where provider_payment_id is not null;
