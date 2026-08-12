import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { LANGS, translate, type Lang, type TranslateVars } from "@/lib/i18n";

const STORAGE_KEY = "lang";

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: TranslateVars) => string;
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // Start as "sk" on both SSR and the first client render so the React tree
  // matches the SSR HTML (no hydration mismatch). We read the saved language
  // from localStorage AFTER mount, exactly like ThemeProvider does.
  const [lang, setLangState] = useState<Lang>("sk");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v && (LANGS as readonly string[]).includes(v)) setLangState(v as Lang);
    } catch {}
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {}
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang, mounted]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const t = useCallback((key: string, vars?: TranslateVars) => translate(lang, key, vars), [lang]);

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const c = useContext(I18nContext);
  if (!c) throw new Error("useI18n must be used within I18nProvider");
  return c;
}
