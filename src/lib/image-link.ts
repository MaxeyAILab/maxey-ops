const IMAGE = /\.(jpe?g|png|webp|gif)$/i;

/**
 * Is this link a picture stored by the app (a receipt, a proof of payment, a site photo…) — not an outside website, a PDF, or a
 * link that is meant to download? Those open in the photo viewer; everything else is left to the browser.
 */
export function isViewableImageHref(href: string | null | undefined): boolean {
  if (!href || !href.startsWith("/") || href.startsWith("//")) return false; // only this site's own files
  const path = href.split(/[?#]/)[0];
  return (path.startsWith("/api/files/") || path.startsWith("/uploads/")) && IMAGE.test(path);
}
