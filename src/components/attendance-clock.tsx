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
      body: { type, projectId: type === "IN" ? projectId : undefined, gps },
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
        GPS and exact time are recorded with each tap. Works offline.
      </p>
    </div>
  );
}
