"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PORTAL_TOKENS, PORTAL_USER_KEYS } from "@/lib/portal-config";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/businesses", label: "Customers" },
  { href: "/admin/subscriptions", label: "Subscriptions" },
  { href: "/admin/billing", label: "Billing" },
  { href: "/admin/revenue", label: "Revenue" },
  { href: "/admin/licenses", label: "Licenses" },
  { href: "/admin/analytics", label: "Usage" },
  { href: "/admin/support", label: "Support" },
  { href: "/admin/monitoring", label: "Monitoring" },
  { href: "/admin/backups", label: "Backups" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");

  const isPublicAuth =
    pathname === "/admin/login" ||
    pathname === "/admin/forgot-password" ||
    pathname === "/admin/reset-password";

  useEffect(() => {
    if (isPublicAuth) {
      setReady(true);
      return;
    }
    const t = localStorage.getItem(PORTAL_TOKENS.admin);
    if (!t) {
      router.replace("/admin/login");
      return;
    }
    try {
      const u = JSON.parse(localStorage.getItem(PORTAL_USER_KEYS.admin) || "{}");
      setEmail(u.email || "Super Admin");
    } catch {
      setEmail("Super Admin");
    }
    setReady(true);
  }, [isPublicAuth, router, pathname]);

  const logout = () => {
    localStorage.removeItem(PORTAL_TOKENS.admin);
    localStorage.removeItem(PORTAL_USER_KEYS.admin);
    router.replace("/admin/login");
  };

  if (!ready) {
    return (
      <div className="min-h-dvh bg-zinc-950 flex items-center justify-center text-zinc-500 text-sm">
        Loading platform…
      </div>
    );
  }

  if (isPublicAuth) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex">
      <aside className="hidden lg:flex w-64 flex-col border-r border-zinc-800 bg-zinc-950 sticky top-0 h-dvh">
        <div className="p-5 border-b border-zinc-800">
          <div className="text-xs uppercase tracking-widest text-violet-400/90 mb-1">Platform</div>
          <div className="font-semibold">Super Admin</div>
          <div className="text-xs text-zinc-500 mt-1 truncate">{email}</div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-3 py-2.5 rounded-xl text-sm ${
                  active ? "bg-violet-500/15 text-violet-200" : "text-zinc-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-zinc-800">
          <button
            type="button"
            onClick={logout}
            className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-950/40"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur px-3 py-3 flex items-center justify-between gap-2">
          <div className="font-semibold text-sm">Super Admin</div>
          <button type="button" onClick={logout} className="text-xs text-red-400 px-2 py-1">
            Sign out
          </button>
        </header>
        <nav className="lg:hidden flex gap-1 overflow-x-auto px-2 py-2 border-b border-zinc-800 text-xs">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 px-3 py-2 rounded-lg ${
                pathname === item.href ? "bg-violet-500/20 text-violet-200" : "text-zinc-400"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
