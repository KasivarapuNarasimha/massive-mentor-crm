import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { portalFromHostname, type PortalId } from "@/lib/portal-config";

/**
 * Host-based portal isolation (production SaaS).
 *
 * admin.massivementor.in  → only /admin/*
 * demo.massivementor.in   → only /demo/*
 * app.massivementor.in     → customer CRM (/login, /register, /dashboard)
 *
 * Localhost allows all path prefixes so three portals can be developed together.
 */
export function middleware(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const { pathname } = request.nextUrl;
  const hostPortal = portalFromHostname(host);

  // Static / Next internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  const portal: PortalId = hostPortal || "customer";
  requestHeaders.set("x-mm-portal", hostPortal || "path");

  // Production host isolation
  if (hostPortal === "admin") {
    if (pathname === "/" || pathname === "/login") {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    if (!pathname.startsWith("/admin")) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
  }

  // Customer host: password reset lives at /forgot-password and /reset-password

  if (hostPortal === "demo") {
    if (pathname === "/" || pathname === "/login") {
      return NextResponse.redirect(new URL("/demo/login", request.url));
    }
    if (!pathname.startsWith("/demo")) {
      return NextResponse.redirect(new URL("/demo", request.url));
    }
  }

  if (hostPortal === "customer") {
    // Never expose Super Admin or Demo UIs on customer host
    if (pathname.startsWith("/admin") || pathname.startsWith("/demo")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  // Localhost root → customer landing
  if (!hostPortal && pathname === "/") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });
  res.headers.set("x-mm-portal", portal);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
