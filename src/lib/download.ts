/**
 * Stiahne súbor, ktorý prišiel zo servera ako base64.
 *
 * PDF vstupeniek sa generuje výhradne na serveri (jeden generátor, vložený font
 * s diakritikou, žiadny jspdf v prehliadači), takže klient dostáva hotový obsah
 * a už ho len uloží.
 */
export function downloadBase64(filename: string, base64: string, mime = "application/pdf") {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
