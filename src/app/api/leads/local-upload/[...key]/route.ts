import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

/**
 * PUT /api/leads/local-upload/<key> — local-dev-only counterpart to the
 * Supabase signed-upload-URL path (used when SUPABASE_* env vars aren't
 * set), writing straight to public/uploads like the rest of the storage
 * fallback in src/lib/storage.ts.
 */
export async function PUT(req: NextRequest, { params }: { params: { key: string[] } }) {
  const key = params.key.join("/");
  if (key.includes("..") || key.startsWith("/")) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const dest = path.join(UPLOAD_DIR, key);
  const buf = Buffer.from(await req.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);

  return NextResponse.json({ ok: true });
}
