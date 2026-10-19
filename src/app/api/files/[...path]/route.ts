import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { clientCanViewFile } from "@/lib/file-access";
import { STORAGE_BUCKET, storageConfigured, supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/files/<key> — authenticated proxy for private-bucket files
 * (checks, receipts, site photos). Staff may view any file; a client only
 * files attached to records shown in their portal (see clientCanViewFile),
 * anything else is a 404; anonymous requests get 401. Files themselves live in a
 * PRIVATE Supabase bucket, so they are never reachable without a session.
 */
export async function GET(_req: NextRequest, { params }: { params: { path: string[] } }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const key = params.path.join("/");
  // Reject path traversal attempts
  if (key.includes("..") || key.startsWith("/")) {
    return new NextResponse("Bad request", { status: 400 });
  }

  // Clients only get files attached to records their portal shows them.
  if (user.role === "CLIENT") {
    if (!user.clientId || !(await clientCanViewFile(user.clientId, `/api/files/${key}`))) {
      return new NextResponse("Not found", { status: 404 });
    }
  }

  if (!storageConfigured) return new NextResponse("Storage not configured", { status: 500 });

  const supabase = supabaseAdmin()!;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(key);
  if (error || !data) return new NextResponse("Not found", { status: 404 });

  const buffer = Buffer.from(await data.arrayBuffer());
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": data.type || "application/octet-stream",
      // Private: cached only in the user's own browser, never a shared CDN
      "Cache-Control": "private, max-age=3600",
    },
  });
}
