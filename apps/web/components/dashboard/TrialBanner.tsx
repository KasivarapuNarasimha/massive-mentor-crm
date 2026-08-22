"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePlan } from "@/lib/plan-context";
import { isDemoModeClient } from "@/lib/demo-session";

/**
 * Top trial countdown banner — driven by live PlanProvider (SSE + access).
 * Hides instantly when Super Admin ends trial / activates a paid plan.
 * Never shown in Demo Mode (sample workspace is not a real trial).
 */
export function TrialBanner() {
  const { isTrial, trialDaysRemaining, plan, loading } = usePlan();
  const [isDemoMode, setIsDemoMode] = useState(false);

  useEffect(() => {
    setIsDemoMode(isDemoModeClient());
  }, []);

  if (isDemoMode) return null;
  if (loading) return null;
  if (!isTrial || trialDaysRemaining == null) return null;

  // Product rule: free trial display capped at 3 days remaining
  const days = Math.min(Math.max(0, trialDaysRemaining), 3);

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
      <span className="font-medium">
        {msg}
        {plan && plan !== "trial" ? (
          <span className="opacity-80 font-normal"> · Plan: {plan}</span>
        ) : null}
      </span>
      <Link
        href="/dashboard/billing"
        className="underline font-semibold shrink-0 hover:opacity-90"
      >
        Upgrade plan
      </Link>
    </div>
  );
}
