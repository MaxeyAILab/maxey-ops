"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLang, useT } from "@/components/lang-provider";
import { haptic } from "@/components/feedback-provider";
import type { Lang } from "@/lib/i18n";

/** EN | FIL — switches the app's language for this person, on every device they sign in on. */
export function LanguageToggle({ className }: { className?: string }) {
  const lang = useLang();
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function pick(next: Lang) {
    if (next === lang || busy) return;
    setBusy(true);
    haptic("tap");
    await fetch("/api/account/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: next }) }).catch(() => undefined);
    router.refresh();
    setBusy(false);
  }

  const seg = (value: Lang, text: string) => (
    <button
      type="button"
      onClick={() => pick(value)}
      aria-pressed={lang === value}
      className={`px-2 py-1 text-xs font-semibold ${lang === value ? "bg-[#8a1a28] text-white" : "text-ink-600 hover:bg-ink-100"}`}
    >
      {text}
    </button>
  );
  return (
    <span role="group" aria-label={t("chrome.language")} className={`inline-flex overflow-hidden rounded-lg border border-ink-200 ${className ?? ""}`}>
      {seg("en", "EN")}
      {seg("fil", "FIL")}
    </span>
  );
}
