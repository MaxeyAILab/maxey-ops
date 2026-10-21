import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccess, canAddInventoryCatalog } from "@/lib/access";
import { Card, CardHeader, Table, Td, Th } from "@/components/ui";
import { DeleteStockItemButton } from "@/components/inventory-requests-ui";
import { EditStockItemButton } from "@/components/inventory-edit";
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABEL, categoryFromSlug, isMaterialCategory, summarizeByCategory } from "@/lib/material-category";

export const metadata = { title: "Warehouse stock" };
export const dynamic = "force-dynamic";

/**
 * The items of the warehouse stock, by category. The Inventory tab shows only the four categories; this page lists what is in
 * each one, with a search box, and is where an item is edited or (by the Owner) deleted.
 */
export default async function WarehouseStockPage({ searchParams }: { searchParams: { category?: string; q?: string } }) {
  const user = await getSessionUser();
  if (!user || !canAccess(user.role, user.department, "/inventory", user.customMenus, user.useCustomMenus)) redirect("/attendance");

  const category = categoryFromSlug(searchParams.category);
  const q = (searchParams.q ?? "").trim().slice(0, 80);
  const canEdit = canAddInventoryCatalog(user);
  const isOwner = user.role === "OWNER";

  const all = await prisma.warehouseItem.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { movements: true } }, projectStocks: { select: { qty: true } } },
  });
  const counts = summarizeByCategory(all);
  const needle = q.toLowerCase();
  const items = all.filter((i) => (!category || i.category === category) && (!needle || i.name.toLowerCase().includes(needle)));

  const tab = (slug: string | null, label: string, n: number) => {
    const on = (slug ? categoryFromSlug(slug) : null) === category;
    const qs = new URLSearchParams();
    if (slug) qs.set("category", slug);
    if (q) qs.set("q", q);
    return (
      <Link
        key={slug ?? "all"}
        href={`/inventory/stock${qs.toString() ? `?${qs}` : ""}`}
        aria-current={on ? "page" : undefined}
        className={`rounded-full border px-3 py-1.5 text-sm font-medium ${on ? "border-[#8a1a28] bg-[#8a1a28] text-white" : "border-ink-200 text-ink-700 hover:bg-ink-100"}`}
      >
        {label} <span className={on ? "text-white/80" : "text-ink-400"}>({n})</span>
      </Link>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <Link href="/inventory" className="text-sm font-medium text-brand-600 hover:underline">
          ← Inventory
        </Link>
        <h1 className="mt-1 text-xl font-bold text-ink-900">Warehouse stock</h1>
        <p className="text-sm text-ink-500">Every material in the warehouse, by category.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tab(null, "All", all.length)}
        {MATERIAL_CATEGORIES.map((c) => tab(c.slug, c.label, counts[c.value].items))}
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2">
        {category && <input type="hidden" name="category" value={searchParams.category} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search an item…"
          aria-label="Search an item"
          className="min-h-[40px] w-full max-w-xs rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-[#8a1a28] focus:outline-none"
        />
        <button type="submit" className="min-h-[40px] rounded-lg bg-[#8a1a28] px-4 text-sm font-semibold text-white hover:bg-[#741522]">
          Search
        </button>
        {q && (
          <Link href={`/inventory/stock${category ? `?category=${searchParams.category}` : ""}`} className="text-sm text-ink-500 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <Card>
        <CardHeader title={`${category ? MATERIAL_CATEGORY_LABEL[category] : "All categories"} (${items.length})`} subtitle="Real-time levels" />
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              {!category && <Th>Category</Th>}
              <Th className="text-right">Qty</Th>
              <Th>Unit</Th>
              {(canEdit || isOwner) && <Th />}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const cat = isMaterialCategory(i.category) ? i.category : "OTHERS";
              return (
                <tr key={i.id} className={Number(i.currentQty) === 0 ? "opacity-60" : ""}>
                  <Td className="font-medium">{i.name}</Td>
                  {!category && <Td className="text-ink-500">{MATERIAL_CATEGORY_LABEL[cat]}</Td>}
                  <Td className={`text-right tabular-nums ${Number(i.currentQty) === 0 ? "text-red-600" : ""}`}>{Number(i.currentQty)}</Td>
                  <Td>{i.unit}</Td>
                  {(canEdit || isOwner) && (
                    <Td className="text-right">
                      <span className="inline-flex items-center gap-3">
                        {canEdit && <EditStockItemButton id={i.id} name={i.name} unit={i.unit} category={cat} qty={Number(i.currentQty)} />}
                        {isOwner && (
                          <DeleteStockItemButton
                            id={i.id}
                            name={i.name}
                            movements={i._count.movements}
                            warehouseQty={Number(i.currentQty)}
                            onSiteTotal={i.projectStocks.reduce((sum, st) => sum + Math.max(0, Number(st.qty)), 0)}
                          />
                        )}
                      </span>
                    </Td>
                  )}
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <Td colSpan={5} className="py-8 text-center text-ink-400">
                  {q ? `Nothing matches “${q}”.` : "No items in this category yet."}
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
