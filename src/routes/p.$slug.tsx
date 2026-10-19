import { createFileRoute, notFound } from "@tanstack/react-router";
import { getSitePage } from "@/lib/site-pages.functions";
import { PageShell } from "@/components/site/PageShell";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/p/$slug")({
  // Obsah ťahá loader, nie dopyt v prehliadači. Dve veci sa tým získali:
  // neexistujúca stránka vracia skutočnú **404** namiesto 200 so správou (čo si
  // vyhľadávač zaindexoval ako platnú stránku), a text obchodných podmienok je
  // v HTML, takže ho robot vôbec vidí.
  loader: async ({ params }) => {
    const page = await getSitePage({ data: { slug: params.slug } });
    // Nepublikovaná stránka sa tvári, že neexistuje — to rozhoduje server.
    if (!page) throw notFound();
    return { page };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.page ? `${loaderData.page.title} · eticketo.eu` : "eticketo.eu" },
      ...(loaderData?.page?.meta_description
        ? [{ name: "description", content: loaderData.page.meta_description }]
        : []),
    ],
  }),
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
  const { page } = Route.useLoaderData();

  return (
    <PageShell eyebrow="eticketo.eu" title={page.title} description={page.meta_description ?? ""}>
      <Card className="p-6 sm:p-10 bg-card/60 border-border/60 max-w-3xl">
        <div className="text-[15px]">{renderBody(page.body)}</div>
        <p className="text-xs text-muted-foreground mt-10 pt-4 border-t border-border/40">
          Naposledy upravené {new Date(page.updated_at).toLocaleDateString("sk-SK")}
        </p>
      </Card>
    </PageShell>
  );
}
