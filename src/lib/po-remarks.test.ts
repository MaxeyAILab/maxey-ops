import { describe, expect, it } from "vitest";
import { poLineRemarks } from "./po-remarks";

const reqItems = [
  { name: "Tubular 2\" x2\" x1.5mm", remarks: "josan", warehouseItemId: null },
  { name: "Welding rod 2.5mm", remarks: "ABC Hardware", warehouseItemId: null },
  { name: "Cement", remarks: null, warehouseItemId: "w1" },
];

describe("PO remarks column", () => {
  it("uses the supplier stored on the line", () => {
    expect(poLineRemarks({ name: "Welding rod 2.5mm", remarks: "Lazada Hardware" }, reqItems)).toBe("Lazada Hardware");
  });
  it("falls back to the supplier chosen on the requisition for older POs (name match ignores case/spaces)", () => {
    expect(poLineRemarks({ name: " welding ROD 2.5mm " }, reqItems)).toBe("ABC Hardware");
    expect(poLineRemarks({ name: "Tubular 2\" x2\" x1.5mm", remarks: null }, reqItems)).toBe("josan");
  });
  it("says Warehouse stock for lines taken from the warehouse", () => {
    expect(poLineRemarks({ name: "Cement", fromWarehouse: true }, reqItems)).toBe("Warehouse stock");
  });
  it("is empty when nothing is known", () => {
    expect(poLineRemarks({ name: "Unknown item" }, reqItems)).toBeNull();
  });
});
