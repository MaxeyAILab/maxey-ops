"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { LANG_COOKIE, makeT, type Lang, type T } from "@/lib/i18n";

const LangContext = createContext<Lang>("en");

/** Makes the person's language available to every client component under it. */
export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

/** `const t = useT(); t("nav.projects")` — the text in the person's language. */
export function useT(): T {
  const lang = useLang();
  return useMemo(() => makeT(lang), [lang]);
}

/**
 * The choice of language is saved on the person's account; this carries it to a phone that hasn't heard of it yet
 * (a new sign-in) by setting the cookie the pages read, then redrawing once.
 */
export function LangSync({ saved }: { saved: Lang }) {
  const router = useRouter();
  useEffect(() => {
    document.cookie = `${LANG_COOKIE}=${saved}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [saved, router]);
  return null;
}
