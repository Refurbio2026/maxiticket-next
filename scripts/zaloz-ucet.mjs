#!/usr/bin/env node
// Založenie účtu s rolou — to isté, čo robí admin na /admin/system/users.
//
// PREČO SKRIPT, KEĎ TO VIE ADMIN: niekedy treba založiť prvý alebo náhradný
// prístup zvonku (napríklad keď sa nikto nemá ako prihlásiť). Postup je
// zámerne ten istý ako v `createUserWithRole`, aby účet nevznikol
// s polovicou záznamov:
//   1. účet v auth s potvrdeným e-mailom (inak čaká na overovací odkaz),
//   2. profil s menom,
//   3. rola.
//
// HESLO SA NEPÍŠE DO PRÍKAZU ani do tohto súboru — berie sa z premennej
// prostredia HESLO. V histórii shellu by zostalo čitateľné komukoľvek,
// kto sa k serveru dostane.
//
// POUŽITIE:
//   HESLO='...' node scripts/zaloz-ucet.mjs jana@eticketo.eu "Jana" admin
//   HESLO='...' node scripts/zaloz-ucet.mjs jana@eticketo.eu "Jana" admin naostro
import fs from "node:fs";
import { createClient } from "../node_modules/@supabase/supabase-js/dist/index.mjs";

const [email, meno, rola = "admin", rezim] = process.argv.slice(2);
const NAOSTRO = rezim === "naostro";
const heslo = process.env.HESLO;

if (!email || !meno) {
  console.error(
    'Použitie: HESLO=... node scripts/zaloz-ucet.mjs <email> "<meno>" [rola] [naostro]',
  );
  process.exit(1);
}
if (!["user", "organizer", "admin"].includes(rola)) {
  console.error(`Neznáma rola „${rola}". Povolené: user, organizer, admin.`);
  process.exit(1);
}
if (!heslo || heslo.length < 8) {
  console.error("Chýba premenná HESLO (najmenej 8 znakov).");
  process.exit(1);
}

const env = {};
for (const l of fs.readFileSync("/opt/maxiticket/.env", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Existujúci účet sa NEPREPISUJE. Prepísať heslo niekomu, kto sa práve
// prihlasuje, je horšie než nič neurobiť.
const { data: zoznam, error: chybaZoznamu } = await sb.auth.admin.listUsers({ perPage: 1000 });
if (chybaZoznamu) {
  console.error("Zoznam účtov sa nepodarilo načítať:", chybaZoznamu.message);
  process.exit(1);
}
const uz = (zoznam?.users || []).find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
if (uz) {
  console.error(`Účet ${email} už existuje (vznikol ${uz.created_at}). Nič sa nemenilo.`);
  process.exit(1);
}

console.log(`Vznikne účet:\n  e-mail: ${email}\n  meno:   ${meno}\n  rola:   ${rola}`);
console.log("  heslo:  (z premennej HESLO, nevypisuje sa)");
console.log("  e-mail bude potvrdený, takže sa dá prihlásiť hneď\n");

if (!NAOSTRO) {
  console.log("NASUCHO — nič sa nezaložilo. Spusť znova s `naostro`.");
  process.exit(0);
}

const { data: vytvoreny, error } = await sb.auth.admin.createUser({
  email,
  password: heslo,
  email_confirm: true,
  user_metadata: { full_name: meno },
});
if (error || !vytvoreny?.user) {
  console.error("Účet sa nepodarilo vytvoriť:", error?.message);
  process.exit(1);
}
const id = vytvoreny.user.id;
console.log(`Účet vytvorený: ${id}`);

// `handle_new_user()` profil aj rolu `user` založí sám; meno a vyžiadanú
// rolu doplníme, aby sme sa na trigger nespoliehali.
const { error: chybaProfilu } = await sb
  .from("profiles")
  .upsert({ id, full_name: meno }, { onConflict: "id" });
if (chybaProfilu) console.error("POZOR, profil sa nedoplnil:", chybaProfilu.message);
else console.log("Profil doplnený.");

if (rola !== "user") {
  const { error: chybaRoly } = await sb
    .from("user_roles")
    .upsert({ user_id: id, role: rola }, { onConflict: "user_id,role" });
  if (chybaRoly) {
    console.error(`POZOR, rola ${rola} sa nepriradila:`, chybaRoly.message);
    console.error("Účet existuje, ale bez práv. Prirad rolu v /admin/system/users.");
    process.exit(1);
  }
  console.log(`Rola ${rola} priradená.`);
}

// Kontrola z druhej strany: čo o účte naozaj vidí databáza.
const { data: roly } = await sb.from("user_roles").select("role").eq("user_id", id);
const { data: profil } = await sb.from("profiles").select("full_name").eq("id", id).maybeSingle();
console.log(
  `\nOverenie: profil „${profil?.full_name ?? "—"}", roly: ${(roly || []).map((r) => r.role).join(", ") || "žiadne"}`,
);
