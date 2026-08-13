"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitOrQueue } from "@/lib/outbox";
import { Button, Label, Select } from "@/components/ui";

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
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function tap(type: "IN" | "OUT") {
    setBusy(true);
    setError("");
    setMsg("");
    const gps = await getGps();
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
      setError(result.error ?? "Failed");
      return;
    }
    if (result.queued) {
      setMsg(
        `Time ${type.toLowerCase()} saved on this device (no signal) — it will sync automatically with the exact tap time.`
      );
    } else {
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {!clockedIn && needsProject && (
        <div>
          <Label htmlFor="clockProject">Site / project</Label>
          <Select id="clockProject" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Office / no specific site</option>
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
          {busy ? "Recording…" : "⏱ TIME OUT"}
        </Button>
      ) : (
        <Button
          variant="success"
          disabled={busy}
          onClick={() => tap("IN")}
          className="h-24 w-full text-xl font-bold"
        >
          {busy ? "Recording…" : "⏱ TIME IN"}
        </Button>
      )}

      {msg && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">{msg}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-center text-xs text-ink-400">
        GPS, device, and exact time are recorded with each tap. Works offline.
      </p>
    </div>
  );
}
