"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported } from "@/lib/push-client";

export interface CategoryOption {
  key: string;
  label: string;
  muted: boolean;
}

type PhoneState = "checking" | "unsupported" | "needs-install" | "blocked" | "off" | "on";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;

/** Phone alerts for this device, plus the person's own category mutes and quiet hours. */
export function NotificationSettings({ categories, quietStart, quietEnd }: { categories: CategoryOption[]; quietStart: number | null; quietEnd: number | null }) {
  const [phone, setPhone] = useState<PhoneState>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [muted, setMuted] = useState<Set<string>>(new Set(categories.filter((c) => c.muted).map((c) => c.key)));
  const [qs, setQs] = useState<number | null>(quietStart);
  const [qe, setQe] = useState<number | null>(quietEnd);
  const [saved, setSaved] = useState(false);

  async function refresh() {
    if (!pushSupported()) {
      // iPhones only allow notifications for an app added to the Home Screen.
      setPhone(isIos() && !isStandalone() ? "needs-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") return setPhone("blocked");
    setPhone((await currentSubscription()) && Notification.permission === "granted" ? "on" : "off");
  }
  useEffect(() => {
    refresh();
  }, []);

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    const r = await enablePush();
    setBusy(false);
    if (r.ok) setMessage({ tone: "ok", text: "Notifications are on for this phone." });
    else setMessage({ tone: "error", text: r.error });
    await refresh();
  }
  async function turnOff() {
    setBusy(true);
    setMessage(null);
    await disablePush();
    setBusy(false);
    setMessage({ tone: "ok", text: "Notifications are off for this phone." });
    await refresh();
  }
  async function sendTest() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/push/test", { method: "POST" });
    setBusy(false);
    if (res.ok) setMessage({ tone: "ok", text: "Test sent — it should appear on your phone in a moment." });
    else setMessage({ tone: "error", text: ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "The test didn't send." });
  }

  async function savePrefs(nextMuted: Set<string>, start: number | null, end: number | null) {
    setSaved(false);
    const res = await fetch("/api/notifications/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ muted: Array.from(nextMuted), quietStart: start, quietEnd: end }),
    });
    if (res.ok) setSaved(true);
    else setMessage({ tone: "error", text: ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save." });
  }
  function toggle(key: string) {
    const next = new Set(muted);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setMuted(next);
    savePrefs(next, qs, qe);
  }
  function setQuiet(start: number | null, end: number | null) {
    setQs(start);
    setQe(end);
    // both or neither: a half-set range isn't saved until it is complete
    if ((start == null) === (end == null)) savePrefs(muted, start, end);
  }

  const select = "min-h-[40px] rounded-lg border border-ink-200 bg-ink-50 px-2 text-sm";

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border border-ink-200 p-4">
        <h2 className="text-sm font-semibold text-ink-900">Alerts on this phone</h2>
        {phone === "checking" && <p className="text-sm text-ink-500">Checking…</p>}
        {phone === "unsupported" && (
          <p className="text-sm text-ink-600">
            This browser can&apos;t show phone notifications. Use Chrome on Android, or Safari on iPhone with the app added to the Home Screen. You&apos;ll still see everything under the bell.
          </p>
        )}
        {phone === "needs-install" && (
          <div className="space-y-1 text-sm text-ink-700">
            <p className="font-medium">On iPhone, add Maxey Ops to your Home Screen first:</p>
            <ol className="list-decimal space-y-0.5 pl-5">
              <li>
                Open this page in <strong>Safari</strong>.
              </li>
              <li>
                Tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>.
              </li>
              <li>
                Open <strong>Maxey Ops from the Home Screen</strong> (not Safari), come back to this page and tap &ldquo;Turn on notifications&rdquo;.
              </li>
            </ol>
          </div>
        )}
        {phone === "blocked" && (
          <p className="text-sm text-red-700">
            Notifications are blocked for Maxey Ops on this phone. Allow them in the phone&apos;s Settings (Notifications → Maxey Ops), then come back here.
          </p>
        )}
        {phone === "off" && (
          <div className="space-y-2">
            <p className="text-sm text-ink-600">Notifications are off on this phone. Turn them on to be alerted the moment something you&apos;re involved in changes.</p>
            <Button onClick={turnOn} disabled={busy}>
              {busy ? "Turning on…" : "Turn on notifications"}
            </Button>
          </div>
        )}
        {phone === "on" && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-emerald-700">✓ Notifications are on for this phone.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={sendTest} disabled={busy}>
                Send me a test
              </Button>
              <Button variant="secondary" onClick={turnOff} disabled={busy}>
                Turn off on this phone
              </Button>
            </div>
          </div>
        )}
        {message && <p className={`text-sm ${message.tone === "ok" ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p>}
        <p className="text-xs text-ink-500">Each phone or browser you sign in on is turned on separately. Signing out turns it off on that phone.</p>
      </section>

      <section className="space-y-3 rounded-lg border border-ink-200 p-4">
        <h2 className="text-sm font-semibold text-ink-900">What you&apos;re told about</h2>
        <p className="text-xs text-ink-500">Based on your role and the tabs you have. Untick a kind to stop hearing about it — you can turn it back on any time.</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {categories.map((c) => (
            <li key={c.key}>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-800">
                <input type="checkbox" checked={!muted.has(c.key)} onChange={() => toggle(c.key)} />
                {c.label}
              </label>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 pt-1 text-sm text-ink-800">
          <span>No phone alerts from</span>
          <select aria-label="Quiet hours start" className={select} value={qs ?? ""} onChange={(e) => setQuiet(e.target.value === "" ? null : Number(e.target.value), qe)}>
            <option value="">— off —</option>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
          <span>to</span>
          <select aria-label="Quiet hours end" className={select} value={qe ?? ""} onChange={(e) => setQuiet(qs, e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">— off —</option>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink-500">(Manila time — they still appear under the bell)</span>
        </div>
        {saved && <p className="text-sm text-emerald-700">Saved.</p>}
      </section>
    </div>
  );
}
