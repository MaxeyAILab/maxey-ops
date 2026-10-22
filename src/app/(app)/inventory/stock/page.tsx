import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccess, canAddInventoryCatalog, canSeeStockPrices } from "@/lib/access";
import { php } from "@/lib/format";
import { PriceEditor } from "@/components/price-editor";
import { lineValue, summarizeValue } from "@/lib/warehouse-value";
import { Card, CardHeader, Table, Td, Th } from "@/components/ui";
import { DeleteStockItemButton } from "@/components/inventory-requests-ui";
import { EditStockItemButton } from "@/components/inventory-edit";
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABEL, categoryFromSlug, isMaterialCategory, summarizeByCategory } from "@/lib/material-category";
import { WarehouseTabs } from "@/components/warehouse-tabs";
import { DEFAULT_WAREHOUSE, countByWarehouse, warehouseFromSlug, warehouseLabel, warehouseSlug } from "@/lib/warehouses";

export const metadata = { title: "Warehouse stock" };
export const dynamic = "force-dynamic";

/**
 * The items of one warehouse (chosen with the tabs), by category. The Inventory tab shows only the four categories; this page lists what is in
 * each one, with a search box, and is where an item is edited or (by the Owner) deleted.
 */
export default async function WarehouseStockPage({ searchParams }: { searchParams: { category?: string; q?: string; edit?: string; wh?: string } }) {
  const user = await getSessionUser();
  if (!user || !canAccess(user.role, user.department, "/inventory", user.customMenus, user.useCustomMenus)) redirect("/attendance");

  const category = categoryFromSlug(searchParams.category);
  const q = (searchParams.q ?? "").trim().slice(0, 80);
  const canEdit = canAddInventoryCatalog(user);
  const isOwner = user.role === "OWNER";
  const showPrices = canSeeStockPrices(user); // prices and the value of the stock: office staff, Owner, PM, Purchasing
  const editPrices = showPrices && searchParams.edit === "prices";

  const wh = warehouseFromSlug(searchParams.wh);
  const whName = warehouseLabel(wh);
  const whQuery: Record<string, string> = wh === DEFAULT_WAREHOUSE ? {} : { wh: warehouseSlug(wh) };

  const everything = await prisma.warehouseItem.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { movements: true } }, projectStocks: { select: { qty: true } } },
  });
  const itemCounts = countByWarehouse(everything);
  const all = everything.filter((i) => i.warehouse === wh);
  const counts = summarizeByCategory(all);
  const value = summarizeValue(all);
  const here = category ? value.byCategory[category] : null;
  const needle = q.toLowerCase();
  const items = all.filter((i) => (!category || i.category === category) && (!needle || i.name.toLowerCase().includes(needle)));

  const tab = (slug: string | null, label: string, n: number) => {
    const on = (slug ? categoryFromSlug(slug) : null) === category;
    const qs = new URLSearchParams(whQuery);
    if (slug) qs.set("category", slug);
    if (q) qs.set("q", q);
    if (editPrices) qs.set("edit", "prices");
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
        <h1 className="mt-1 text-xl font-bold text-ink-900">Warehouse stock — {whName}</h1>
        <p className="text-sm text-ink-500">Every material kept in the {whName}, by category.</p>
      </div>

      <WarehouseTabs current={wh} counts={itemCounts} path="/inventory/stock" params={{ category: searchParams.category && category ? searchParams.category : undefined, q: q || undefined, edit: editPrices ? "prices" : undefined }} />

      <div className="flex flex-wrap items-center gap-2">
        {tab(null, "All", all.length)}
        {MATERIAL_CATEGORIES.map((c) => tab(c.slug, c.label, counts[c.value].items))}
      </div>

      {showPrices && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-ink-200 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-500">Total value in the {whName}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-ink-900">{php(value.total)}</div>
            <div className="text-xs text-ink-500">{value.priced} priced item{value.priced === 1 ? "" : "s"} · quantity × price per unit</div>
          </div>
          <div className="rounded-xl border border-ink-200 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-500">{category ? MATERIAL_CATEGORY_LABEL[category] : "Per category"}</div>
            {here ? (
              <>
                <div className="mt-1 text-2xl font-bold tabular-nums text-ink-900">{php(here.value)}</div>
                <div className="text-xs text-ink-500">{here.items} item{here.items === 1 ? "" : "s"}</div>
              </>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm">
                {MATERIAL_CATEGORIES.map((c) => (
                  <li key={c.value} className="flex justify-between gap-3">
                    <span className="text-ink-600">{c.label}</span>
                    <span className="tabular-nums text-ink-900">{php(value.byCategory[c.value].value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={`rounded-xl border p-4 ${value.unpriced > 0 ? "border-amber-300" : "border-ink-200"}`}>
            <div className="text-xs font-medium uppercase tracking-wide text-ink-500">Items without a price</div>
            <div className={`mt-1 text-2xl font-bold tabular-nums ${value.unpriced > 0 ? "text-amber-700" : "text-ink-900"}`}>{value.unpriced}</div>
            <div className="text-xs text-ink-500">{value.unpriced > 0 ? "not counted in the total yet" : "every item has a price"}</div>
          </div>
        </div>
      )}

      {showPrices && (
        <div className="flex flex-wrap items-center gap-3">
          {editPrices ? (
            <span className="text-sm font-medium text-ink-700">Setting prices for {category ? MATERIAL_CATEGORY_LABEL[category] : "all categories"}{q ? ` matching “${q}”` : ""}</span>
          ) : (
            <Link
              href={`/inventory/stock?${new URLSearchParams({ ...whQuery, ...(category ? { category: searchParams.category! } : {}), ...(q ? { q } : {}), edit: "prices" })}`}
              className="rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-800 hover:bg-ink-100"
            >
              ✎ Set prices
            </Link>
          )}
        </div>
      )}

      <form method="get" className="flex flex-wrap items-center gap-2">
        {editPrices && <input type="hidden" name="edit" value="prices" />}
        {wh !== DEFAULT_WAREHOUSE && <input type="hidden" name="wh" value={warehouseSlug(wh)} />}
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
          <Link href={`/inventory/stock${new URLSearchParams({ ...whQuery, ...(category ? { category: searchParams.category! } : {}) }).toString() ? `?${new URLSearchParams({ ...whQuery, ...(category ? { category: searchParams.category! } : {}) })}` : ""}`} className="text-sm text-ink-500 hover:underline">
            Clear
          </Link>
        )}
      </form>

      {editPrices ? (
        <PriceEditor key={`${wh}|${searchParams.category ?? "all"}|${q}`} rows={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, qty: Number(i.currentQty), price: i.unitPrice === null ? null : Number(i.unitPrice) }))} doneHref={`/inventory/stock${new URLSearchParams({ ...whQuery, ...(category ? { category: searchParams.category! } : {}) }).toString() ? `?${new URLSearchParams({ ...whQuery, ...(category ? { category: searchParams.category! } : {}) })}` : ""}`} />
      ) : (
      <Card>
        <CardHeader title={`${category ? MATERIAL_CATEGORY_LABEL[category] : "All categories"} (${items.length})`} subtitle="Real-time levels" />
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              {!category && <Th>Category</Th>}
              <Th className="text-right">Qty</Th>
              <Th>Unit</Th>
              {showPrices && <Th className="text-right">Price / unit</Th>}
              {showPrices && <Th className="text-right">Total</Th>}
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
                  {showPrices && <Td className="text-right tabular-nums text-ink-700">{i.unitPrice === null ? <span className="text-amber-700">no price</span> : php(i.unitPrice)}</Td>}
                  {showPrices && <Td className="text-right tabular-nums font-medium text-ink-900">{lineValue(i.currentQty, i.unitPrice) === null ? "—" : php(lineValue(i.currentQty, i.unitPrice) ?? 0)}</Td>}
                  {(canEdit || isOwner) && (
                    <Td className="text-right">
                      <span className="inline-flex items-center gap-3">
                        {canEdit && <EditStockItemButton id={i.id} name={i.name} unit={i.unit} category={cat} warehouse={i.warehouse} qty={Number(i.currentQty)} price={i.unitPrice === null ? null : Number(i.unitPrice)} canPrice={showPrices} />}
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
                <Td colSpan={showPrices ? 7 : 5} className="py-8 text-center text-ink-400">
                  {q ? `Nothing matches “${q}”.` : `Nothing in this category in the ${whName} yet.`}
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
      )}
    </div>
  );
}
