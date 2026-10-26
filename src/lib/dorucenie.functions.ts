// Čo smie pokladňa ponúknuť ako doručenie.
//
// Prečo cez server: cena poštovného je v šifrovaných prístupoch a to, či je
// doručovanie poštou vôbec spustené, závisí od nastavenia organizátora.
// Klient sa dozvie len výsledok — cenu a či si poštu môže vybrať.
import { createServerFn } from "@tanstack/react-start";
import { cenaPostovneho, ephStav } from "./posta/eph.server";

export const moznostiDorucenia = createServerFn({ method: "GET" }).handler(async () => {
  const cena = await cenaPostovneho();
  // Cena bez vyplnených prístupov k pošte by bola pasca: zákazník zaplatí
  // poštovné a hárok sa nedá podať. Preto sa pošta ponúkne len vtedy, keď je
  // nastavená cena AJ prístup k ePodaciemu hárku.
  const { pripravene } = ephStav();
  return {
    posta: cena && pripravene ? { cena } : null,
  };
});
