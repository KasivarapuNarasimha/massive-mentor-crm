"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePlan } from "@/lib/plan-context";
import {
  FEATURE_LABELS,
  requiredPlanName,
  type FeatureKey,
} from "@/lib/plan-entitlements";

/**
 * Page-level plan gate — blocks content and offers upgrade for locked modules.
 */
export function FeatureGate({
  feature,
  children,
}: {
  feature: FeatureKey;
  children: ReactNode;
}) {
  const { can, loading, openLock } = usePlan();
  const allowed = can(feature);

  useEffect(() => {
    if (!loading && !allowed) openLock(feature);
  }, [loading, allowed, feature, openLock]);

  if (loading) {
    return (
      <div className="m-6 h-40 animate-pulse rounded-2xl bg-zinc-900 border border-zinc-800" />
    );
  }

  if (!allowed) {
    const label = FEATURE_LABELS[feature];
    const plan = requiredPlanName(feature);
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10 border border-violet-500/30">
          <svg
            className="h-8 w-8 text-violet-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-white tracking-tight">{label}</h1>
        <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
          Available on the <span className="text-violet-300 font-medium">{plan}</span>{" "}
          plan and above. Upgrade to unlock this module for your workspace.
        </p>
        <Link
          href="/dashboard/billing"
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-r from-violet-600 to-sky-600 px-6 text-sm font-semibold text-white shadow-lg shadow-violet-900/25 hover:opacity-95 transition"
        >
          View plans &amp; upgrade
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
