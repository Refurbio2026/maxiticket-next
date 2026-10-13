// Schvaľovanie organizátorských účtov.
//
// Registrácia organizátora je verejná, takže toto je miesto, kde sa rozhoduje,
// kto smie pod hlavičkou eticketa predávať. Zoznam preto ukazuje aj rozpracované
// registrácie — človek, ktorý sa zasekol na polovici, je často len telefonát od
// dokončenia.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  BadgeCheck,
  Ban,
  Clock,
  ExternalLink,
  Loader2,
  PauseCircle,
  RotateCcw,
  XCircle,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  decideOrganizerApplication,
  listOrganizerApplications,
  type OrganizerApplication,
} from "@/lib/organizer-approvals.functions";
import { ORGANIZER_STATUS_LABEL, type OrganizerStatus } from "@/lib/organizer-profile";

export const Route = createFileRoute("/admin/eticketo/organizer-approvals")({
  head: () => ({ meta: [{ title: "Žiadosti organizátorov · eticketo.eu Admin" }] }),
  component: Page,
});

type Filter = "open" | "pending" | "approved" | "all";

const FILTRE: { kluc: Filter; nazov: string }[] = [
  { kluc: "open", nazov: "Nevyriešené" },
  { kluc: "pending", nazov: "Čakajúce" },
  { kluc: "approved", nazov: "Schválené" },
  { kluc: "all", nazov: "Všetky" },
];

const ODZNAK: Record<OrganizerStatus, string> = {
  none: "bg-muted text-muted-foreground",
  onboarding: "bg-sky-500/15 text-sky-500",
  pending: "bg-amber-500/15 text-amber-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  rejected: "bg-destructive/15 text-destructive",
  suspended: "bg-orange-500/15 text-orange-500",
};

const datum = (v: string | null) =>
  v ? new Date(v).toLocaleString("sk-SK", { dateStyle: "medium", timeStyle: "short" }) : "—";

function Page() {
  const qc = useQueryClient();
  const fetchZiadosti = useServerFn(listOrganizerApplications);
  const rozhodni = useServerFn(decideOrganizerApplication);

  const [filter, setFilter] = useState<Filter>("open");
  const [detail, setDetail] = useState<OrganizerApplication | null>(null);
  const [poznamka, setPoznamka] = useState("");

  const ziadosti = useQuery({
    queryKey: ["organizer-applications", filter],
    queryFn: () => fetchZiadosti({ data: { status: filter } }),
  });

  const rozhodnutie = useMutation({
    mutationFn: (vstup: {
      user_id: string;
      decision: "approve" | "reject" | "suspend" | "reinstate";
    }) => rozhodni({ data: { ...vstup, note: poznamka.trim() || null } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["organizer-applications"] });
      qc.invalidateQueries({ queryKey: ["admin-organizers"] });
      toast.success(`Stav zmenený na „${ORGANIZER_STATUS_LABEL[res.status]}".`);
      setDetail(null);
      setPoznamka("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Nepodarilo sa"),
  });

  const otvor = (z: OrganizerApplication) => {
    setDetail(z);
    setPoznamka(z.organizer_review_note ?? "");
  };

  const riadky = ziadosti.data ?? [];
  const cakajucich = riadky.filter((z) => z.organizer_status === "pending").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Žiadosti organizátorov</h1>
        <p className="mt-1 text-muted-foreground">
          Schválením sa prideľuje rola <span className="font-mono text-xs">organizer</span>. Kým
          účet nie je schválený, podujatie sa nedá zverejniť — odmietne to samotná databáza.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTRE.map((f) => (
          <Button
            key={f.kluc}
            size="sm"
            variant={filter === f.kluc ? "default" : "outline"}
            onClick={() => setFilter(f.kluc)}
          >
            {f.nazov}
          </Button>
        ))}
        {cakajucich > 0 && (
          <Badge className="border-0 bg-amber-500/15 text-amber-500">
            <Clock className="mr-1 size-3" /> {cakajucich} čaká na rozhodnutie
          </Badge>
        )}
      </div>

      <Card className="overflow-hidden bg-card/60 border-border/50">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Organizátor</th>
                <th className="px-4 py-3 font-medium">Firma</th>
                <th className="px-4 py-3 font-medium">Adresa profilu</th>
                <th className="px-4 py-3 font-medium">Stav</th>
                <th className="px-4 py-3 font-medium">Požiadané</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {ziadosti.isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </td>
                </tr>
              )}
              {!ziadosti.isLoading && riadky.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    Žiadne žiadosti v tomto výbere.
                  </td>
                </tr>
              )}
              {riadky.map((z) => (
                <tr key={z.id} className="border-b border-border/30 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{z.display_name || z.full_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{z.email}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {z.company_name || "—"}
                    {z.ico ? <div className="text-xs">IČO {z.ico}</div> : null}
                  </td>
                  <td className="px-4 py-3">
                    {z.subdomain ? (
                      <span className="font-mono text-xs">/o/{z.subdomain}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">nenastavená</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={`border-0 ${ODZNAK[z.organizer_status]}`}>
                      {ORGANIZER_STATUS_LABEL[z.organizer_status]}
                    </Badge>
                    {z.organizer_status === "onboarding" && (
                      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        krok {z.onboarding_step} / 6
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {datum(z.organizer_requested_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => otvor(z)}>
                      Posúdiť
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog
        open={!!detail}
        onOpenChange={(v) => {
          if (!v) {
            setDetail(null);
            setPoznamka("");
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.display_name || detail?.full_name || detail?.email}</DialogTitle>
            <DialogDescription>
              {detail ? ORGANIZER_STATUS_LABEL[detail.organizer_status] : ""} · žiadosť{" "}
              {datum(detail?.organizer_requested_at ?? null)}
            </DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <Udaj label="E-mail" hodnota={detail.email} />
                <Udaj label="Telefón" hodnota={detail.phone} />
                <Udaj label="Obchodné meno" hodnota={detail.company_name} />
                <Udaj label="IČO" hodnota={detail.ico} />
                <Udaj label="DIČ" hodnota={detail.dic} />
                <Udaj
                  label="IČ DPH"
                  hodnota={detail.vat_payer ? detail.ic_dph || "platca, nevyplnené" : "neplatca"}
                />
                <Udaj label="Fakturačná adresa" hodnota={detail.billing_address} />
                <Udaj label="IBAN" hodnota={detail.payout_iban} mono />
                <Udaj label="Mesto" hodnota={detail.city} />
                <Udaj
                  label="V katalógu"
                  hodnota={detail.listed_in_catalog ? "áno" : "nie (len vlastná adresa)"}
                />
                <Udaj label="Podujatí v systéme" hodnota={String(detail.events_count)} />
                <Udaj label="Kontakt na reklamácie" hodnota={detail.complaint_contact} />
              </div>

              {detail.subdomain && (
                <a
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
                  href={`/o/${detail.subdomain}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-3.5" /> /o/{detail.subdomain}
                </a>
              )}

              {detail.bio && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Popis
                  </div>
                  <p className="mt-1 whitespace-pre-line text-foreground/80">{detail.bio}</p>
                </div>
              )}

              {detail.cancellation_policy && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Storno podmienky
                  </div>
                  <p className="mt-1 whitespace-pre-line text-foreground/80">
                    {detail.cancellation_policy}
                  </p>
                </div>
              )}

              {detail.links.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Sociálne siete
                  </div>
                  <ul className="mt-1 space-y-1">
                    {detail.links.map((l) => (
                      <li key={l.platform}>
                        <a
                          className="text-primary hover:underline"
                          href={l.url}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {l.platform}: {l.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-2">
                <Label>Poznámka k rozhodnutiu</Label>
                <Textarea
                  rows={3}
                  value={poznamka}
                  placeholder="Pri zamietnutí a pozastavení povinné — organizátor ju dostane e-mailom."
                  onChange={(e) => setPoznamka(e.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2">
            {detail && detail.organizer_status !== "approved" && (
              <Button
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={rozhodnutie.isPending}
                onClick={() => rozhodnutie.mutate({ user_id: detail.id, decision: "approve" })}
              >
                <BadgeCheck className="mr-1.5 size-4" /> Schváliť
              </Button>
            )}
            {detail && detail.organizer_status === "suspended" && (
              <Button
                variant="outline"
                disabled={rozhodnutie.isPending}
                onClick={() => rozhodnutie.mutate({ user_id: detail.id, decision: "reinstate" })}
              >
                <RotateCcw className="mr-1.5 size-4" /> Zrušiť pozastavenie
              </Button>
            )}
            {detail && detail.organizer_status === "approved" && (
              <Button
                variant="outline"
                className="border-orange-500/40 text-orange-500"
                disabled={rozhodnutie.isPending}
                onClick={() => rozhodnutie.mutate({ user_id: detail.id, decision: "suspend" })}
              >
                <PauseCircle className="mr-1.5 size-4" /> Pozastaviť
              </Button>
            )}
            {detail && detail.organizer_status !== "approved" && (
              <Button
                variant="outline"
                className="border-destructive/40 text-destructive"
                disabled={rozhodnutie.isPending}
                onClick={() => rozhodnutie.mutate({ user_id: detail.id, decision: "reject" })}
              >
                <XCircle className="mr-1.5 size-4" /> Zamietnuť
              </Button>
            )}
            <Button variant="ghost" onClick={() => setDetail(null)}>
              <Ban className="mr-1.5 size-4" /> Zavrieť
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Udaj({
  label,
  hodnota,
  mono,
}: {
  label: string;
  hodnota: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-xs" : ""}>{hodnota || "—"}</div>
    </div>
  );
}
