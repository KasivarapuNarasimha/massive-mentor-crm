"use client";

import Link from "next/link";
import {
  AI_QUOTA_BILLING_HREF,
  AI_QUOTA_PLAN_ROWS,
  matchPlanRowKey,
} from "@/lib/ai-quota-ui";

type Props = {
  open: boolean;
  planLabel: string;
  dailyLimit: number;
  onClose: () => void;
};

/**
 * Conversion modal when Massive Mentor AI daily CRM quota is exhausted.
 * Navigates to existing /dashboard/billing — does not embed payment logic.
 */
export function AiQuotaUpgradeModal({ open, planLabel, dailyLimit, onClose }: Props) {
  if (!open) return null;

  const currentKey = matchPlanRowKey(planLabel);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-quota-upgrade-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-border bg-gradient-to-b from-zinc-900 via-zinc-950 to-background shadow-2xl shadow-black/50 p-5 sm:p-7">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-white/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
          aria-label="Close"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/25 to-fuchsia-500/20 border border-violet-500/35">
          <span className="text-2xl" aria-hidden>
            🚀
          </span>
        </div>

        <h2
          id="ai-quota-upgrade-title"
          className="text-center text-xl sm:text-2xl font-semibold tracking-tight text-foreground pr-8"
        >
          Massive Mentor AI limit reached 🚀
        </h2>

        <p className="mt-3 text-center text-sm leading-relaxed text-muted-foreground">
          You&apos;ve used all{" "}
          <span className="font-semibold text-foreground">{dailyLimit}</span> AI actions included in
          your <span className="font-semibold text-violet-300">{planLabel}</span> plan for today.
        </p>
        <p className="mt-2 text-center text-sm leading-relaxed text-muted-foreground">
          Need more AI power? Upgrade your plan and continue working without waiting for the daily
          reset.
        </p>

        <div className="mt-5 rounded-2xl border border-border/80 bg-card/40 overflow-hidden">
          <ul className="divide-y divide-border/70">
            {AI_QUOTA_PLAN_ROWS.map((row) => {
              const isCurrent = row.key === currentKey;
              return (
                <li
                  key={row.key}
                  className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${
                    isCurrent ? "bg-violet-500/10" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className={`font-medium ${isCurrent ? "text-violet-200" : "text-foreground"}`}>
                      {row.label}
                      {isCurrent ? (
                        <span className="ml-2 inline-flex rounded-full border border-violet-400/40 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                          Current Plan
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div
                    className={`shrink-0 text-xs sm:text-sm ${
                      isCurrent ? "text-violet-200 font-semibold" : "text-muted-foreground"
                    }`}
                  >
                    {row.limitLabel}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row gap-2.5">
          <Link
            href={AI_QUOTA_BILLING_HREF}
            onClick={onClose}
            className="flex-1 min-h-11 inline-flex items-center justify-center rounded-xl border border-border bg-card/80 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            View Plans
          </Link>
          <Link
            href={AI_QUOTA_BILLING_HREF}
            onClick={onClose}
            className="flex-1 min-h-11 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 hover:from-violet-500 hover:to-fuchsia-500 transition-all"
          >
            Upgrade Now
          </Link>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full min-h-10 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
