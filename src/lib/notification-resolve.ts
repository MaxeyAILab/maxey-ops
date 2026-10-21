import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS, GA_LABEL } from "@/lib/requisitions";
import { payslipPeriodLabel } from "@/lib/payslip";
import type { PayrollEntry } from "@/lib/payroll";
import type { EventCtx } from "@/lib/notification-rules";
import { REQUEST_LABEL } from "@/lib/inventory-labels";

/**
 * Looks up what an audit record is about: which project, a short human reference, where tapping the notification should go,
 * and the people the event is directly about. Reads only; returns null when there is nothing sensible to say. Never an amount.
 */

const ids = (...v: (string | null | undefined)[]) => v.filter((x): x is string => !!x);
const fallbackUrl: Record<string, string> = {
  Requisition: "/requisitions",
  PurchaseOrder: "/purchasing",
  Delivery: "/deliveries",
  SiteInstruction: "/instructions",
  PettyCashRequest: "/cash-expense/petty-cash",
  PettyCashFundEntry: "/cash-expense/petty-cash",
  CashAdvance: "/cash-expense/cash-advance",
  Lead: "/leads",
  Quotation: "/leads",
  CashSnapshot: "/dashboard",
  WarehouseItem: "/inventory",
  Tool: "/inventory",
  InventoryMovement: "/inventory",
  ToolMovement: "/inventory",
};

const projectUrl = (projectId: string | null | undefined, section = "") => (projectId ? `/projects/${projectId}${section}` : "/projects");

export async function resolveContext(entityType: string, entityId: string, action: string, diff: unknown): Promise<EventCtx | null> {
  const d = (diff ?? {}) as Record<string, unknown>;
  const dText = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);
  try {
    switch (entityType) {
      case "Requisition": {
        const r = await prisma.requisition.findUnique({ where: { id: entityId }, select: { projectId: true, category: true, submittedById: true, project: { select: { name: true } } } });
        if (!r) return { url: "/requisitions", label: dText("project") };
        const label = r.project?.name ?? `${GA_LABEL} · ${CATEGORY_LABELS[r.category ?? "EMERGENCY"] ?? ""}`;
        return { url: `/requisitions/${entityId}`, label, projectId: r.projectId, projectName: r.project?.name, explicit: ids(r.submittedById) };
      }
      case "PurchaseOrder": {
        const po = await prisma.purchaseOrder.findUnique({ where: { id: entityId }, select: { poNumber: true, requisition: { select: { submittedById: true, projectId: true, project: { select: { name: true } } } } } });
        if (!po) return { url: "/purchasing" };
        return { url: `/purchasing/${entityId}`, label: [po.poNumber, po.requisition.project?.name].filter(Boolean).join(" · "), projectId: po.requisition.projectId, explicit: ids(po.requisition.submittedById) };
      }
      case "Delivery": {
        const dv = await prisma.delivery.findUnique({ where: { id: entityId }, select: { projectId: true, project: { select: { name: true } }, po: { select: { poNumber: true, requisition: { select: { submittedById: true } } } } } });
        if (!dv) return { url: "/deliveries" };
        return { url: "/deliveries", label: [dv.po.poNumber, dv.project?.name].filter(Boolean).join(" · "), projectId: dv.projectId, explicit: ids(dv.po.requisition.submittedById) };
      }
      case "ProgressEntry": {
        const p = await prisma.progressEntry.findUnique({ where: { id: entityId }, select: { projectId: true, submittedById: true, project: { select: { name: true } } } });
        if (!p) return null;
        return { url: projectUrl(p.projectId, "#progress"), projectId: p.projectId, projectName: p.project.name, label: p.project.name, explicit: ids(p.submittedById) };
      }
      case "DailyConstructionReport": {
        const p = await prisma.dailyConstructionReport.findUnique({ where: { id: entityId }, select: { projectId: true, project: { select: { name: true } } } });
        return p ? { url: projectUrl(p.projectId), projectId: p.projectId, projectName: p.project.name, label: p.project.name } : null;
      }
      case "SiteInstruction": {
        const i = await prisma.siteInstruction.findUnique({ where: { id: entityId }, select: { projectId: true, taskId: true, title: true, postedById: true, assignees: { select: { id: true } }, project: { select: { name: true } } } });
        if (!i) return { url: "/instructions" };
        return { url: "/instructions", projectId: i.projectId, projectName: i.project?.name, label: [i.taskId ?? i.title, i.project?.name].filter(Boolean).join(" · "), explicit: i.assignees.map((a) => a.id) };
      }
      case "Rfi": {
        const r = await prisma.rfi.findUnique({ where: { id: entityId }, select: { projectId: true, number: true, assigneeId: true, raisedById: true, project: { select: { name: true } } } });
        if (!r) return null;
        const explicit = action === "RFI_ANSWERED" ? ids(r.raisedById) : action === "RFI_RAISED" || action === "RFI_REOPENED" ? ids(r.assigneeId) : [];
        return { url: projectUrl(r.projectId, "#rfis"), projectId: r.projectId, projectName: r.project.name, label: `RFI-${String(r.number).padStart(3, "0")} · ${r.project.name}`, explicit };
      }
      case "Finding": {
        const f = await prisma.finding.findUnique({ where: { id: entityId }, select: { projectId: true, ownerId: true, raisedById: true, project: { select: { name: true } } } });
        if (!f) return null;
        const explicit = action === "FINDING_CLOSURE_SUBMITTED" ? ids(f.raisedById) : ids(f.ownerId);
        return { url: projectUrl(f.projectId, "#quality"), projectId: f.projectId, projectName: f.project.name, label: f.project.name, explicit };
      }
      case "ChangeOrder": {
        const c = await prisma.changeOrder.findUnique({ where: { id: entityId }, select: { projectId: true, title: true, project: { select: { name: true } } } });
        return c ? { url: projectUrl(c.projectId, "#changes"), projectId: c.projectId, projectName: c.project.name, label: `${c.title} · ${c.project.name}` } : null;
      }
      case "WorkRequest": {
        const w = await prisma.workRequest.findUnique({ where: { id: entityId }, select: { projectId: true, number: true, project: { select: { name: true } } } });
        return w ? { url: projectUrl(w.projectId, "#additional-work"), projectId: w.projectId, projectName: w.project.name, label: `CR-${String(w.number).padStart(3, "0")} · ${w.project.name}` } : null;
      }
      case "ProjectDocument":
      case "DocumentRevision": {
        const projectId = entityType === "ProjectDocument"
          ? (await prisma.projectDocument.findUnique({ where: { id: entityId }, select: { projectId: true } }))?.projectId
          : (await prisma.documentRevision.findUnique({ where: { id: entityId }, select: { document: { select: { projectId: true } } } }))?.document.projectId;
        if (!projectId) return null;
        const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
        return { url: projectUrl(projectId, "#documents"), projectId, projectName: p?.name, label: p?.name };
      }
      case "Milestone": {
        const m = await prisma.milestone.findUnique({ where: { id: entityId }, select: { projectId: true, title: true, project: { select: { name: true } } } });
        return m ? { url: projectUrl(m.projectId, "#schedule"), projectId: m.projectId, projectName: m.project.name, label: `${m.title} · ${m.project.name}` } : null;
      }
      case "Project": {
        const p = await prisma.project.findUnique({ where: { id: entityId }, select: { name: true } });
        return { url: projectUrl(entityId), projectId: entityId, projectName: p?.name, label: p?.name ?? dText("name") };
      }
      case "ProjectAssignment": {
        const a = await prisma.projectAssignment.findUnique({ where: { id: entityId }, select: { userId: true, projectId: true, project: { select: { name: true } } } });
        return a ? { url: projectUrl(a.projectId), projectId: a.projectId, projectName: a.project.name, label: a.project.name, explicit: ids(a.userId) } : null;
      }
      case "InventoryMovement": {
        // a return/transfer request: the people it is about is whoever asked for it (told when it is decided)
        const m = await prisma.inventoryMovement.findUnique({ where: { id: entityId }, select: { actorId: true, type: true, item: { select: { name: true } } } });
        if (!m) return { url: "/inventory" };
        return { url: "/inventory", label: `${m.item.name} · ${REQUEST_LABEL[m.type] ?? "Request"}`, explicit: ids(m.actorId) };
      }
      case "ToolMovement": {
        const m = await prisma.toolMovement.findUnique({ where: { id: entityId }, select: { actorId: true, type: true, tool: { select: { name: true } } } });
        if (!m) return { url: "/inventory" };
        return { url: "/inventory", label: `${m.tool.name} · ${REQUEST_LABEL[m.type] ?? "Request"}`, explicit: ids(m.actorId) };
      }
      case "PettyCashRequest": {
        const r = await prisma.pettyCashRequest.findUnique({ where: { id: entityId }, select: { number: true, requestedById: true, projectId: true, project: { select: { name: true } } } });
        if (!r) return { url: "/cash-expense/petty-cash" };
        return { url: "/cash-expense/petty-cash", projectId: r.projectId, label: `PC-${String(r.number).padStart(4, "0")}${r.project ? ` · ${r.project.name}` : ""}`, explicit: ids(r.requestedById) };
      }
      case "CashAdvance": {
        const a = await prisma.cashAdvance.findUnique({ where: { id: entityId }, select: { number: true, userId: true } });
        if (!a) return { url: "/cash-expense/cash-advance" };
        return { url: "/cash-expense/cash-advance", label: `CA-${String(a.number).padStart(4, "0")}`, explicit: ids(a.userId) };
      }
      case "PayrollRun": {
        const run = await prisma.payrollRun.findUnique({ where: { id: entityId }, select: { department: true, periodStart: true, periodEnd: true, entries: true, project: { select: { name: true } } } });
        if (!run) return null;
        const label = `${run.project?.name ?? run.department ?? "Payroll"} · ${payslipPeriodLabel(run.periodStart, run.periodEnd)}`;
        const people = action === "PAYROLL_APPROVED" || action === "PAYROLL_PAID" ? (run.entries as unknown as PayrollEntry[]).map((e) => e.userId) : [];
        return { url: `/payroll/${entityId}`, explicitUrl: "/payroll", label, explicit: people };
      }
      case "TimeAdjustmentRequest": {
        const t = await prisma.timeAdjustmentRequest.findUnique({ where: { id: entityId }, select: { userId: true, requestedById: true, user: { select: { name: true } } } });
        return t ? { url: "/attendance", label: t.user.name, explicit: ids(t.userId, t.requestedById) } : { url: "/attendance" };
      }
      case "Payment": {
        const p = await prisma.payment.findUnique({ where: { id: entityId }, select: { projectId: true, project: { select: { name: true } } } });
        return p ? { url: projectUrl(p.projectId, "#commercial"), projectId: p.projectId, projectName: p.project.name, label: p.project.name } : { url: "/projects" };
      }
      case "Auth":
      case "User":
        return { url: entityType === "User" ? "/people" : "/dashboard", label: dText("name") ?? entityId };
      default: {
        const url = fallbackUrl[entityType];
        return url ? { url } : null;
      }
    }
  } catch (err) {
    console.error("[notify] resolveContext", entityType, err);
    return null;
  }
}
