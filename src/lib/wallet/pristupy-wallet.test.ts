import { describe, expect, it } from "vitest";
import {
  rozpoznajVstup,
  skontrolujApplePem,
  skontrolujServisnyUcet,
  skontrolujWwdr,
} from "./pristupy-wallet";

const CERT = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const KLUC = "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----";

describe("rozpoznanie vstupu", () => {
  it("pozná PEM, JSON aj .p12 v base64", () => {
    expect(rozpoznajVstup(CERT)).toBe("pem");
    expect(rozpoznajVstup('{"type":"service_account"}')).toBe("json");
    expect(rozpoznajVstup("MIIKvAIBAzCCCoIGCSqGSIb3DQEHAaCCCnMEggpv")).toBe("p12");
    expect(rozpoznajVstup("ahoj")).toBe("nezrozumitelne");
    expect(rozpoznajVstup("   ")).toBe("nezrozumitelne");
  });
});

describe("Apple certifikát", () => {
  it("prijme certifikát spolu s kľúčom", () => {
    expect(skontrolujApplePem(`${CERT}\n${KLUC}`).ok).toBe(true);
  });

  it("vloženému .p12 poradí príkaz na prevod", () => {
    const v = skontrolujApplePem("MIIKvAIBAzCCCoIGCSqGSIb3DQEHAaCCCnMEggpv");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.sprava).toContain("openssl pkcs12");
  });

  it("odmietne PEM bez privátneho kľúča — pass by sa nepodpísal", () => {
    const v = skontrolujApplePem(CERT);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.sprava).toContain("privátny kľúč");
  });
});

describe("WWDR", () => {
  it("prijme samotný certifikát", () => {
    expect(skontrolujWwdr(CERT).ok).toBe(true);
  });

  it("odmietne, keď je v ňom privátny kľúč", () => {
    expect(skontrolujWwdr(`${CERT}\n${KLUC}`).ok).toBe(false);
  });

  it("odmietne binárny .cer", () => {
    expect(skontrolujWwdr("MIIEUTCCAzmgAwIBAgIQ").ok).toBe(false);
  });
});

describe("servisný účet Google", () => {
  it("prijme platný JSON", () => {
    const json = JSON.stringify({
      type: "service_account",
      client_email: "a@b.iam.gserviceaccount.com",
      private_key: KLUC,
    });
    expect(skontrolujServisnyUcet(json).ok).toBe(true);
  });

  it("odmietne JSON bez kľúča", () => {
    const v = skontrolujServisnyUcet('{"client_email":"a@b.com"}');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.sprava).toContain("private_key");
  });

  it("odmietne OAuth klienta namiesto servisného účtu", () => {
    const json = JSON.stringify({
      type: "authorized_user",
      client_email: "a@b.com",
      private_key: KLUC,
    });
    const v = skontrolujServisnyUcet(json);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.sprava).toContain("service_account");
  });

  it("odmietne nezmysel", () => {
    expect(skontrolujServisnyUcet("ahoj").ok).toBe(false);
  });
});
