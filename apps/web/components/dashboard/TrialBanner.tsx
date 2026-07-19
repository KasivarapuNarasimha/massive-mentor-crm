"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

/**
 * Top trial countdown banner — blue / orange / red by days remaining.
 */
export function TrialBanner() {
  const { token, isAuthenticated } = useAuth();
  const [days, setDays] = useState<number | null>(null);
  const [isTrial, setIsTrial] = useState(false);

  useEffect(() => {
    if (!token || !isAuthenticated) return;
    let cancelled = false;
    (async () => {
      const res = await api.get<{
        access: { allowed: boolean; isTrial: boolean; trialDaysRemaining: number | null; reason?: string };
      }>("/billing/access", token);
      if (cancelled || !res.success || !res.data?.access) return;
      const a = res.data.access;
      if (!a.allowed && a.reason) {
        // Hard lock handled by dashboard layout redirect
        return;
      }
      setIsTrial(!!a.isTrial);
      // Product rule: free trial is 3 days — never display inflated remaining
      const rem = a.trialDaysRemaining;
      setDays(rem == null ? null : Math.min(Math.max(0, rem), 3));
    })();
    return () => {
      cancelled = true;
    };
  }, [token, isAuthenticated]);

  if (!isTrial || days == null) return null;

  const tone =
    days <= 0
      ? "bg-red-950/95 border-red-800 text-red-100"
      : days === 1
        ? "bg-red-950/90 border-red-800/80 text-red-100"
        : days === 2
          ? "bg-amber-950/90 border-amber-700/80 text-amber-100"
          : "bg-sky-950/90 border-sky-800/80 text-sky-100";

  const msg =
    days <= 0
      ? "Today is your last trial day."
      : days === 1
        ? "Only 1 day remaining."
        : days === 2
          ? "Only 2 days remaining."
          : `Your Free Trial expires in ${days} days.`;

  return (
    <div
      className={`w-full border-b px-3 sm:px-5 py-2 text-xs sm:text-sm flex flex-wrap items-center justify-between gap-2 ${tone}`}
      role="status"
      data-testid="trial-banner"
    >
      <span className="font-medium">{msg}</span>
      <Link
        href="/dashboard/billing"
        className="underline font-semibold shrink-0 hover:opacity-90"
      >
        Upgrade plan
      </Link>
    </div>
  );
}
