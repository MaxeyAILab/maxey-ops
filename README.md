# Maxey Construction — Operations Platform

Phases 1 & 2 per [Spec.md](Spec.md): CRM & lead intake, requisition → approval →
purchasing workflow, cashflow dashboard, client portal, time & attendance +
payroll, delivery checklist, warehouse inventory, site instructions, and daily
progress reporting with photos. Built with Next.js 14, Prisma, PostgreSQL,
NextAuth (RBAC), Tailwind, and an offline-first PWA outbox.

## Local development

```bash
npm install
npm run db:start      # starts embedded PostgreSQL on port 5433 (keep running)
npm run db:push       # creates the schema
npm run db:seed       # demo users + sample project
npm run dev           # http://localhost:3000
```

### Demo logins (password: `maxey123`)

| Role | Email |
|---|---|
| Owner (Jacob) | jacob@maxeyconstruction.ph |
| Project Manager | pm@maxeyconstruction.ph |
| Site Foreman | foreman@maxeyconstruction.ph |
| Purchasing | purchasing@maxeyconstruction.ph |
| Accounting | accounting@maxeyconstruction.ph |
| Client (portal) | client@example.com |

## What's in Phase 1

- **Public site + lead intake** (`/`): contact form posts straight into the CRM
  with an automatic acknowledgment and a 5-business-day estimate promise.
- **CRM** (`/leads`): first-come-first-served inquiry queue with "days waiting"
  and "estimate due by", pipeline statuses, quotation builder with markup/VAT and
  branded print-to-PDF, one-click convert-to-project (seeds payment terms).
- **Requisitions** (`/requisitions`): mobile-first field form that **works
  offline** (IndexedDB outbox + background sync + visible "N items pending sync"
  indicator), then PM/Accounting costing → Owner approval → auto-forward to
  Purchasing → PO. Approved cost posts as committed cost against the project.
- **Owner dashboard** (`/dashboard`): contract value, payments received,
  committed cost, gross margin, retention held; 6-month cashflow chart;
  per-project financial table. Owner + Accounting only.
- **Client portal** (`/portal`): curated progress timeline, payment status
  (terms only, no internal costs), change-order approve/reject with timestamped,
  attributed responses. Approved COs auto-post to contract value and billing.
- **Audit trail**: every write creates an append-only `AuditLog` row
  (who/what/when/diff). Requisition pages show the trail inline.

## What's in Phase 2

- **Time & Attendance** (`/attendance`): one-tap GPS-stamped time in/out,
  offline-capable, with the exact tap time preserved through sync.
- **Payroll** (`/payroll`): Owner/Accounting generate runs per department from
  attendance — hours, daily OT at 1.25×, placeholder SSS/PhilHealth/Pag-IBIG
  deductions (`src/lib/payroll.ts` PAYROLL_CONFIG), net pay. DRAFT → REVIEW →
  APPROVED (Owner-only) → PAID, CSV export + print register. **Strict
  visibility**: workers see only their own pay lines, never peers'.
- **Deliveries** (`/deliveries`): foreman checks arriving materials off against
  the PO on-site (offline, GPS, photos); auto-generates the Delivery Form,
  updates PO/requisition status, and flags shortages to PM + Purchasing.
- **Warehouse Inventory** (`/inventory`): stock ledger with real-time levels;
  every pullout/issue/site-to-site transfer logged with actor + timestamp and
  atomic stock updates. Offline-capable movement logging.
- **Site Instructions** (`/instructions`): Jacob/PM post dated project
  instructions (with photo/marked-up drawing); foreman's running daily list with
  Open → Acknowledged → In Progress → Done, offline status updates that never
  move backwards.
- **Progress reporting upgrade**: site photos (compressed client-side) on
  progress entries, shown in the project timeline and client portal; compiled
  print-ready **Progress Report** per project (`/projects/[id]/report`) with
  photo timeline, instruction log, deliveries, and cost-to-date.

Photos are stored locally in `public/uploads/` for development — swap
`src/lib/storage.ts` to Supabase Storage/R2 for production.

## Production notes

- **Database/hosting are not provisioned yet** — per the spec this is confirmed
  with the owner first. Recommended: Vercel + **Supabase** Postgres (also covers
  file storage for Phase 2 photos). Set `DATABASE_URL`, `NEXTAUTH_URL`,
  `NEXTAUTH_SECRET` and run `prisma migrate deploy`.
- SMS (Semaphore) and email (Resend) senders are stubbed in
  `src/lib/notify.ts` — call sites are wired; add API keys and implement.
- Replace the placeholder "M" PWA icons in `public/icons/` with real branding
  (`scripts/gen-icons.mjs` regenerates placeholders).

## Phase 3 (not yet built)

Logbook OCR (Claude vision), permits & compliance tracker with expiry
reminders, meeting logs, driver/pahinante trip logs, auto-generated financial
statements, Facebook Messenger auto-reply + lead sync. The Prisma schema for
all of these is already defined so migrations stay additive.
