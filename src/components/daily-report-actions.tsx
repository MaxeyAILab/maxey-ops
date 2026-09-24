"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Textarea } from "@/components/ui";
import { PhotoInput } from "@/components/photo-input";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { dailyReportExpiresAt } from "@/lib/daily-reports";

interface DeliveryItem {
  material: string;
  qty: string;
  supplier: string;
  condition: string;
}
interface ManpowerItem {
  role: string;
  count: string; // kept as string in form state; coerced to number on submit
}

const emptyDelivery = (): DeliveryItem => ({ material: "", qty: "", supplier: "", condition: "Good" });
const emptyManpower = (): ManpowerItem => ({ role: "", count: "1" });

function DeliveryRows({
  rows,
  setRows,
}: {
  rows: DeliveryItem[];
  setRows: React.Dispatch<React.SetStateAction<DeliveryItem[]>>;
}) {
  function update(i: number, patch: Partial<DeliveryItem>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-12 gap-2">
          <Input
            placeholder="Material"
            value={r.material}
            onChange={(e) => update(i, { material: e.target.value })}
            className="col-span-12 sm:col-span-4"
          />
          <Input
            placeholder="Qty (e.g. 100 bags)"
            value={r.qty}
            onChange={(e) => update(i, { qty: e.target.value })}
            className="col-span-6 sm:col-span-2"
          />
          <Input
            placeholder="Supplier"
            value={r.supplier}
            onChange={(e) => update(i, { supplier: e.target.value })}
            className="col-span-6 sm:col-span-3"
          />
          <Input
            placeholder="Condition"
            value={r.condition}
            onChange={(e) => update(i, { condition: e.target.value })}
            className="col-span-9 sm:col-span-2"
          />
          <button
            type="button"
            onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
            className="col-span-3 sm:col-span-1 min-h-[44px] rounded-lg text-red-500 hover:bg-red-50"
            aria-label="Remove delivery row"
          >
            ✕
          </button>
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={() => setRows((p) => [...p, emptyDelivery()])}>
        + Add delivery
      </Button>
    </div>
  );
}

function ManpowerRows({
  rows,
  setRows,
}: {
  rows: ManpowerItem[];
  setRows: React.Dispatch<React.SetStateAction<ManpowerItem[]>>;
}) {
  function update(i: number, patch: Partial<ManpowerItem>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  const total = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-12 gap-2">
          <Input
            placeholder="Personnel (e.g. Carpenters)"
            value={r.role}
            onChange={(e) => update(i, { role: e.target.value })}
            className="col-span-8 sm:col-span-9"
          />
          <Input
            type="number"
            min="0"
            placeholder="No."
            value={r.count}
            onChange={(e) => update(i, { count: e.target.value })}
            className="col-span-3 sm:col-span-2"
          />
          <button
            type="button"
            onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
            className="col-span-1 min-h-[44px] rounded-lg text-red-500 hover:bg-red-50"
            aria-label="Remove manpower row"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button type="button" variant="secondary" onClick={() => setRows((p) => [...p, emptyManpower()])}>
          + Add personnel
        </Button>
        <span className="text-xs text-ink-500">Total: {total}</span>
      </div>
    </div>
  );
}

/** OWNER/PM/FOREMAN posts an end-of-day Daily Construction Report. */
export function DailyReportForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [deliveries, setDeliveries] = useState<DeliveryItem[]>([]);
  const [manpower, setManpower] = useState<ManpowerItem[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [visibleToClient, setVisibleToClient] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/daily-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        reportDate: fd.get("reportDate"),
        weather: fd.get("weather"),
        workingHours: fd.get("workingHours"),
        workProgress: fd.get("workProgress"),
        deliveries: deliveries.filter((d) => d.material.trim()),
        manpower: manpower
          .filter((m) => m.role.trim())
          .map((m) => ({ role: m.role, count: m.count || "0" })),
        equipment: fd.get("equipment"),
        siteEvents: fd.get("siteEvents"),
        issues: fd.get("issues"),
        safety: fd.get("safety"),
        weatherNotes: fd.get("weatherNotes"),
        plannedNextDay: fd.get("plannedNextDay"),
        overallProgress: fd.get("overallProgress"),
        photos,
        visibleToClient,
      }),
    });
    setBusy(false);
    if (res.ok) {
      (e.target as HTMLFormElement).reset?.();
      setDeliveries([]);
      setManpower([]);
      setPhotos([]);
      setVisibleToClient(true);
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to post daily report");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="reportDate">Date *</Label>
          <Input
            id="reportDate"
            name="reportDate"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </div>
        <div>
          <Label htmlFor="weather">Weather</Label>
          <Input id="weather" name="weather" placeholder="e.g., Partly cloudy; no rain" />
        </div>
        <div>
          <Label htmlFor="workingHours">Working hours</Label>
          <Input id="workingHours" name="workingHours" placeholder="e.g., 7:00 AM – 5:00 PM" />
        </div>
      </div>

      <div>
        <Label htmlFor="workProgress">1. Work progress (by trade) *</Label>
        <Textarea
          id="workProgress"
          name="workProgress"
          rows={5}
          required
          placeholder={"Civil/Structural Works\n- ...\nMasonry Works\n- ...\nElectrical Works\n- ...\nPlumbing Works\n- ..."}
        />
      </div>

      <div>
        <Label>2. Deliveries received</Label>
        <DeliveryRows rows={deliveries} setRows={setDeliveries} />
      </div>

      <div>
        <Label>3. Manpower</Label>
        <ManpowerRows rows={manpower} setRows={setManpower} />
      </div>

      <div>
        <Label htmlFor="equipment">4. Equipment on site</Label>
        <Textarea id="equipment" name="equipment" rows={2} placeholder={"1 unit concrete mixer\n1 unit plate compactor\n..."} />
      </div>

      <div>
        <Label htmlFor="siteEvents">5. Site events / activities</Label>
        <Textarea id="siteEvents" name="siteEvents" rows={2} placeholder="Toolbox meeting, inspections, coordination meetings…" />
      </div>

      <div>
        <Label htmlFor="issues">6. Issues / observations</Label>
        <Textarea id="issues" name="issues" rows={2} />
      </div>

      <div>
        <Label htmlFor="safety">7. Safety</Label>
        <Textarea id="safety" name="safety" rows={2} placeholder="PPE compliance, barricades, incidents (or none reported)…" />
      </div>

      <div>
        <Label htmlFor="weatherNotes">8. Weather / working conditions</Label>
        <Textarea id="weatherNotes" name="weatherNotes" rows={2} />
      </div>

      <div>
        <Label htmlFor="plannedNextDay">9. Planned activities for next working day</Label>
        <Textarea id="plannedNextDay" name="plannedNextDay" rows={2} />
      </div>

      <div>
        <Label htmlFor="overallProgress">10. Overall daily progress</Label>
        <Textarea id="overallProgress" name="overallProgress" rows={2} />
      </div>

      <PhotoInput label="Site photos" onChange={setPhotos} />

      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={visibleToClient}
          onChange={(e) => setVisibleToClient(e.target.checked)}
          className="h-4 w-4 rounded border-ink-300"
        />
        Visible to client in their portal
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Posting…" : "Post daily report"}
      </Button>
    </form>
  );
}

export interface DailyReportEditable {
  id: string;
  reportDate: string; // yyyy-mm-dd
  weather: string | null;
  workingHours: string | null;
  workProgress: string;
  deliveries: DeliveryItem[];
  manpower: { role: string; count: number }[];
  equipment: string | null;
  siteEvents: string | null;
  issues: string | null;
  safety: string | null;
  weatherNotes: string | null;
  plannedNextDay: string | null;
  overallProgress: string | null;
  visibleToClient: boolean;
}

function EditDailyReportForm({
  report,
  onCancel,
  onSaved,
}: {
  report: DailyReportEditable;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [deliveries, setDeliveries] = useState<DeliveryItem[]>(
    report.deliveries.length ? report.deliveries : []
  );
  const [manpower, setManpower] = useState<ManpowerItem[]>(
    report.manpower.map((m) => ({ role: m.role, count: String(m.count) }))
  );
  const [visibleToClient, setVisibleToClient] = useState(report.visibleToClient);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch(`/api/daily-reports/${report.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportDate: fd.get("reportDate"),
        weather: fd.get("weather"),
        workingHours: fd.get("workingHours"),
        workProgress: fd.get("workProgress"),
        deliveries: deliveries.filter((d) => d.material.trim()),
        manpower: manpower
          .filter((m) => m.role.trim())
          .map((m) => ({ role: m.role, count: m.count || "0" })),
        equipment: fd.get("equipment"),
        siteEvents: fd.get("siteEvents"),
        issues: fd.get("issues"),
        safety: fd.get("safety"),
        weatherNotes: fd.get("weatherNotes"),
        plannedNextDay: fd.get("plannedNextDay"),
        overallProgress: fd.get("overallProgress"),
        visibleToClient,
      }),
    });
    setBusy(false);
    if (res.ok) {
      onSaved();
    } else {
      setError((await res.json()).error ?? "Failed to save changes");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-brand-100 bg-brand-50/40 p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor={`edDate-${report.id}`}>Date *</Label>
          <Input id={`edDate-${report.id}`} name="reportDate" type="date" required defaultValue={report.reportDate} />
        </div>
        <div>
          <Label htmlFor={`edWeather-${report.id}`}>Weather</Label>
          <Input id={`edWeather-${report.id}`} name="weather" defaultValue={report.weather ?? ""} />
        </div>
        <div>
          <Label htmlFor={`edHours-${report.id}`}>Working hours</Label>
          <Input id={`edHours-${report.id}`} name="workingHours" defaultValue={report.workingHours ?? ""} />
        </div>
      </div>
      <div>
        <Label htmlFor={`edProgress-${report.id}`}>1. Work progress (by trade) *</Label>
        <Textarea id={`edProgress-${report.id}`} name="workProgress" rows={5} required defaultValue={report.workProgress} />
      </div>
      <div>
        <Label>2. Deliveries received</Label>
        <DeliveryRows rows={deliveries} setRows={setDeliveries} />
      </div>
      <div>
        <Label>3. Manpower</Label>
        <ManpowerRows rows={manpower} setRows={setManpower} />
      </div>
      <div>
        <Label htmlFor={`edEquip-${report.id}`}>4. Equipment on site</Label>
        <Textarea id={`edEquip-${report.id}`} name="equipment" rows={2} defaultValue={report.equipment ?? ""} />
      </div>
      <div>
        <Label htmlFor={`edEvents-${report.id}`}>5. Site events / activities</Label>
        <Textarea id={`edEvents-${report.id}`} name="siteEvents" rows={2} defaultValue={report.siteEvents ?? ""} />
      </div>
      <div>
        <Label htmlFor={`edIssues-${report.id}`}>6. Issues / observations</Label>
        <Textarea id={`edIssues-${report.id}`} name="issues" rows={2} defaultValue={report.issues ?? ""} />
      </div>
      <div>
        <Label htmlFor={`edSafety-${report.id}`}>7. Safety</Label>
        <Textarea id={`edSafety-${report.id}`} name="safety" rows={2} defaultValue={report.safety ?? ""} />
      </div>
      <div>
        <Label htmlFor={`edWNotes-${report.id}`}>8. Weather / working conditions</Label>
        <Textarea id={`edWNotes-${report.id}`} name="weatherNotes" rows={2} defaultValue={report.weatherNotes ?? ""} />
      </div>
      <div>
        <Label htmlFor={`edNext-${report.id}`}>9. Planned activities for next working day</Label>
        <Textarea id={`edNext-${report.id}`} name="plannedNextDay" rows={2} defaultValue={report.plannedNextDay ?? ""} />
      </div>
      <div>
        <Label htmlFor={`edOverall-${report.id}`}>10. Overall daily progress</Label>
        <Textarea id={`edOverall-${report.id}`} name="overallProgress" rows={2} defaultValue={report.overallProgress ?? ""} />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={visibleToClient}
          onChange={(e) => setVisibleToClient(e.target.checked)}
          className="h-4 w-4 rounded border-ink-300"
        />
        Visible to client in their portal
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} className="text-xs">
          Cancel
        </Button>
        <Button type="submit" disabled={busy} className="text-xs">
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

export interface DailyReportDisplay extends DailyReportEditable {
  reportNo: string;
  submittedById: string;
  submittedByName: string;
  createdAt: string; // ISO
  editedAt: string | null;
  photos: string[];
}

/** One Daily Construction Report — collapsed summary by default, full
 * content (and, for authorized staff, edit/delete) on expand. */
export function DailyReportCard({
  report,
  canEdit,
  canDelete,
}: {
  report: DailyReportDisplay;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);

  async function onDelete() {
    if (!confirm(`Delete ${report.reportNo}? This cannot be undone.`)) return;
    setBusyDelete(true);
    const res = await fetch(`/api/daily-reports/${report.id}`, { method: "DELETE" });
    setBusyDelete(false);
    if (res.ok) router.refresh();
    else alert((await res.json()).error ?? "Failed to delete");
  }

  return (
    <details className="group rounded-lg border border-ink-100">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-3 hover:bg-ink-50">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <span className="mt-0.5 shrink-0 text-ink-400 transition-transform group-open:rotate-90">▶</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-400">
              <span className="font-mono font-medium text-ink-600">{report.reportNo}</span>
              <span>{fmtDate(report.reportDate)}</span>
              {report.weather && <span>· {report.weather}</span>}
              {!report.visibleToClient && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                  Internal only
                </span>
              )}
            </div>
            <p className="truncate text-sm font-medium text-ink-800">{report.workProgress}</p>
            <p className="text-[10px] text-ink-400">Prepared by {report.submittedByName}</p>
          </div>
        </div>
      </summary>

      <div className="space-y-4 border-t border-ink-100 p-3">
        {editing ? (
          <EditDailyReportForm
            report={report}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              router.refresh();
            }}
          />
        ) : (
          <>
            <Section title="1. Work progress">
              <p className="whitespace-pre-wrap text-sm text-ink-800">{report.workProgress}</p>
            </Section>

            {report.deliveries.length > 0 && (
              <Section title="2. Deliveries received">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-ink-500">
                        <th className="py-1 pr-2 font-semibold">Material</th>
                        <th className="py-1 pr-2 font-semibold">Qty</th>
                        <th className="py-1 pr-2 font-semibold">Supplier</th>
                        <th className="py-1 font-semibold">Condition</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.deliveries.map((d, i) => (
                        <tr key={i} className="border-t border-ink-50">
                          <td className="py-1 pr-2 text-ink-800">{d.material}</td>
                          <td className="py-1 pr-2 text-ink-600">{d.qty}</td>
                          <td className="py-1 pr-2 text-ink-600">{d.supplier}</td>
                          <td className="py-1 text-ink-600">{d.condition}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {report.manpower.length > 0 && (
              <Section title="3. Manpower">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-700">
                  {report.manpower.map((m, i) => (
                    <span key={i}>
                      {m.role}: <span className="font-medium">{m.count}</span>
                    </span>
                  ))}
                  <span className="font-semibold text-ink-900">
                    Total: {report.manpower.reduce((s, m) => s + m.count, 0)}
                  </span>
                </div>
              </Section>
            )}

            {report.equipment && (
              <Section title="4. Equipment on site">
                <p className="whitespace-pre-wrap text-xs text-ink-700">{report.equipment}</p>
              </Section>
            )}
            {report.siteEvents && (
              <Section title="5. Site events / activities">
                <p className="whitespace-pre-wrap text-xs text-ink-700">{report.siteEvents}</p>
              </Section>
            )}
            {report.issues && (
              <Section title="6. Issues / observations">
                <p className="whitespace-pre-wrap text-xs text-ink-700">{report.issues}</p>
              </Section>
            )}
            {report.safety && (
              <Section title="7. Safety">
                <p className="whitespace-pre-wrap text-xs text-ink-700">{report.safety}</p>
              </Section>
            )}
            {report.weatherNotes && (
              <Section title="8. Weather / working conditions">
                <p className="whitespace-pre-wrap text-xs text-ink-700">{report.weatherNotes}</p>
              </Section>
            )}
            {report.plannedNextDay && (
              <Section title="9. Planned activities for next working day">
                <p className="whitespace-pre-wrap text-xs text-ink-700">{report.plannedNextDay}</p>
              </Section>
            )}
            {report.overallProgress && (
              <Section title="10. Overall daily progress">
                <p className="whitespace-pre-wrap text-xs text-ink-700">{report.overallProgress}</p>
              </Section>
            )}

            {report.photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {report.photos.map((src) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={src} src={src} alt="" className="h-20 w-20 rounded-lg object-cover" />
                ))}
              </div>
            )}

            <p className="text-[10px] text-ink-400">
              Prepared by {report.submittedByName} · {fmtDateTime(report.createdAt)}
              {report.editedAt && " · edited"}
              {" · "}auto-deletes {fmtDate(dailyReportExpiresAt(report.createdAt))}
            </p>

            <div className="flex items-center gap-3">
              <a
                href={`/api/daily-reports/${report.id}/pdf`}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                ⬇ Download PDF
              </a>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-xs font-medium text-brand-600 hover:underline"
                >
                  Edit
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={busyDelete}
                  className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                >
                  {busyDelete ? "Deleting…" : "Delete"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</p>
      {children}
    </div>
  );
}
