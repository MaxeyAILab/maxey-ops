import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { STORAGE_BUCKET, storageConfigured, supabaseAdmin } from "@/lib/supabase";

/**
 * Photo/document storage adapter. Callers only ever see the returned URL.
 *
 * - Production (Supabase env set): uploads to a PRIVATE bucket and returns a
 *   `/api/files/<key>` reference served by an authenticated proxy route, so
 *   sensitive docs (checks, receipts) require a logged-in session to view.
 * - Local dev (no Supabase env): writes to public/uploads and returns
 *   `/uploads/<name>`, served statically by Next.
 * Both forms render directly in existing <img> tags.
 */

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

function decodeDataUrl(dataUrl: string): { ext: string; buf: Buffer; mime: string } {
  const match = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid image data");
  const [, kind, b64] = match;
  const buf = Buffer.from(b64, "base64");
  if (buf.length > 5 * 1024 * 1024) throw new Error("Image too large (max 5MB)");
  return { ext: kind === "jpeg" ? "jpg" : kind, buf, mime: `image/${kind}` };
}

/** Accepts a data URL (data:image/jpeg;base64,...) and returns a URL/reference. */
export async function savePhoto(dataUrl: string): Promise<string> {
  const { ext, buf, mime } = decodeDataUrl(dataUrl);
  const fileName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;

  if (storageConfigured) {
    // Foldered by year/month to keep the bucket browsable
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${fileName}`;
    const supabase = supabaseAdmin()!;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(key, buf, {
      contentType: mime,
      upsert: false,
    });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    return `/api/files/${key}`;
  }

  // Local-disk fallback
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buf);
  return `/uploads/${fileName}`;
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
