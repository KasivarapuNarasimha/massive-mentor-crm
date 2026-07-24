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
    if (scoreValue >= 75) return "text-emerald-400";
    if (scoreValue >= 55) return "text-yellow-400";
    return "text-orange-400";
  };

  const getProgressColor = (scoreValue: number) => {
    if (scoreValue >= 75) return "bg-emerald-500";
    if (scoreValue >= 55) return "bg-yellow-500";
    return "bg-orange-500";
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Health Score</h1>
          <p className="text-sm text-muted-foreground mt-1">AI-powered analysis from your profile</p>
        </div>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground focus-ring" aria-label="Back to dashboard overview">
          ← Back to Overview
        </Link>
      </div>

      {isLoading ? (
        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8">
          <div className="animate-pulse">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <Skeleton className="h-5 w-40 mb-2" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-9 w-36 rounded-xl" />
            </div>

            {/* Big Score */}
            <div className="mb-8">
              <Skeleton className="h-3 w-28 mb-2" />
              <Skeleton className="h-20 w-40" />
            </div>

            {/* Insights area */}
            <div className="mb-8">
              <Skeleton className="h-3 w-24 mb-3" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>

            {/* Category Breakdown skeleton */}
            <div className="mb-8">
              <Skeleton className="h-3 w-36 mb-4" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
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
              <div className="flex gap-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex-1 px-4 py-3 bg-background border border-border rounded-xl">
                    <Skeleton className="h-8 w-full mb-2" />
                    <Skeleton className="h-2.5 w-20 mx-auto" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : score ? (
        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 transition-colors hover:border-border">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold">Business Health Score</h2>
              <p className="text-sm text-muted-foreground">Last calculated: {formatDate(score.calculatedAt)}</p>
            </div>
            <button
              onClick={handleRecalculate}
              disabled={isRecalculating}
              className="px-5 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-sm font-medium focus-ring button-active transition-colors disabled:opacity-50"
            >
              {isRecalculating ? "Recalculating..." : "Recalculate Score"}
            </button>
          </div>

          {/* Overall Score */}
          <div className="mb-8">
            <div className="text-sm font-medium text-muted-foreground tracking-widest mb-1">OVERALL SCORE</div>
            <div 
              className={`text-7xl sm:text-8xl md:text-[92px] font-semibold tabular-nums tracking-[-4px] sm:tracking-[-6px] leading-none ${getScoreColor(score.overallScore)}`}
              aria-label={`Overall health score: ${score.overallScore} out of 100`}
            >
              {score.overallScore}
            </div>
          </div>

          {/* AI Insights */}
          {score.insights && score.insights.length > 0 && (
            <div className="mb-8">
              <div className="text-sm font-medium text-muted-foreground mb-3 tracking-widest">AI INSIGHTS</div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {score.insights.map((insight, index) => (
                  <li key={index} className="flex gap-2">
                    <span className="text-emerald-400 mt-1">→</span>
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Category Breakdown */}
          <div className="mb-8">
            <div className="text-sm font-medium text-muted-foreground mb-4 tracking-widest">CATEGORY BREAKDOWN</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
              {(Object.keys(score.breakdown) as Array<keyof typeof score.breakdown>).map((key) => {
                const value = score.breakdown[key];
                return (
                  <div key={key}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-muted-foreground">{CATEGORY_LABELS[key]}</span>
                      <span className={`font-mono ${getScoreColor(value)}`}>{value}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={`${CATEGORY_LABELS[key]} score`}>
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
              <div className="text-sm font-medium text-muted-foreground mb-3 tracking-widest">RECENT TREND (LAST 3)</div>
              <div className="flex gap-4">
                {recentScores.slice().reverse().map((s: HealthScore, index: number) => (
                  <div key={index} className="flex-1 text-center px-4 py-3 bg-background border border-border rounded-xl transition-colors hover:border-border">
                    <div className={`text-3xl font-semibold tabular-nums ${getScoreColor(s.overallScore)}`}>
                      {s.overallScore}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1.5">
                      {formatDate(s.calculatedAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl p-8 sm:p-12 text-center">
          <div className="mx-auto w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mb-6">
            <span className="text-3xl">📊</span>
          </div>
          <h3 className="text-2xl font-semibold mb-3">No Health Score Yet</h3>
          <p className="text-muted-foreground mb-8 max-w-md mx-auto">
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
            className="px-8 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary-hover focus-ring button-active transition-colors"
          >
            Calculate Health Score
          </button>
        </div>
      )}
    </div>
  );
}
