"use client";

import Link from "next/link";
import type { FeatureKey } from "@/lib/plan-entitlements";

type Props = {
  open: boolean;
  feature: FeatureKey | null;
  featureLabel: string;
  requiredPlan: string;
  onClose: () => void;
};

/**
 * Premium upgrade modal when a locked plan feature is opened.
 */
export function FeatureLockModal({
  open,
  featureLabel,
  requiredPlan,
  onClose,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feature-lock-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-border bg-gradient-to-b from-zinc-900 to-background shadow-2xl shadow-black/50 p-6 sm:p-8 animate-in slide-in-from-bottom duration-200">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-sky-500/20 border border-violet-500/30">
          <svg
            className="h-7 w-7 text-violet-300"
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
        <h2
          id="feature-lock-title"
          className="text-center text-xl font-semibold tracking-tight text-foreground"
        >
          Unlock {featureLabel || "this feature"}
        </h2>
        <p className="mt-3 text-center text-sm leading-relaxed text-muted-foreground">
          This feature is available only in the{" "}
          <span className="font-semibold text-violet-300">{requiredPlan}</span>{" "}
          plan.
          {featureLabel ? (
            <>
              {" "}
              Upgrade now to unlock{" "}
              <span className="text-foreground">{featureLabel}</span>.
            </>
          ) : null}
        </p>
        <div className="mt-7 flex flex-col-reverse sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-11 rounded-xl border border-border bg-card/80 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Maybe Later
          </button>
          <Link
            href="/dashboard/billing"
            onClick={onClose}
            className="flex-1 min-h-11 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-violet-600 to-sky-600 text-sm font-semibold text-foreground shadow-lg shadow-violet-900/30 hover:from-violet-500 hover:to-sky-500 transition-all"
          >
            Upgrade Now
          </Link>
        </div>
      </div>
    </div>
  );
}
