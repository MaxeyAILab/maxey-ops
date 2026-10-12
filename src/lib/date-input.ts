import { parseDateOnly } from "@/lib/milestones";
import { ApiError } from "@/lib/rbac";

/** Parse several YYYY-MM-DD fields of a request body, turning a bad date into a 400. */
export function parseDates<T extends object>(input: T, keys: (keyof T & string)[]) {
  const out: Record<string, Date | null> = {};
  for (const k of keys) {
    try {
      out[k] = parseDateOnly(((input as Record<string, unknown>)[k] as string | null | undefined) ?? null);
    } catch {
      throw new ApiError(400, `${k}: use a valid date (YYYY-MM-DD)`);
    }
  }
  return out;
}

export function assertOrder(start: Date | null | undefined, finish: Date | null | undefined, label: string) {
  if (start && finish && finish < start) throw new ApiError(400, `${label}: finish can't be before start`);
}
