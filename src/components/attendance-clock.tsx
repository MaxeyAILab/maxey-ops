"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { submitOrQueue } from "@/lib/outbox";
import { Button, Label, Select } from "@/components/ui";
import { useT } from "@/components/lang-provider";

interface ProjectOption {
  id: string;
  name: string;
}

/** Best-effort GPS fix — never blocks the tap (Spec §4). */
function getGps(): Promise<string> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve("");
    const timer = setTimeout(() => resolve(""), 4000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve(`${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`);
      },
      () => {
        clearTimeout(timer);
        resolve("");
      },
      { enableHighAccuracy: false, timeout: 3500, maximumAge: 60000 }
    );
  });
}

const DEVICE_ID_KEY = "maxey_device_id";

/** A readable "OS · Browser" label from the user agent — for a human to scan, not a security control. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  let os = "Unknown OS";
  if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Macintosh/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";

  let browser = "Unknown browser";
  if (/SamsungBrowser/.test(ua)) browser = "Samsung Internet";
  else if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/Firefox/.test(ua)) browser = "Firefox";
  else if (/CriOS/.test(ua)) browser = "Chrome (iOS)";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari/.test(ua)) browser = "Safari";

  if (os === "Unknown OS" && browser === "Unknown browser") return ua.slice(0, 60);
  return `${os} · ${browser}`;
}

/** Stable per-browser id, persisted in localStorage — not a fraud-proof
 * fingerprint (cleared by clearing site data / incognito), but enough to
 * flag "this same browser tapped in for two different people this week." */
function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return ""; // private browsing / storage disabled — degrade gracefully
  }
}

/**
 * Time in/out tap screen (Spec 6.5) — GPS-stamped, offline-capable, one big
 * button. Works for office staff (no project) and site/driver staff.
 */
export function AttendanceClock({
  projects,
  clockedIn,
  needsProject,
}: {
  projects: ProjectOption[];
  clockedIn: boolean;
  needsProject: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [locState, setLocState] = useState<"unknown" | "granted" | "prompt" | "denied">("unknown");
  const [lastFix, setLastFix] = useState<"" | "yes" | "no">("");

  // Tell the person up front whether their location will be recorded, so a blocked permission isn't a surprise later.
  useEffect(() => {
    const perms = (navigator as Navigator & { permissions?: { query(d: { name: string }): Promise<{ state: string; onchange: (() => void) | null }> } }).permissions;
    perms
      ?.query({ name: "geolocation" })
      .then((p) => {
        const apply = () => setLocState(p.state as "granted" | "prompt" | "denied");
        apply();
        p.onchange = apply;
      })
      .catch(() => undefined);
  }, []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function tap(type: "IN" | "OUT") {
    setBusy(true);
    setError("");
    setMsg("");
    const gps = await getGps();
    setLastFix(gps ? "yes" : "no");
    const result = await submitOrQueue({
      url: "/api/attendance",
      label: `Time ${type.toLowerCase()}`,
      body: {
        type,
        projectId: type === "IN" ? projectId : undefined,
        gps,
        device: deviceLabel(),
        deviceId: getDeviceId(),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t("clock.failed"));
      return;
    }
    if (result.queued) {
      setMsg(t(type === "IN" ? "clock.queuedIn" : "clock.queuedOut"));
    } else {
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {!clockedIn && needsProject && (
        <div>
          <Label htmlFor="clockProject">{t("clock.project")}</Label>
          <Select id="clockProject" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{t("clock.office")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {clockedIn ? (
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => tap("OUT")}
          className="h-24 w-full text-xl font-bold"
        >
          {busy ? t("clock.recording") : t("clock.timeOut")}
        </Button>
      ) : (
        <Button
          variant="success"
          disabled={busy}
          onClick={() => tap("IN")}
          className="h-24 w-full text-xl font-bold"
        >
          {busy ? t("clock.recording") : t("clock.timeIn")}
        </Button>
      )}

      {msg && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">{msg}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className={`text-center text-xs ${locState === "denied" || lastFix === "no" ? "text-amber-700" : "text-ink-500"}`}>
        {locState === "denied" ? t("clock.locBlocked") : lastFix === "yes" ? t("clock.locCaptured") : lastFix === "no" ? t("clock.locMissing") : t("clock.locOn")}
      </p>
      <p className="text-center text-xs text-ink-400">{t("clock.footer")}</p>
    </div>
  );
}
