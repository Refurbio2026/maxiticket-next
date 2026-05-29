import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageShell } from "@/components/site/PageShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Mail, Phone, MapPin, Instagram, Facebook, Youtube, Twitter, Send } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Kontakt · MAXITICKET" },
      { name: "description", content: "Kontaktujte tím MAXITICKET – e-mail, telefón, adresa a sociálne siete." },
      { property: "og:title", content: "Kontakt · MAXITICKET" },
      { property: "og:description", content: "Spojte sa s nami." },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", topic: "", message: "" });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setForm({ name: "", email: "", topic: "", message: "" });
      toast.success("Správa odoslaná. Ozveme sa do 24 hodín.");
    }, 600);
  };
  return (
    <PageShell
      eyebrow="Kontakt"
      title={<>Povedzte nám, ako <span className="text-gradient-flame">vám pomôcť</span></>}
      description="Sme tu pre kupujúcich, organizátorov aj partnerov. Vyberte si formu kontaktu, ktorá vám vyhovuje."
    >
      <Toaster />
      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6 md:p-8 bg-card/60 border-border/60">
          <h2 className="font-display text-2xl font-bold mb-1">Kontaktný formulár</h2>
          <p className="text-sm text-muted-foreground mb-6">Odpovedáme do 24 hodín v pracovných dňoch.</p>
          <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Meno</Label>
              <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="topic">Téma</Label>
              <Input id="topic" required placeholder="napr. Refundácia objednávky #12345" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="message">Správa</Label>
              <Textarea id="message" required rows={6} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy} className="bg-gradient-flame text-primary-foreground shadow-glow">
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
                  <a href="mailto:hello@maxiticket.sk" className="text-muted-foreground hover:text-foreground">hello@maxiticket.sk</a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="size-5 text-primary mt-0.5" />
                <div>
                  <div className="font-display font-bold">Telefón</div>
                  <a href="tel:+421222333444" className="text-muted-foreground hover:text-foreground">+421 2 22 333 444</a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="size-5 text-primary mt-0.5" />
                <div>
                  <div className="font-display font-bold">Adresa</div>
                  <div className="text-muted-foreground">MAXITICKET s.r.o.<br />Mlynské nivy 5<br />821 09 Bratislava</div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6 bg-card/60 border-border/60">
            <div className="font-display font-bold mb-3">Sociálne siete</div>
            <div className="flex gap-2">
              {[Instagram, Facebook, Youtube, Twitter].map((I, i) => (
                <a key={i} href="#" className="size-10 rounded-xl glass grid place-items-center hover:text-primary transition-colors">
                  <I className="size-4" />
                </a>
              ))}
            </div>
          </Card>

          <Card className="overflow-hidden bg-card/60 border-border/60">
            <iframe
              title="MAXITICKET sídlo"
              src="https://www.openstreetmap.org/export/embed.html?bbox=17.135%2C48.140%2C17.165%2C48.155&layer=mapnik&marker=48.1475%2C17.150"
              className="w-full h-56 border-0"
              loading="lazy"
            />
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
