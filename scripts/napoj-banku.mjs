#!/usr/bin/env node
// Napojenie bankových pohybov z Faktera — jednorazové nastavenie.
//
// ČO ROBÍ:
//   1. Založí v aplikácii bankový účet (IBAN z nastavenia prevodov), ak ešte nie je.
//   2. Pridá zdroj typu „api“ s poskytovateľom `faktero`, zúžený na jeden účet
//      vo Fakere, aby sa neťahali pohyby celej firmy.
//
// KĽÚČ: nekopíruje sa v otvorenej podobe. Zoberie sa zašifrovaná hodnota
// `FAKTERO_API_KEY` z `integration_credentials` a vloží sa tak, ako je —
// obe tabuľky používajú to isté šifrovanie, takže netreba nič dešifrovať.
//
// POUŽITIE:
//   node scripts/napoj-banku.mjs          # len vypíše, čo by spravil
//   node scripts/napoj-banku.mjs zapis    # vykoná
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const l of fs.readFileSync("/opt/maxiticket/.env", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const ZAPISAT = process.argv[2] === "zapis";

// Účet vo Fakere, na ktorý chodia platby za vstupenky prevodom. Zistené
// porovnaním variabilných symbolov s objednávkami: 31 z 35 pohybov na tomto
// účte má VS objednávky a chodia od 27 rôznych ľudí — teda skutoční kupujúci,
// nie súhrnné zúčtovanie karty.
const FAKTERO_UCET = "7c9a8242-5b05-4ab6-bc25-f543cf62079b";

const { data: nastavenia } = await db
  .from("platform_settings")
  .select("transfer_iban, transfer_holder, transfer_bank_name")
  .maybeSingle();

const iban = (nastavenia?.transfer_iban ?? "").replace(/\s/g, "");
if (!iban) {
  console.log("V platform_settings nie je IBAN na prevody — nemám čo napojiť.");
  process.exit(1);
}

console.log("=== BANKOVÝ ÚČET ===");
const { data: existujuce } = await db.from("bank_accounts").select("id, iban, bank_name");
const najdeny = (existujuce ?? []).find((a) => (a.iban ?? "").replace(/\s/g, "") === iban);
console.log(`  IBAN z nastavení: ${iban} (${nastavenia.transfer_bank_name ?? "?"})`);
console.log(`  v aplikácii: ${najdeny ? `už je (${najdeny.id})` : "ešte nie je, založí sa"}`);

console.log("\n=== ZDROJ POHYBOV ===");
const { data: kluc } = await db
  .from("integration_credentials")
  .select("hodnota_sifrovana")
  .eq("provider", "faktero")
  .eq("kluc", "FAKTERO_API_KEY")
  .maybeSingle();
console.log(`  kľúč k Fakteru: ${kluc ? "nájdený, prevezme sa zašifrovaný" : "CHÝBA"}`);
console.log(`  poskytovateľ: faktero, účet vo Fakere: ${FAKTERO_UCET}`);
console.log("  okno: 7 dní dozadu, sťahovanie automaticky každých 10 minút");
if (!kluc) process.exit(1);

const { data: zdroje } = await db.from("bank_statement_sources").select("id, name, provider");
console.log(
  `  existujúce zdroje: ${zdroje?.length ? zdroje.map((z) => z.name).join(", ") : "žiadne"}`,
);

if (!ZAPISAT) {
  console.log("\n(náhľad — nič sa nezapísalo)");
  process.exit(0);
}

let accountId = najdeny?.id;
if (!accountId) {
  const { data, error } = await db
    .from("bank_accounts")
    .insert({
      bank_name: nastavenia.transfer_bank_name || "VÚB",
      account_name: "Prevody za vstupenky",
      owner_name: nastavenia.transfer_holder || null,
      iban,
      currency: "EUR",
      kind: "bank",
      provider: "faktero",
      connected: true,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.log("Účet sa nepodarilo založiť:", error.message);
    process.exit(1);
  }
  accountId = data.id;
  console.log(`účet založený: ${accountId}`);
}

const uz = (zdroje ?? []).find((z) => z.provider === "faktero");
const riadok = {
  account_id: accountId,
  name: "Faktero — prevody za vstupenky",
  kind: "api",
  provider: "faktero",
  enabled: true,
  window_days: 7,
  config: { bank_account_id: FAKTERO_UCET },
  secret_enc: kluc.hodnota_sifrovana,
  updated_at: new Date().toISOString(),
};
const { error } = uz
  ? await db.from("bank_statement_sources").update(riadok).eq("id", uz.id)
  : await db.from("bank_statement_sources").insert(riadok);
console.log(error ? `Zdroj sa nepodarilo uložiť: ${error.message}` : "zdroj uložený");
