import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSitePage } from "@/lib/site-pages.functions";
import { PageShell } from "@/components/site/PageShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, FileQuestion } from "lucide-react";

export const Route = createFileRoute("/p/$slug")({
  head: () => ({ meta: [{ title: "vipky.sk" }] }),
  component: Page,
});

/**
 * Text stránky je zámerne jednoduchý, nie HTML: obsah zadáva človek v admine a
 * vložené HTML by bola diera. Prázdny riadok oddeľuje odsek, riadok začínajúci
 * `## ` je medzinadpis, `- ` je odrážka.
 */
function renderBody(body: string) {
  const blocks = body.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return blocks.map((block, i) => {
    const trimmed = block.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith("## ")) {
      return (
        <h2 key={i} className="font-display text-xl font-bold mt-8 mb-3 first:mt-0">
          {trimmed.slice(3)}
        </h2>
      );
    }

    const lines = trimmed.split("\n");
    if (lines.every((l) => l.trimStart().startsWith("- "))) {
      return (
        <ul key={i} className="list-disc pl-5 space-y-1 my-4 text-foreground/80">
          {lines.map((l, j) => (
            <li key={j}>{l.trimStart().slice(2)}</li>
          ))}
        </ul>
      );
    }

    return (
      <p key={i} className="my-4 leading-relaxed text-foreground/80 whitespace-pre-line">
        {trimmed}
      </p>
    );
  });
}

function Page() {
  const { slug } = Route.useParams();
  const fetchPage = useServerFn(getSitePage);

  const q = useQuery({
    queryKey: ["site-page", slug],
    queryFn: () => fetchPage({ data: { slug } }),
  });

  if (q.isLoading) {
    return (
      <PageShell eyebrow="vipky.sk" title="Načítavam…" description="">
        <div className="py-16 text-center">
          <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
        </div>
      </PageShell>
    );
  }

  if (!q.data) {
    return (
      <PageShell
        eyebrow="vipky.sk"
        title="Stránka sa nenašla"
        description="Táto adresa neexistuje alebo stránka ešte nie je zverejnená."
      >
        <Card className="p-12 text-center bg-card/60 border-dashed border-border/60">
          <FileQuestion className="mx-auto size-7 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            Skúste to o chvíľu znova, alebo sa pozrite na ponuku podujatí.
          </p>
          <Button asChild className="mt-5 bg-gradient-flame text-primary-foreground shadow-glow">
            <Link to="/events">Pozrieť podujatia</Link>
          </Button>
        </Card>
      </PageShell>
    );
  }

  const page = q.data;
  return (
    <PageShell eyebrow="vipky.sk" title={page.title} description={page.meta_description ?? ""}>
      <Card className="p-6 sm:p-10 bg-card/60 border-border/60 max-w-3xl">
        <div className="text-[15px]">{renderBody(page.body)}</div>
        <p className="text-xs text-muted-foreground mt-10 pt-4 border-t border-border/40">
          Naposledy upravené {new Date(page.updated_at).toLocaleDateString("sk-SK")}
        </p>
      </Card>
    </PageShell>
  );
}
