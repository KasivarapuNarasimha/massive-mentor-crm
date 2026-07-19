"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PortalProvider } from "@/lib/portal-context";
import { PlanProvider } from "@/lib/plan-context";
import { api } from "@/lib/api";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, isLoading, token } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Extra client safety: if auth bootstrap is stuck, force exit after 5s
  const [forceReady, setForceReady] = useState(false);
  const [billingChecked, setBillingChecked] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setForceReady(true), 5000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if ((!isLoading || forceReady) && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, forceReady, router]);

  // SaaS gate: expired trial / locked → subscription-required (billing page still allowed)
  useEffect(() => {
    if (!token || !isAuthenticated) return;
    if (pathname?.startsWith("/dashboard/billing")) {
      setBillingChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await api.get<{
        access: { allowed: boolean; reason?: string };
      }>("/billing/access", token);
      if (cancelled) return;
      if (res.success && res.data?.access && !res.data.access.allowed) {
        router.replace("/subscription-required");
        return;
      }
      // 402 from API client may surface as error string
      if (!res.success && (res.error || "").toLowerCase().includes("subscription")) {
        router.replace("/subscription-required");
        return;
      }
      setBillingChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, isAuthenticated, pathname, router]);

  // Re-check auth when restoring from browser Back/forward cache
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted || !token) {
        const t =
          typeof window !== "undefined"
            ? localStorage.getItem("massive_mentor_token")
            : null;
        if (!t) {
          router.replace("/login");
        }
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [token, router]);

  // Only show loading while bootstrapping AND not forced ready
  if ((isLoading && !forceReady) || (isAuthenticated && !billingChecked && !pathname?.startsWith("/dashboard/billing"))) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
        <div className="text-center max-w-xs">
          <div
            className="mx-auto mb-4 h-10 w-10 rounded-2xl border border-violet-500/30 bg-violet-500/10 flex items-center justify-center"
            aria-hidden
          >
            <div className="h-5 w-5 rounded-full border-2 border-violet-400/40 border-t-violet-300 animate-spin" />
          </div>
          <div className="text-zinc-300 text-sm font-medium tracking-tight">Loading workspace…</div>
          <div className="text-zinc-600 text-xs mt-1.5">Restoring your session</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="text-zinc-500 text-sm">Redirecting to sign in…</div>
      </div>
    );
  }

  return (
    <PortalProvider>
      <PlanProvider>
        <DashboardShell>{children}</DashboardShell>
      </PlanProvider>
    </PortalProvider>
  );
}
