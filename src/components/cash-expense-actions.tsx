"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { compressImage } from "@/lib/photos";
import { NO_PROJECT, PETTY_CASH_CATEGORIES, PETTY_CASH_STATUS_LABEL } from "@/lib/cash-expense";

const fieldCls =
  "block min-h-[44px] w-full rounded-md border border-ink-200 bg-ink-50 px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-[#8a1a28] focus:outline-none focus:ring-1 focus:ring-[#8a1a28]";
const labelCls = "mb-1.5 block text-sm font-medium text-ink-700";
const primaryBtn =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-[#8a1a28] px-4 text-sm font-semibold text-white hover:bg-[#741522] disabled:opacity-50";
const smallBtn = "rounded-md border border-ink-200 bg-ink-50 px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-50";

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function send(url: string, method: "POST" | "PATCH", body: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  try {
    return (await res.json()).error ?? "Something went wrong";
  } catch {
    return "Something went wrong";
  }
}

async function remove(url: string): Promise<string | null> {
  const res = await fetch(url, { method: "DELETE" });
  if (res.ok) return null;
  try {
    return (await res.json()).error ?? "Something went wrong";
  } catch {
    return "Something went wrong";
  }
}

/** Refreshes the page's figures every 20 seconds while it's open in front, so a release or approval elsewhere shows up. */
export function LiveUpdates() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 20_000);
    return () => clearInterval(t);
  }, [router]);
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-600" title="Figures refresh automatically every 20 seconds">
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      Live updates
    </span>
  );
}

/** Dashed "Attach receipt" box: camera on phones, compressed before upload. */
function ReceiptInput({ value, onChange, max = 4, label = "Attach receipt" }: { value: string[]; onChange: (v: string[]) => void; max?: number; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, max - value.length);
    const compressed = await Promise.all(files.map((f) => compressImage(f)));
    onChange([...value, ...compressed]);
    if (ref.current) ref.current.value = "";
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={value.length >= max}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-dashed border-ink-300 text-sm text-ink-600 hover:bg-ink-100 disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M21 11.5l-8.6 8.6a5 5 0 01-7.1-7.1l8.6-8.6a3.4 3.4 0 014.8 4.8l-8.6 8.6a1.7 1.7 0 01-2.4-2.4l8-8" />
        </svg>
        {label}
      </button>
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={onFiles} />
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {value.map((src, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Receipt ${i + 1}`} className="h-16 w-16 rounded-md border border-ink-200 object-cover" />
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink-800 text-[11px] text-white"
                aria-label={`Remove receipt ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

/** The Quick Record form: file a petty cash request for a project (or for no project). */
export function QuickRecordForm({
  projects,
  people,
  me,
  canPickRequester,
}: {
  projects: { group: string; options: Option[] }[];
  people: Option[];
  me: Option;
  canPickRequester: boolean;
}) {
  const router = useRouter();
  const [receipts, setReceipts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    setMsg(null);
    const project = String(fd.get("projectId") ?? "");
    const err = await send("/api/petty-cash", "POST", {
      projectId: project === NO_PROJECT ? null : project,
      category: fd.get("category"),
      amount: String(fd.get("amount") ?? "").replace(/,/g, ""),
      purpose: fd.get("purpose"),
      requestedById: fd.get("requestedById") || undefined,
      receipts,
    });
    setBusy(false);
    if (err) {
      setMsg({ ok: false, text: err });
      return;
    }
    form.reset();
    setReceipts([]);
    setMsg({ ok: true, text: "Request filed — it's waiting for the Owner's approval." });
    router.refresh();
  }

  return (
    <form id="quick-record" onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="pc-project" className={labelCls}>
          Project / Site
        </label>
        <select id="pc-project" name="projectId" required defaultValue={projects[0]?.options[0]?.value ?? ""} className={fieldCls}>
          {projects.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="pc-category" className={labelCls}>
          Expense Category
        </label>
        <select id="pc-category" name="category" required defaultValue="SITE_SUPPLIES" className={fieldCls}>
          {PETTY_CASH_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="pc-amount" className={labelCls}>
          Amount
        </label>
        <div className="flex">
          <span className="flex items-center rounded-l-md border border-r-0 border-ink-200 bg-ink-100 px-3 text-sm font-semibold text-ink-700">₱</span>
          <input id="pc-amount" name="amount" inputMode="decimal" required placeholder="0.00" pattern="[0-9,]*\.?[0-9]{0,2}" className={`${fieldCls} rounded-l-none`} />
        </div>
      </div>
      <div>
        <label htmlFor="pc-requester" className={labelCls}>
          Requested By
        </label>
        {canPickRequester ? (
          <select id="pc-requester" name="requestedById" defaultValue={me.value} className={fieldCls}>
            {people.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        ) : (
          <select id="pc-requester" disabled className={fieldCls}>
            <option>{me.label}</option>
          </select>
        )}
      </div>
      <div>
        <label htmlFor="pc-purpose" className={labelCls}>
          Purpose / Notes
        </label>
        <textarea id="pc-purpose" name="purpose" required minLength={3} rows={3} placeholder="What the cash is for" className={`${fieldCls} py-2.5`} />
      </div>
      <div>
        <span className={labelCls}>
          Attach receipt <span className="font-normal text-ink-400">(optional)</span>
        </span>
        <ReceiptInput value={receipts} onChange={setReceipts} />
      </div>
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Submitting…" : "Submit Request"}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>{msg.text}</p>}
      <p className="text-xs text-ink-500">Requests go to the approvers; once released, the requester confirms receiving the cash here.</p>
    </form>
  );
}

/** Status / date range / search filters over the activity table, kept in the URL. */
export function ActivityFilters({ status, from, to, q }: { status: string; from: string; to: string; q: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [text, setText] = useState(q);

  function set(next: Record<string, string>) {
    const sp = new URLSearchParams(params?.toString() ?? "");
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.5fr)_minmax(0,1.1fr)]">
      <select aria-label="Status" value={status} onChange={(e) => set({ status: e.target.value })} className={fieldCls}>
        <option value="">All statuses</option>
        {Object.entries(PETTY_CASH_STATUS_LABEL).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <div className="flex min-h-[44px] items-center gap-2 rounded-md border border-ink-200 bg-ink-50 px-3 text-sm">
        <span aria-hidden>📅</span>
        <input aria-label="From" type="date" value={from} onChange={(e) => set({ from: e.target.value })} className="min-w-0 flex-1 bg-transparent text-ink-900 focus:outline-none" />
        <span className="text-ink-400">–</span>
        <input aria-label="To" type="date" value={to} onChange={(e) => set({ to: e.target.value })} className="min-w-0 flex-1 bg-transparent text-ink-900 focus:outline-none" />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: text.trim() });
        }}
        className="flex min-h-[44px] items-center gap-2 rounded-md border border-ink-200 bg-ink-50 px-3"
      >
        <span aria-hidden className="text-ink-400">⌕</span>
        <input
          aria-label="Search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text.trim() !== q && set({ q: text.trim() })}
          placeholder="Search requests, purpose, or project..."
          className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
        />
      </form>
    </div>
  );
}

/** Approve / reject / release / cancel / delete buttons on one petty cash request. */
export function RequestActions({
  id,
  status,
  canApprove,
  canRelease,
  canDelete,
  custodian,
  own,
  isRequester,
  received,
}: {
  id: string;
  status: string;
  canApprove: boolean; // Owner or an assigned approver
  canRelease: boolean; // an assigned releaser (or the Owner)
  canDelete: boolean; // Owner only
  custodian: boolean;
  own: boolean; // filed it or is the requester
  isRequester: boolean; // the cash is (or will be) theirs — they confirm receipt and report what it was spent on
  received: boolean; // the requester already confirmed receiving the released cash
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(body: Record<string, unknown> | null, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError("");
    const err = body ? await send(`/api/petty-cash/${id}`, "PATCH", body) : await remove(`/api/petty-cash/${id}`);
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }
  function reject() {
    const reason = window.prompt("Reason for rejecting this request?");
    if (reason && reason.trim().length >= 3) act({ action: "reject", reason: reason.trim() });
  }

  const buttons: React.ReactNode[] = [];
  if (canApprove && status === "PENDING") {
    buttons.push(
      <button key="a" className={smallBtn} disabled={busy} onClick={() => act({ action: "approve" })}>
        Approve
      </button>,
      <button key="r" className={smallBtn} disabled={busy} onClick={reject}>
        Reject
      </button>
    );
  }
  if (canRelease && status === "APPROVED") {
    buttons.push(
      <button key="rel" className={smallBtn} disabled={busy} onClick={() => act({ action: "release" }, "Release this cash from the petty cash fund?")}>
        Release cash
      </button>
    );
    if (canApprove)
      buttons.push(
        <button key="r2" className={smallBtn} disabled={busy} onClick={reject}>
          Reject
        </button>
      );
  }
  if (status === "PENDING" && (own || custodian || canApprove)) {
    buttons.push(
      <button key="c" className={smallBtn} disabled={busy} onClick={() => act({ action: "cancel" }, "Cancel this request?")}>
        Cancel
      </button>
    );
  }
  // Approved by mistake: the Owner can call it off before the cash goes out (the requester can too).
  if (status === "APPROVED" && (isRequester || canApprove)) {
    buttons.push(
      <button
        key="c"
        className={smallBtn}
        disabled={busy}
        onClick={() => act({ action: "cancel" }, canApprove ? "Cancel this approved request? No cash will be released for it." : "Cancel this request?")}
      >
        {canApprove ? "Cancel approval" : "Cancel"}
      </button>
    );
  }
  if (isRequester && status === "RELEASED" && !received) {
    buttons.push(
      <button
        key="rcv"
        className={`${primaryBtn} min-h-[30px] px-3 text-xs`}
        disabled={busy}
        onClick={() => act({ action: "confirm_receipt" }, "Confirm that you have received this cash?")}
      >
        Confirm cash received
      </button>
    );
  }
  if (isRequester && status === "RELEASED" && received) {
    buttons.push(
      <a key="l" href={`/cash-expense/report#liquidate-${id}`} className={smallBtn}>
        Report expenses
      </a>
    );
  }
  if (canDelete && (status === "CANCELLED" || status === "REJECTED")) {
    buttons.push(
      <button
        key="del"
        className={`${smallBtn} text-red-700 dark:text-red-300`}
        disabled={busy}
        onClick={() => act(null, "Delete this request? It's removed from the list; the audit log keeps a copy.")}
      >
        Delete
      </button>
    );
  }
  if (canDelete && (status === "RELEASED" || status === "FOR_LIQUIDATION")) {
    buttons.push(
      <button
        key="del"
        className={`${smallBtn} text-red-700 dark:text-red-300`}
        disabled={busy}
        onClick={() => act(null, "Delete this released petty cash? Only do this if the cash was released by mistake and is back in the fund — its amount returns to the available balance.")}
      >
        Delete
      </button>
    );
  }
  if (buttons.length === 0) return null;
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">{buttons}</div>
      {error && <p className="mt-1 max-w-xs text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}

/** Owner/Accounting: put cash into the petty cash fund, or correct it with a negative amount. */
export function FundForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-[#8a1a28] hover:underline dark:text-rose-300">
        + Replenish fund
      </button>
    );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        const err = await send("/api/petty-cash/fund", "POST", { amount: String(fd.get("amount")).replace(/,/g, ""), note: fd.get("note") });
        setBusy(false);
        if (err) setError(err);
        else {
          setOpen(false);
          router.refresh();
        }
      }}
      className="mt-2 space-y-2"
    >
      <input name="amount" required inputMode="decimal" placeholder="Amount (₱) — negative to take out" className={fieldCls} autoFocus />
      <input name="note" placeholder="Note, e.g. Check #1023 encashed" className={fieldCls} />
      {error && <p className="text-xs text-red-700 dark:text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={`${primaryBtn} min-h-[36px] px-3 text-xs`}>
          {busy ? "Saving…" : "Add to fund"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={smallBtn}>
          Close
        </button>
      </div>
    </form>
  );
}

/** Turn in what a released request really spent: line items, receipts, and the change that goes back to the fund. */
export function LiquidationForm({ id, released, custodian }: { id: string; released: number; custodian: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState([{ description: "", amount: "" }]);
  const [receipts, setReceipts] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const spent = Math.round(items.reduce((s, i) => s + (Number(i.amount.replace(/,/g, "")) || 0), 0) * 100) / 100;
  const change = Math.round((released - spent) * 100) / 100;

  async function submit(verify: boolean) {
    const clean = items.filter((i) => i.description.trim() || i.amount.trim());
    if (clean.length === 0 || clean.some((i) => !i.description.trim() || !(Number(i.amount.replace(/,/g, "")) >= 0))) {
      setError("Each line needs a description and an amount");
      return;
    }
    setBusy(true);
    setError("");
    const err = await send(`/api/petty-cash/${id}`, "PATCH", {
      action: "liquidate",
      items: clean.map((i) => ({ description: i.description.trim(), amount: i.amount.replace(/,/g, "") })),
      receipts,
      note: note.trim() || undefined,
      verify,
    });
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_8rem_auto] gap-2">
            <input
              aria-label={`Item ${i + 1}`}
              value={it.description}
              onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
              placeholder="What was bought / paid"
              className={fieldCls}
            />
            <input
              aria-label={`Amount ${i + 1}`}
              value={it.amount}
              inputMode="decimal"
              onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
              placeholder="₱ 0.00"
              className={`${fieldCls} text-right`}
            />
            <button
              type="button"
              onClick={() => setItems(items.length > 1 ? items.filter((_, j) => j !== i) : [{ description: "", amount: "" }])}
              className="px-2 text-ink-400 hover:text-red-600"
              aria-label={`Remove item ${i + 1}`}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setItems([...items, { description: "", amount: "" }])} className={smallBtn}>
          + Add line
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ReceiptInput value={receipts} onChange={setReceipts} max={6} label="Attach receipts" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={fieldCls} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-ink-100 px-3 py-2 text-sm">
        <span>
          Released <b className="tabular-nums">{peso(released)}</b> · Spent <b className="tabular-nums">{peso(spent)}</b>
        </span>
        <span className={change < 0 ? "font-semibold text-red-700 dark:text-red-300" : "font-semibold text-emerald-700 dark:text-emerald-300"}>
          {change < 0 ? `Reimburse requester ${peso(-change)}` : `Change to return ${peso(change)}`}
        </span>
      </div>
      {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => submit(false)} className={custodian ? "rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-50" : primaryBtn}>
          {busy ? "Saving…" : "Submit liquidation"}
        </button>
        {custodian && (
          <button type="button" disabled={busy} onClick={() => submit(true)} className={primaryBtn}>
            {busy ? "Saving…" : "Liquidate & verify"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Owner/Accounting: verify a submitted liquidation (posts the expense) or send it back. */
export function VerifyActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const err = await send(`/api/petty-cash/${id}`, "PATCH", body);
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        <button className={`${primaryBtn} min-h-[34px] px-3 text-xs`} disabled={busy} onClick={() => act({ action: "verify" })}>
          Verify &amp; post expense
        </button>
        <button
          className={smallBtn}
          disabled={busy}
          onClick={() => {
            const reason = window.prompt("What needs fixing?");
            if (reason && reason.trim().length >= 3) act({ action: "send_back", reason: reason.trim() });
          }}
        >
          Send back
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}

/** Record a worker's cash advance and the amount to deduct every payroll cut-off. */
export function CashAdvanceForm({ people, canApprove }: { people: Option[]; canApprove: boolean }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [per, setPer] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const a = Number(amount.replace(/,/g, "")) || 0;
  const p = Number(per.replace(/,/g, "")) || 0;
  const cutoffs = a > 0 && p > 0 ? Math.ceil(a / p) : 0;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        setBusy(true);
        setMsg(null);
        const err = await send("/api/cash-advances", "POST", {
          userId: fd.get("userId"),
          amount: amount.replace(/,/g, ""),
          deductionPerCutoff: per.replace(/,/g, ""),
          reason: fd.get("reason"),
          approveNow: canApprove && fd.get("approveNow") === "on",
        });
        setBusy(false);
        if (err) setMsg({ ok: false, text: err });
        else {
          form.reset();
          setAmount("");
          setPer("");
          setMsg({ ok: true, text: "Cash advance recorded." });
          router.refresh();
        }
      }}
      className="space-y-4"
    >
      <div>
        <label htmlFor="ca-user" className={labelCls}>
          Employee
        </label>
        <select id="ca-user" name="userId" required defaultValue="" className={fieldCls}>
          <option value="" disabled>
            Select employee…
          </option>
          {people.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ca-amount" className={labelCls}>
            Amount
          </label>
          <input id="ca-amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₱ 0.00" className={fieldCls} />
        </div>
        <div>
          <label htmlFor="ca-per" className={labelCls}>
            Deduct per cut-off
          </label>
          <input id="ca-per" required inputMode="decimal" value={per} onChange={(e) => setPer(e.target.value)} placeholder="₱ 0.00" className={fieldCls} />
        </div>
      </div>
      {cutoffs > 0 && (
        <p className="text-xs text-ink-500">
          Paid off in about <b>{cutoffs}</b> cut-off{cutoffs === 1 ? "" : "s"} ({peso(p)} each{a % p ? `, last one ${peso(Math.round((a - p * (cutoffs - 1)) * 100) / 100)}` : ""}).
        </p>
      )}
      <div>
        <label htmlFor="ca-reason" className={labelCls}>
          Reason
        </label>
        <textarea id="ca-reason" name="reason" required minLength={3} rows={3} placeholder="e.g. Hospital bill for family member" className={`${fieldCls} py-2.5`} />
      </div>
      {canApprove && (
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="approveNow" defaultChecked className="h-4 w-4" /> Approve and release now
        </label>
      )}
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full`}>
        {busy ? "Saving…" : "Record Cash Advance"}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>{msg.text}</p>}
      <p className="text-xs text-ink-500">Once approved, every new payroll run starts with this deduction filled in until the balance is paid.</p>
    </form>
  );
}

/** Approve / reject / payment / change-deduction / cancel on one cash advance. */
export function AdvanceActions({ id, status, canApprove, repaid }: { id: string; status: string; canApprove: boolean; repaid: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const err = await send(`/api/cash-advances/${id}`, "PATCH", body);
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }
  const b: React.ReactNode[] = [];
  if (canApprove && status === "PENDING") {
    b.push(
      <button key="a" className={smallBtn} disabled={busy} onClick={() => act({ action: "approve" })}>
        Approve
      </button>,
      <button
        key="r"
        className={smallBtn}
        disabled={busy}
        onClick={() => {
          const reason = window.prompt("Reason for rejecting?");
          if (reason && reason.trim().length >= 3) act({ action: "reject", reason: reason.trim() });
        }}
      >
        Reject
      </button>
    );
  }
  if (status === "ACTIVE") {
    b.push(
      <button
        key="p"
        className={smallBtn}
        disabled={busy}
        onClick={() => {
          const v = window.prompt("Cash repaid directly (₱):");
          if (v && Number(v.replace(/,/g, "")) > 0) act({ action: "record_payment", amount: v.replace(/,/g, "") });
        }}
      >
        Record payment
      </button>
    );
  }
  if (status === "PENDING" || status === "ACTIVE") {
    b.push(
      <button
        key="d"
        className={smallBtn}
        disabled={busy}
        onClick={() => {
          const v = window.prompt("New deduction per cut-off (₱):");
          if (v && Number(v.replace(/,/g, "")) > 0) act({ action: "set_deduction", deductionPerCutoff: v.replace(/,/g, "") });
        }}
      >
        Change deduction
      </button>
    );
    if (!repaid)
      b.push(
        <button key="c" className={smallBtn} disabled={busy} onClick={() => window.confirm("Cancel this cash advance?") && act({ action: "cancel" })}>
          Cancel
        </button>
      );
  }
  if (b.length === 0) return null;
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">{b}</div>
      {error && <p className="mt-1 max-w-xs text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
