/**
 * The REMARKS column of the printed Purchase Order shows, for each material, the supplier chosen for it on the requisition.
 * New POs store that supplier on each line; for a PO made before that was stored, it is read from the requisition's items
 * (matched by name), so every PO downloads with its suppliers. Lines taken from the warehouse say so.
 */
export interface PoLineLike {
  name: string;
  remarks?: string | null;
  fromWarehouse?: boolean;
}

export interface RequisitionLineLike {
  name: string;
  remarks: string | null;
  warehouseItemId?: string | null;
}

const key = (s: string) => s.trim().toLowerCase();

export function poLineRemarks(line: PoLineLike, requisitionItems: RequisitionLineLike[]): string | null {
  if (line.fromWarehouse) return "Warehouse stock";
  const own = line.remarks?.trim();
  if (own) return own;
  const match = requisitionItems.find((r) => !r.warehouseItemId && key(r.name) === key(line.name) && r.remarks?.trim());
  return match?.remarks?.trim() ?? null;
}
