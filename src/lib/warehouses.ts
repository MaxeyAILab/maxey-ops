/**
 * The company's four warehouses. Every stock item and every tool/equipment unit belongs to exactly one of them (its "home"):
 * materials are counted per warehouse, and a tool that is returned goes back to its home warehouse. The first one — the Main
 * Warehouse at the Main Office — is where everything that was registered before the others existed lives.
 */
export const WAREHOUSES = [
  { value: "MAIN", label: "Main Warehouse", short: "Main", slug: "main", place: "Main Office" },
  { value: "ALUA", label: "Alua Warehouse", short: "Alua", slug: "alua", place: "Alua" },
  { value: "VENTUS", label: "Ventus Warehouse", short: "Ventus", slug: "ventus", place: "Ventus" },
  { value: "BARANGAY", label: "Barangay Warehouse", short: "Barangay", slug: "barangay", place: "Barangay" },
] as const;

export type WarehouseValue = (typeof WAREHOUSES)[number]["value"];

export const DEFAULT_WAREHOUSE: WarehouseValue = "MAIN";

export const WAREHOUSE_VALUES = WAREHOUSES.map((w) => w.value) as [WarehouseValue, ...WarehouseValue[]];

export const isWarehouse = (v: unknown): v is WarehouseValue => WAREHOUSES.some((w) => w.value === v);

/** "Alua Warehouse" — what people see; anything unknown counts as the Main Warehouse. */
export function warehouseLabel(value: string | null | undefined): string {
  return WAREHOUSES.find((w) => w.value === value)?.label ?? WAREHOUSES[0].label;
}

/** "alua" (as used in the page address) → ALUA; anything else (or nothing) → the Main Warehouse. */
export function warehouseFromSlug(slug: string | null | undefined): WarehouseValue {
  return WAREHOUSES.find((w) => w.slug === slug)?.value ?? DEFAULT_WAREHOUSE;
}

export const warehouseSlug = (value: string): string => WAREHOUSES.find((w) => w.value === value)?.slug ?? WAREHOUSES[0].slug;

/** How many of each warehouse's things there are, e.g. for the numbers on the tabs. Warehouses with nothing count 0. */
export function countByWarehouse(rows: { warehouse: string }[]): Record<WarehouseValue, number> {
  const out = Object.fromEntries(WAREHOUSES.map((w) => [w.value, 0])) as Record<WarehouseValue, number>;
  for (const r of rows) out[isWarehouse(r.warehouse) ? r.warehouse : DEFAULT_WAREHOUSE] += 1;
  return out;
}
