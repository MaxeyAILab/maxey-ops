import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import type { Role } from "@prisma/client";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * RBAC gate for API routes. Enforced server-side on every route (Spec §8),
 * never just hidden in the UI.
 */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "Not authenticated");
  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    throw new ApiError(403, "Not authorized for this action");
  }
  return user;
}

/** Wrap a route handler so ApiError / unexpected errors become JSON responses. */
export function handleApi<T extends unknown[]>(
  fn: (...args: T) => Promise<NextResponse | Response>
) {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      if (err instanceof ZodError) {
        const first = err.errors[0];
        return NextResponse.json(
          { error: `${first?.path.join(".") || "input"}: ${first?.message ?? "invalid"}` },
          { status: 400 }
        );
      }
      console.error("[api]", err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

/** Staff roles allowed into the internal app shell. */
export const STAFF_ROLES: Role[] = [
  "OWNER",
  "PM",
  "FOREMAN",
  "PURCHASING",
  "ACCOUNTING",
  "OFFICE",
  "DRIVER",
];

/** Roles that can see money dashboards. */
export const FINANCE_ROLES: Role[] = ["OWNER", "ACCOUNTING"];
