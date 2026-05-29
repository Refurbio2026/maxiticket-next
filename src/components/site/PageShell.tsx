import type { ReactNode } from "react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";

export function PageShell({
  eyebrow,
  title,
  description,
  children,
  cta,
}: {
  eyebrow: string;
  title: ReactNode;
  description: string;
  children: ReactNode;
  cta?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <section className="relative pt-40 pb-16 bg-hero noise overflow-hidden">
        <div className="mx-auto max-w-7xl px-4 relative z-10">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full glass px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-5">
              {eyebrow}
            </div>
            <h1 className="font-display text-4xl md:text-6xl font-bold tracking-tight leading-[1.05]">
              {title}
            </h1>
            <p className="mt-5 text-base md:text-lg text-muted-foreground max-w-2xl">
              {description}
            </p>
            {cta && <div className="mt-7 flex flex-wrap gap-3">{cta}</div>}
          </div>
        </div>
      </section>
      <main className="mx-auto max-w-7xl px-4 py-16 space-y-16">{children}</main>
      <Footer />
    </div>
  );
}

export function FeatureGrid({
  items,
}: {
  items: { icon: React.ComponentType<{ className?: string }>; title: string; description: string }[];
}) {
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div
            key={it.title}
            className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur-xl p-6 hover:border-primary/50 hover:-translate-y-0.5 transition-all shadow-card-premium"
          >
            <div className="size-11 rounded-xl bg-gradient-flame grid place-items-center shadow-glow mb-4">
              <Icon className="size-5 text-primary-foreground" />
            </div>
            <div className="font-display font-bold text-lg">{it.title}</div>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{it.description}</p>
          </div>
        );
      })}
    </div>
  );
}
