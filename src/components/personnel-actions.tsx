"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Input, Label, Select } from "@/components/ui";
import { ASSIGNABLE_MENUS, allowedMenus } from "@/lib/access";
import type { Role } from "@prisma/client";

const ASSIGNABLE_ROLES: { value: Role; label: string }[] = [
  { value: "OFFICE", label: "Office Staff" },
  { value: "FOREMAN", label: "Foreman" },
  { value: "PM", label: "Project Manager" },
  { value: "PURCHASING", label: "Purchasing" },
  { value: "ACCOUNTING", label: "Accounting" },
  { value: "DRIVER", label: "Driver" },
];

/** Role picker + tab checklist — what a sign-in account can see and do.
 * Checking a role pre-checks its normal tabs; the checklist is then the
 * authoritative list actually granted (can add or remove from the default). */
function SignInAccessFields({
  role,
  onRoleChange,
  checkedMenus,
  onCheckedMenusChange,
}: {
  role: Role;
  onRoleChange: (r: Role) => void;
  checkedMenus: Set<string>;
  onCheckedMenusChange: (m: Set<string>) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-ink-100 bg-ink-50/50 p-3">
      <div>
        <Label htmlFor="pRole">Role (only matters if they will log in)</Label>
        <Select
          id="pRole"
          value={role}
          onChange={(e) => onRoleChange(e.target.value as Role)}
        >
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Tabs they can access</Label>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
          {ASSIGNABLE_MENUS.map((m) => (
            <label key={m.href} className="flex items-center gap-1.5 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={checkedMenus.has(m.href)}
                onChange={(e) => {
                  const next = new Set(checkedMenus);
                  if (e.target.checked) next.add(m.href);
                  else next.delete(m.href);
                  onCheckedMenusChange(next);
                }}
              />
              {m.label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-ink-400">
          Pre-checked from the role above — check or uncheck any tab to customize exactly what
          this account can see.
        </p>
      </div>
    </div>
  );
}

const POSITIONS = [
  "Foreman",
  "Mason",
  "Carpenter",
  "Painter",
  "Welder",
  "Steelman",
  "Electrician",
  "Plumber",
  "Driver",
  "Laborer",
  "Office Admin",
  "Warehouseman",
  "Safety Officer",
];

interface ProjectOption {
  id: string;
  name: string;
}

/** "Add personnel" — new manpower or staff (Attendance tab). */
export function AddPersonnelForm({
  projects = [],
  onDone,
}: {
  projects?: ProjectOption[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState("");
  const [department, setDepartment] = useState("SITE");
  const [role, setRole] = useState<Role>("OFFICE");
  const [checkedMenus, setCheckedMenus] = useState<Set<string>>(new Set(allowedMenus("OFFICE", null)));

  useEffect(() => {
    setCheckedMenus(new Set(allowedMenus(role, null)));
  }, [role]);

  function onDepartmentChange(next: string) {
    setDepartment(next);
    if (next === "DRIVER") setRole("DRIVER");
    else if (role === "DRIVER") setRole("OFFICE");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/personnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        position: fd.get("position"),
        department,
        dailyRate: fd.get("dailyRate") || undefined,
        phone: fd.get("phone"),
        email: fd.get("email"),
        password: fd.get("password"),
        projectId: department === "SITE" ? fd.get("projectId") : undefined,
        projectStartDate:
          department === "SITE" && fd.get("projectId") ? fd.get("projectStartDate") : undefined,
        role,
        useCustomMenus: true,
        customMenus: Array.from(checkedMenus),
      }),
    });
    setBusy(false);
    if (res.ok) {
      const j = await res.json();
      setCreated(j.project ? `${j.name} added and assigned to ${j.project}.` : `${j.name} added.`);
      (e.target as HTMLFormElement).reset?.();
      setRole("OFFICE");
      router.refresh();
      onDone?.();
    } else {
      setError((await res.json()).error ?? "Failed to add personnel");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="pName">Full name *</Label>
          <Input id="pName" name="name" required />
        </div>
        <div>
          <Label htmlFor="pPosition">Position *</Label>
          <Input id="pPosition" name="position" list="position-options" required placeholder="e.g., Mason" />
          <datalist id="position-options">
            {POSITIONS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
      </div>

      {/* Box 1: where they are assigned — site, office, or driver */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="pDept">Assigned as *</Label>
          <Select
            id="pDept"
            value={department}
            onChange={(e) => onDepartmentChange(e.target.value)}
            required
          >
            <option value="SITE">On Site (worker)</option>
            <option value="OFFICE">On Office</option>
            <option value="DRIVER">As Driver</option>
            <option value="ARCHITECT">Architect</option>
            <option value="ENGINEER">Engineer</option>
          </Select>
        </div>
        {/* Box 2: for site workers — which project they are assigned to.
            Not required: a foreman/worker can be hired ahead of a project
            being set up, so "TBA" leaves them off any roster until the
            Owner assigns one later (e.g. by editing them once a project
            exists). */}
        {department === "SITE" && (
          <div>
            <Label htmlFor="pProject">Assigned project</Label>
            <Select id="pProject" name="projectId">
              <option value="">TBA — assign later</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            {projects.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                No active projects yet — leave as TBA and assign one later.
              </p>
            )}
          </div>
        )}
      </div>
      {department === "SITE" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="pStart">Started on project</Label>
            <Input
              id="pStart"
              name="projectStartDate"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="pRate">Daily rate (PHP) *</Label>
          <Input id="pRate" name="dailyRate" type="number" min="1" step="0.01" required />
        </div>
        <div>
          <Label htmlFor="pPhone">Phone</Label>
          <Input id="pPhone" name="phone" type="tel" />
        </div>
        <div>
          <Label htmlFor="pEmail">Email (optional — only if they will log in)</Label>
          <Input id="pEmail" name="email" type="email" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="pPass">Password (optional)</Label>
          <Input id="pPass" name="password" type="text" minLength={6} placeholder="min 6 characters" />
        </div>
      </div>
      <SignInAccessFields
        role={role}
        onRoleChange={setRole}
        checkedMenus={checkedMenus}
        onCheckedMenusChange={setCheckedMenus}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {created && <p className="text-sm text-emerald-600">{created}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? "Adding…" : "+ Add personnel"}
      </Button>
      <p className="text-xs text-ink-400">
        {department === "SITE"
          ? "Site workers land directly on the selected project's payroll roster at their daily rate ÷ 8 per hour (adjustable in the Payroll tab)."
          : "Office staff and drivers are paid from the department payroll — no project needed."}
      </p>
    </form>
  );
}

export function AddPersonnelSection({ projects = [] }: { projects?: ProjectOption[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ Add personnel</Button>;
  }
  return (
    <Card className="w-full">
      <CardHeader
        title="Add personnel"
        subtitle="New manpower or office staff — becomes available for attendance and payroll"
        action={
          <button onClick={() => setOpen(false)} className="text-sm text-ink-400 hover:text-ink-600">
            ✕ Close
          </button>
        }
      />
      <CardBody>
        <AddPersonnelForm projects={projects} />
      </CardBody>
    </Card>
  );
}

/** "Edit personnel" — update name, position, rate, contact info, and sign-in access. */
export function EditPersonnelButton({
  userId,
  name,
  position,
  department: initialDepartment,
  dailyRate,
  phone,
  email,
  role: initialRole,
  useCustomMenus: initialUseCustomMenus,
  customMenus: initialCustomMenus,
}: {
  userId: string;
  name: string;
  position: string;
  department?: string | null;
  dailyRate?: number | null;
  phone?: string | null;
  email?: string | null;
  role?: Role;
  useCustomMenus?: boolean;
  customMenus?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [role, setRole] = useState<Role>(initialRole ?? "OFFICE");
  const [department, setDepartment] = useState(initialDepartment ?? "OFFICE");
  const [checkedMenus, setCheckedMenus] = useState<Set<string>>(
    new Set(
      initialUseCustomMenus && initialCustomMenus
        ? initialCustomMenus
        : allowedMenus(initialRole ?? "OFFICE", null)
    )
  );

  function onRoleChange(next: Role) {
    setRole(next);
    setCheckedMenus(new Set(allowedMenus(next, null)));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch(`/api/personnel/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        position: fd.get("position"),
        department,
        dailyRate: fd.get("dailyRate") || undefined,
        phone: fd.get("phone"),
        email: fd.get("email"),
        role,
        useCustomMenus: true,
        customMenus: Array.from(checkedMenus),
      }),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to update");
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 text-xs text-brand-600 hover:bg-brand-50"
      >
        Edit
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
            <Card>
              <CardHeader
                title={`Edit ${name}`}
                subtitle="Name, position, department, rate, and contact info"
                action={
                  <button
                    onClick={() => setOpen(false)}
                    className="text-sm text-ink-400 hover:text-ink-600"
                  >
                    ✕ Close
                  </button>
                }
              />
              <CardBody>
                <form onSubmit={onSubmit} className="space-y-3">
                  <div>
                    <Label htmlFor={`eName-${userId}`}>Full name</Label>
                    <Input id={`eName-${userId}`} name="name" defaultValue={name} required />
                  </div>
                  <div>
                    <Label htmlFor={`ePosition-${userId}`}>Position</Label>
                    <Input
                      id={`ePosition-${userId}`}
                      name="position"
                      list="position-options"
                      defaultValue={position}
                      required
                    />
                    <datalist id="position-options">
                      {POSITIONS.map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <Label htmlFor={`eDept-${userId}`}>Department</Label>
                    <Select
                      id={`eDept-${userId}`}
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                    >
                      <option value="SITE">Site Workers</option>
                      <option value="OFFICE">Office</option>
                      <option value="DRIVER">Drivers</option>
                      <option value="ARCHITECT">Architect</option>
                      <option value="ENGINEER">Engineer</option>
                    </Select>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor={`eRate-${userId}`}>Daily rate (PHP)</Label>
                      <Input
                        id={`eRate-${userId}`}
                        name="dailyRate"
                        type="number"
                        min="1"
                        step="0.01"
                        defaultValue={dailyRate ?? ""}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`ePhone-${userId}`}>Phone</Label>
                      <Input id={`ePhone-${userId}`} name="phone" type="tel" defaultValue={phone ?? ""} />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor={`eEmail-${userId}`}>Email</Label>
                    <Input id={`eEmail-${userId}`} name="email" type="email" defaultValue={email ?? ""} />
                  </div>
                  <SignInAccessFields
                    role={role}
                    onRoleChange={onRoleChange}
                    checkedMenus={checkedMenus}
                    onCheckedMenusChange={setCheckedMenus}
                  />
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={busy}>
                      {busy ? "Saving…" : "Save changes"}
                    </Button>
                  </div>
                </form>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

/** "Remove personnel" — resignation. History is preserved. */
export function RemovePersonnelButton({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (
      !confirm(
        `Remove ${name}? Their attendance and payroll history is kept, but they will no longer appear in rosters or be able to log in.`
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/personnel/${userId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) alert((await res.json()).error ?? "Failed to remove");
    router.refresh();
  }

  return (
    <button
      onClick={remove}
      disabled={busy}
      className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-50"
    >
      {busy ? "…" : "Remove"}
    </button>
  );
}
