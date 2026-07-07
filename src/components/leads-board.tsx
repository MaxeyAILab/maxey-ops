"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { daysSince, fmtDate } from "@/lib/format";

export interface BoardLead {
  id: string;
  contactName: string;
  phone: string | null;
  email: string | null;
  source: string;
  status: string;
  createdAt: string;
  estimateDueBy: string | null;
  quotationCount: number;
}

const COLUMNS: { status: string; label: string; accent: string }[] = [
  { status: "NEW", label: "New", accent: "border-t-blue-400" },
  { status: "UNDER_REVIEW", label: "Under Review", accent: "border-t-amber-400" },
  { status: "ESTIMATE_IN_PROGRESS", label: "Estimate in Progress", accent: "border-t-violet-400" },
  { status: "QUOTATION_SENT", label: "Quotation Sent", accent: "border-t-cyan-400" },
  { status: "WON", label: "Won", accent: "border-t-emerald-400" },
  { status: "LOST", label: "Lost", accent: "border-t-ink-300" },
];

/**
 * Trello-style Kanban board for the lead pipeline (owner's request,
 * 2026-07-07). Drag a card to a new column to change its status — reuses the
 * existing PATCH /api/leads/[id] endpoint, so approvals/audit stay identical
 * to the dropdown on the lead detail page. Native HTML5 drag-and-drop
 * (desktop only — this menu is Owner-only office work, not a field form).
 */
export function LeadsBoard({
  leads,
  onMove,
}: {
  leads: BoardLead[];
  onMove: (id: string, status: string) => void;
}) {
  const router = useRouter();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function drop(status: string) {
    setOverColumn(null);
    const id = draggingId;
    setDraggingId(null);
    if (!id) return;
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.status === status) return;

    onMove(id, status); // optimistic
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      onMove(id, lead.status); // revert
      setError((await res.json()).error ?? "Failed to move lead");
    } else {
      router.refresh();
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
          <button onClick={() => setError("")} className="ml-2 underline">
            dismiss
          </button>
        </p>
      )}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const items = leads.filter((l) => l.status === col.status);
          return (
            <div
              key={col.status}
              onDragOver={(e) => {
                e.preventDefault();
                setOverColumn(col.status);
              }}
              onDragLeave={() => setOverColumn((c) => (c === col.status ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                drop(col.status);
              }}
              className={`flex w-72 shrink-0 flex-col rounded-xl border-t-4 bg-ink-50 ${col.accent} ${
                overColumn === col.status ? "ring-2 ring-brand-400" : ""
              }`}
            >
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-sm font-semibold text-ink-700">{col.label}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-ink-500">
                  {items.length}
                </span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-3" style={{ maxHeight: "70vh" }}>
                {items.map((lead) => {
                  const overdue =
                    !!lead.estimateDueBy &&
                    new Date(lead.estimateDueBy) < new Date() &&
                    !["QUOTATION_SENT", "WON", "LOST"].includes(lead.status);
                  return (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={() => setDraggingId(lead.id)}
                      onDragEnd={() => setDraggingId(null)}
                      className={`cursor-grab rounded-lg border border-ink-100 bg-white p-3 shadow-sm transition-opacity hover:shadow-md active:cursor-grabbing ${
                        draggingId === lead.id ? "opacity-40" : ""
                      }`}
                    >
                      <Link
                        href={`/leads/${lead.id}`}
                        className="block font-medium text-ink-900 hover:text-brand-600"
                      >
                        {lead.contactName}
                      </Link>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge value={lead.source} />
                        {lead.quotationCount > 0 && (
                          <span className="text-[11px] text-ink-400">
                            {lead.quotationCount} quote{lead.quotationCount === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 text-xs text-ink-400">
                        waiting {daysSince(lead.createdAt)}d
                        {lead.estimateDueBy && (
                          <span className={overdue ? "ml-1 font-semibold text-red-600" : "ml-1"}>
                            · due {fmtDate(lead.estimateDueBy)}
                            {overdue && " ⚠"}
                          </span>
                        )}
                      </div>
                      {(lead.phone || lead.email) && (
                        <div className="mt-1 truncate text-[11px] text-ink-400">
                          {lead.phone ?? lead.email}
                        </div>
                      )}
                    </div>
                  );
                })}
                {items.length === 0 && (
                  <div className="rounded-lg border border-dashed border-ink-200 py-6 text-center text-xs text-ink-300">
                    Drop here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
