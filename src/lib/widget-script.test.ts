import { describe, it, expect } from "vitest";
import { WIDGET_JS, widgetJs } from "./widget-script";

describe("widgetJs", () => {
  it("doplní adresu nášho webu", () => {
    const js = widgetJs("https://eticketo.eu");
    expect(js).toContain('var ZAKLAD = "https://eticketo.eu"');
    expect(js).not.toContain("__ZAKLAD__");
  });

  it("odreže koncové lomky, nech sa adresy neskladajú s dvojitou", () => {
    expect(widgetJs("https://eticketo.eu///")).toContain('"https://eticketo.eu"');
  });

  it("z adresy vyhodí znaky, ktorými by sa dal ukončiť reťazec", () => {
    const js = widgetJs('https://zle.sk";alert(1);//');
    // Úvodzovka padla pri čistení a koncové lomky pri orezaní adresy.
    expect(js).toContain('var ZAKLAD = "https://zle.sk;alert(1);"');
    // Podstatné je, že sa nedá vyskočiť z reťazca a pridať vlastný príkaz.
    expect(js).not.toContain('";alert');
  });
});

describe("skript, ktorý beží na cudzom webe", () => {
  it("nevkladá HTML — len textContent", () => {
    expect(WIDGET_JS).not.toContain("innerHTML");
    expect(WIDGET_JS).not.toContain("insertAdjacentHTML");
    expect(WIDGET_JS).not.toContain("document.write");
  });

  it("odkazy na nákup otvára bezpečne v novej karte", () => {
    expect(WIDGET_JS).toContain('a.target = "_blank"');
    expect(WIDGET_JS).toContain('a.rel = "noopener"');
  });

  it("izoluje sa v Shadow DOM a neposiela cookies", () => {
    expect(WIDGET_JS).toContain("attachShadow");
    expect(WIDGET_JS).toContain('credentials: "omit"');
  });

  it("nespolieha sa na nič z cudzej stránky a nešpiní globálny priestor", () => {
    expect(WIDGET_JS).toContain('"use strict"');
    // Jediná stopa v stránke je značka na skripte proti dvojitému vloženiu.
    expect(WIDGET_JS).toContain("etHotovo");
    expect(WIDGET_JS).not.toContain("window.eticketo =");
  });

  it("overuje si vlastné parametre, takže ich nikto nepodstrčí", () => {
    expect(WIDGET_JS).toContain("/^[a-z0-9]+(?:-[a-z0-9]+)*$/");
    expect(WIDGET_JS).toContain("/^#[0-9a-fA-F]{6}$/");
  });
});
