"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePortal } from "@/lib/portal-context";
import { canAccessPath } from "@/lib/module-permissions";

/**
 * Route-level module permission gate.
 * Shows 403 when the user lacks Super Admin–granted module access.
 */
export function ModuleGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const { portal, isLoading } = usePortal();

  if (isLoading && !portal) {
    return (
      <div className="p-8 text-sm text-muted-foreground">Checking permissions…</div>
    );
  }

  const modules = portal?.modules;
  if (!canAccessPath(pathname, modules)) {
    return (
      <div
        className="max-w-lg mx-auto m-6 sm:m-10 rounded-2xl border border-red-500/30 bg-red-500/5 p-6 sm:p-8 text-center"
        role="alert"
        data-testid="module-forbidden"
      >
        <div className="text-4xl font-semibold text-red-400 mb-2">403</div>
        <h1 className="text-lg font-semibold text-foreground">Forbidden</h1>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          You do not have permission to access this page.
          Contact your Super Admin or Business Admin if you need access.
        </p>
        <Link
          href={portal?.homeRoute || "/dashboard"}
          className="inline-flex mt-6 min-h-11 px-4 items-center justify-center rounded-xl bg-primary text-primary-foreground text-sm font-medium"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
