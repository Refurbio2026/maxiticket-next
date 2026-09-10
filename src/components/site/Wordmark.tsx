// Textová značka v hlavičke a pätičke.
//
// Pôvodne tu bol obrázok `assets/logo.png`, ktorý ešte niesol starý názov
// vipky.sk — pri premenovaní na eticketo.eu sa naň zabudlo, lebo grep po texte
// obrázok nenájde. Kým bude hotová vlastná grafika, značka sa vysádza písmom
// aplikácie: nesie správny názov, škáluje sa a v tmavom režime nepotrebuje
// prevracať farby.

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`select-none text-2xl font-bold tracking-tight leading-none ${className}`}
      aria-label="eticketo.eu"
    >
      <span className="text-foreground">eticketo</span>
      <span className="text-primary">.eu</span>
    </span>
  );
}
