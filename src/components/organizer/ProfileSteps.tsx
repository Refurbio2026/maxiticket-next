// Kroky organizátorského profilu — jeden zdroj polí pre dve miesta:
// sprievodcu na `/onboarding` (kroky za sebou) a stránku „Verejný profil"
// v administrácii organizátora (tie isté karty pod sebou). Keby to boli dva
// formuláre, pri každom novom poli by sa jeden z nich zabudol.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Globe, ImagePlus, Landmark, Loader2, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { uploadEventImage } from "@/lib/event-images.functions";
import { checkSubdomain } from "@/lib/organizers.functions";
import type { ProfileForm } from "@/lib/organizer-profile-form";
import {
  LINK_PLATFORMS,
  formatujIban,
  platnyIban,
  type LinkPlatform,
} from "@/lib/organizer-profile";
import { chybaSubdomeny, navrhSubdomeny } from "@/lib/subdomena";

/** Musí sedieť s bucketom `event-images` a s `uploadEventImage`. */
const POVOLENE_TYPY = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const MAX_BAJTOV = 5 * 1024 * 1024;

type Props = {
  form: ProfileForm;
  setForm: React.Dispatch<React.SetStateAction<ProfileForm>>;
};

function Pole({
  label,
  hint,
  children,
  wide,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`space-y-2 ${wide ? "sm:col-span-2" : ""}`}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Nahranie obrázka do úložiska; vracia verejný odkaz. */
function NahratObrazok({
  hodnota,
  onZmena,
  popis,
  vyska,
}: {
  hodnota: string;
  onZmena: (url: string) => void;
  popis: string;
  vyska: string;
}) {
  const [nahravam, setNahravam] = useState(false);
  const vstup = useRef<HTMLInputElement>(null);
  const nahraj = useServerFn(uploadEventImage);

  // Súbor ide ako base64 — server funkcie prenášajú JSON, nie multipart.
  const vyber = async (file: File | undefined) => {
    if (!file) return;
    if (!POVOLENE_TYPY.includes(file.type))
      return toast.error("Podporujeme JPG, PNG, WEBP a AVIF.");
    if (file.size > MAX_BAJTOV) return toast.error("Obrázok má viac ako 5 MB.");
    setNahravam(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Súbor sa nepodarilo prečítať."));
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
        reader.readAsDataURL(file);
      });
      const res = await nahraj({ data: { content_type: file.type, base64 } });
      onZmena(res.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nahrávanie zlyhalo.");
    } finally {
      setNahravam(false);
      if (vstup.current) vstup.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div
        className={`relative overflow-hidden rounded-xl border border-dashed border-border/60 bg-muted/20 ${vyska}`}
      >
        {hodnota ? (
          <img src={hodnota} alt="" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-xs text-muted-foreground">
            {popis}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          ref={vstup}
          type="file"
          accept={POVOLENE_TYPY.join(",")}
          className="hidden"
          onChange={(e) => vyber(e.target.files?.[0])}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={nahravam}
          onClick={() => vstup.current?.click()}
        >
          {nahravam ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : (
            <ImagePlus className="size-3.5 mr-1.5" />
          )}
          {hodnota ? "Vymeniť" : "Nahrať"}
        </Button>
        {hodnota && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onZmena("")}>
            <X className="size-3.5 mr-1.5" /> Odobrať
          </Button>
        )}
      </div>
    </div>
  );
}

export function StepIdentita({ form, setForm }: Props) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Pole
        label="Verejný názov"
        hint="Pod týmto ťa uvidia kupujúci. Môže sa líšiť od obchodného mena vo faktúre."
        wide
      >
        <Input
          value={form.display_name}
          placeholder="Amfiteáter Zvolen"
          onChange={(e) => {
            const display_name = e.target.value;
            setForm((f) => ({
              ...f,
              display_name,
              // Adresu navrhneme z názvu, kým si ju organizátor sám neupravil.
              subdomain:
                f.subdomain === "" || f.subdomain === navrhSubdomeny(f.display_name)
                  ? navrhSubdomeny(display_name)
                  : f.subdomain,
            }));
          }}
        />
      </Pole>

      <Pole label="Logo" hint="Štvorcové vyjde najlepšie. Zobrazuje sa na profile a v e-maile.">
        <NahratObrazok
          hodnota={form.logo_url}
          onZmena={(logo_url) => setForm((f) => ({ ...f, logo_url }))}
          popis="Bez loga"
          vyska="h-32 w-32"
        />
      </Pole>

      <Pole label="Titulný obrázok" hint="Široký pás v hlavičke profilu. Nepovinný.">
        <NahratObrazok
          hodnota={form.cover_url}
          onZmena={(cover_url) => setForm((f) => ({ ...f, cover_url }))}
          popis="Bez titulného obrázka"
          vyska="h-32 w-full"
        />
      </Pole>

      <Pole label="Mesto" hint="Odkiaľ organizuješ. Pomáha v katalógu.">
        <Input
          value={form.city}
          placeholder="Zvolen"
          onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
        />
      </Pole>

      <Pole label="Web">
        <Input
          value={form.website}
          placeholder="amfiteater.sk"
          onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
        />
      </Pole>

      <Pole label="Krátky popis" hint="Dva–tri riadky o tom, čo robíš." wide>
        <Textarea
          rows={4}
          value={form.bio}
          onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
        />
      </Pole>
    </div>
  );
}

export function StepAdresa({ form, setForm }: Props) {
  const over = useServerFn(checkSubdomain);
  const adresa = form.subdomain.trim().toLowerCase();
  const chybaFormatu = adresa === "" ? null : chybaSubdomeny(adresa);

  // Tá istá kontrola, akú robí asistent v admine — vrátane toho, či adresa už
  // odpovedá naživo. Bez zástupného DNS záznamu a wildcard certifikátu sa
  // subdoména zapísať dá, ale neotvorí sa; nech to človek vie dopredu.
  const kontrola = useQuery({
    queryKey: ["subdomena-check", adresa],
    queryFn: () => over({ data: { subdomain: adresa } }),
    enabled: adresa !== "" && chybaFormatu === null,
    staleTime: 10_000,
  });

  const volna = kontrola.data?.volna === true;

  return (
    <div className="space-y-5">
      <Pole
        label="Adresa profilu"
        hint="Malé písmená bez diakritiky, číslice a spojovník, 3–32 znakov. Zmeniť sa dá aj neskôr, ale rozposlané odkazy prestanú fungovať."
      >
        <div className="flex items-center gap-0 rounded-xl border border-border/60 bg-muted/20 px-3 py-1">
          <span className="shrink-0 text-sm text-muted-foreground">eticketo.eu/o/</span>
          <Input
            className="border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
            value={form.subdomain}
            placeholder="amfiteater-zvolen"
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                subdomain: e.target.value.toLowerCase().replace(/\s+/g, "-"),
              }))
            }
          />
          <span className="shrink-0 pl-2">
            {adresa === "" ? null : chybaFormatu ? (
              <X className="size-4 text-destructive" />
            ) : kontrola.isFetching ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : volna ? (
              <Check className="size-4 text-emerald-500" />
            ) : (
              <X className="size-4 text-destructive" />
            )}
          </span>
        </div>
      </Pole>

      {(chybaFormatu || kontrola.data?.chyba) && (
        <p className="text-sm text-destructive">{chybaFormatu ?? kontrola.data?.chyba}</p>
      )}

      <div className="rounded-xl border border-border/50 bg-muted/10 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Globe className="size-4 text-primary" /> Jedna adresa, dve cesty
        </div>
        <p className="mt-2 text-muted-foreground">
          Všetky tvoje podujatia na jednej stránke, ktorú môžeš dať do bia na Instagrame:{" "}
          <span className="font-mono text-foreground">
            eticketo.eu/o/{adresa || "tvoja-adresa"}
          </span>
          . Tá istá hodnota poslúži aj ako vlastná subdoména{" "}
          <span className="font-mono text-foreground">{adresa || "tvoja-adresa"}.eticketo.eu</span>,
          takže odkazy, ktoré rozpošleš dnes, ostanú v platnosti.
        </p>
        {volna && !kontrola.data?.https_ok && (
          <p className="mt-2 text-xs text-muted-foreground">
            Subdoména zatiaľ neodpovedá — chýba k nej DNS záznam a certifikát. Adresa{" "}
            <span className="font-mono">/o/{adresa}</span> funguje bez nich.
          </p>
        )}
      </div>

      <div className="flex items-start justify-between gap-4 rounded-xl border border-border/50 p-4">
        <div>
          <div className="text-sm font-medium">Zobrazovať ma v katalógu eticketo</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Keď vypneš, podujatia sa budú predávať len cez tvoju adresu a odkazy, ktoré rozpošleš.
          </p>
        </div>
        <Switch
          checked={form.listed_in_catalog}
          onCheckedChange={(v) => setForm((f) => ({ ...f, listed_in_catalog: v }))}
        />
      </div>
    </div>
  );
}

export function StepSiete({ form, setForm }: Props) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Odkazy sa zobrazia na tvojom profile a v pätičke e-mailu so vstupenkou. Vyplň len tie, ktoré
        naozaj používaš — prázdne polia sa neuložia.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {LINK_PLATFORMS.map((p) => (
          <Pole key={p.key} label={p.label}>
            <Input
              value={form.links[p.key] ?? ""}
              placeholder={p.hint}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  links: { ...f.links, [p.key as LinkPlatform]: e.target.value },
                }))
              }
            />
          </Pole>
        ))}
      </div>
    </div>
  );
}

export function StepFirma({ form, setForm }: Props) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Pole label="Obchodné meno" hint="Presne ako v registri — ide na faktúru." wide>
        <Input
          value={form.company_name}
          placeholder="Amfiteáter, s. r. o."
          onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
        />
      </Pole>
      <Pole label="IČO">
        <Input
          value={form.ico}
          inputMode="numeric"
          onChange={(e) => setForm((f) => ({ ...f, ico: e.target.value }))}
        />
      </Pole>
      <Pole label="DIČ">
        <Input value={form.dic} onChange={(e) => setForm((f) => ({ ...f, dic: e.target.value }))} />
      </Pole>
      <Pole label="Fakturačná adresa" wide>
        <Input
          value={form.billing_address}
          placeholder="Námestie 1, 960 01 Zvolen"
          onChange={(e) => setForm((f) => ({ ...f, billing_address: e.target.value }))}
        />
      </Pole>
      <Pole label="Telefón" hint="Kontakt pre nás aj pre kupujúceho, keď nastane problém.">
        <Input
          value={form.phone}
          placeholder="+421 900 000 000"
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        />
      </Pole>
      <div className="space-y-3 sm:col-span-2">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-border/50 p-4">
          <div>
            <div className="text-sm font-medium">Som platca DPH</div>
            <p className="text-xs text-muted-foreground mt-1">
              Rozhoduje o tom, ako sa počíta cena vstupenky a čo bude na faktúre.
            </p>
          </div>
          <Switch
            checked={form.vat_payer}
            onCheckedChange={(v) => setForm((f) => ({ ...f, vat_payer: v }))}
          />
        </div>
        {form.vat_payer && (
          <Pole label="IČ DPH">
            <Input
              value={form.ic_dph}
              placeholder="SK2020000000"
              onChange={(e) => setForm((f) => ({ ...f, ic_dph: e.target.value }))}
            />
          </Pole>
        )}
      </div>
    </div>
  );
}

export function StepVyplaty({ form, setForm }: Props) {
  const iban = form.payout_iban.replace(/\s/g, "");
  const zlyIban = iban !== "" && !platnyIban(iban);
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Peniaze od kupujúcich prichádzajú na účet eticketa a po vyúčtovaní ti ich posielame ďalej.
        Bez IBAN-u sa predávať dá, vyplatiť nie — doplň ho najneskôr pred prvým predajom.
      </p>
      <Pole label="IBAN na výplatu tržby">
        <div className="relative">
          <Landmark className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 font-mono"
            value={form.payout_iban}
            placeholder="SK00 0000 0000 0000 0000 0000"
            onChange={(e) => setForm((f) => ({ ...f, payout_iban: e.target.value }))}
            onBlur={() =>
              setForm((f) => ({
                ...f,
                payout_iban: f.payout_iban.trim() ? formatujIban(f.payout_iban) : "",
              }))
            }
          />
        </div>
      </Pole>
      {zlyIban && (
        <p className="text-sm text-destructive">
          Toto číslo neprešlo kontrolou. Skontroluj, či si neprehodil číslice.
        </p>
      )}
      <Pole label="Ako často chceš výplatu">
        <Select
          value={form.payout_frequency || "per_event"}
          onValueChange={(v) =>
            setForm((f) => ({ ...f, payout_frequency: v as ProfileForm["payout_frequency"] }))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="per_event">Po každom podujatí</SelectItem>
            <SelectItem value="monthly">Raz za mesiac</SelectItem>
          </SelectContent>
        </Select>
      </Pole>
    </div>
  );
}

export function StepPodmienky({ form, setForm, uzOdklikane }: Props & { uzOdklikane: boolean }) {
  return (
    <div className="space-y-5">
      <Pole
        label="Storno podmienky"
        hint="Kupujúci to musí vidieť pred nákupom — zobrazí sa na tvojom profile a pri podujatí."
      >
        <Textarea
          rows={5}
          value={form.cancellation_policy}
          placeholder="Vstupenku je možné vrátiť najneskôr 7 dní pred podujatím…"
          onChange={(e) => setForm((f) => ({ ...f, cancellation_policy: e.target.value }))}
        />
      </Pole>
      <Pole label="Kontakt na reklamácie" hint="E-mail alebo telefón, kam sa kupujúci obráti.">
        <Input
          value={form.complaint_contact}
          placeholder="reklamacie@amfiteater.sk"
          onChange={(e) => setForm((f) => ({ ...f, complaint_contact: e.target.value }))}
        />
      </Pole>
      <label className="flex items-start gap-3 rounded-xl border border-border/50 p-4">
        <Checkbox
          className="mt-0.5"
          checked={form.accept_terms}
          disabled={uzOdklikane}
          onCheckedChange={(v) => setForm((f) => ({ ...f, accept_terms: v === true }))}
        />
        <span className="text-sm">
          Súhlasím s podmienkami pre organizátorov a beriem na vedomie, že údaje kupujúcich
          spracúvam ako prevádzkovateľ.
          {uzOdklikane && (
            <span className="block text-xs text-muted-foreground mt-1">
              Súhlas je už zaznamenaný.
            </span>
          )}
        </span>
      </label>
    </div>
  );
}
