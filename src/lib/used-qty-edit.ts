/**
 * Owner only: correct the quantity of a "Used on site" (consumed) log entry that was typed wrongly.
 *
 * The correction is a correction of the RECORD. By default the project's on-site stock is left exactly as it is: when the
 * wrong figure came from a mistake elsewhere (for example a delivery that was received twice, so the extra pieces were never
 * really on site), giving the difference back to the site would put pieces on the shelf that do not exist.
 * When the Owner does want the stock to follow the correction, the site balance moves by the difference: a smaller usage gives
 * pieces back, a larger usage takes more.
 */
export function usedQtyStockChange(oldQty: number, newQty: number, adjustSiteStock: boolean): number {
  if (!adjustSiteStock) return 0;
  // positive = pieces given back to the site, negative = more taken from the site
  return Math.round((oldQty - newQty) * 100) / 100;
}
