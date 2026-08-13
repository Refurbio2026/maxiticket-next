import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Loader2, Mail, RotateCcw, Save, Send, Eye, Code } from "lucide-react";
import {
  listEmailTemplates,
  saveEmailTemplate,
  resetEmailTemplate,
  sendTestEmail,
  type EmailTemplateRecord,
} from "@/lib/email-templates.functions";
import { renderTemplate } from "@/lib/email-templates";

export const Route = createFileRoute("/admin/system/email-templates")({
  head: () => ({ meta: [{ title: "Emailové šablóny · vipky.sk Admin" }] }),
  component: Page,
});

type Draft = { subject: string; html: string; text: string; enabled: boolean };

function Page() {
  const qc = useQueryClient();
  const fetchTemplates = useServerFn(listEmailTemplates);
  const save = useServerFn(saveEmailTemplate);
  const reset = useServerFn(resetEmailTemplate);
  const sendTest = useServerFn(sendTestEmail);

  const templates = useQuery({
    queryKey: ["email-templates"],
    queryFn: () => fetchTemplates({ data: undefined as never }),
  });

  const [activeKey, setActiveKey] = useState<string>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mode, setMode] = useState<"preview" | "html">("preview");
  const [testTo, setTestTo] = useState("");

  const list = useMemo(() => templates.data ?? [], [templates.data]);
  const active: EmailTemplateRecord | undefined = list.find((t) => t.key === activeKey) ?? list[0];

  // Pri prepnutí šablóny (a po uložení) sa do editora načíta jej znenie.
  useEffect(() => {
    if (!active) return;
    setActiveKey(active.key);
    setDraft({
      subject: active.subject,
      html: active.html,
      text: active.text,
      enabled: active.enabled,
    });
  }, [active?.key, active?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          key: active!.key,
          subject: draft!.subject,
          html: draft!.html,
          text: draft!.text || null,
          enabled: draft!.enabled,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-templates"] });
      toast.success("Šablóna uložená");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const resetMutation = useMutation({
    mutationFn: () => reset({ data: { key: active!.key } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-templates"] });
      toast.success("Obnovené pôvodné znenie");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Obnovenie zlyhalo"),
  });

  const testMutation = useMutation({
    mutationFn: () =>
      sendTest({
        data: { key: active!.key, to: testTo, subject: draft!.subject, html: draft!.html },
      }),
    onSuccess: (r) =>
      r.ok
        ? toast.success(`Testovací e-mail odoslaný na ${testTo}`)
        : toast.error(r.message || "Odoslanie zlyhalo"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Odoslanie zlyhalo"),
  });

  // Náhľad skladá tá istá funkcia, ktorá e-mail naozaj renderuje — čo vidíš,
  // to zákazník dostane.
  const previewVars = useMemo(
    () => Object.fromEntries((active?.variables ?? []).map((v) => [v.key, v.example])),
    [active],
  );
  const previewHtml = draft ? renderTemplate(draft.html, previewVars) : "";
  const previewSubject = draft ? renderTemplate(draft.subject, previewVars, { escape: false }) : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Emailové šablóny</h1>
        <p className="text-muted-foreground mt-1">
          Znenie e-mailov, ktoré platforma posiela zákazníkom. Kým šablónu neuložíš, používa sa
          vstavané znenie z aplikácie — odosielanie teda nikdy nezostane bez textu.
        </p>
      </div>

      {templates.isLoading && (
        <Card className="bg-card/60 border-border/50 p-10 text-center text-muted-foreground">
          <Loader2 className="mx-auto size-5 animate-spin" />
        </Card>
      )}

      {list.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {list.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveKey(t.key)}
              className={`px-3 py-2 rounded-lg text-sm border transition text-left ${
                active?.key === t.key
                  ? "bg-primary/15 border-primary text-foreground"
                  : "bg-muted/40 border-border/50 hover:border-primary/50"
              }`}
            >
              <div className="font-medium flex items-center gap-2">
                <Mail className="size-3.5" /> {t.name}
                {t.customized ? (
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0 text-[10px]">
                    upravená
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    pôvodná
                  </Badge>
                )}
                {!t.enabled && (
                  <Badge variant="destructive" className="text-[10px]">
                    vypnutá
                  </Badge>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5 max-w-md">
                {t.description}
              </div>
            </button>
          ))}
        </div>
      )}

      {active && draft && (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <Card className="bg-card/60 border-border/50 p-5 space-y-4">
            <div className="space-y-2">
              <Label>Predmet</Label>
              <Input
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Náhľad: {previewSubject}</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Telo e-mailu</Label>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={mode === "preview" ? "default" : "outline"}
                    onClick={() => setMode("preview")}
                  >
                    <Eye className="size-3.5 mr-1.5" /> Náhľad
                  </Button>
                  <Button
                    size="sm"
                    variant={mode === "html" ? "default" : "outline"}
                    onClick={() => setMode("html")}
                  >
                    <Code className="size-3.5 mr-1.5" /> HTML
                  </Button>
                </div>
              </div>
              {mode === "html" ? (
                <Textarea
                  rows={20}
                  className="font-mono text-xs"
                  value={draft.html}
                  onChange={(e) => setDraft({ ...draft, html: e.target.value })}
                />
              ) : (
                // `sandbox=""` vypne v náhľade skripty aj odkazy — šablóna je
                // cudzie HTML a nemá čo bežať v admine.
                <iframe
                  title="Náhľad e-mailu"
                  sandbox=""
                  srcDoc={previewHtml}
                  className="w-full h-[480px] rounded-md border border-border/50 bg-white"
                />
              )}
            </div>

            <div className="space-y-2">
              <Label>Čistý text (pre klientov bez HTML)</Label>
              <Textarea
                rows={3}
                className="font-mono text-xs"
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/40">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
                />
                Používať túto úpravu
                <span className="text-xs text-muted-foreground">
                  (vypnuté = pošle sa pôvodné znenie)
                </span>
              </label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (confirm("Zahodiť úpravy a vrátiť pôvodné znenie?")) resetMutation.mutate();
                  }}
                  disabled={!active.customized || resetMutation.isPending}
                >
                  <RotateCcw className="size-4 mr-2" /> Obnoviť pôvodné
                </Button>
                <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="size-4 mr-2" />
                  )}
                  Uložiť
                </Button>
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="bg-card/60 border-border/50 p-5">
              <h2 className="font-semibold mb-1">Premenné</h2>
              <p className="text-xs text-muted-foreground mb-3">
                Zapíš ich do textu ako <code className="font-mono">{"{{kľúč}}"}</code>. Časť, ktorá
                sa má skryť, keď je hodnota prázdna, obaľ do{" "}
                <code className="font-mono">{"{{#if kľúč}} … {{/if}}"}</code>.
              </p>
              <div className="space-y-2">
                {active.variables.map((v) => (
                  <div key={v.key} className="text-xs">
                    <button
                      className="font-mono text-primary hover:underline"
                      onClick={() => {
                        navigator.clipboard?.writeText(`{{${v.key}}}`);
                        toast.success(`Skopírované {{${v.key}}}`);
                      }}
                    >
                      {`{{${v.key}}}`}
                    </button>
                    <div className="text-muted-foreground">
                      {v.label} — napr. {v.example}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="bg-card/60 border-border/50 p-5 space-y-3">
              <h2 className="font-semibold">Skúšobné odoslanie</h2>
              <p className="text-xs text-muted-foreground">
                Pošle práve rozpísané znenie s ukážkovými údajmi, cez toho istého odosielateľa ako
                ostré e-maily.
              </p>
              <Input
                type="email"
                placeholder="tvoj@email.sk"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={() => testMutation.mutate()}
                disabled={!testTo.includes("@") || testMutation.isPending}
              >
                {testMutation.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Send className="size-4 mr-2" />
                )}
                Poslať test
              </Button>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
