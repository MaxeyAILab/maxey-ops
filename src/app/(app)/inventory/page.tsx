import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDateTime, labelize } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui";
import { AddItemForm, MovementForm, ProjectMaterialQuickActions } from "@/components/inventory-forms";
import { AddToolForm, ToolActions } from "@/components/tool-forms";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";

export const metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const user = await getSessionUser();
  // Drivers no longer have inventory access (owner's rule)
  if (!user || !["FOREMAN", "PM", "OWNER", "PURCHASING", "ACCOUNTING"].includes(user.role)) {
    redirect("/attendance");
  }

  const [items, movements, projects, tools, toolMovements] = await Promise.all([
    prisma.warehouseItem.findMany({ orderBy: { name: "asc" } }),
    prisma.inventoryMovement.findMany({
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
          include: { item: { select: { id: true, name: true, unit: true } } },
        },
        toolAssets: true,
      },
    }),
    prisma.toolAsset.findMany({
      orderBy: { name: "asc" },
      include: { currentProject: { select: { name: true } } },
    }),
    prisma.toolMovement.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        tool: { select: { name: true } },
        fromProject: { select: { name: true } },
        toProject: { select: { name: true } },
      },
    }),
  ]);

  const actorIds = [...new Set([...movements.map((m) => m.actorId), ...toolMovements.map((m) => m.actorId)])];
  const actorNames = new Map(
    (await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map(
      (u) => [u.id, u.name]
    )
  );

  const canAddCatalog = ["PURCHASING", "OWNER", "PM"].includes(user.role);
  const canMove = ["FOREMAN", "PM", "OWNER", "PURCHASING"].includes(user.role);
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-ink-900">Inventory</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={`Warehouse stock (${items.length})`} subtitle="Real-time levels" />
          <Table>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th className="text-right">Qty</Th>
                <Th>Unit</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className={Number(i.currentQty) === 0 ? "opacity-50" : ""}>
                  <Td className="font-medium">{i.name}</Td>
                  <Td
                    className={`text-right tabular-nums ${Number(i.currentQty) === 0 ? "text-red-600" : ""}`}
                  >
                    {Number(i.currentQty)}
                  </Td>
                  <Td>{i.unit}</Td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <Td colSpan={3} className="py-6 text-center text-ink-400">
                    No stock items yet.
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
          {canAddCatalog && (
            <CardBody className="border-t border-ink-100">
              <AddItemForm />
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Log a movement"
            subtitle="Issue to a project, return, transfer, or log usage — works offline"
          />
          <CardBody>
            {canMove ? (
              items.length > 0 && projectOptions.length > 0 ? (
                <MovementForm items={items} projects={projectOptions} />
              ) : (
                <p className="text-sm text-ink-400">Add a stock item and an active project first.</p>
              )
            ) : (
              <p className="text-sm text-ink-400">View-only for your role.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={`Tools & Equipment (${tools.length})`}
          subtitle="Individually tracked — each unit checked out to a project and returned to the warehouse"
        />
        <Table>
          <thead>
            <tr>
              <Th>Tool</Th>
              <Th>Tag</Th>
              <Th>Category</Th>
              <Th>Status</Th>
              <Th>Location</Th>
              {canMove && <Th>Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.name}</Td>
                <Td className="text-ink-500">{t.assetTag ?? "—"}</Td>
                <Td className="text-ink-500">{t.category ?? "—"}</Td>
                <Td>
                  <Badge value={t.status} />
                  {t.condition && <div className="mt-0.5 text-[11px] text-ink-400">{t.condition}</div>}
                </Td>
                <Td className="text-ink-600">{t.currentProject?.name ?? "Warehouse"}</Td>
                {canMove && (
                  <Td>
                    <ToolActions
                      toolId={t.id}
                      status={t.status}
                      currentProjectId={t.currentProjectId}
                      projects={projectOptions}
                    />
                  </Td>
                )}
              </tr>
            ))}
            {tools.length === 0 && (
              <tr>
                <Td colSpan={canMove ? 6 : 5} className="py-6 text-center text-ink-400">
                  No tools registered yet.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
        {canAddCatalog && (
          <CardBody className="border-t border-ink-100">
            <AddToolForm />
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
                        <Th>Item</Th>
                        <Th className="text-right">Qty on site</Th>
                        <Th>Unit</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.materialStocks.map((s) => (
                        <tr key={s.id}>
                          <Td className="font-medium">{s.item.name}</Td>
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
                    }))}
                    otherProjects={otherProjects}
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
                          <Badge value={t.status} />
                        </div>
                        {canMove && (
                          <ToolActions
                            toolId={t.id}
                            status={t.status}
                            currentProjectId={t.currentProjectId}
                            projects={projectOptions}
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
        <CardHeader title="Material movement log" subtitle="Every movement, with actor and timestamp" />
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Type</Th>
              <Th>Item</Th>
              <Th className="text-right">Qty</Th>
              <Th>From → To</Th>
              <Th>By</Th>
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
                <Td className="text-xs">{actorNames.get(m.actorId) ?? "—"}</Td>
              </tr>
            ))}
            {movements.length === 0 && (
              <tr>
                <Td colSpan={6} className="py-6 text-center text-ink-400">
                  No movements logged yet.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="Tool movement log" subtitle="Checkouts, returns, transfers, and condition flags" />
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Tool</Th>
              <Th>Action</Th>
              <Th>From → To</Th>
              <Th>By</Th>
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
                  {m.fromProject?.name ?? "Warehouse"} → {m.toProject?.name ?? "Warehouse"}
                </Td>
                <Td className="text-xs">{actorNames.get(m.actorId) ?? "—"}</Td>
              </tr>
            ))}
            {toolMovements.length === 0 && (
              <tr>
                <Td colSpan={5} className="py-6 text-center text-ink-400">
                  No tool movements logged yet.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
