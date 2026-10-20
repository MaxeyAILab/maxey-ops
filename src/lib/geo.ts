/** "14.123456,121.123456" as recorded by clock-in and delivery checks → numbers, or null when it isn't a usable fix. */
export function parseGps(gps: string | null | undefined): { lat: number; lng: number } | null {
  if (!gps) return null;
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(gps);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/** The picture-map OpenStreetMap serves for embedding, with a pin at the spot. */
export function osmEmbedUrl({ lat, lng }: { lat: number; lng: number }): string {
  const d = 0.004;
  const bbox = [lng - d, lat - d, lng + d, lat + d].map((n) => n.toFixed(6)).join("%2C");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lng.toFixed(6)}`;
}

/** Opens the phone's maps app (or the maps site) at the spot. */
export function mapsLink({ lat, lng }: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)}%2C${lng.toFixed(6)}`;
}
