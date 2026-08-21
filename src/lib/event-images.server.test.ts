// Rozobratie URL obrázka. Chyba tu znamená buď osirené súbory, alebo — horšie —
// pokus zmazať niečo, čo nám nepatrí.
import { describe, it, expect } from "vitest";
import { storagePathFromUrl } from "./event-images.server";

const ZAKLAD = "https://aasraovckzekicoobadx.supabase.co/storage/v1/object/public/event-images/";

describe("storagePathFromUrl", () => {
  it("vytiahne cestu z verejnej URL", () => {
    expect(storagePathFromUrl(ZAKLAD + "user-1/obrazok.webp")).toBe("user-1/obrazok.webp");
  });

  it("odreže dopyt aj kotvu", () => {
    expect(storagePathFromUrl(ZAKLAD + "user-1/a.jpg?t=123")).toBe("user-1/a.jpg");
    expect(storagePathFromUrl(ZAKLAD + "user-1/a.jpg#x")).toBe("user-1/a.jpg");
  });

  it("dekóduje percentové kódovanie", () => {
    // Storage vracia cestu zakódovanú; mazať sa musí tá pôvodná.
    expect(storagePathFromUrl(ZAKLAD + "user-1/letny%20plagat.png")).toBe(
      "user-1/letny plagat.png",
    );
  });

  it("cudzí odkaz nechá na pokoji", () => {
    // Toto je to podstatné: obrázok z cudzieho webu nesmieme skúšať mazať.
    for (const url of [
      "https://images.unsplash.com/photo-123.jpg",
      "https://iny.web.sk/storage/v1/object/public/ine-uloziste/a.jpg",
      "https://aasraovckzekicoobadx.supabase.co/storage/v1/object/public/hall-imports/a.json",
    ]) {
      expect(storagePathFromUrl(url)).toBeNull();
    }
  });

  it("prázdne a nezmyselné vstupy dajú null", () => {
    for (const url of [null, undefined, "", "nieco", ZAKLAD, ZAKLAD + "?t=1"]) {
      expect(storagePathFromUrl(url)).toBeNull();
    }
  });

  it("pokazené kódovanie nespadne a nič nezmaže", () => {
    expect(() => storagePathFromUrl(ZAKLAD + "user-1/%E0%A4%A.jpg")).not.toThrow();
    expect(storagePathFromUrl(ZAKLAD + "user-1/%E0%A4%A.jpg")).toBeNull();
  });
});
