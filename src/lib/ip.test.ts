import { describe, expect, it } from "vitest";
import { jeVerejnaIp } from "./ip";

describe("jeVerejnaIp", () => {
  it("prijme bežné verejné adresy", () => {
    expect(jeVerejnaIp("91.127.3.8")).toBe(true);
    expect(jeVerejnaIp("116.202.234.209")).toBe(true);
    expect(jeVerejnaIp("8.8.8.8")).toBe(true);
    expect(jeVerejnaIp("2a01:4f8:1c17::1")).toBe(true);
  });

  it("odmietne adresu, ktorú podáva náš vlastný perimeter", () => {
    // Presne to, čo nginx vidí dnes — kvôli tomuto celá kontrola existuje.
    expect(jeVerejnaIp("192.168.1.1")).toBe(false);
    expect(jeVerejnaIp("10.0.0.5")).toBe(false);
    expect(jeVerejnaIp("172.16.0.1")).toBe(false);
    expect(jeVerejnaIp("172.31.255.254")).toBe(false);
    expect(jeVerejnaIp("127.0.0.1")).toBe(false);
    expect(jeVerejnaIp("169.254.1.1")).toBe(false);
  });

  it("172.15 a 172.32 sú mimo súkromného rozsahu, tie prejdú", () => {
    expect(jeVerejnaIp("172.15.0.1")).toBe(true);
    expect(jeVerejnaIp("172.32.0.1")).toBe(true);
  });

  it("odmietne chýbajúcu a nezmyselnú hodnotu", () => {
    expect(jeVerejnaIp(null)).toBe(false);
    expect(jeVerejnaIp(undefined)).toBe(false);
    expect(jeVerejnaIp("")).toBe(false);
    expect(jeVerejnaIp("unknown")).toBe(false);
    expect(jeVerejnaIp("300.1.1.1")).toBe(false);
    expect(jeVerejnaIp("1.2.3")).toBe(false);
    expect(jeVerejnaIp("ahoj")).toBe(false);
  });

  it("odmietne vnútorné IPv6", () => {
    expect(jeVerejnaIp("::1")).toBe(false);
    expect(jeVerejnaIp("fd00::1")).toBe(false);
    expect(jeVerejnaIp("fe80::1")).toBe(false);
  });

  it("zdieľaný rozsah operátorov berie ako použiteľný", () => {
    expect(jeVerejnaIp("100.64.0.1")).toBe(true);
  });
});
