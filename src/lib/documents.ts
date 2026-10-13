/** Only https links to a file kept elsewhere; anything else (javascript:, data:, http:, embedded passwords) is refused. */
export function validateDocumentLink(raw: string): string | null {
  const value = raw.trim();
  if (value.length > 2000) return "That link is too long";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a full link starting with https://";
  }
  if (url.protocol !== "https:") return "Only secure https:// links are allowed";
  if (url.username || url.password) return "The link must not contain a username or password";
  if (!url.hostname.includes(".")) return "Enter a full link starting with https://";
  return null;
}

export const MAX_DOCUMENT_UPLOAD_BYTES = 3 * 1024 * 1024; // keeps the request inside the host's body limit once base64-encoded

const ALLOWED_UPLOAD_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

/** Parses a data URL for a small document upload. Returns the parsed parts, or an error message. */
export function parseDocumentDataUrl(dataUrl: string): { ok: true; mime: string; bytes: number } | { ok: false; error: string } {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return { ok: false, error: "That file couldn't be read" };
  if (!(ALLOWED_UPLOAD_MIME as readonly string[]).includes(m[1])) return { ok: false, error: "Upload a PDF, JPG, PNG or WebP — or paste a link for other file types" };
  const bytes = Math.floor((m[2].length * 3) / 4) - (m[2].endsWith("==") ? 2 : m[2].endsWith("=") ? 1 : 0);
  if (bytes > MAX_DOCUMENT_UPLOAD_BYTES) return { ok: false, error: "That file is over 3 MB — keep it in your shared drive and paste the link instead" };
  return { ok: true, mime: m[1], bytes };
}

/** Suggest the next revision label: A → B … Z → Rev 27; otherwise "Rev N+1". */
export function nextRevisionLabel(existing: string[]): string {
  if (existing.length === 0) return "A";
  const letters = existing.filter((r) => /^[A-Z]$/.test(r)).sort();
  if (letters.length === existing.length && letters.length < 26) return String.fromCharCode(letters[letters.length - 1].charCodeAt(0) + 1);
  const nums = existing.map((r) => Number(/(\d+)\s*$/.exec(r)?.[1] ?? 0));
  return `Rev ${Math.max(existing.length, ...nums) + 1}`;
}

export function currentRevision<T extends { current: boolean; createdAt: Date }>(revisions: T[]): T | null {
  const current = revisions.filter((r) => r.current).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return current[0] ?? null;
}
