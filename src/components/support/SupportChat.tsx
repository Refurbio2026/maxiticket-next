// Bublina asistenta na webe.
//
// Čo sa tu rieši okrem výpisu správ:
//   – návrhy otázok, kým návštevník nenapísal nič (prázdne pole s blikajúcim
//     kurzorom je najhorší možný začiatok rozhovoru),
//   – odkazy v odpovedi sú klikacie a ostávajú v aplikácii,
//   – rozhovor prežije prechod na inú stránku (sessionStorage),
//   – asistent vie, kde návštevník stojí — posiela sa cesta, nie celá adresa.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouterState, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Send, Bot, Loader2, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { askSupport } from "@/lib/support.functions";
import { TEMY } from "@/lib/asistent/temy";
import { rozdelOdkazy } from "@/lib/asistent/odkazy";

type Msg = { role: "user" | "assistant"; content: string; greeting?: boolean };

// Miesta, kde bublina nemá čo robiť (obrazovky pre personál).
const HIDDEN_PREFIXES = ["/admin", "/organizer", "/scanner"];

/** Kľúč v sessionStorage — rozhovor prežije prechod na inú stránku. */
const ULOZENE = "eticketo-asistent";

/** Otázky, ktoré ponúkneme na začiatku. Sú to tie najčastejšie z `temy.ts`. */
const NAVRHY = ["dorucenie", "platba", "prenos", "vratenie"];

export function SupportChat() {
  const { t, lang } = useI18n();
  const ask = useServerFn(askSupport);
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const poleRef = useRef<HTMLTextAreaElement>(null);

  // Rozhovor z predchádzajúcej stránky. Čítame až na klientovi — pri
  // serverovom vykreslení sessionStorage neexistuje.
  useEffect(() => {
    try {
      const ulozene = sessionStorage.getItem(ULOZENE);
      if (ulozene) setMessages(JSON.parse(ulozene) as Msg[]);
    } catch {
      // Súkromné okno alebo zakázané úložisko — rozhovor proste začne odznova.
    }
  }, []);

  useEffect(() => {
    try {
      if (messages.length > 0) sessionStorage.setItem(ULOZENE, JSON.stringify(messages));
    } catch {
      // Neuložené je v poriadku; widget musí fungovať aj tak.
    }
  }, [messages]);

  // Pozdrav sa doplní pri prvom otvorení, nech je v jazyku, ktorý je zvolený.
  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ role: "assistant", content: t("support.greeting"), greeting: true }]);
    }
    if (open) poleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // Escape zavrie panel — bez toho sa z neho na klávesnici nedá odísť.
  useEffect(() => {
    if (!open) return;
    const naKlavesu = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", naKlavesu);
    return () => window.removeEventListener("keydown", naKlavesu);
  }, [open]);

  const navrhy = useMemo(
    () =>
      NAVRHY.map((id) => TEMY.find((x) => x.id === id))
        .filter((x): x is (typeof TEMY)[number] => !!x)
        .map((x) => (lang === "sk" ? x.otazka.sk : x.otazka.en)),
    [lang],
  );

  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  const posli = async (text: string) => {
    if (!text.trim() || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text.trim() }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const payload = next
        .filter((m) => !m.greeting)
        .slice(-16)
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await ask({ data: { lang, cesta: pathname, messages: payload } });
      setMessages((m) => [...m, { role: "assistant", content: res.ok ? res.reply : res.message }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: t("support.error") }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t("support.title")}
        aria-expanded={open}
        className="fixed bottom-5 right-5 z-[60] size-14 rounded-full bg-gradient-flame text-primary-foreground shadow-glow grid place-items-center hover:opacity-90 transition-opacity"
      >
        {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            role="dialog"
            aria-label={t("support.title")}
            className="fixed bottom-24 right-5 z-[60] w-[calc(100vw-2.5rem)] max-w-sm h-[32rem] max-h-[70vh] rounded-2xl overflow-hidden border border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl flex flex-col"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 bg-gradient-to-r from-primary/10 to-transparent">
              <div className="size-9 rounded-xl bg-gradient-flame grid place-items-center shadow-glow shrink-0">
                <Bot className="size-5 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <div className="font-display font-semibold text-sm truncate">
                  {t("support.title")}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {t("support.subtitle")}
                </div>
              </div>
            </div>

            <div
              ref={scrollRef}
              role="log"
              aria-live="polite"
              className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
            >
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
                >
                  <div
                    className={
                      "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap " +
                      (m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted/60 text-foreground rounded-bl-sm")
                    }
                  >
                    {m.role === "assistant" ? (
                      <SpravaSOdkazmi text={m.content} onOdkaz={() => setOpen(false)} />
                    ) : (
                      m.content
                    )}
                  </div>
                </div>
              ))}

              {/* Kým sa nič nespýtal, ponúkneme otázky — rýchlejšie než písať. */}
              {messages.length <= 1 && !busy && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {navrhy.map((otazka) => (
                    <button
                      key={otazka}
                      onClick={() => void posli(otazka)}
                      className="rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                    >
                      {otazka}
                    </button>
                  ))}
                </div>
              )}

              {busy && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-sm bg-muted/60 px-3.5 py-2 text-sm text-muted-foreground inline-flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" /> {t("support.thinking")}
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border/50 p-3 space-y-2">
              <div className="flex items-end gap-2">
                <textarea
                  ref={poleRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void posli(input);
                    }
                  }}
                  rows={1}
                  placeholder={t("support.placeholder")}
                  aria-label={t("support.placeholder")}
                  className="flex-1 resize-none rounded-xl border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 max-h-28"
                />
                <Button
                  onClick={() => void posli(input)}
                  disabled={busy || !input.trim()}
                  size="icon"
                  className="rounded-xl bg-gradient-flame text-primary-foreground shrink-0"
                  aria-label={t("support.send")}
                >
                  <Send className="size-4" />
                </Button>
              </div>
              <Link
                to="/contact"
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <LifeBuoy className="size-3" /> {t("support.contactCta")}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Odpoveď s klikacími odkazmi.
 *
 * Model píše adresy ako `/events` alebo `[Moje vstupenky](/account)`. Bez
 * tohto by návštevník videl cestu ako obyčajný text a musel ju prepisovať.
 * Zámerne sa nevykresľuje HTML ani cudzie adresy — len cesty v tejto
 * aplikácii, takže z odpovede nemôže vzniknúť odkaz inam.
 */
function SpravaSOdkazmi({ text, onOdkaz }: { text: string; onOdkaz: () => void }) {
  const casti = useMemo(() => rozdelOdkazy(text), [text]);
  return (
    <>
      {casti.map((c, i) =>
        c.cesta ? (
          <Link
            key={i}
            to={c.cesta}
            onClick={onOdkaz}
            className="font-medium underline underline-offset-2 hover:opacity-80"
          >
            {c.text}
          </Link>
        ) : (
          <span key={i}>{c.text}</span>
        ),
      )}
    </>
  );
}
