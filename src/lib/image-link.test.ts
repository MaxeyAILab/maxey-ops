import { describe, expect, it } from "vitest";
import { isViewableImageHref } from "./image-link";

describe("isViewableImageHref", () => {
  it("accepts pictures stored by the app", () => {
    expect(isViewableImageHref("/api/files/2026/10/1790228064907-18a71cdbf2e5.jpg")).toBe(true);
    expect(isViewableImageHref("/uploads/photo.PNG")).toBe(true);
    expect(isViewableImageHref("/api/files/2026/10/x.webp?v=2")).toBe(true);
  });

  it("leaves PDFs, other pages and outside websites alone", () => {
    expect(isViewableImageHref("/api/files/2026/10/contract.pdf")).toBe(false);
    expect(isViewableImageHref("/cash-expense/report#missing-receipts")).toBe(false);
    expect(isViewableImageHref("https://example.com/a.jpg")).toBe(false);
    expect(isViewableImageHref("//example.com/uploads/a.jpg")).toBe(false);
    expect(isViewableImageHref("/api/payroll/abc/payslips?inline=1")).toBe(false);
    expect(isViewableImageHref("")).toBe(false);
    expect(isViewableImageHref(null)).toBe(false);
  });
});
