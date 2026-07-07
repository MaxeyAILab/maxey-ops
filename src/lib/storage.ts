import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Photo storage adapter. Local development writes to public/uploads (served
 * statically). For production swap the body of savePhoto() for Supabase
 * Storage / Cloudflare R2 — callers only ever see the returned URL.
 */

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

/** Accepts a data URL (data:image/jpeg;base64,...) and returns a public URL. */
export async function savePhoto(dataUrl: string): Promise<string> {
  const match = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid image data");
  const [, ext, b64] = match;
  const buf = Buffer.from(b64, "base64");
  if (buf.length > 5 * 1024 * 1024) throw new Error("Image too large (max 5MB)");

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext === "jpeg" ? "jpg" : ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}

/** Save an array of data URLs, skipping any that fail validation. */
export async function savePhotos(dataUrls: string[] | undefined): Promise<string[]> {
  if (!dataUrls?.length) return [];
  const urls: string[] = [];
  for (const d of dataUrls.slice(0, 6)) {
    try {
      urls.push(await savePhoto(d));
    } catch {
      // skip invalid entries rather than failing the whole submission
    }
  }
  return urls;
}
