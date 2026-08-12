import { useEffect, useRef, useState } from "react";
import { useRouterState, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Send, Bot, Loader2, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { askSupport } from "@/lib/support.functions";

type Msg = { role: "user" | "assistant"; content: string; greeting?: boolean };

// Areas where the customer support bot should not appear (staff-only screens).
const HIDDEN_PREFIXES = ["/admin", "/organizer", "/scanner"];

export function SupportChat() {
  const { t, lang } = useI18n();
  const ask = useServerFn(askSupport);
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Seed the greeting the first time the panel opens (so it follows the language).
  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ role: "assistant", content: t("support.greeting"), greeting: true }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const payload = next
        .filter((m) => !m.greeting)
        .slice(-16)
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await ask({ data: { lang, messages: payload } });
      if (res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
      } else if (res.reason === "not_configured") {
        setMessages((m) => [...m, { role: "assistant", content: t("support.disabled") }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: t("support.error") }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: t("support.error") }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t("support.title")}
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
            className="fixed bottom-24 right-5 z-[60] w-[calc(100vw-2.5rem)] max-w-sm h-[32rem] max-h-[70vh] rounded-2xl overflow-hidden border border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl flex flex-col"
          >
            {/* Header */}
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

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
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
                    {m.content}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-sm bg-muted/60 px-3.5 py-2 text-sm text-muted-foreground inline-flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" /> {t("support.thinking")}
                  </div>
                </div>
              )}
            </div>

            {/* Footer: input + contact link */}
            <div className="border-t border-border/50 p-3 space-y-2">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder={t("support.placeholder")}
                  className="flex-1 resize-none rounded-xl border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 max-h-28"
                />
                <Button
                  onClick={send}
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
