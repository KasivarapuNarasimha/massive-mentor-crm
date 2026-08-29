"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PORTAL_TOKENS, PORTAL_USER_KEYS } from "@/lib/portal-config";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

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
  { href: "/admin/appearance", label: "Appearance" },
];

const SIDEBAR_WIDTH = "w-64"; // 16rem — matches prior admin aside

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
      <div className="min-h-dvh bg-background flex items-center justify-center text-muted-foreground text-sm">
        Loading platform…
      </div>
    );
  }

  if (isPublicAuth) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-dvh bg-background text-foreground flex">
      {/* Width reserve so fixed sidebar does not cover main content (CRM DashboardShell pattern) */}
      <div className={`hidden lg:block shrink-0 ${SIDEBAR_WIDTH}`} aria-hidden />

      <aside
        className={`hidden lg:flex ${SIDEBAR_WIDTH} flex-col border-r border-border bg-card fixed left-0 top-0 z-30 h-dvh overflow-hidden`}
      >
        <div className="p-5 border-b border-border shrink-0">
          <div className="text-xs uppercase tracking-widest text-violet-500 dark:text-violet-400/90 mb-1">
            Platform
          </div>
          <div className="font-semibold text-foreground">Super Admin</div>
          <div className="text-xs text-muted-foreground mt-1 truncate">{email}</div>
        </div>
        <nav className="flex-1 min-h-0 p-3 space-y-0.5 overflow-y-auto overscroll-contain">
          {NAV.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/admin" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-3 py-2.5 rounded-xl text-sm transition-colors ${
                  active
                    ? "bg-violet-500/15 text-violet-700 dark:text-violet-200 font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border space-y-2 shrink-0">
          <ThemeToggle className="w-full" showLabel />
          <button
            type="button"
            onClick={logout}
            className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-dvh">
        <header className="lg:hidden sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur px-3 py-3 flex items-center justify-between gap-2">
          <div className="font-semibold text-sm text-foreground">Super Admin</div>
          <div className="flex items-center gap-1">
            <ThemeToggle showLabel={false} />
            <button
              type="button"
              onClick={logout}
              className="text-xs text-red-600 dark:text-red-400 px-2 py-1"
            >
              Sign out
            </button>
          </div>
        </header>
        <nav className="lg:hidden flex gap-1 overflow-x-auto px-2 py-2 border-b border-border text-xs bg-card">
          {NAV.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/admin" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 px-3 py-2 rounded-lg ${
                  active
                    ? "bg-violet-500/20 text-violet-700 dark:text-violet-200"
                    : "text-muted-foreground"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden bg-background">
          {children}
        </main>
      </div>
    </div>
  );
}
