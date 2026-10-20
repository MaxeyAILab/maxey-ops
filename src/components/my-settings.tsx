"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useT } from "@/components/lang-provider";
import { LanguageToggle } from "@/components/language-toggle";
import { hapticsOn, setHaptics, toast } from "@/components/feedback-provider";
import { playChime, setSound, soundOn } from "@/lib/chime";
import { passkeysSupported, registerPasskey, wasCancelled } from "@/lib/passkey-client";
import { MAX_TABS, MIN_TABS } from "@/lib/mobile-tabs";
import { MAX_QUICK } from "@/lib/quick-actions";

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

interface PickOption {
  key: string;
  label: string;
  icon: string;
}

/**
 * "Pick what goes here" — tick the options you want (the order you tick them is the order they show), save, or go back to the
 * default. Used for the bottom bar and for the floating + button.
 */
function PickSection({
  field,
  title,
  help,
  options,
  chosen,
  defaults,
  usingDefault: startsDefault,
  min,
  max,
  defaultNote,
}: {
  field: "mobileTabs" | "quickActions";
  title: string;
  help: string;
  options: PickOption[];
  chosen: string[];
  defaults: string[];
  usingDefault: boolean;
  min: number;
  max: number;
  defaultNote: string;
}) {
  const t = useT();
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(chosen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [usingDefault, setUsingDefault] = useState(startsDefault);

  const toggle = (key: string) => {
    setError("");
    setUsingDefault(false);
    setPicked((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : cur.length >= max ? cur : [...cur, key]));
  };
  async function save(toSave: string[]) {
    setBusy(true);
    setError("");
    const res = await fetch("/api/account/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: toSave }) });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save");
    setUsingDefault(toSave.length === 0);
    toast(t("toast.saved"));
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-lg border border-ink-200 p-4">
      <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
      <p className="text-xs text-ink-500">{help}</p>
      {usingDefault && <p className="text-xs font-medium text-ink-600">{defaultNote}</p>}
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {options.map((o) => {
          const on = picked.includes(o.key);
          const full = !on && picked.length >= max;
          return (
            <li key={o.key}>
              <label className={`flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${on ? "border-[#8a1a28] bg-[#8a1a28]/5 text-ink-900" : "border-ink-200 text-ink-700"} ${full ? "opacity-50" : ""}`}>
                <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(o.key)} />
                <span aria-hidden>{o.icon}</span>
                {o.label}
                {on && <span className="ml-auto text-xs text-ink-400">{picked.indexOf(o.key) + 1}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => save(picked)} disabled={busy || picked.length < min}>
          {t("settings.save")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setPicked(defaults);
            save([]);
          }}
          disabled={busy}
        >
          {t("settings.useDefault")}
        </Button>
      </div>
    </section>
  );
}

export function MySettings({
  tabs,
  chosen,
  defaults,
  usingDefault,
  quick,
  passkeys,
}: {
  tabs: TabOption[];
  chosen: string[];
  defaults: string[];
  usingDefault: boolean;
  quick: { options: PickOption[]; chosen: string[]; defaults: string[]; usingDefault: boolean };
  passkeys: PasskeyRow[];
}) {
  const t = useT();
  const router = useRouter();

  // ----- vibration -----
  const [vibrate, setVibrate] = useState(true);
  useEffect(() => setVibrate(hapticsOn()), []);
  const [sound, setSoundState] = useState(true);
  useEffect(() => setSoundState(soundOn()), []);

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
      <PickSection
        field="mobileTabs"
        title={t("settings.bottomBar")}
        help={t("settings.bottomBarHelp")}
        options={tabs.map((x) => ({ key: x.href, label: x.label, icon: x.icon }))}
        chosen={chosen}
        defaults={defaults}
        usingDefault={usingDefault}
        min={MIN_TABS}
        max={MAX_TABS}
        defaultNote={t("settings.isDefault")}
      />

      <PickSection
        field="quickActions"
        title={t("settings.quickTitle")}
        help={t("settings.quickHelp")}
        options={quick.options}
        chosen={quick.chosen}
        defaults={quick.defaults}
        usingDefault={quick.usingDefault}
        min={1}
        max={MAX_QUICK}
        defaultNote={t("settings.quickDefault")}
      />

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
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-800">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              setSoundState(e.target.checked);
              setSound(e.target.checked);
              if (e.target.checked) playChime(); // so they hear what it sounds like
            }}
          />
          {t("settings.sound")}
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
