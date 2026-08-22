import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { portalFromHostname, type PortalId } from "@/lib/portal-config";
import { verifyDemoSessionJwt } from "@/lib/demo-jwt";

/**
 * Host-based portal isolation (production SaaS).
 *
 * admin.massivementor.in  → only /admin/*
 * demo.massivementor.in   → only /demo/*
 * crm.massivementor.in / app.massivementor.in → customer CRM (/login, /dashboard)
 *
 * Localhost allows all path prefixes so three portals can be developed together.
 */
export async function middleware(request: NextRequest) {
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
      return NextResponse.redirect(new URL("/demo", request.url));
    }

    const isDemoPublic =
      pathname === "/demo" ||
      pathname === "/demo/login" ||
      pathname.startsWith("/demo/");

    const isDemoCrmShell =
      pathname === "/dashboard" ||
      pathname.startsWith("/dashboard/") ||
      pathname === "/subscription-required";

    // /dashboard on the demo host requires a cryptographically verified demo JWT cookie
    // (HS256 with server-only JWT_SECRET, portal === "demo"). Shape-only checks are insufficient.
    if (isDemoCrmShell) {
      const session = request.cookies.get("mm_demo_session")?.value || "";
      const secret = process.env.JWT_SECRET || "";
      const ok = await verifyDemoSessionJwt(session, secret);
      if (!ok) {
        const loginUrl = new URL("/demo", request.url);
        loginUrl.searchParams.set("next", pathname);
        const res = NextResponse.redirect(loginUrl);
        // Drop forged / invalid cookies so the browser does not keep sending them.
        res.cookies.set("mm_demo_session", "", { path: "/", maxAge: 0 });
        return res;
      }
    } else if (!isDemoPublic) {
      // Keep Super Admin / other portals blocked on the demo host.
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
