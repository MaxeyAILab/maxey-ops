/**
 * Pure rules for putting what a verified delivery received onto the project's on-site materials list. No database here — shared
 * by delivery-stock.ts (which applies the plan) and the tests.
 *
 * Every received line of a verified delivery becomes ONE "Supplier → Site" movement, tied to the delivery and the line
 * (deliveryId + deliveryLine, which is unique). Correcting the delivery changes that same movement, deleting the delivery
 * removes it — so a delivery can never add its materials twice, however many times it is confirmed, edited or synced.
 */

export interface PlanChecklistRow {
  item: string;
  receivedQty: number;
}

export interface PlanPoLine {
  name: string;
  unit: string;
  unitCost: number;
  /** issued from warehouse stock (at no cost on the PO) — already put on site when the requisition was approved */
  fromWarehouse?: boolean;
}

export interface ExistingStockMovement {
  id: string;
  deliveryLine: string | null;
  qty: number;
}

export type StockAction =
  | { kind: "add"; line: string; qty: number; unit: string; unitCost: number }
  | { kind: "change"; movementId: string; line: string; from: number; to: number }
  | { kind: "remove"; movementId: string; line: string; qty: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** How a PO line is looked up from a delivery line: the same way the rest of the delivery code does it (trimmed, any case). */
const lineKey = (s: string) => s.trim().toLowerCase();

/**
 * What the delivery should have put on site, by delivery line: the quantity received (lines with the same name add up), skipping
 * warehouse-sourced lines. `enabled` is false for a delivery that is not fully verified, was verified before this existed, or has
 * no project — then nothing should be on site for it.
 */
export function desiredStock(checklist: PlanChecklistRow[], poLines: PlanPoLine[], enabled: boolean): Map<string, { qty: number; unit: string; unitCost: number }> {
  const out = new Map<string, { qty: number; unit: string; unitCost: number }>();
  if (!enabled) return out;
  for (const row of checklist) {
    const po = poLines.find((l) => lineKey(l.name) === lineKey(row.item));
    if (po?.fromWarehouse) continue;
    const qty = round2(Number(row.receivedQty) || 0);
    if (qty <= 0) continue;
    const have = out.get(row.item);
    if (have) have.qty = round2(have.qty + qty);
    else out.set(row.item, { qty, unit: po?.unit?.trim() || "pc", unitCost: Number(po?.unitCost) || 0 });
  }
  return out;
}

/** The movements to add, change or remove so that what is on site for the delivery matches what it received. */
export function planDeliveryStock(desired: Map<string, { qty: number; unit: string; unitCost: number }>, existing: ExistingStockMovement[]): StockAction[] {
  const actions: StockAction[] = [];
  const byLine = new Map<string, ExistingStockMovement>();
  for (const e of existing) if (e.deliveryLine !== null) byLine.set(e.deliveryLine, e);
  for (const [line, want] of desired) {
    const have = byLine.get(line);
    if (!have) actions.push({ kind: "add", line, qty: want.qty, unit: want.unit, unitCost: want.unitCost });
    else if (round2(have.qty) !== want.qty) actions.push({ kind: "change", movementId: have.id, line, from: round2(have.qty), to: want.qty });
  }
  for (const [line, have] of byLine) if (!desired.has(line)) actions.push({ kind: "remove", movementId: have.id, line, qty: round2(have.qty) });
  return actions;
}

// ---------------------------------------------------------------------------------------------------- matching an item

/** A name for comparing: lower case, without spaces and quote marks, so Tubular 1" x 2" and tubular 1x2 are the same item. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s"'`´‘’“”″′]+/g, "")
    .replace(/[^a-z0-9./\-+x]/g, "");
}

const UNIT_ALIASES: Record<string, string> = {
  pc: "pc", pcs: "pc", piece: "pc", pieces: "pc", pce: "pc", ea: "pc", each: "pc", unit: "pc", units: "pc",
  bag: "bag", bags: "bag",
  box: "box", boxes: "box",
  length: "length", lengths: "length", lgth: "length", lgt: "length", len: "length",
  liter: "l", liters: "l", litre: "l", litres: "l", ltr: "l", ltrs: "l", l: "l",
  gal: "gal", gals: "gal", gallon: "gal", gallons: "gal",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg",
  m: "m", mtr: "m", mtrs: "m", meter: "m", meters: "m", metre: "m", metres: "m",
  roll: "roll", rolls: "roll",
  set: "set", sets: "set",
  sack: "sack", sacks: "sack",
  pail: "pail", pails: "pail",
  can: "can", cans: "can",
  sheet: "sheet", sheets: "sheet", sht: "sheet", shts: "sheet",
  pair: "pair", pairs: "pair",
  bundle: "bundle", bundles: "bundle", bdl: "bundle", bdls: "bundle",
  cubic: "cu.m", cum: "cu.m", "cu.m": "cu.m", "cu.m.": "cu.m", m3: "cu.m",
};

/** A unit for comparing: pcs / piece / pieces are one unit, bag / bags another, and so on. */
export function normalizeUnit(unit: string): string {
  const u = unit.toLowerCase().replace(/[\s]+/g, "").replace(/\.$/, "");
  return UNIT_ALIASES[u] ?? UNIT_ALIASES[u.replace(/\.$/, "")] ?? u;
}

/** Two items are the same item when their names and their units both match. */
export const itemKey = (name: string, unit: string): string => `${normalizeName(name)}|${normalizeUnit(unit)}`;

export interface CatalogueEntry {
  id: string;
  name: string;
  unit: string;
  warehouse: string;
}

/**
 * Which existing item a delivered line is. First the items already on this project's materials list, then the catalogue (the Main
 * Warehouse first, then the others, oldest first); null when there is none — a new item is added to the catalogue.
 */
export function findExistingItem(name: string, unit: string, onSite: CatalogueEntry[], catalogue: CatalogueEntry[]): CatalogueEntry | null {
  const key = itemKey(name, unit);
  const mine = onSite.find((i) => itemKey(i.name, i.unit) === key);
  if (mine) return mine;
  return catalogue.find((i) => itemKey(i.name, i.unit) === key) ?? null;
}

// --------------------------------------------------------------------------------------------- category of a new item

const CATEGORY_WORDS: { category: "ELECTRICAL" | "PLUMBING" | "CIVIL_ARCHITECTURAL"; words: RegExp }[] = [
  { category: "ELECTRICAL", words: /\b(wire|wires|cable|conduit|breaker|thhn|romex|outlet|receptacle|switch|gang|lamp|bulb|led|panel ?board|junction|utility box|electrical|lighting|light fixture|fuse|ground rod)\b/ },
  { category: "PLUMBING", words: /\b(pvc|ppr|cpvc|faucet|valve|elbow|coupling|toilet|lavatory|sink|water meter|plumbing|p-?trap|floor drain|teflon|tee|reducer|adaptor|adapter|shower|bidet)\b/ },
  { category: "CIVIL_ARCHITECTURAL", words: /\b(cement|sand|gravel|aggregate|rebar|deformed bar|tie wire|plywood|lumber|coco ?lumber|marine|tile|tiles|paint|primer|putty|hollow ?block|chb|nail|nails|tubular|angle bar|gypsum|board|steel|concrete|mortar|screed|waterproofing|roofing|gutter|adhesive|epoxy)\b/ },
];

/** A best guess at the material group of a newly added item, from its name — anything unclear is "Others" (it can be changed later). */
export function guessCategory(name: string): "CIVIL_ARCHITECTURAL" | "PLUMBING" | "ELECTRICAL" | "OTHERS" {
  const n = name.toLowerCase();
  for (const c of CATEGORY_WORDS) if (c.words.test(n)) return c.category;
  return "OTHERS";
}
