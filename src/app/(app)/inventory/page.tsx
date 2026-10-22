import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDateTime, labelize } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui";
import { AddItemForm, MovementForm, ProjectMaterialQuickActions } from "@/components/inventory-forms";
import { AddToolForm, DeleteToolButton, ToolActions, ToolConditionControl } from "@/components/tool-forms";
import { TOOL_CONDITION_LABEL } from "@/lib/tool-condition";
import { TOOL_FILTERS, filterTools, isToolFilter, toolFilterCounts } from "@/lib/tool-filter";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";
import { canAccess, canAddInventoryCatalog, canApproveInventoryRequest, canDeleteTool, canLogInventoryMovement, canSeeStockPrices } from "@/lib/access";
import { issuedFromWarehouse, lineValue, summarizeValue } from "@/lib/warehouse-value";
import { php } from "@/lib/format";
import { manilaDayKey } from "@/lib/time-rules";
import { RequestDecision } from "@/components/inventory-requests-ui";
import { EditToolButton } from "@/components/inventory-edit";
import { MATERIAL_CATEGORIES, summarizeByCategory } from "@/lib/material-category";
import { REQUEST_LABEL, decisionText } from "@/lib/inventory-labels";
import { WarehouseTabs } from "@/components/warehouse-tabs";
import { RequestPhotos } from "@/components/request-photos-ui";
import { PhotoThumbnails } from "@/components/photo-viewer";
import { photoList } from "@/lib/request-photos";
import { DEFAULT_WAREHOUSE, countByWarehouse, warehouseFromSlug, warehouseLabel, warehouseSlug } from "@/lib/warehouses";

export const metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

export default async function InventoryPage({ searchParams }: { searchParams: { tool?: string; toolq?: string; wh?: string } }) {
  const user = await getSessionUser();
  // Drivers don't have the tab by default (owner's rule) unless it is ticked on their account; with it they can log movements.
  if (!user || !canAccess(user.role, user.department, "/inventory", user.customMenus, user.useCustomMenus)) {
    redirect("/attendance");
  }

  // The four warehouses are tabs on this page: the one chosen (?wh=alua) decides which stock, tools and logs are shown.
  const wh = warehouseFromSlug(searchParams.wh);
  const whName = warehouseLabel(wh);

  const [allItems, movements, projects, allTools, toolMovements, pendingStock, pendingTools, myRecent, issuedRows] = await Promise.all([
    prisma.warehouseItem.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { movements: true } }, projectStocks: { select: { qty: true } } },
    }),
    prisma.inventoryMovement.findMany({
      where: { item: { warehouse: wh } },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { item: { select: { name: true, unit: true } } },
    }),
    prisma.project.findMany({
      where: { status: { in: CHARGEABLE_STATUSES } },
      orderBy: { name: "asc" },
      include: {
        materialStocks: {
          where: { qty: { gt: 0 } },
          include: { item: { select: { id: true, name: true, unit: true, category: true, warehouse: true } } },
        },
        toolAssets: true,
      },
    }),
    prisma.toolAsset.findMany({
      orderBy: { name: "asc" },
      include: { currentProject: { select: { name: true } }, _count: { select: { movements: true } } },
    }),
    prisma.toolMovement.findMany({
      where: { tool: { warehouse: wh } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        tool: { select: { name: true, warehouse: true } },
        fromProject: { select: { name: true } },
        toProject: { select: { name: true } },
      },
    }),
    // requests waiting for office staff (every one, however old)
    prisma.inventoryMovement.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, include: { item: { select: { name: true, unit: true, warehouse: true } } } }),
    prisma.toolMovement.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { tool: { select: { name: true, assetTag: true, warehouse: true } }, fromProject: { select: { name: true } }, toProject: { select: { name: true } } },
    }),
    // the items this person logged most recently (offered first in the item picker)
    prisma.inventoryMovement.findMany({ where: { actorId: user.id }, orderBy: { createdAt: "desc" }, take: 60, select: { itemId: true } }),
    // every applied issue out of the warehouse, for the "taken out" totals (only read when the person may see prices)
    canSeeStockPrices(user)
      ? prisma.inventoryMovement.findMany({ where: { type: "WAREHOUSE_TO_SITE", status: "APPLIED", item: { warehouse: wh } }, select: { type: true, status: true, qty: true, unitPrice: true, createdAt: true } })
      : Promise.resolve([]),
  ]);

  const actorIds = [...new Set([...movements, ...toolMovements, ...pendingStock, ...pendingTools].map((m) => m.actorId))];
  const actorNames = new Map(
    (await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map(
      (u) => [u.id, u.name]
    )
  );

  const items = allItems.filter((i) => i.warehouse === wh);
  const tools = allTools.filter((t) => t.warehouse === wh);
  const itemCounts = countByWarehouse(allItems);
  const toolWarehouseCounts = countByWarehouse(allTools);

  const canAddCatalog = canAddInventoryCatalog(user);
  const canMove = canLogInventoryMovement(user);
  const canApprove = canApproveInventoryRequest(user);
  const isOwner = user.role === "OWNER";
  const pendingByTool = new Map(pendingTools.map((m) => [m.toolId, m]));
  const waitingText = (m: { type: string; actorId: string }) => `${REQUEST_LABEL[m.type] ?? "Request"} requested by ${actorNames.get(m.actorId) ?? "—"} — waiting for approval`;
  const pendingCount = pendingStock.length + pendingTools.length;
  // every photo of a movement: the ones sent with a return/transfer request, and a tool's damage/condition photo
  const shots = (m: { photos: unknown; photoUrl?: string | null }) => [...photoList(m.photos), ...(m.photoUrl ? [m.photoUrl] : [])];
  const categoryCounts = summarizeByCategory(items);
  const showPrices = canSeeStockPrices(user);
  const stockValue = summarizeValue(items);
  const allWarehousesValue = summarizeValue(allItems);
  const issued = issuedFromWarehouse(issuedRows, new Date(`${manilaDayKey(new Date()).slice(0, 7)}-01T00:00:00+08:00`));
  const recentIds = [...new Set(myRecent.map((m) => m.itemId))].slice(0, 8);
  const pickerItems = items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, category: i.category, qty: Number(i.currentQty), price: showPrices && i.unitPrice !== null ? Number(i.unitPrice) : null }));

  // tools: narrow by where it is / needs attention, and by typing
  const toolFilter = isToolFilter(searchParams.tool) ? searchParams.tool : "all";
  const toolQuery = (searchParams.toolq ?? "").trim().slice(0, 80);
  const toolRows = tools.map((t) => ({ ...t, location: t.currentProject?.name ?? warehouseLabel(t.warehouse) }));
  const toolCounts = toolFilterCounts(toolRows);
  const visibleTools = filterTools(toolRows, toolFilter, toolQuery);
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));
  const whQuery: Record<string, string> = wh === DEFAULT_WAREHOUSE ? {} : { wh: warehouseSlug(wh) };
  const clearToolSearch = new URLSearchParams({ ...whQuery, ...(toolFilter !== "all" ? { tool: toolFilter } : {}) });
  const stockHref = (category?: string) => {
    const qs = new URLSearchParams({ ...(category ? { category } : {}), ...whQuery });
    return `/inventory/stock${qs.toString() ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-ink-900">Inventory</h1>

      {pendingCount > 0 && (
        <Card className="border-amber-300">
          <CardHeader
            title={`Requests waiting for approval (${pendingCount})`}
            subtitle="Returns to the warehouse and transfers between projects only take effect once office staff approve them"
          />
          <CardBody className="space-y-2">
            {pendingStock.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-100 p-3 text-sm">
                <div>
                  <div className="font-medium text-ink-900">
                    {REQUEST_LABEL[m.type]} · {Number(m.qty)} {m.item.unit} {m.item.name}
                    <span className="ml-1.5 rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-600">{warehouseLabel(m.item.warehouse)}</span>
                  </div>
                  <div className="text-xs text-ink-500">
                    {m.fromLoc} → {m.toLoc} · requested by <b>{actorNames.get(m.actorId) ?? "—"}</b> · {fmtDateTime(m.createdAt)}
                    {m.note ? ` · ${m.note}` : ""}
                  </div>
                  <RequestPhotos kind="stock" id={m.id} photos={photoList(m.photos)} label={fmtDateTime(m.createdAt)} canAdd={m.actorId === user.id || canApprove} />
                </div>
                <RequestDecision kind="stock" id={m.id} canDecide={canApprove && (isOwner || m.actorId !== user.id)} mine={m.actorId === user.id} />
              </div>
            ))}
            {pendingTools.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-100 p-3 text-sm">
                <div>
                  <div className="font-medium text-ink-900">
                    {REQUEST_LABEL[m.type]} · {m.tool.name}
                    {m.tool.assetTag ? ` (${m.tool.assetTag})` : ""}
                    <span className="ml-1.5 rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-600">{warehouseLabel(m.tool.warehouse)}</span>
                  </div>
                  <div className="text-xs text-ink-500">
                    {m.fromProject?.name ?? warehouseLabel(m.tool.warehouse)} → {m.toProject?.name ?? warehouseLabel(m.tool.warehouse)} · requested by <b>{actorNames.get(m.actorId) ?? "—"}</b> · {fmtDateTime(m.createdAt)}
                  </div>
                  <RequestPhotos kind="tool" id={m.id} photos={photoList(m.photos)} label={fmtDateTime(m.createdAt)} canAdd={m.actorId === user.id || canApprove} />
                </div>
                <RequestDecision kind="tool" id={m.id} canDecide={canApprove && (isOwner || m.actorId !== user.id)} mine={m.actorId === user.id} />
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={`Warehouse stock (${items.length})`}
            subtitle={
              showPrices
                ? `${whName} — total value ${php(stockValue.total)}${stockValue.unpriced > 0 ? ` (${stockValue.unpriced} item${stockValue.unpriced === 1 ? "" : "s"} without a price)` : ""}`
                : `${whName} — open a category to see its items`
            }
            action={
              <Link href={stockHref()} className="text-sm font-medium text-brand-600 hover:underline">
                View all items →
              </Link>
            }
          />
          <CardBody className="space-y-1.5 border-b border-ink-100 pb-3">
            <WarehouseTabs current={wh} counts={itemCounts} path="/inventory" params={{ tool: toolFilter !== "all" ? toolFilter : undefined, toolq: toolQuery || undefined }} noun="items" />
            {showPrices && (
              <p className="text-xs text-ink-500">
                All four warehouses together: <b className="tabular-nums text-ink-700">{php(allWarehousesValue.total)}</b>
                {allWarehousesValue.unpriced > 0 ? ` (${allWarehousesValue.unpriced} item${allWarehousesValue.unpriced === 1 ? "" : "s"} without a price)` : ""}
              </p>
            )}
          </CardBody>
          <CardBody>
            {items.length === 0 && (
              <p className="mb-3 rounded-lg border border-dashed border-ink-200 px-3 py-2 text-sm text-ink-500">
                Nothing is kept in the {whName} yet.{canAddCatalog ? " Add its first item below." : ""}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {MATERIAL_CATEGORIES.map((c) => (
                <Link
                  key={c.value}
                  href={stockHref(c.slug)}
                  className="group rounded-xl border border-ink-200 p-4 transition hover:border-[#8a1a28] hover:bg-ink-100/50"
                >
                  <div className="flex items-start gap-3">
                    <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-xl">
                      {c.icon}
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold text-ink-900">{c.label}</div>
                      <div className="text-sm text-ink-600">
                        {categoryCounts[c.value].items} item{categoryCounts[c.value].items === 1 ? "" : "s"}
                      </div>
                      {showPrices && <div className="text-sm font-semibold tabular-nums text-ink-900">{php(stockValue.byCategory[c.value].value)}</div>}
                      {categoryCounts[c.value].outOfStock > 0 && <div className="text-xs font-medium text-red-600">{categoryCounts[c.value].outOfStock} out of stock</div>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardBody>
          {canAddCatalog && (
            <CardBody className="border-t border-ink-100">
              <AddItemForm withPrice={showPrices} warehouse={wh} />
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Log a movement"
            subtitle={`From and back to the ${whName} — issue to a project, return, transfer, or log usage. Works offline`}
          />
          <CardBody>
            {canMove ? (
              items.length > 0 && projectOptions.length > 0 ? (
                <MovementForm key={wh} warehouseName={whName} items={pickerItems} projects={projectOptions} recentIds={recentIds} instant={isOwner} showValue={showPrices} />
              ) : (
                <p className="text-sm text-ink-400">Add a stock item to the {whName} and have an active project first.</p>
              )
            ) : (
              <p className="text-sm text-ink-400">View-only for your role.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card id="tools" className="scroll-mt-16">
        <CardHeader
          title={`Tools & Equipment (${toolFilter === "all" && !toolQuery ? tools.length : `${visibleTools.length} of ${tools.length}`})`}
          subtitle={`${whName} — individually tracked, each unit checked out to a project and returned to its warehouse`}
        />
        <CardBody className="space-y-3 border-b border-ink-100">
          <WarehouseTabs current={wh} counts={toolWarehouseCounts} path="/inventory" params={{ tool: toolFilter !== "all" ? toolFilter : undefined, toolq: toolQuery || undefined }} noun="tools" />
          <div className="flex flex-wrap items-center gap-2">
            {TOOL_FILTERS.map((f) => {
              const qs = new URLSearchParams(whQuery);
              if (f.key !== "all") qs.set("tool", f.key);
              if (toolQuery) qs.set("toolq", toolQuery);
              const on = toolFilter === f.key;
              return (
                <Link
                  key={f.key}
                  href={`/inventory${qs.toString() ? `?${qs}` : ""}#tools`}
                  aria-current={on ? "true" : undefined}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium ${on ? "border-[#8a1a28] bg-[#8a1a28] text-white" : "border-ink-200 text-ink-700 hover:bg-ink-100"}`}
                >
                  {f.label} <span className={on ? "text-white/80" : "text-ink-400"}>({toolCounts[f.key]})</span>
                </Link>
              );
            })}
          </div>
          <form method="get" action="/inventory#tools" className="flex flex-wrap items-center gap-2">
            {wh !== DEFAULT_WAREHOUSE && <input type="hidden" name="wh" value={warehouseSlug(wh)} />}
            {toolFilter !== "all" && <input type="hidden" name="tool" value={toolFilter} />}
            <input
              type="search"
              name="toolq"
              defaultValue={toolQuery}
              placeholder="Search a tool — name, tag, category or location…"
              aria-label="Search tools"
              className="min-h-[40px] w-full max-w-sm rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-[#8a1a28] focus:outline-none"
            />
            <button type="submit" className="min-h-[40px] rounded-lg bg-[#8a1a28] px-4 text-sm font-semibold text-white hover:bg-[#741522]">
              Search
            </button>
            {toolQuery && (
              <Link href={`/inventory${clearToolSearch.toString() ? `?${clearToolSearch}` : ""}#tools`} className="text-sm text-ink-500 hover:underline">
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
              <Th>Category</Th>
              <Th>Status</Th>
              <Th>Condition</Th>
              <Th>Location</Th>
              {canMove && <Th>Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {visibleTools.map((t) => (
              <tr key={t.id}>
                <Td sticky className="min-w-[7rem] max-w-[9.5rem] font-medium sm:max-w-none">
                  {t.name}
                  {t.assetTag && <div className="text-xs font-semibold text-ink-500 sm:hidden">{t.assetTag}</div>}
                </Td>
                <Td className="hidden text-ink-500 sm:table-cell">{t.assetTag ?? "—"}</Td>
                <Td className="text-ink-500">{t.category ?? "—"}</Td>
                <Td>
                  <Badge value={t.status} />
                  {t.condition && <div className="mt-0.5 text-[11px] text-ink-400">{t.condition}</div>}
                </Td>
                <Td>{canMove ? <ToolConditionControl toolId={t.id} value={t.workingStatus} /> : <Badge value={t.workingStatus} label={TOOL_CONDITION_LABEL[t.workingStatus]} />}</Td>
                <Td className="text-ink-600">{t.currentProject?.name ?? warehouseLabel(t.warehouse)}</Td>
                {canMove && (
                  <Td>
                    <div className="flex flex-wrap items-center gap-3">
                      <ToolActions
                        toolId={t.id}
                        status={t.status}
                        currentProjectId={t.currentProjectId}
                        projects={projectOptions}
                        pending={pendingByTool.get(t.id) ? waitingText(pendingByTool.get(t.id)!) : undefined}
                      />
                      {canAddCatalog && <EditToolButton id={t.id} name={t.name} assetTag={t.assetTag} category={t.category} warehouse={t.warehouse} />}
                      {canDeleteTool(user, t._count.movements) && <DeleteToolButton toolId={t.id} name={t.name} movements={t._count.movements} />}
                    </div>
                  </Td>
                )}
              </tr>
            ))}
            {visibleTools.length === 0 && (
              <tr>
                <Td colSpan={canMove ? 7 : 6} className="py-6 text-center text-ink-400">
                  {tools.length === 0 ? `No tools are kept in the ${whName} yet.` : "No tools match — try another filter or fewer words."}
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
        {canAddCatalog && (
          <CardBody className="border-t border-ink-100">
            <AddToolForm warehouse={wh} />
          </CardBody>
        )}
      </Card>

      {/* Per-project on-site inventory */}
      {projects.map((p) => {
        const otherProjects = projectOptions.filter((x) => x.id !== p.id);
        return (
          <Card key={p.id}>
            <CardHeader
              title={`On-site inventory — ${p.name}`}
              subtitle={`${p.materialStocks.length} material(s) · ${p.toolAssets.length} tool(s) on site`}
            />
            <CardBody className="space-y-5">
              <div>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Materials on site</h4>
                {p.materialStocks.length > 0 ? (
                  <Table>
                    <thead>
                      <tr>
                        <Th sticky>Item</Th>
                        <Th className="text-right">Qty on site</Th>
                        <Th>Unit</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.materialStocks.map((s) => (
                        <tr key={s.id}>
                          <Td sticky className="font-medium">
                            {s.item.name}
                            {s.item.warehouse !== DEFAULT_WAREHOUSE && <span className="ml-1.5 rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-600">{warehouseLabel(s.item.warehouse)}</span>}
                          </Td>
                          <Td className="text-right tabular-nums">{Number(s.qty)}</Td>
                          <Td>{s.item.unit}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <p className="text-sm text-ink-400">Nothing issued to this project yet.</p>
                )}
                {canMove && p.materialStocks.length > 0 && (
                  <ProjectMaterialQuickActions
                    projectId={p.id}
                    stocks={p.materialStocks.map((s) => ({
                      itemId: s.itemId,
                      name: s.item.name,
                      unit: s.item.unit,
                      qty: Number(s.qty),
                      category: s.item.category,
                    }))}
                    otherProjects={otherProjects}
                    instant={isOwner}
                  />
                )}
              </div>

              <div className="border-t border-ink-100 pt-4">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Tools on site</h4>
                {p.toolAssets.length > 0 ? (
                  <ul className="space-y-2">
                    {p.toolAssets.map((t) => (
                      <li
                        key={t.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-100 p-2 text-sm"
                      >
                        <div>
                          <span className="font-medium text-ink-800">{t.name}</span>
                          {t.assetTag && <span className="ml-1 text-xs text-ink-400">({t.assetTag})</span>}
                          {t.warehouse !== DEFAULT_WAREHOUSE && <span className="ml-1.5 rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-600">{warehouseLabel(t.warehouse)}</span>}
                          <Badge value={t.status} />
                          {t.workingStatus !== "WORKING" && <Badge value={t.workingStatus} label={TOOL_CONDITION_LABEL[t.workingStatus]} />}
                        </div>
                        {canMove && (
                          <ToolActions
                            toolId={t.id}
                            status={t.status}
                            currentProjectId={t.currentProjectId}
                            projects={projectOptions}
                            pending={pendingByTool.get(t.id) ? waitingText(pendingByTool.get(t.id)!) : undefined}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-400">No tools checked out to this project.</p>
                )}
              </div>
            </CardBody>
          </Card>
        );
      })}

      <Card>
        <CardHeader title="Material movement log" subtitle={`${whName} — every movement, with actor and timestamp`} />
        {showPrices && (
          <CardBody className="border-b border-ink-100">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-ink-100 px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-ink-500">Taken out of the {whName} this month</div>
                <div className="text-xl font-bold tabular-nums text-ink-900">{php(issued.monthValue)}</div>
                <div className="text-xs text-ink-500">{issued.monthCount} issue{issued.monthCount === 1 ? "" : "s"} to project sites from the {whName}</div>
              </div>
              <div className="rounded-lg bg-ink-100 px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-ink-500">Taken out, all logged so far</div>
                <div className="text-xl font-bold tabular-nums text-ink-900">{php(issued.allValue)}</div>
                <div className="text-xs text-ink-500">
                  {issued.allCount} issue{issued.allCount === 1 ? "" : "s"}
                  {issued.unpriced > 0 ? ` · ${issued.unpriced} had no price (not counted)` : ""}
                </div>
              </div>
            </div>
          </CardBody>
        )}
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Type</Th>
              <Th>Item</Th>
              <Th className="text-right">Qty</Th>
              <Th>From → To</Th>
              {showPrices && <Th className="text-right">Value</Th>}
              <Th>Requested / logged by</Th>
              <Th>Approval</Th>
              <Th>Photos</Th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id}>
                <Td className="text-xs">{fmtDateTime(m.createdAt)}</Td>
                <Td className="text-xs">{labelize(m.type)}</Td>
                <Td>{m.item.name}</Td>
                <Td className="text-right tabular-nums">
                  {Number(m.qty)} {m.item.unit}
                </Td>
                <Td className="text-xs">
                  {m.fromLoc} → {m.toLoc}
                </Td>
                {showPrices && <Td className="text-right text-xs tabular-nums">{lineValue(m.qty, m.unitPrice) === null ? "—" : php(lineValue(m.qty, m.unitPrice) ?? 0)}</Td>}
                <Td className="text-xs">{actorNames.get(m.actorId) ?? "—"}</Td>
                <Td className="text-xs">{decisionText(m, fmtDateTime) ?? "—"}</Td>
                <Td>{shots(m).length > 0 ? <PhotoThumbnails photos={shots(m).map((src) => ({ src, label: fmtDateTime(m.createdAt) }))} /> : <span className="text-xs text-ink-400">—</span>}</Td>
              </tr>
            ))}
            {movements.length === 0 && (
              <tr>
                <Td colSpan={showPrices ? 9 : 8} className="py-6 text-center text-ink-400">
                  No movements logged for the {whName} yet.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="Tool movement log" subtitle={`${whName} — checkouts, returns, transfers, and condition flags`} />
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Tool</Th>
              <Th>Action</Th>
              <Th>From → To</Th>
              <Th>Requested / logged by</Th>
              <Th>Approval</Th>
              <Th>Photos</Th>
            </tr>
          </thead>
          <tbody>
            {toolMovements.map((m) => (
              <tr key={m.id}>
                <Td className="text-xs">{fmtDateTime(m.createdAt)}</Td>
                <Td>{m.tool.name}</Td>
                <Td className="text-xs">
                  {labelize(m.type)}
                  {m.condition && <div className="text-[11px] text-ink-400">{m.condition}</div>}
                </Td>
                <Td className="text-xs">
                  {m.fromProject?.name ?? warehouseLabel(m.tool.warehouse)} → {m.toProject?.name ?? warehouseLabel(m.tool.warehouse)}
                </Td>
                <Td className="text-xs">{actorNames.get(m.actorId) ?? "—"}</Td>
                <Td className="text-xs">{decisionText(m, fmtDateTime) ?? "—"}</Td>
                <Td>{shots(m).length > 0 ? <PhotoThumbnails photos={shots(m).map((src) => ({ src, label: fmtDateTime(m.createdAt) }))} /> : <span className="text-xs text-ink-400">—</span>}</Td>
              </tr>
            ))}
            {toolMovements.length === 0 && (
              <tr>
                <Td colSpan={7} className="py-6 text-center text-ink-400">
                  No tool movements logged for the {whName} yet.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
