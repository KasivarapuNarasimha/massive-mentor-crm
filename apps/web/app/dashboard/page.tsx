"use client";

import { useState, useEffect, lazy, Suspense } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import Link from "next/link";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "sonner";
import { PremiumDashboard } from "@/components/dashboard/PremiumDashboard";
import { PageShell } from "@/components/ui/PageShell";

/** Lazy: config-driven widgets + AI follow-up — not needed for first paint */
const ConfigDashboard = lazy(() =>
  import("@/components/dashboard/ConfigDashboard").then((m) => ({ default: m.ConfigDashboard }))
);
const AiFollowupCenter = lazy(() =>
  import("@/components/ai/AiFollowupCenter").then((m) => ({ default: m.AiFollowupCenter }))
);

interface HealthScore {
  id: string;
  overallScore: number;
  breakdown: {
    profile: number;
    market: number;
    revenue: number;
    growth: number;
    marketing: number;
    operations: number;
  };
  insights: string[];
  calculatedAt: string;
}

const CATEGORY_LABELS: Record<keyof HealthScore["breakdown"], string> = {
  profile: "Profile Strength",
  market: "Market Fit",
  revenue: "Revenue",
  growth: "Growth Potential",
  marketing: "Marketing",
  operations: "Operations",
};

function getScoreColor(scoreValue: number) {
  if (scoreValue >= 75) return "text-emerald-400";
  if (scoreValue >= 55) return "text-yellow-400";
  return "text-orange-400";
}

function getProgressColor(scoreValue: number) {
  if (scoreValue >= 75) return "bg-emerald-500";
  if (scoreValue >= 55) return "bg-yellow-500";
  return "bg-orange-500";
}

export default function DashboardOverview() {
  const { token } = useAuth();
  const [score, setScore] = useState<HealthScore | null>(null);
  const [recentScores, setRecentScores] = useState<HealthScore[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const fetchHealthScore = async () => {
    if (!token) return;
    setIsLoading(true);
    const response = await api.getHealthScore(token);
    if (response.success && response.data) {
      if (response.data.score) {
        setScore(response.data.score as HealthScore);
      }
      setRecentScores((response.data.recent as HealthScore[]) || []);
    } else {
      setScore(null);
      setRecentScores([]);
    }
    setIsLoading(false);
  };

  const handleRecalculate = async () => {
    if (!token) return;
    setIsRecalculating(true);
    const response = await api.recalculateHealthScore(token);
    if (response.success && response.data?.score) {
      const newScore = response.data.score as HealthScore;
      setScore(newScore);
      setRecentScores([newScore, ...recentScores.slice(0, 2)]);
    } else {
      toast.error(
        response.error || "Failed to recalculate score. Make sure your profile is complete."
      );
    }
    setIsRecalculating(false);
  };

  useEffect(() => {
    void fetchHealthScore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <PageShell wide>
      {/* Premium first-impression dashboard */}
      <PremiumDashboard />

      {/* AI Follow-up (lazy) */}
      <section className="mt-8 sm:mt-10" aria-labelledby="followup-heading">
        <h2 id="followup-heading" className="text-lg font-semibold tracking-tight text-white mb-3">
          AI follow-up center
        </h2>
        <Suspense
          fallback={
            <div className="h-40 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900" />
          }
        >
          <AiFollowupCenter token={token} mode="both" limit={12} />
        </Suspense>
      </section>

      {/* Health score — refined secondary section */}
      <section className="mt-8 sm:mt-10" aria-labelledby="health-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 id="health-heading" className="text-lg font-semibold tracking-tight text-white">
              Business health score
            </h2>
            <p className="text-sm text-zinc-500">AI-powered analysis from your profile</p>
          </div>
          <button
            type="button"
            onClick={() => void handleRecalculate()}
            disabled={isRecalculating || isLoading}
            className="px-4 py-2 min-h-10 bg-white/10 hover:bg-white/15 border border-white/15 rounded-xl text-sm font-medium focus-ring button-active disabled:opacity-50"
          >
            {isRecalculating ? "Recalculating…" : "Recalculate"}
          </button>
        </div>

        {isLoading ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 animate-pulse">
            <Skeleton className="h-16 w-28 mb-4" />
            <Skeleton className="h-3 w-full mb-2" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : score ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 sm:p-7 mm-card-hover">
            <div className="flex flex-col md:flex-row md:items-end gap-6">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-1">
                  Overall score
                </div>
                <div
                  className={`text-6xl sm:text-7xl font-semibold tabular-nums tracking-tight leading-none ${getScoreColor(score.overallScore)}`}
                  aria-label={`Overall health score: ${score.overallScore} out of 100`}
                >
                  {score.overallScore}
                </div>
                <div className="text-xs text-zinc-500 mt-2">
                  Updated {formatDate(score.calculatedAt)}
                </div>
              </div>
              {score.insights && score.insights.length > 0 && (
                <div className="flex-1 md:pl-8 border-t md:border-t-0 md:border-l border-zinc-800 pt-4 md:pt-0">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-2">
                    Key insights
                  </div>
                  <ul className="space-y-2 text-sm text-zinc-300">
                    {score.insights.slice(0, 4).map((insight, index) => (
                      <li key={index} className="flex gap-2">
                        <span className="text-violet-400 mt-0.5" aria-hidden>
                          →
                        </span>
                        <span>{insight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="mt-8 pt-6 border-t border-zinc-800">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
                {(Object.keys(score.breakdown) as Array<keyof typeof score.breakdown>).map(
                  (key) => {
                    const value = score.breakdown[key];
                    return (
                      <div key={key}>
                        <div className="flex justify-between text-sm mb-1.5">
                          <span className="text-zinc-400">{CATEGORY_LABELS[key]}</span>
                          <span className={`font-mono tabular-nums ${getScoreColor(value)}`}>
                            {value}
                          </span>
                        </div>
                        <div
                          className="h-2 bg-zinc-800 rounded-full overflow-hidden"
                          role="progressbar"
                          aria-valuenow={value}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${CATEGORY_LABELS[key]} score`}
                        >
                          <div
                            className={`h-full transition-all duration-500 ${getProgressColor(value)}`}
                            style={{ width: `${value}%` }}
                          />
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            </div>
            {recentScores.length > 0 && (
              <div className="mt-6 pt-5 border-t border-zinc-800">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-3">
                  Trend
                </div>
                <div className="flex gap-3">
                  {recentScores
                    .slice()
                    .reverse()
                    .map((s, index) => (
                      <div
                        key={index}
                        className="flex-1 text-center px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl"
                      >
                        <div
                          className={`text-xl font-semibold tabular-nums ${getScoreColor(s.overallScore)}`}
                        >
                          {s.overallScore}
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-1">
                          {formatDate(s.calculatedAt)}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-800 border border-zinc-700">
              <span className="text-2xl" aria-hidden>
                📊
              </span>
            </div>
            <h3 className="text-lg font-semibold text-white">No health score yet</h3>
            <p className="mt-2 text-sm text-zinc-500 max-w-md mx-auto">
              Complete your business profile, then calculate your first AI-powered health analysis.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link
                href="/dashboard/profile"
                className="min-h-10 px-4 inline-flex items-center rounded-xl border border-zinc-700 text-sm font-medium text-zinc-200 hover:bg-zinc-800 focus-ring"
              >
                Update profile
              </Link>
              <button
                type="button"
                onClick={() => void handleRecalculate()}
                disabled={isRecalculating}
                className="min-h-10 px-5 rounded-xl bg-white text-zinc-950 text-sm font-semibold hover:bg-zinc-100 focus-ring button-active disabled:opacity-50"
              >
                {isRecalculating ? "Calculating…" : "Calculate score"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Advanced role analytics — collapsed by default for fast first paint */}
      <section className="mt-8 sm:mt-10 pb-4" aria-labelledby="advanced-heading">
        <button
          type="button"
          id="advanced-heading"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          className="w-full flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-3.5 text-left focus-ring"
        >
          <div>
            <div className="text-sm font-semibold text-white">Role analytics &amp; widgets</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              Configuration-driven charts for your workspace role
            </div>
          </div>
          <span className="text-zinc-400 text-sm" aria-hidden>
            {showAdvanced ? "▾" : "▸"}
          </span>
        </button>
        {showAdvanced && (
          <div className="mt-4">
            <Suspense
              fallback={
                <div className="h-48 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900" />
              }
            >
              <ConfigDashboard />
            </Suspense>
          </div>
        )}
      </section>
    </PageShell>
  );
}
