"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PortalProvider } from "@/lib/portal-context";
import { PlanProvider } from "@/lib/plan-context";
import { AiQuotaModalProvider } from "@/lib/ai-quota-modal-context";
import { ModuleGate } from "@/components/permissions/ModuleGate";
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

  // Fail-safe: never leave the restore splash forever if billing check stalls
  useEffect(() => {
    const t = window.setTimeout(() => setBillingChecked(true), 8000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if ((!isLoading || forceReady) && !isAuthenticated) {
      // On demo.massivementor.in, /login is rewritten to /demo by middleware — go there directly.
      const host = typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
      const loginPath = host.startsWith("demo.") ? "/demo" : "/login";
      router.replace(loginPath);
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
      try {
        const res = await api.get<{
          access: { allowed: boolean; reason?: string };
        }>("/billing/access", token);
        if (cancelled) return;
        if (res.success && res.data?.access && !res.data.access.allowed) {
          setBillingChecked(true);
          router.replace("/subscription-required");
          return;
        }
        // 402 from API client may surface as error string
        if (!res.success && (res.error || "").toLowerCase().includes("subscription")) {
          setBillingChecked(true);
          router.replace("/subscription-required");
          return;
        }
      } catch {
        // Network/transient errors must not trap the UI on the restore splash
      } finally {
        if (!cancelled) setBillingChecked(true);
      }
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
          const host = window.location.hostname.toLowerCase();
          router.replace(host.startsWith("demo.") ? "/demo" : "/login");
        }
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [token, router]);

  // Only show loading while bootstrapping AND not forced ready
  if ((isLoading && !forceReady) || (isAuthenticated && !billingChecked && !pathname?.startsWith("/dashboard/billing"))) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-xs">
          <div
            className="mx-auto mb-4 h-9 w-9 rounded-md border border-border bg-card flex items-center justify-center"
            aria-hidden
          >
            <div className="h-4 w-4 rounded-full border-2 border-border border-t-foreground/70 animate-spin" />
          </div>
          <div className="text-muted-foreground text-sm font-medium tracking-tight">Loading workspace…</div>
          <div className="text-muted-foreground text-xs mt-1.5">Restoring your session</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Redirecting to sign in…</div>
      </div>
    );
  }

  return (
    <PortalProvider>
      <PlanProvider>
        <AiQuotaModalProvider>
          <DashboardShell>
            <ModuleGate>{children}</ModuleGate>
          </DashboardShell>
        </AiQuotaModalProvider>
      </PlanProvider>
    </PortalProvider>
  );
}
