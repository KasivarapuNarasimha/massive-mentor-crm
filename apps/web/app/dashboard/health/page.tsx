"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import Link from "next/link";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "sonner";

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

export default function HealthScorePage() {
  const { token } = useAuth();
  const [score, setScore] = useState<HealthScore | null>(null);
  const [recentScores, setRecentScores] = useState<HealthScore[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecalculating, setIsRecalculating] = useState(false);

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
      toast.error(response.error || "Failed to recalculate score. Make sure your profile is complete.");
    }

    setIsRecalculating(false);
  };

  useEffect(() => {
    fetchHealthScore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]); // fetchHealthScore is stable in intent for this mount/token effect; adding it would require useCallback and risk loops without benefit

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getScoreColor = (scoreValue: number) => {
    if (scoreValue >= 75) return "text-emerald-700 dark:text-emerald-400";
    if (scoreValue >= 55) return "text-amber-700 dark:text-amber-400";
    return "text-orange-700 dark:text-orange-400";
  };

  const getProgressColor = (scoreValue: number) => {
    if (scoreValue >= 75) return "bg-emerald-500";
    if (scoreValue >= 55) return "bg-amber-500";
    return "bg-orange-500";
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-6 overflow-x-hidden pb-24 md:pb-8">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="mm-page-title">Health Score</h1>
          <p className="mm-secondary mt-0.5">AI-powered analysis from your profile</p>
        </div>
        <Link href="/dashboard" className="mm-secondary hover:text-foreground focus-ring shrink-0" aria-label="Back to dashboard overview">
          ← Back to Overview
        </Link>
      </div>

      {isLoading ? (
        <div className="mm-card p-4 sm:p-5">
          <div className="animate-pulse">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <Skeleton className="h-5 w-40 mb-2" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-9 w-36 rounded-lg" />
            </div>

            {/* Big Score */}
            <div className="mb-6">
              <Skeleton className="h-3 w-28 mb-2" />
              <Skeleton className="h-16 w-32" />
            </div>

            {/* Insights area */}
            <div className="mb-6">
              <Skeleton className="h-3 w-24 mb-3" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>

            {/* Category Breakdown skeleton */}
            <div className="mb-6">
              <Skeleton className="h-3 w-36 mb-4" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                {[...Array(6)].map((_, i) => (
                  <div key={i}>
                    <div className="flex justify-between mb-1.5">
                      <Skeleton className="h-3 w-28" />
                      <Skeleton className="h-3 w-8" />
                    </div>
                    <Skeleton className="h-2 w-full" />
                  </div>
                ))}
              </div>
            </div>

            {/* Trend placeholder */}
            <div>
              <Skeleton className="h-3 w-36 mb-3" />
              <div className="flex gap-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex-1 px-3 py-2.5 rounded-lg border border-border bg-background">
                    <Skeleton className="h-7 w-full mb-2" />
                    <Skeleton className="h-2.5 w-20 mx-auto" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : score ? (
        <div className="mm-card p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <h2 className="text-base font-semibold">Business Health Score</h2>
              <p className="mm-secondary mt-0.5">Last calculated: {formatDate(score.calculatedAt)}</p>
            </div>
            <button
              onClick={handleRecalculate}
              disabled={isRecalculating}
              className="mm-btn mm-btn-secondary focus-ring shrink-0"
            >
              {isRecalculating ? "Recalculating..." : "Recalculate Score"}
            </button>
          </div>

          {/* Overall Score */}
          <div className="mb-6">
            <div className="mm-secondary font-medium tracking-wider uppercase mb-1">Overall score</div>
            <div 
              className={`text-5xl sm:text-6xl font-semibold tabular-nums tracking-tight leading-none ${getScoreColor(score.overallScore)}`}
              aria-label={`Overall health score: ${score.overallScore} out of 100`}
            >
              {score.overallScore}
            </div>
          </div>

          {/* AI Insights */}
          {score.insights && score.insights.length > 0 && (
            <div className="mb-6">
              <div className="mm-secondary font-medium tracking-wider uppercase mb-2.5">AI insights</div>
              <ul className="space-y-1.5 text-[13px] text-muted-foreground">
                {score.insights.map((insight, index) => (
                  <li key={index} className="flex gap-2">
                    <span className="text-emerald-600 dark:text-emerald-400 mt-0.5">→</span>
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Category Breakdown */}
          <div className="mb-6">
            <div className="mm-secondary font-medium tracking-wider uppercase mb-3">Category breakdown</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
              {(Object.keys(score.breakdown) as Array<keyof typeof score.breakdown>).map((key) => {
                const value = score.breakdown[key];
                return (
                  <div key={key}>
                    <div className="flex justify-between text-[13px] mb-1.5">
                      <span className="text-muted-foreground">{CATEGORY_LABELS[key]}</span>
                      <span className={`font-mono tabular-nums ${getScoreColor(value)}`}>{value}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={`${CATEGORY_LABELS[key]} score`}>
                      <div
                        className={`h-full transition-all duration-500 ${getProgressColor(value)}`}
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Trend History */}
          {recentScores.length > 0 && (
            <div>
              <div className="mm-secondary font-medium tracking-wider uppercase mb-2.5">Recent trend (last 3)</div>
              <div className="flex gap-3">
                {recentScores.slice().reverse().map((s: HealthScore, index: number) => (
                  <div key={index} className="flex-1 text-center px-3 py-2.5 rounded-lg border border-border bg-background">
                    <div className={`text-2xl font-semibold tabular-nums ${getScoreColor(s.overallScore)}`}>
                      {s.overallScore}
                    </div>
                    <div className="mm-secondary mt-1">
                      {formatDate(s.calculatedAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mm-card p-6 sm:p-8 text-center">
          <div className="mx-auto w-10 h-10 bg-muted rounded-lg flex items-center justify-center mb-3">
            <span className="text-lg">📊</span>
          </div>
          <h3 className="text-base font-semibold mb-1.5">No Health Score Yet</h3>
          <p className="mm-secondary mb-5 max-w-md mx-auto">
            Complete your business profile and click the button below to generate your first AI-powered analysis.
          </p>
          <button
            onClick={async () => {
              if (!token) return;
              setIsLoading(true);
              const response = await api.recalculateHealthScore(token);
              if (response.success && response.data?.score) {
                const newScore = response.data.score as HealthScore;
                setScore(newScore);
                setRecentScores([newScore]);
              }
              setIsLoading(false);
            }}
            className="mm-btn mm-btn-primary focus-ring"
          >
            Calculate Health Score
          </button>
        </div>
      )}
    </div>
  );
}
