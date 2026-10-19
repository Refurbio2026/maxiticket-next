import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PageShell } from "@/components/site/PageShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Mail, Phone, MapPin, Building2, Send } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { posliKontaktnuSpravu } from "@/lib/kontakt.functions";
import { PREVADZKOVATEL, mapaUrl } from "@/lib/kontakt";
import { getCartSessionId } from "@/lib/ticketing-db";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Kontakt · eticketo.eu" },
      {
        name: "description",
        content: "Kontaktujte tím eticketo.eu – e-mail, adresa a údaje prevádzkovateľa.",
      },
      { property: "og:title", content: "Kontakt · eticketo.eu" },
      { property: "og:description", content: "Spojte sa s nami." },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ meno: "", email: "", tema: "", sprava: "", web: "" });
  const posli = useServerFn(posliKontaktnuSpravu);
  // Tá istá relácia, akou sa držia sedadlá. V `sessionStorage`, čiže na
  // serveri neexistuje — preto až v `useEffect`, inak by SSR nesúhlasilo.
  const [sid, setSid] = useState<string | null>(null);
  useEffect(() => setSid(getCartSessionId()), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const v = await posli({ data: { ...form, session: sid ?? undefined } });
      if (v.ok) {
        setForm({ meno: "", email: "", tema: "", sprava: "", web: "" });
        toast.success("Správa odoslaná. Ozveme sa do 24 hodín.");
      } else {
        // Radšej nech zákazník vie, že má napísať priamo, ako aby čakal na ticho.
        toast.error(
          `Formulár je momentálne mimo prevádzky. Napíšte nám prosím na ${PREVADZKOVATEL.email}.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Správu sa nepodarilo odoslať.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      eyebrow="Kontakt"
      title={
        <>
          Povedzte nám, ako <span className="text-gradient-flame">vám pomôcť</span>
        </>
      }
      description="Sme tu pre kupujúcich, organizátorov aj partnerov. Napíšte nám a ozveme sa."
    >
      <Toaster />
      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6 md:p-8 bg-card/60 border-border/60">
          <h2 className="font-display text-2xl font-bold mb-1">Kontaktný formulár</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Odpovedáme do 24 hodín v pracovných dňoch.
          </p>
          <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Meno</Label>
              <Input
                id="name"
                required
                minLength={2}
                value={form.meno}
                onChange={(e) => setForm({ ...form, meno: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="topic">Téma</Label>
              <Input
                id="topic"
                required
                minLength={2}
                placeholder="napr. Refundácia objednávky #12345"
                value={form.tema}
                onChange={(e) => setForm({ ...form, tema: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="message">Správa</Label>
              <Textarea
                id="message"
                required
                minLength={10}
                rows={6}
                value={form.sprava}
                onChange={(e) => setForm({ ...form, sprava: e.target.value })}
              />
            </div>
            {/* Pasca na roboty. Odsunutá mimo obrazovky a nie `display:none` —
                na ten si časť robotov dáva pozor. Človek sa k nej nedostane
                ani tabulátorom, takže ju nevyplní. */}
            <div className="absolute left-[-9999px] top-auto size-px overflow-hidden" aria-hidden>
              <label htmlFor="web">Webová stránka</label>
              <input
                id="web"
                name="web"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={form.web}
                onChange={(e) => setForm({ ...form, web: e.target.value })}
              />
            </div>

            <div className="sm:col-span-2">
              <Button
                type="submit"
                disabled={busy}
                className="bg-gradient-flame text-primary-foreground shadow-glow"
              >
                <Send className="size-4 mr-2" /> {busy ? "Odosielam…" : "Odoslať správu"}
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="p-6 bg-card/60 border-border/60">
            <div className="space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <Mail className="size-5 text-primary mt-0.5" />
                <div>
                  <div className="font-display font-bold">E-mail</div>
                  <a
                    href={`mailto:${PREVADZKOVATEL.email}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {PREVADZKOVATEL.email}
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="size-5 text-primary mt-0.5" />
                <div>
                  <div className="font-display font-bold">Telefón</div>
                  <a
                    href={`tel:${PREVADZKOVATEL.telefonLink}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {PREVADZKOVATEL.telefon}
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="size-5 text-primary mt-0.5" />
                <div>
                  <div className="font-display font-bold">Adresa</div>
                  <div className="text-muted-foreground">
                    {PREVADZKOVATEL.nazov}
                    <br />
                    {PREVADZKOVATEL.ulica}
                    <br />
                    {PREVADZKOVATEL.psc} {PREVADZKOVATEL.mesto}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Building2 className="size-5 text-primary mt-0.5" />
                <div>
                  <div className="font-display font-bold">Prevádzkovateľ</div>
                  <div className="text-muted-foreground">
                    IČO {PREVADZKOVATEL.ico}
                    <br />
                    {PREVADZKOVATEL.registracia}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden bg-card/60 border-border/60">
            <iframe
              title={`${PREVADZKOVATEL.nazov} – sídlo`}
              src={mapaUrl()}
              className="w-full h-56 border-0"
              loading="lazy"
            />
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
