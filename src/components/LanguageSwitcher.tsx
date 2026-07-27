import { Globe, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { LANGS, LANG_LABELS, LANG_FLAGS } from "@/lib/i18n";
import { useI18n } from "@/hooks/use-i18n";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          aria-label={t("common.language")}
          title={t("common.language")}
        >
          <Globe className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {LANGS.map((l) => (
          <DropdownMenuItem key={l} onClick={() => setLang(l)} className="gap-2 cursor-pointer">
            <span aria-hidden>{LANG_FLAGS[l]}</span>
            <span className="flex-1">{LANG_LABELS[l]}</span>
            {lang === l && <Check className="size-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
