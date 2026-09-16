// Fixture dáta — riadky tak, ako ich vracia mysql2 zo zdroja: `datetime` ako
// reťazce (`dateStrings`), `bigint` ako reťazce (`bigNumberStrings`), `bit(1)`
// ako Buffer, `decimal` ako reťazec.

/** T1 — online predaj, má hlavičku objednávky aj faktúru. */
export const onlinePredaj = {
  id_seat: 1980240,
  id_plan: 750,
  id_theater_seat: 3,
  id_seat_status: 23,
  id_seat_note: 55001,
  id_invoice: 9001,
  id_person: 15,
  id_person2: null,
  price: "24.00",
  discount: "4.00",
  system_cost: "0.50",
  id_discount: null,
  id_discount2: null,
  id_payment: 2,
  id_expenses: null,
  barcode: "54840679",
  scan: 0,
  id_seat_category: 1,
  id_reservation: null,
  id_sys_user: null,
  changed: "2026-09-16 09:15:22",
  modified: "2026-09-16 09:15:22",
};

/** T2 — rezervácia prevodom, ešte nezaplatená. */
export const rezervacia = {
  ...onlinePredaj,
  id_seat: 1980241,
  id_seat_status: 11,
  id_invoice: null,
  barcode: "54840680",
  modified: "2026-09-16 09:20:00",
};

/** T2 — tá istá rezervácia po spárovaní platby. */
export const rezervaciaZaplatena = {
  ...rezervacia,
  id_seat_status: 23,
  id_invoice: 9002,
  modified: "2026-09-16 11:02:41",
};

/** T3/T4 — miesto po storne: vrátené do stavu 1, čiarový kód o 1 vyšší. */
export const poStorne = {
  ...onlinePredaj,
  id_seat_status: 1,
  id_seat_note: null,
  id_invoice: null,
  id_person: null,
  price: "0.00",
  barcode: "54840680",
  modified: "2026-09-16 14:00:00",
};

/** T7 — predaj na pokladni: bez hlavičky, bez faktúry, len `id_sys_user`. */
export const pokladnicnyPredaj = {
  ...onlinePredaj,
  id_seat: 1980243,
  id_seat_status: 6,
  id_seat_note: null,
  id_invoice: null,
  id_person: null,
  id_sys_user: 42,
  barcode: "77508064",
  changed: "2026-09-16 18:31:07",
  modified: "2026-09-16 18:31:07",
};

/** Druhé miesto z toho istého nákupu pri kase — o 12 sekúnd neskôr. */
export const pokladnicnyPredajDruheMiesto = {
  ...pokladnicnyPredaj,
  id_seat: 1980244,
  barcode: "77508065",
  changed: "2026-09-16 18:31:19",
  modified: "2026-09-16 18:31:19",
};

/** Nákup pri kase o dve minúty neskôr — iná objednávka. */
export const pokladnicnyPredajInyNakup = {
  ...pokladnicnyPredaj,
  id_seat: 1980245,
  barcode: "77508066",
  changed: "2026-09-16 18:33:40",
  modified: "2026-09-16 18:33:40",
};

/** Stav 15 s nulovou cenou a bez hlavičky — zrušená rezervácia z turniketu. */
export const stav15Podozrivy = {
  ...onlinePredaj,
  id_seat: 1980250,
  id_seat_status: 15,
  id_seat_note: null,
  id_invoice: null,
  price: "0.00",
  id_sys_user: null,
  barcode: "99000001",
};

/** Stav 15 so skutočnou cenou — ozajstný externý predaj. */
export const stav15Skutocny = {
  ...stav15Podozrivy,
  id_seat: 1980251,
  price: "18.00",
  barcode: "99000002",
};

/** Blokované miesto, ktoré napriek tomu má hlavičku objednávky (44 % z nich). */
export const blokovaneSHlavickou = {
  ...onlinePredaj,
  id_seat: 1980260,
  id_seat_status: 2,
  price: "0.00",
  id_seat_note: 55009,
  id_invoice: null,
};

/** T9 — predstavenie. `start`/`end` sú `time`, `require_access_code` je `bit(1)`. */
export const plan = {
  id_plan: 750,
  id_drama: 310,
  id_hall_desc: 12,
  id_price_category: 4,
  id_promoter: 7,
  id_promoter_ticket: 7,
  id_subdomain: null,
  id_plan_group: null,
  id_performer: 88,
  datum: "2026-10-04",
  start_time: "19:00:00",
  end_time: "21:30:00",
  door_time: "2026-10-04 18:00:00",
  sell_start: "2026-05-01 00:00:00",
  sell_end: "2026-10-04 18:30:00",
  stop_sell: 0,
  show_online: 7,
  show_hash: "4821993",
  allow_remote: 1,
  allow_export: 0,
  require_access_code: Buffer.from([0]),
  abo_mask: 0,
  ticket_limit: 10,
  vat: "23.00",
  tickets_with_places: 1,
  created: "2026-04-02 10:00:00",
  modified: "2026-09-16 08:00:00",
  drama_name: "Kvet Tisícich Ciest",
  hall_name: "Veľká sála",
};

/** Plán s nulovým dátumom a bez `modified` — starší nájomca. */
export const planBezModified = {
  ...plan,
  id_plan: 751,
  datum: "0000-00-00",
  door_time: "0000-00-00 00:00:00",
  modified: null,
};
