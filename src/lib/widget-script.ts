// Zdroj skriptu, ktorý si organizátor vloží na vlastný web.
//
// Je to obyčajný text, nie modul: beží na **cudzej stránke**, takže nesmie
// nič predpokladať o jej nástrojoch ani ju ovplyvniť. Preto:
//   * vanilla JS bez závislostí a bez prekladu (ES2019, nech funguje aj
//     v starších prehliadačoch, ktoré organizátorom chodia na weby),
//   * **Shadow DOM** — cudzie CSS nám nerozhodí vzhľad a naše im nerozhodí web,
//   * žiadne globálne premenné okrem jednej stráže proti dvojitému vloženiu,
//   * žiadne cookies, žiadne sledovanie, nič sa neposiela nikam inam,
//   * všetok text sa vkladá cez `textContent`, nie `innerHTML` — názov
//     podujatia je síce náš, ale do cudzej stránky sa HTML vkladať nebude.
//
// Nákup otvára eticketo.eu v novej karte. Platba vo vnorenom ráme na cudzej
// doméne je zlý zvyk: zákazník nevidí, komu zadáva kartu, a 3DS sa v ráme
// často ani nedokončí.

export const WIDGET_JS = String.raw`/* eticketo.eu widget — https://eticketo.eu/organizer/widget */
(function () {
  "use strict";

  var ZAKLAD = "__ZAKLAD__";

  var skript = document.currentScript;
  if (!skript) return;
  if (skript.dataset.etHotovo === "1") return;
  skript.dataset.etHotovo = "1";

  function cislo(x, predvolene, najmenej, najviac) {
    var n = parseInt(x, 10);
    if (isNaN(n)) return predvolene;
    return Math.min(najviac, Math.max(najmenej, n));
  }

  function jeHex(x) {
    return typeof x === "string" && /^#[0-9a-fA-F]{6}$/.test(x);
  }

  var d = skript.dataset;
  var rezim = d.rezim === "podujatie" || d.rezim === "tlacidlo" ? d.rezim : "zoznam";
  var organizator = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.organizator || "") ? d.organizator : "";
  var podujatie = /^[0-9a-fA-F-]{36}$/.test(d.podujatie || "") ? d.podujatie : "";
  var pocet = cislo(d.pocet, 5, 1, 20);
  var vzhlad = d.vzhlad === "svetly" || d.vzhlad === "tmavy" ? d.vzhlad : "auto";
  var farba = jeHex(d.farba) ? d.farba : "#fe6a00";

  /* Kam sa vykreslí: buď do zadaného prvku, alebo do #eticketo, alebo hneď
     za skript. Nikdy nič neprepisujeme — vkladáme vlastný prvok. */
  var ciel = null;
  if (d.ciel) ciel = document.getElementById(d.ciel);
  if (!ciel) ciel = document.getElementById("eticketo");
  var hostitel = document.createElement("div");
  if (ciel) ciel.appendChild(hostitel);
  else if (skript.parentNode) skript.parentNode.insertBefore(hostitel, skript.nextSibling);
  else return;

  var koren = hostitel.attachShadow ? hostitel.attachShadow({ mode: "open" }) : hostitel;

  var tmavy =
    vzhlad === "tmavy" ||
    (vzhlad === "auto" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  var styl = document.createElement("style");
  styl.textContent = [
    ":host{all:initial;display:block}",
    "*{box-sizing:border-box;margin:0;padding:0}",
    ".w{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;",
    "color:" + (tmavy ? "#e8e8ea" : "#17171a") + ";display:grid;gap:10px}",
    ".k{display:grid;grid-template-columns:84px 1fr auto;gap:12px;align-items:center;",
    "border:1px solid " + (tmavy ? "#2e2e35" : "#e4e4e7") + ";border-radius:12px;padding:10px;",
    "background:" + (tmavy ? "#15151a" : "#fff") + "}",
    "@media(max-width:420px){.k{grid-template-columns:1fr;text-align:left}}",
    ".o{width:84px;height:56px;border-radius:8px;object-fit:cover;background:",
    (tmavy ? "#23232a" : "#f1f1f4") + "}",
    "@media(max-width:420px){.o{width:100%;height:120px}}",
    ".n{font-weight:600;font-size:15px}",
    ".m{font-size:12.5px;color:" + (tmavy ? "#a1a1aa" : "#6b6b72") + "}",
    ".c{font-size:12.5px;color:" + (tmavy ? "#a1a1aa" : "#6b6b72") + ";margin-top:2px}",
    ".b{display:inline-block;background:" + farba + ";color:#fff;text-decoration:none;",
    "font-weight:600;font-size:13.5px;padding:9px 14px;border-radius:9px;white-space:nowrap}",
    ".b:hover{filter:brightness(1.07)}",
    ".b:focus-visible{outline:2px solid " + farba + ";outline-offset:2px}",
    ".p{font-size:12.5px;color:" + (tmavy ? "#a1a1aa" : "#6b6b72") + "}",
    ".z{font-size:11px;color:" + (tmavy ? "#71717a" : "#8a8a93") + ";text-align:right}",
    ".z a{color:inherit}",
    ".jedno{display:grid;gap:8px;border:1px solid " + (tmavy ? "#2e2e35" : "#e4e4e7") + ";",
    "border-radius:12px;padding:16px;background:" + (tmavy ? "#15151a" : "#fff") + "}",
  ].join("");
  koren.appendChild(styl);

  var obal = document.createElement("div");
  obal.className = "w";
  koren.appendChild(obal);

  function text(tag, trieda, obsah) {
    var el = document.createElement(tag);
    if (trieda) el.className = trieda;
    if (obsah != null) el.textContent = obsah;
    return el;
  }

  function hlaska(s) {
    obal.textContent = "";
    obal.appendChild(text("div", "m", s));
  }

  function datumCas(p) {
    var den = p.datum;
    try {
      den = new Date(p.datum + "T00:00:00").toLocaleDateString("sk-SK", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch (e) {
      /* keby prehliadač lokalizáciu nezvládol, zostane ISO dátum */
    }
    return p.cas ? den + " · " + String(p.cas).slice(0, 5) : den;
  }

  function cena(p) {
    if (p.cena_od == null) return null;
    return "od " + Number(p.cena_od).toFixed(2).replace(".", ",") + " €";
  }

  function tlacidlo(p, popis) {
    var a = document.createElement("a");
    a.className = "b";
    a.href = p.odkaz;
    /* Nová karta: zákazník neopustí web organizátora a platba beží na našej
       doméne, kde vidí adresu aj certifikát. noopener je povinnosť. */
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = popis || "Kúpiť vstupenky";
    return a;
  }

  function znacka() {
    var z = text("div", "z");
    var a = document.createElement("a");
    a.href = ZAKLAD;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "predaj zabezpečuje eticketo.eu";
    z.appendChild(a);
    return z;
  }

  function vykresliZoznam(data) {
    obal.textContent = "";
    if (!data.podujatia.length) {
      obal.appendChild(text("div", "m", "Momentálne nie sú v predaji žiadne podujatia."));
      obal.appendChild(znacka());
      return;
    }
    data.podujatia.forEach(function (p) {
      var k = text("div", "k");
      var o = document.createElement("img");
      o.className = "o";
      o.alt = "";
      o.loading = "lazy";
      if (p.obrazok) o.src = p.obrazok;
      k.appendChild(o);

      var stred = document.createElement("div");
      stred.appendChild(text("div", "n", p.nazov));
      stred.appendChild(text("div", "m", datumCas(p)));
      var kde = [p.miesto, p.mesto].filter(Boolean).join(", ");
      if (kde) stred.appendChild(text("div", "m", kde));
      var c = cena(p);
      if (c) stred.appendChild(text("div", "c", c));
      k.appendChild(stred);

      k.appendChild(tlacidlo(p, "Kúpiť"));
      obal.appendChild(k);
    });
    obal.appendChild(znacka());
  }

  function vykresliJedno(data) {
    obal.textContent = "";
    var p = data.podujatia[0];
    if (!p) {
      obal.appendChild(text("div", "m", "Podujatie nie je v predaji."));
      return;
    }
    var box = text("div", "jedno");
    box.appendChild(text("div", "n", p.nazov));
    box.appendChild(text("div", "m", datumCas(p)));
    var kde = [p.miesto, p.mesto].filter(Boolean).join(", ");
    if (kde) box.appendChild(text("div", "m", kde));
    var c = cena(p);
    if (c) box.appendChild(text("div", "p", c));
    box.appendChild(tlacidlo(p));
    obal.appendChild(box);
    obal.appendChild(znacka());
  }

  function vykresliTlacidlo(data) {
    obal.textContent = "";
    var p = data.podujatia[0];
    if (!p) return; /* nie je v predaji — na cudzom webe radšej nič než chyba */
    obal.appendChild(tlacidlo(p));
  }

  var adresa = ZAKLAD + "/api/widget/events";
  if (rezim === "zoznam") {
    if (!organizator) return hlaska("eticketo: chýba data-organizator.");
    adresa += "?organizator=" + encodeURIComponent(organizator) + "&pocet=" + pocet;
  } else {
    if (!podujatie) return hlaska("eticketo: chýba data-podujatie.");
    adresa += "?podujatie=" + encodeURIComponent(podujatie);
  }

  hlaska("Načítavam podujatia…");

  fetch(adresa, { credentials: "omit" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      if (!data || !data.podujatia) throw new Error("zlá odpoveď");
      if (rezim === "zoznam") vykresliZoznam(data);
      else if (rezim === "podujatie") vykresliJedno(data);
      else vykresliTlacidlo(data);
    })
    .catch(function () {
      /* Na cudzom webe nekričíme do konzoly ani nerozbíjame stránku. */
      hlaska("Podujatia sa teraz nedajú načítať.");
    });
})();
`;

/** Skript s doplnenou adresou nášho webu. */
export function widgetJs(zaklad: string): string {
  // Do JS reťazca ide len vlastná adresa z nastavení, ale aj tak sa z nej
  // odstráni všetko, čo by vedelo ukončiť reťazec.
  const cisty = zaklad.replace(/["'\\<>]/g, "").replace(/\/+$/, "");
  return WIDGET_JS.replace("__ZAKLAD__", cisty);
}
