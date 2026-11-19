"use client";

import { useState } from "react";
import { Label, Select } from "@/components/ui";
import { Modal } from "@/components/modal";
import { AddEmployeeForm, GenerateRunForm } from "@/components/payroll-actions";

const OFFICE = "__office__";

/**
 * "+ New payroll run" / "+ Generate run": opens the existing GenerateRunForm in a pop-up. Pick a project, or
 * Office / Drivers (no project). The form, its server-computed periods and the API call are unchanged.
 */
export function NewRunDialog({
  projects,
  initialProjectId,
  small = false,
}: {
  projects: { id: string; name: string }[];
  initialProjectId?: string | null;
  small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(initialProjectId ?? (projects[0]?.id || OFFICE));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          small
            ? "rounded-full border border-ink-200 px-3 py-1 text-xs font-semibold text-ink-700 hover:bg-ink-100"
            : "fx-grad inline-flex min-h-[44px] items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-white hover:brightness-110"
        }
      >
        <span aria-hidden className={small ? "" : "text-lg leading-none"}>+</span> {small ? "Generate run" : "New payroll run"}
      </button>
      {open && (
        <Modal title="New payroll run" onClose={() => setOpen(false)}>
          <div className="space-y-4">
            {!initialProjectId && (
              <div>
                <Label>Payroll for</Label>
                <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value={OFFICE}>Office / Drivers / Engineers / Architects (no project)</option>
                </Select>
              </div>
            )}
            {initialProjectId && (
              <p className="text-sm font-semibold text-ink-700">
                {initialProjectId === OFFICE ? "Office / Drivers / Engineers / Architects (no project)" : projects.find((p) => p.id === initialProjectId)?.name}
              </p>
            )}
            <GenerateRunForm key={choice} projectId={choice === OFFICE ? undefined : choice} />
          </div>
        </Modal>
      )}
    </>
  );
}

/** "+ Add employee" to a project roster: the existing AddEmployeeForm in a pop-up. */
export function AddEmployeeDialog({ projectId, projectName, employees }: { projectId: string; projectName: string; employees: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-full border border-ink-200 px-3 py-1 text-xs font-semibold text-ink-700 hover:bg-ink-100">
        + Add employee
      </button>
      {open && (
        <Modal title={`Add employee · ${projectName}`} onClose={() => setOpen(false)} wide>
          <AddEmployeeForm projectId={projectId} employees={employees} />
        </Modal>
      )}
    </>
  );
}
