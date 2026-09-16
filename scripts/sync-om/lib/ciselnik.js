// Číselník stavov miesta. Worker ho **nemá natvrdo v kóde** (spec 3.1) —
// mapovanie je konfigurovateľné aj v starom systéme, takže zdrojom pravdy je
// tabuľka `om_seat_status` v cieli.
//
// Kategóriu na uložený riadok stanovuje trigger v databáze. Tu sa číselník
// používa len na rozhodnutia, ktoré sa robia **pred** zápisom: či sa má
// vstupenke počítať odvodená objednávka (len pre predaj a permanentky).

import { ciel } from "./target.js";

let stavy;

export async function nacitajCiselnik() {
  const { data, error } = await ciel()
    .from("om_seat_status")
    .select("id_seat_status, category, suspicious_when_free, name");
  if (error) throw new Error(`Číselník stavov: ${error.message}`);
  return nastavCiselnik(data);
}

/**
 * Naplnenie číselníka bez databázy. Používajú to testy — mapovanie sa inak
 * nedá overiť bez pripojenia na Supabase.
 */
export function nastavCiselnik(zoznam) {
  stavy = new Map(zoznam.map((r) => [Number(r.id_seat_status), r]));
  return stavy;
}

export function kategoria(idSeatStatus) {
  return stavy?.get(Number(idSeatStatus))?.category ?? "other";
}

/** Predaj v širšom zmysle — to, čo môže mať objednávku. */
export function jePredaj(idSeatStatus) {
  const k = kategoria(idSeatStatus);
  return k === "sold" || k === "abo";
}

/**
 * Stavy patriace do kategórie — pre zdrojovú agregáciu v kontrole počtov.
 * Zoznamy sa **neopisujú do kódu**: obe strany porovnania musia počítať podľa
 * toho istého zaradenia, inak by preklasifikovanie jedného stavu hlásilo
 * nezhodu na každom pláne.
 */
export function stavyKategorie(kategoria) {
  return [...(stavy?.values() ?? [])]
    .filter((s) => s.category === kategoria)
    .map((s) => Number(s.id_seat_status))
    .sort((a, b) => a - b);
}

export function neznameStavy(videne) {
  return [...videne].filter((s) => !stavy?.has(Number(s)));
}
