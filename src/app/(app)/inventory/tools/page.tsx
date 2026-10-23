import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge, Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui";
import { DeleteToolButton, ToolActions, ToolConditionControl } from "@/components/tool-forms";
import { EditToolButton } from "@/components/inventory-edit";
import { WarehouseTabs } from "@/components/warehouse-tabs";
import { canAccess, canAddInventoryCatalog, canDeleteTool, canLogInventoryMovement } from "@/lib/access";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";
import { TOOL_CONDITION_LABEL } from "@/lib/tool-condition";
import { TOOL_FILTERS, filterTools, isToolFilter, toolFilterCounts } from "@/lib/tool-filter";
import { NO_TOOL_CATEGORY, TOOL_CATEGORIES, TOOL_CATEGORY_LABEL, summarizeToolCategories, toolCategoryFromSlug, toolCategoryKey, toolCategorySlug } from "@/lib/tool-category";
import { DEFAULT_WAREHOUSE, countByWarehouse, warehouseFromSlug, warehouseLabel, warehouseSlug } from "@/lib/warehouses";
import { REQUEST_LABEL } from "@/lib/inventory-labels";

export const metadata = { title: "Tools & Equipment" };
export const dynamic = "force-dynamic";

/**
 * The tools and equipment of one warehouse (chosen with the tabs), by category. The Inventory tab shows only the four category
 * tiles; this page lists the tools of each one, with a status filter and a search box, and is where a tool is checked out,
 * returned, edited or (by the Owner) deleted.
 */
export default async function ToolsPage({ searchParams }: { searchParams: { category?: string; tool?: string; toolq?: string; wh?: string } }) {
  const user = await getSessionUser();
  if (!user || !canAccess(user.role, user.department, "/inventory", user.customMenus, user.useCustomMenus)) redirect("/attendance");

  const wh = warehouseFromSlug(searchParams.wh);
  const whName = warehouseLabel(wh);
  const whQuery: Record<string, string> = wh === DEFAULT_WAREHOUSE ? {} : { wh: warehouseSlug(wh) };
  const category = toolCategoryFromSlug(searchParams.category);
  const statusFilter = isToolFilter(searchParams.tool) ? searchParams.tool : "all";
  const q = (searchParams.toolq ?? "").trim().slice(0, 80);

  const [everything, projects, pendingTools] = await Promise.all([
    prisma.toolAsset.findMany({ orderBy: { name: "asc" }, include: { currentProject: { select: { name: true } }, _count: { select: { movements: true } } } }),
    prisma.project.findMany({ where: { status: { in: CHARGEABLE_STATUSES } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.toolMovement.findMany({ where: { status: "PENDING" }, select: { toolId: true, type: true, actorId: true } }),
  ]);
  const actorNames = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(pendingTools.map((m) => m.actorId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const pendingByTool = new Map(pendingTools.map((m) => [m.toolId, m]));
  const waitingText = (m: { type: string; actorId: string }) => `${REQUEST_LABEL[m.type] ?? "Request"} requested by ${actorNames.get(m.actorId) ?? "—"} — waiting for approval`;

  const canAddCatalog = canAddInventoryCatalog(user);
  const canMove = canLogInventoryMovement(user);
  const toolWarehouseCounts = countByWarehouse(everything);
  const inWarehouse = everything.filter((t) => t.warehouse === wh);
  const counts = summarizeToolCategories(inWarehouse);
  const rows = inWarehouse.map((t) => ({ ...t, location: t.currentProject?.name ?? warehouseLabel(t.warehouse) }));
  const inCategory = category ? rows.filter((t) => toolCategoryKey(t.category) === category) : rows;
  const statusCounts = toolFilterCounts(inCategory);
  const visible = filterTools(inCategory, statusFilter, q);
  const projectOptions = projects;

  const href = (over: { category?: string | null; tool?: string | null; toolq?: string | null }) => {
    const qs = new URLSearchParams(whQuery);
    const c = over.category === undefined ? searchParams.category : over.category;
    const t = over.tool === undefined ? (statusFilter === "all" ? null : statusFilter) : over.tool;
    const s = over.toolq === undefined ? q : over.toolq;
    if (c) qs.set("category", c);
    if (t) qs.set("tool", t);
    if (s) qs.set("toolq", s);
    return `/inventory/tools${qs.toString() ? `?${qs}` : ""}`;
  };
  const pill = (on: boolean) => `rounded-full border px-3 py-1.5 text-sm font-medium ${on ? "border-[#8a1a28] bg-[#8a1a28] text-white" : "border-ink-200 text-ink-700 hover:bg-ink-100"}`;
  const categoryTab = (slug: string | null, label: string, n: number) => {
    const on = (slug ? toolCategoryFromSlug(slug) : null) === category;
    return (
      <Link key={slug ?? "all"} href={href({ category: slug })} aria-current={on ? "page" : undefined} className={pill(on)}>
        {label} <span className={on ? "text-white/80" : "text-ink-400"}>({n})</span>
      </Link>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/inventory${whQuery.wh ? `?wh=${whQuery.wh}` : ""}#tools`} className="text-sm font-medium text-brand-600 hover:underline">
          ← Inventory
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink-900">Tools &amp; Equipment — {whName}</h1>
        <p className="text-sm text-ink-500">Every tool and piece of equipment kept in the {whName}, by category.</p>
      </div>

      <WarehouseTabs current={wh} counts={toolWarehouseCounts} path="/inventory/tools" params={{ category: searchParams.category && category ? searchParams.category : undefined, tool: statusFilter !== "all" ? statusFilter : undefined, toolq: q || undefined }} noun="tools" />

      <div className="flex flex-wrap items-center gap-2">
        {categoryTab(null, "All", inWarehouse.length)}
        {TOOL_CATEGORIES.map((c) => categoryTab(c.slug, c.label, counts[c.value].tools))}
        {counts[NO_TOOL_CATEGORY].tools > 0 && categoryTab(toolCategorySlug(NO_TOOL_CATEGORY), TOOL_CATEGORY_LABEL[NO_TOOL_CATEGORY], counts[NO_TOOL_CATEGORY].tools)}
      </div>

      <Card>
        <CardHeader title={`${category ? TOOL_CATEGORY_LABEL[category] : "All categories"} (${visible.length}${visible.length !== inCategory.length ? ` of ${inCategory.length}` : ""})`} subtitle="Individually tracked — each unit checked out to a project and returned to its warehouse" />
        <CardBody className="space-y-3 border-b border-ink-100">
          <div className="flex flex-wrap items-center gap-2">
            {TOOL_FILTERS.map((f) => (
              <Link key={f.key} href={href({ tool: f.key === "all" ? null : f.key })} aria-current={statusFilter === f.key ? "true" : undefined} className={pill(statusFilter === f.key)}>
                {f.label} <span className={statusFilter === f.key ? "text-white/80" : "text-ink-400"}>({statusCounts[f.key]})</span>
              </Link>
            ))}
          </div>
          <form method="get" className="flex flex-wrap items-center gap-2">
            {wh !== DEFAULT_WAREHOUSE && <input type="hidden" name="wh" value={warehouseSlug(wh)} />}
            {category && <input type="hidden" name="category" value={searchParams.category} />}
            {statusFilter !== "all" && <input type="hidden" name="tool" value={statusFilter} />}
            <input
              type="search"
              name="toolq"
              defaultValue={q}
              placeholder="Search a tool — name, tag or location…"
              aria-label="Search tools"
              className="min-h-[40px] w-full max-w-sm rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-[#8a1a28] focus:outline-none"
            />
            <button type="submit" className="min-h-[40px] rounded-lg bg-[#8a1a28] px-4 text-sm font-semibold text-white hover:bg-[#741522]">
              Search
            </button>
            {q && (
              <Link href={href({ toolq: null })} className="text-sm text-ink-500 hover:underline">
                Clear
              </Link>
            )}
          </form>
        </CardBody>
        <Table>
          <thead>
            <tr>
              <Th sticky>Tool</Th>
              <Th className="hidden sm:table-cell">Tag</Th>
              {!category && <Th>Category</Th>}
              <Th>Status</Th>
              <Th>Condition</Th>
              <Th>Location</Th>
              {canMove && <Th>Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr key={t.id}>
                <Td sticky className="min-w-[7rem] max-w-[9.5rem] font-medium sm:max-w-none">
                  {t.name}
                  {t.assetTag && <div className="text-xs font-semibold text-ink-500 sm:hidden">{t.assetTag}</div>}
                </Td>
                <Td className="hidden text-ink-500 sm:table-cell">{t.assetTag ?? "—"}</Td>
                {!category && <Td className="text-ink-500">{TOOL_CATEGORY_LABEL[toolCategoryKey(t.category)]}</Td>}
                <Td>
                  <Badge value={t.status} />
                  {t.condition && <div className="mt-0.5 text-[11px] text-ink-400">{t.condition}</div>}
                </Td>
                <Td>{canMove ? <ToolConditionControl toolId={t.id} value={t.workingStatus} /> : <Badge value={t.workingStatus} label={TOOL_CONDITION_LABEL[t.workingStatus]} />}</Td>
                <Td className="text-ink-600">{t.currentProject?.name ?? warehouseLabel(t.warehouse)}</Td>
                {canMove && (
                  <Td>
                    <div className="flex flex-wrap items-center gap-3">
                      <ToolActions toolId={t.id} status={t.status} currentProjectId={t.currentProjectId} projects={projectOptions} pending={pendingByTool.get(t.id) ? waitingText(pendingByTool.get(t.id)!) : undefined} />
                      {canAddCatalog && <EditToolButton id={t.id} name={t.name} assetTag={t.assetTag} category={t.category} warehouse={t.warehouse} />}
                      {canDeleteTool(user, t._count.movements) && <DeleteToolButton toolId={t.id} name={t.name} movements={t._count.movements} />}
                    </div>
                  </Td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <Td colSpan={canMove ? 7 : 6} className="py-8 text-center text-ink-400">
                  {inWarehouse.length === 0 ? `No tools are kept in the ${whName} yet.` : q || statusFilter !== "all" ? "No tools match — try another filter or fewer words." : "No tools in this category yet."}
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
