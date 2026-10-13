import { z } from "zod";
import { saveDocument } from "@/lib/storage";
import { parseDocumentDataUrl, validateDocumentLink } from "@/lib/documents";
import { ApiError } from "@/lib/rbac";

export const fileSourceSchema = z.object({
  link: z.string().trim().optional().nullable(),
  dataUrl: z.string().optional().nullable(),
  fileName: z.string().trim().max(200).optional().nullable(),
});

/** Turn the "link or small upload" input into a stored reference. Exactly one source is required. */
export async function resolveFileSource(input: { link?: string | null; dataUrl?: string | null; fileName?: string | null }) {
  const hasLink = !!input.link;
  const hasFile = !!input.dataUrl;
  if (hasLink === hasFile) throw new ApiError(400, "Attach either a link or a file (not both, not neither)");
  if (hasLink) {
    const problem = validateDocumentLink(input.link!);
    if (problem) throw new ApiError(400, problem);
    return { url: input.link!.trim(), isExternal: true, fileName: input.fileName || null };
  }
  const parsed = parseDocumentDataUrl(input.dataUrl!);
  if (!parsed.ok) throw new ApiError(400, parsed.error);
  return { url: await saveDocument(input.dataUrl!), isExternal: false, fileName: input.fileName || null };
}
