import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * Route protection. This only gates page access — every API route enforces
 * RBAC server-side independently (Spec §8).
 */
export default withAuth(
  function middleware(req) {
    const role = req.nextauth.token?.role as string | undefined;
    const path = req.nextUrl.pathname;

    // Any signed-in role may set their password (first-login temp flow)
    if (path === "/change-password") return NextResponse.next();

    // Clients only see the portal
    if (role === "CLIENT" && !path.startsWith("/portal")) {
      return NextResponse.redirect(new URL("/portal", req.url));
    }
    // Staff don't use the client portal
    if (role !== "CLIENT" && path.startsWith("/portal")) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  },
  {
    callbacks: { authorized: ({ token }) => !!token },
    pages: { signIn: "/login" },
  }
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/leads/:path*",
    "/projects/:path*",
    "/requisitions/:path*",
    "/purchasing/:path*",
    "/quotations/:path*",
    "/deliveries/:path*",
    "/inventory/:path*",
    "/instructions/:path*",
    "/attendance/:path*",
    "/payroll/:path*",
    "/people/:path*",
    "/change-password",
    "/portal/:path*",
  ],
};
