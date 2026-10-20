"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useT } from "@/components/lang-provider";
import { LanguageToggle } from "@/components/language-toggle";
import { hapticsOn, setHaptics, toast } from "@/components/feedback-provider";
import { passkeysSupported, registerPasskey, wasCancelled } from "@/lib/passkey-client";
import { MAX_TABS, MIN_TABS } from "@/lib/mobile-tabs";

interface TabOption {
  href: string;
  label: string;
  icon: string;
}
interface PasskeyRow {
  id: string;
  label: string;
  added: string;
  lastUsed: string | null;
}

/** A readable name for this phone, shown beside its fingerprint / Face ID in the list. */
function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad|iPod/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android phone" : /Windows/.test(ua) ? "Windows PC" : /Macintosh/.test(ua) ? "Mac" : "Device";
  const browser = /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Edg\//.test(ua) ? "Edge" : /Firefox/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
  return browser ? `${os} · ${browser}` : os;
}

export function MySettings({ tabs, chosen, defaults, usingDefault: startsDefault, passkeys }: { tabs: TabOption[]; chosen: string[]; defaults: string[]; usingDefault: boolean; passkeys: PasskeyRow[] }) {
  const t = useT();
  const router = useRouter();

  // ----- bottom bar -----
  const [picked, setPicked] = useState<string[]>(chosen);
  const [barBusy, setBarBusy] = useState(false);
  const [barError, setBarError] = useState("");
  const [usingDefault, setUsingDefault] = useState(startsDefault);
  const toggle = (href: string) => {
    setBarError("");
    setUsingDefault(false);
    setPicked((cur) => (cur.includes(href) ? cur.filter((h) => h !== href) : cur.length >= MAX_TABS ? cur : [...cur, href]));
  };
  async function saveBar(tabsToSave: string[]) {
    setBarBusy(true);
    setBarError("");
    const res = await fetch("/api/account/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mobileTabs: tabsToSave }) });
    setBarBusy(false);
    if (!res.ok) return setBarError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save");
    setUsingDefault(tabsToSave.length === 0);
    toast(t("toast.saved"));
    router.refresh();
  }

  // ----- vibration -----
  const [vibrate, setVibrate] = useState(true);
  useEffect(() => setVibrate(hapticsOn()), []);

  // ----- passkeys -----
  const [canPasskey, setCanPasskey] = useState(true);
  const [pkBusy, setPkBusy] = useState(false);
  const [pkError, setPkError] = useState("");
  useEffect(() => setCanPasskey(passkeysSupported()), []);
  async function addPasskey() {
    setPkBusy(true);
    setPkError("");
    try {
      await registerPasskey(deviceName());
      toast(t("toast.saved"));
      router.refresh();
    } catch (err) {
      if (!wasCancelled(err)) setPkError((err as Error).message);
    } finally {
      setPkBusy(false);
    }
  }
  async function removePasskey(id: string) {
    setPkBusy(true);
    await fetch(`/api/passkey/${id}`, { method: "DELETE" });
    setPkBusy(false);
    router.refresh();
  }

  const card = "space-y-3 rounded-lg border border-ink-200 p-4";
  return (
    <div className="space-y-6">
      <section className={card}>
        <h2 className="text-sm font-semibold text-ink-900">{t("settings.bottomBar")}</h2>
        <p className="text-xs text-ink-500">{t("settings.bottomBarHelp")}</p>
        {usingDefault && <p className="text-xs font-medium text-ink-600">{t("settings.isDefault")}</p>}
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {tabs.map((tab) => {
            const on = picked.includes(tab.href);
            const full = !on && picked.length >= MAX_TABS;
            return (
              <li key={tab.href}>
                <label className={`flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${on ? "border-[#8a1a28] bg-[#8a1a28]/5 text-ink-900" : "border-ink-200 text-ink-700"} ${full ? "opacity-50" : ""}`}>
                  <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(tab.href)} />
                  <span aria-hidden>{tab.icon}</span>
                  {tab.label}
                  {on && <span className="ml-auto text-xs text-ink-400">{picked.indexOf(tab.href) + 1}</span>}
                </label>
              </li>
            );
          })}
        </ul>
        {barError && <p className="text-sm text-red-700">{barError}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => saveBar(picked)} disabled={barBusy || picked.length < MIN_TABS}>
            {t("settings.save")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setPicked(defaults);
              saveBar([]);
            }}
            disabled={barBusy}
          >
            {t("settings.useDefault")}
          </Button>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-ink-900">{t("settings.language")}</h2>
        <LanguageToggle />
        <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm text-ink-800">
          <input
            type="checkbox"
            checked={vibrate}
            onChange={(e) => {
              setVibrate(e.target.checked);
              setHaptics(e.target.checked);
            }}
          />
          {t("settings.vibration")}
        </label>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-ink-900">{t("settings.passkeys")}</h2>
        <p className="text-xs text-ink-500">{t("settings.passkeysHelp")}</p>
        {passkeys.length === 0 ? (
          <p className="text-sm text-ink-600">{t("settings.noPasskeys")}</p>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
            {passkeys.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink-900">🔐 {p.label}</span>
                  <span className="block truncate text-xs text-ink-500">
                    {p.added}
                    {p.lastUsed ? ` · ${p.lastUsed}` : ""}
                  </span>
                </span>
                <button type="button" onClick={() => removePasskey(p.id)} disabled={pkBusy} className="shrink-0 text-xs font-medium text-red-700 hover:underline disabled:opacity-50">
                  {t("settings.removePasskey")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {canPasskey ? (
          <Button onClick={addPasskey} disabled={pkBusy}>
            {t("settings.addPasskey")}
          </Button>
        ) : (
          <p className="text-sm text-ink-600">{t("settings.passkeyUnsupported")}</p>
        )}
        {pkError && <p className="text-sm text-red-700">{pkError}</p>}
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-ink-900">{t("settings.notifications")}</h2>
        <Link href="/notifications" className="text-sm font-medium text-brand-600 hover:underline">
          {t("settings.openNotifications")} →
        </Link>
      </section>
    </div>
  );
}
