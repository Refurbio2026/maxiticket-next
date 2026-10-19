import { describe, expect, it } from "vitest";
import { LANGS, translate, translations, type Lang } from "./i18n";

describe("úplnosť prekladov", () => {
  // Najcennejší test v tomto súbore: zachytí ten raz, keď niekto pridá
  // slovenský kľúč a na ostatné tri jazyky zabudne. Na stránke by sa potom
  // zobrazil slovenský text v nemčine — alebo surový kľúč.
  const sk = Object.keys(translations.sk);

  it("slovenčina má kľúče", () => {
    expect(sk.length).toBeGreaterThan(500);
  });

  for (const lang of ["en", "de", "hu"] as Lang[]) {
    it(`${lang} má všetky kľúče, ktoré má slovenčina`, () => {
      const chybaju = sk.filter((k) => !(k in translations[lang]));
      expect(chybaju).toEqual([]);
    });

    it(`${lang} nemá kľúče, ktoré slovenčina nepozná`, () => {
      const navyse = Object.keys(translations[lang]).filter((k) => !(k in translations.sk));
      expect(navyse).toEqual([]);
    });
  }

  it("žiadny preklad nie je prázdny", () => {
    const prazdne: string[] = [];
    for (const lang of LANGS) {
      for (const [k, v] of Object.entries(translations[lang])) {
        if (!String(v).trim()) prazdne.push(`${lang}:${k}`);
      }
    }
    expect(prazdne).toEqual([]);
  });
});

describe("translate", () => {
  it("vráti text v požadovanom jazyku", () => {
    const k = Object.keys(translations.sk)[0];
    expect(translate("sk", k)).toBe(translations.sk[k]);
    expect(translate("en", k)).toBe(translations.en[k]);
  });

  it("neznámy kľúč vráti ako text, nie prázdno", () => {
    // Lepšie nech je na stránke vidieť kľúč než prázdne miesto — chyba sa tak
    // odhalí pri prvom pohľade.
    expect(translate("sk", "toto.neexistuje")).toBe("toto.neexistuje");
  });

  it("dopĺňa premenné", () => {
    const vzor = Object.entries(translations.sk).find(([, v]) => v.includes("{{"));
    expect(vzor, "v slovníku má byť aspoň jeden text s premennou").toBeTruthy();
    const [kluc, text] = vzor!;
    const nazov = /\{\{(\w+)\}\}/.exec(text)![1];
    const vysledok = translate("sk", kluc, { [nazov]: "42" });
    expect(vysledok).toContain("42");
    expect(vysledok).not.toContain("{{");
  });

  it("neodovzdanú premennú nechá viditeľnú", () => {
    // Zámer: chýbajúca premenná sa má dať odhaliť, nie zmiznúť.
    const vzor = Object.entries(translations.sk).find(([, v]) => v.includes("{{"))!;
    expect(translate("sk", vzor[0], { nieco: "x" })).toContain("{{");
  });

  it("prázdnu hodnotu premennej nahradí prázdnym textom", () => {
    const vzor = Object.entries(translations.sk).find(([, v]) => v.includes("{{"))!;
    const nazov = /\{\{(\w+)\}\}/.exec(vzor[1])![1];
    for (const hodnota of [null, undefined]) {
      const r = translate("sk", vzor[0], { [nazov]: hodnota });
      expect(r).not.toContain("{{");
      expect(r).not.toContain("null");
      expect(r).not.toContain("undefined");
    }
  });

  it("číslo prevedie na text", () => {
    const vzor = Object.entries(translations.sk).find(([, v]) => v.includes("{{"))!;
    const nazov = /\{\{(\w+)\}\}/.exec(vzor[1])![1];
    expect(translate("sk", vzor[0], { [nazov]: 7 })).toContain("7");
  });
});
