# Maxey Construction — Operations Platform
### Claude Code Build Specification (Spec.md)
**Owner:** Jacob Villamor, Civil Engineer, 14 yrs industry experience
**Company:** Maxey Construction — 374 Malapit, San Isidro, Nueva Ecija, Philippines
**Scope of work:** Residential, commercial, industrial, infrastructure — private + government (PCAB-registered) projects
**Document purpose:** This is the master spec for Claude Code to scaffold, build, and iterate on the system. It defines architecture, phasing, modules, data model, and acceptance criteria.
---
## 1. Vision
A single web platform that runs the whole business: winning work, running projects, controlling cost, paying people correctly, and keeping clients informed — without depending on phone calls, Messenger chats, and paper logbooks that get lost or delayed. The system should make Maxey Construction look and operate like an established, professional, PCAB-grade contractor from day one, even while rebuilding from scratch.
Guiding principles:
- **Single source of truth** — a requisition, a payment, a progress update exists in exactly one place, not scattered across texts and calls.
- **Field-first, offline-tolerant** — foremen/engineers work from job sites with weak or no signal; the system must capture data locally and sync later.
- **Accountability by design** — every entry (edits, approvals, instructions, logbook) is timestamped and attributed to a named user.
- **Role-scoped visibility** — site payroll, office payroll, and driver payroll are visible only to their own department + Owner; clients see only their project's curated portal view.
---
## 2. Tech Stack
| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 14+ (App Router, TypeScript) | Web app now; mobile app (React Native/Expo) later, sharing the same API layer |
| UI | Tailwind CSS + shadcn/ui | Fast, professional-looking default components |
| Database | PostgreSQL | Hosted (Supabase, Neon, or Railway — Claude Code to recommend at setup) |
| ORM | Prisma | Type-safe schema + migrations |
| Auth | NextAuth (Auth.js) with role-based access control (RBAC) | Email/password + optional phone OTP for site staff |
| File/photo storage | S3-compatible bucket (Supabase Storage or Cloudflare R2) | Delivery photos, logbook scans, site photos, permit PDFs |
| Offline support | PWA (installable) + Service Worker + IndexedDB queue + background sync | Critical — see Section 4 |
| Notifications | Web push + SMS gateway (e.g., Semaphore/Movider, PH-focused) + email (Resend/SendGrid) | Replaces "call/text Jacob" workflow |
| Facebook integration | Meta Graph API (Messenger + Page inbox webhook) | Auto-reply + lead capture into CRM |
| OCR (logbook photos) | Claude API (vision) via `/v1/messages` with image input | Convert handwritten/photographed logbook pages to structured text |
| Charts/dashboards | Recharts | Cashflow, progress, financial dashboards |
| Hosting | Vercel (app) + managed Postgres | Simple ops for a small company |
---
## 3. Roles & Permissions
| Role | Access |
|---|---|
| **Owner/Admin (Jacob)** | Full access to everything, all approvals, all dashboards, all payroll |
| **Project Manager (PM)** | Assigned projects: progress entry, instructions, requisition review, reports |
| **Site Foreman/Engineer** | Assigned project only: requisitions, delivery checklist, daily logbook, site instructions (view + acknowledge), attendance (self + crew) |
| **Purchasing** | Approved requisitions → POs → supplier management |
| **Accounting/Finance** | Payments, invoicing, project & company cashflow, payroll processing, financial reports |
| **Driver/Pahinante** | Delivery/pullout log, time in/out, assigned trip list |
| **Client** | Client portal only: their project's progress, photos, instructions log, change orders (approve/reject), payment status (no cost breakdown unless Jacob allows) |
| **Office Staff (general)** | Time in/out, limited modules per assignment |
Payroll visibility rule: **Site crew payroll, office payroll, and driver payroll are separate ledgers**, each visible only to Owner + Accounting + that department's own members (self-view only, not peers).
Every edit anywhere in the system stores: `edited_by`, `edited_at`, and a version/audit trail (append-only log, never silent overwrite).
---
## 4. Offline-First Architecture (site connectivity is often weak/none)
This is a first-class requirement, not an afterthought.
- App installs as a **PWA** on site phones/tablets.
- Forms usable offline: requisitions, delivery checklist, attendance time in/out, logbook photo capture, site instruction acknowledgment, progress update entry, driver/pahinante log.
- All offline actions write to an **IndexedDB outbox queue** with a client-generated UUID + timestamp captured at time of action (not sync time).
- A visible **sync status indicator** ("3 items pending sync") on every relevant screen.
- **Background Sync API** pushes the queue when connectivity returns; manual "Sync now" button as fallback.
- **Conflict handling:** last-write-wins on non-critical fields, but approvals/financial entries are append-only (no overwrite) so conflicting offline entries never silently vanish — flagged for Owner/PM review if two edits collide.
- Photos are compressed client-side before queuing to reduce sync payload.
- GPS + timestamp auto-captured (when permitted) on attendance and delivery checklist entries for verification.
---
## 5. Phased Build Plan
### **Phase 1 — MVP** (build first)
Directly targets: client acquisition, requisition bottleneck, and cash visibility — the highest-pain items.
1. **CRM & Lead Intake** (Problems 1, 18, 19)
2. **Requisition → Approval → Purchasing workflow** (Problem 4)
3. **Project & Company Cashflow + Owner Dashboard** (Problems 3, 9, 11)
4. **Client Portal (progress view + change order approval)** (Problems 7, 14, 15, 17)
### **Phase 2**
5. **Time & Attendance + Automated Payroll** (Problems 12, 15)
6. **Delivery Checklist + Warehouse Inventory & Pullout/Transfer Log** (Problems 5, 11, 20)
7. **Site Instructions Log** (Problem 16)
8. **Daily Progress Reporting** (Problems 6, 8)
### **Phase 3**
9. **Logbook OCR capture** (Problem 7)
10. **Permit & Compliance Renewal Reminders** (Problem 14)
11. **Meeting Logs** (Problem 13)
12. **Driver/Pahinante Trip Log** (Problem 20, materials-in-transit tracking)
13. **Weekly/Monthly/Yearly Financial Statement auto-generation** (Problem 10)
14. **Facebook Messenger auto-reply + lead sync** (Problem 19)
Each phase should ship as a working, usable increment — not a partial skeleton.
---
## 6. Module Specifications
### 6.1 CRM & Lead Management *(Phase 1)*
**Solves:** Problems 1, 18, 19
- Central **Leads/Inquiries** inbox: source (website form, Facebook, referral, walk-in, government bid notice), contact name, email, phone, address, uploaded plan/document, message.
- Auto-timestamped queue ordered by inquiry time → gives Jacob first-come-first-served prioritization instead of guessing.
- Auto-reply on website contact form and Facebook Page (via Graph API webhook): acknowledges receipt, gives expected estimate turnaround (configurable, e.g., "3–5 business days"), and creates a Lead record automatically — no person needs to be watching the inbox live.
- Lead status pipeline: `New → Under Review → Estimate in Progress → Quotation Sent → Won/Lost`.
- Convert a won lead directly into a **Project** record (carries over client info, documents).
- Quotation/estimate builder: line items, materials, labor, markup, VAT — exportable as branded PDF (professional letterhead using Maxey Construction branding).
- Every lead shows "days since inquiry" and "estimate due by" so nothing sits unanswered.
### 6.2 Requisition → Approval → Purchasing Workflow *(Phase 1)*
**Solves:** Problem 4
- Foreman/engineer submits a **Material Requisition** from phone/tablet (works offline): item, quantity, unit, specification/notes, urgency, project auto-tagged, photo attachment optional.
- Requisition routes to **PM/Office** to complete costing fields if needed, then to **Jacob for approval** (push notification + SMS fallback — replaces the phone call/text step entirely).
- On approval, auto-forwards to **Purchasing** with the approved quantities and cost locked in.
- Purchasing converts to a **Purchase Order**, records supplier, unit cost, delivery date.
- Every approved requisition **automatically posts as a committed cost** against that project's budget in the accounting module — no manual re-entry.
- Full audit trail: submitted by → approved by → PO by → delivered (links to Section 6.3).
### 6.3 Delivery Checklist & Materials Verification *(Phase 2)*
**Solves:** Problem 5
- When materials arrive on-site, foreman/engineer opens the linked PO on phone/tablet, checks off each line item against what's physically delivered (quantity + spec match), can flag shortages/damage with photo.
- On submission (or sync), this auto-generates a **Delivery Form** filed under that project — no separate paperwork.
- Discrepancies (short-delivered, wrong spec) auto-flag to PM + Purchasing for follow-up with supplier.
### 6.4 Warehouse Inventory & Materials Movement Log *(Phase 2)*
**Solves:** Problems 5, 11, 20
- Warehouse stock ledger: what's in stock, from which project's unused materials, pulled out to which site.
- Every movement type logged with actor + timestamp:
  - Site → Warehouse (pullout of unused materials)
  - Warehouse → Site (issue to a project)
  - Site → Site (direct transfer, logged by foreman/driver on phone)
- Real-time stock levels per warehouse item; low-stock and idle-stock visibility.
- Feeds directly into the driver/trip log (6.9) when a physical delivery vehicle is involved.
### 6.5 Time & Attendance + Automated Payroll *(Phase 2)*
**Solves:** Problems 12, 15
- Time in/out capture for: office staff, site workers, drivers/pahinante — via phone (QR code at site, or GPS-stamped tap-in), offline-capable.
- Each worker has a rate profile (hourly/daily) and department (Office / Site / Driver).
- Payroll auto-computes weekly totals: hours, overtime (per PH labor rules — configurable), gross, statutory deductions (SSS/PhilHealth/Pag-IBIG placeholders configurable), net pay.
- **Strict visibility separation**: Site payroll, Office payroll, Driver payroll are separate views; a worker sees only their own pay, department heads/Accounting/Owner see their department's full ledger.
- Payroll register exportable (PDF/Excel) for bank disbursement or cash payout sheets — designed to cut the "2–3 people, all day" process down to a review-and-approve action.
### 6.6 Site Instructions Log *(Phase 2)*
**Solves:** Problem 16
- Jacob/PM posts dated, project-specific instructions (text + optional photo/marked-up drawing).
- Foreman/engineer sees a **running daily list** on their device (not a buried chat thread) — today's instructions plus full searchable history for that project.
- Each instruction has a status: `Open → Acknowledged → In Progress → Done`, settable by site staff.
- Weekly auto-summary of open/overdue instructions surfaces to Jacob.
### 6.7 Daily Progress Reporting + Client Portal View *(Phase 2)*
**Solves:** Problems 6, 7, 8, 17
- PM/foreman submits daily progress input (from phone/tablet): % complete per work item, photos, notes, tied to delivered materials and instructions status already in the system.
- Auto-compiles into a **Project Progress Report**: photo timeline, instruction log, meeting log excerpts, cost-to-date chart, schedule variance chart.
- Every entry logs the editor's name and timestamp (per your requirement) — creates a defensible record of what was reported, when, and by whom, directly addressing disputes over "who said what caused the delay."
- **Client Portal**: read-only curated view of the same progress report (photos, % complete, instructions, approved change orders) — clients self-serve status instead of calling, and the system provides a timestamped record countering after-the-fact blame-shifting.
- Change orders (6.8) and client-side instruction acknowledgments appear in the same portal.
### 6.8 Change Orders & Client Approvals *(Phase 1 portal, workflow expands Phase 2)*
**Solves:** Problems 14, 15, 17
- Any additional work / change order is logged with description, cost/time impact, and photos/drawings.
- Client reviews and **approves or rejects in-portal** with e-signature/click-to-approve + timestamp — creates an unambiguous record of client-caused scope changes, directly countering "the contractor caused the delay" disputes.
- Approved change orders auto-post into project cost/cashflow.
### 6.9 Driver & Pahinante Trip Log *(Phase 3)*
**Solves:** Problem 20 (+ feeds 6.4)
- Driver logs: origin, destination (site/warehouse/supplier), items carried, departure/arrival time, odometer/photo of load — offline-capable from phone.
- Time-on-road auto-calculated and feeds into materials-cost/logistics tracking mentioned in your goals (Solution 2).
- Pahinante (helper) hours logged alongside for payroll (6.5).
### 6.10 Logbook OCR Capture *(Phase 3)*
**Solves:** Problem 7 (daily logbook delay)
- Foreman photographs the physical site logbook page (or fills a digital equivalent).
- Photo sent to **Claude API (vision)** with a structured-extraction prompt → returns structured JSON (date, weather, manpower count, equipment on site, activities, remarks).
- Extracted entry auto-files under the correct project/date, editable by foreman/PM before final save (OCR errors are common — human confirms).
- Removes the "logbook always delayed" bottleneck since capture takes seconds on-site.
### 6.11 Permits & Compliance Tracker *(Phase 3)*
**Solves:** Problem 14
- Register of all business/project permits (PCAB license, business permit, BIR, site-specific permits, insurance, bonds) with issue date and expiry date.
- Automated reminders at **30 / 20 / 10 / 5 / 1 days** before expiry via push + SMS + email to Jacob (and any assigned admin).
- Status dashboard: Active / Expiring Soon / Expired, with document upload/versioning per permit.
### 6.12 Meeting Logs *(Phase 3)*
**Solves:** Problem 13
- Structured meeting-minutes form: date, project, attendees, agenda items, decisions/action items with owner + due date.
- Action items sync into the Site Instructions log (6.6) or a general task list so decisions don't get lost.
- Searchable history per project.
### 6.13 Financial Dashboard & Reports *(Phase 1 dashboard basics → Phase 3 full automation)*
**Solves:** Problems 3, 9, 10, 11
- **Owner Dashboard**: daily/weekly/monthly/yearly view of savings, gross profit, net profit, downpayments received, partial payments received, retention held/released, running total cost, per-project and company-wide.
- **Project Cashflow**: contract value, terms (downpayment %, milestone billing schedule), payments received vs. due, retention tracked separately (amount held, release conditions/date), committed cost (from approved requisitions/POs) vs. actual cost, real-time gross/net margin.
- **Company Cashflow**: consolidated across all active projects, inflows (client payments) vs. outflows (payroll, materials, overhead), forecast view.
- **Auto-generated Financial Statements** (weekly/monthly/yearly): income statement, cashflow statement — auto-drafted from ledger data, human-reviewed and locked/exported rather than built from scratch each period.
- Inventory value (from 6.4) rolls into balance sheet view.
### 6.14 Company Website (professional presence)
**Solves:** Problem 1, supports 18/19
- Marketing site: company profile, PCAB registration/credentials, project portfolio (with photos from the progress module — reusable content), services, contact form feeding directly into the CRM (6.1), and a Facebook Page link.
- Built with the same Next.js app (public routes) so branding is consistent with the client portal.
---
## 7. Core Data Model (high level — Prisma schema to formalize)
```
User (id, name, email, phone, role, department, rate_profile, active)
Client (id, name, contact_info, source)
Lead (id, client_id, source, message, plan_file_url, status, created_at)
Quotation (id, lead_id, line_items[], total, vat, pdf_url, status)
Project (id, client_id, name, address, contract_value, terms_json, status, pcab_ref, start_date, target_end_date)
PaymentTerm (id, project_id, type[downpayment|partial|retention|final], amount, due_condition, status)
Payment (id, project_id, payment_term_id, amount, date_received, method)
Requisition (id, project_id, submitted_by, items[], status, approved_by, approved_at)
PurchaseOrder (id, requisition_id, supplier, items[], unit_costs[], status, delivery_date)
Delivery (id, po_id, project_id, checklist[], verified_by, discrepancies, photos[])
WarehouseItem (id, name, unit, current_qty)
InventoryMovement (id, item_id, from, to, qty, project_id, actor, timestamp, type)
Attendance (id, user_id, project_id_or_office, time_in, time_out, gps, source[online|offline_synced])
PayrollRun (id, department, period_start, period_end, entries[], status)
SiteInstruction (id, project_id, posted_by, text, photo_url, status, created_at)
ProgressEntry (id, project_id, submitted_by, pct_complete, photos[], notes, edited_by, edited_at)
ChangeOrder (id, project_id, description, cost_impact, time_impact_days, status, client_response_at)
Meeting (id, project_id, date, attendees[], notes, action_items[])
LogbookEntry (id, project_id, date, source_photo_url, ocr_json, confirmed_by)
Permit (id, name, issuing_body, issue_date, expiry_date, document_url, status)
TripLog (id, driver_id, project_id, origin, destination, items[], depart_time, arrive_time)
AuditLog (id, entity_type, entity_id, actor, action, timestamp, diff)
```
---
## 8. Non-Functional Requirements
- **Security:** RBAC enforced server-side on every API route, not just UI hiding. Sensitive financial/payroll data encrypted at rest where supported by hosting provider.
- **Audit trail:** every create/edit/approve action logged in `AuditLog` — non-negotiable given multiple disputes described (client blame-shifting, delayed reports).
- **Mobile-first UI** for all field modules (requisition, delivery checklist, attendance, instructions, logbook, trip log) — large tap targets, minimal typing, camera-first where relevant.
- **Branding:** consistent professional visual identity (logo, letterhead, color scheme) applied to quotations, delivery forms, client portal, and public website — reinforces "PCAB-grade professional company" positioning.
- **Notifications:** push (PWA) as primary, SMS as fallback for approvals/time-critical items (requisition approval requests, permit expiry, change order awaiting client response).
- **Localization:** PHP currency formatting, Philippine labor rules (OT/holiday pay) configurable in payroll module, Philippine timezone (Asia/Manila) throughout.
---
## 9. Explicit Assumptions (flag if wrong before build starts)
1. Single company entity for now (not multi-branch) — schema should stay flexible for future entities.
2. Payroll computes gross-to-net pay for internal payout purposes; full BIR/SSS/PhilHealth/Pag-IBIG remittance filing is **out of scope** for Phase 1–3 (can be added later).
3. Government-bid-specific PCAB document workflows (bid document generation, eligibility docs) are treated as file storage under Permits/Compliance in Phase 3, not a dedicated bidding workflow — flag if you need a full bidding module.
4. Facebook Messenger auto-reply requires a verified Meta Business/Developer app — this has a setup lead time outside Claude Code's control.
5. OCR logbook accuracy will need human confirmation initially; not a fully unattended pipeline.
---
## 10. Instruction to Claude Code (when this file is opened in a project)
> Build this system in the phase order defined in Section 5. For each module, implement the data model (Section 7) via Prisma migrations first, then the API routes with RBAC enforcement (Section 3), then the UI (mobile-first for field modules, dashboard-first for Owner/Accounting views). Every write operation must create an `AuditLog` entry. Field-facing forms (requisition, delivery checklist, attendance, site instructions, logbook, trip log) must work offline via the IndexedDB outbox pattern described in Section 4, with a visible sync status. Do not skip the offline queue for these forms even in early phases — retrofitting it later is expensive. Confirm the hosting/database provider choice with the user before provisioning.
