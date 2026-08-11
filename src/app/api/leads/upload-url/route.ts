import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { STORAGE_BUCKET, storageConfigured, supabaseAdmin } from "@/lib/supabase";
import { ApiError, handleApi } from "@/lib/rbac";

const ALLOWED_EXT = ["jpg", "jpeg", "png", "webp", "pdf", "dwg", "dxf"];
const MAX_BYTES = 20 * 1024 * 1024; // 20MB — plenty for a scanned plan or a modest CAD file

const bodySchema = z.object({
  fileName: z.string().min(1).max(200),
  fileSize: z.number().int().positive().max(MAX_BYTES),
});

/**
 * POST /api/leads/upload-url — public, unauthenticated. Issues a one-time
 * upload target for a client-submitted plan file (photo, PDF, or CAD
 * drawing) so the actual bytes go straight from the browser to storage —
 * never through this Vercel function — avoiding the platform's ~4.5MB
 * request-body ceiling that would otherwise reject real plan files.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const { fileName, fileSize } = bodySchema.parse(await req.json());

  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.includes(ext)) {
    throw new ApiError(400, "Unsupported file type. Use JPG, PNG, WEBP, PDF, DWG, or DXF.");
  }
  if (fileSize > MAX_BYTES) {
    throw new ApiError(400, "File is too large (max 20MB).");
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  const now = new Date();
  const key = `leads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto
    .randomBytes(8)
    .toString("hex")}-${safeName}`;

  if (!storageConfigured) {
    // Local-dev fallback: PUT straight to a same-origin route that writes to public/uploads.
    return NextResponse.json({ key, uploadUrl: `/api/leads/local-upload/${key}`, fileUrl: `/uploads/${key}` });
  }

  const supabase = supabaseAdmin()!;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUploadUrl(key);
  if (error || !data) throw new ApiError(500, "Could not prepare upload. Please try again.");

  return NextResponse.json({ key, uploadUrl: data.signedUrl, fileUrl: `/api/files/${key}` });
});
