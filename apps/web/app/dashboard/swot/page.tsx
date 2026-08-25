"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface SWOT {
  id: string;
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
  summary: string;
  aiModel: string;
  createdAt: string;
}

const SWOT_CATEGORIES = [
  { key: "strengths" as const, label: "Strengths", color: "emerald", description: "Internal advantages" },
  { key: "weaknesses" as const, label: "Weaknesses", color: "rose", description: "Internal disadvantages" },
  { key: "opportunities" as const, label: "Opportunities", color: "blue", description: "External possibilities" },
  { key: "threats" as const, label: "Threats", color: "amber", description: "External risks" },
];

export default function SWOTPage() {
  const { token } = useAuth();
  const [swot, setSwot] = useState<SWOT | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  const fetchLatestSWOT = async () => {
    if (!token) return;
    setIsLoading(true);

    const response = await api.getLatestSWOT(token);

    if (response.success && response.data?.swot) {
      setSwot(response.data.swot as SWOT);
    } else {
      setSwot(null);
    }
    setIsLoading(false);
  };

  const handleGenerate = async () => {
    if (!token) return;

    setIsGenerating(true);

    const response = await api.generateSWOT(token);

    if (response.success && response.data?.swot) {
      setSwot(response.data.swot as SWOT);
    } else {
      toast.error(response.error || "Failed to generate SWOT analysis. Please ensure your business profile is complete.");
    }

    setIsGenerating(false);
  };

  useEffect(() => {
    fetchLatestSWOT();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]); // fetchLatestSWOT stable intent for token-driven data load

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getColorClasses = (color: string) => {
    const colors: Record<string, { bg: string; border: string; text: string; accent: string }> = {
      emerald: {
        bg: "bg-emerald-50 dark:bg-emerald-950/30",
        border: "border-emerald-200 dark:border-emerald-800",
        text: "text-emerald-700 dark:text-emerald-400",
        accent: "bg-emerald-500",
      },
      rose: {
        bg: "bg-rose-50 dark:bg-rose-950/30",
        border: "border-rose-200 dark:border-rose-800",
        text: "text-rose-700 dark:text-rose-400",
        accent: "bg-rose-500",
      },
      blue: {
        bg: "bg-blue-50 dark:bg-blue-950/30",
        border: "border-blue-200 dark:border-blue-800",
        text: "text-blue-700 dark:text-blue-400",
        accent: "bg-blue-500",
      },
      amber: {
        bg: "bg-amber-50 dark:bg-amber-950/30",
        border: "border-amber-200 dark:border-amber-800",
        text: "text-amber-700 dark:text-amber-400",
        accent: "bg-amber-500",
      },
    };
    return colors[color];
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6 overflow-x-hidden pb-24 md:pb-8">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="mm-page-title">SWOT Analysis</h1>
          <p className="mm-secondary mt-0.5">Strategic analysis powered by AI</p>
        </div>

        <button
          onClick={handleGenerate}
          disabled={isGenerating || isLoading}
          className="mm-btn mm-btn-primary focus-ring shrink-0"
        >
          {isGenerating ? "Generating..." : swot ? "Regenerate SWOT" : "Generate SWOT"}
        </button>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-20 mm-card" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-52 mm-card" />
            ))}
          </div>
        </div>
      ) : swot ? (
        <div className="space-y-4">
          {/* Summary */}
          <div className="mm-card p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-3">
              <div className="mm-secondary font-medium tracking-wider uppercase">Executive summary</div>
              <div className="mm-secondary">
                Generated on {formatDate(swot.createdAt)} • {swot.aiModel}
              </div>
            </div>
            <p className="text-[13px] leading-relaxed text-foreground">{swot.summary}</p>
          </div>

          {/* 2x2 SWOT Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {SWOT_CATEGORIES.map(({ key, label, color, description }) => {
              const items = swot[key];
              const colors = getColorClasses(color);

              return (
                <div key={key} className={`${colors.bg} border ${colors.border} rounded-lg p-4`}>
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${colors.accent}`} />
                    <div>
                      <div className={`text-sm font-semibold ${colors.text}`}>{label}</div>
                      <div className="mm-secondary">{description}</div>
                    </div>
                  </div>

                  <ul className="space-y-2 mt-3">
                    {items.length > 0 ? (
                      items.map((item, index) => (
                        <li key={index} className="flex gap-2 text-[13px] leading-relaxed text-foreground">
                          <span className={`${colors.text} mt-1 block leading-none`}>•</span>
                          <span>{item}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-[13px] text-muted-foreground italic">No items generated</li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="mm-secondary text-center pt-2">
            This analysis was generated using AI based on your current business profile. Regenerate after updating your profile for more accurate insights.
          </div>
        </div>
      ) : (
        <div className="mm-card p-6 sm:p-8 text-center">
          <div className="mx-auto w-10 h-10 bg-muted rounded-lg flex items-center justify-center mb-3">
            <span className="text-lg">📊</span>
          </div>
          <h3 className="text-base font-semibold mb-1.5">No SWOT Analysis Yet</h3>
          <p className="mm-secondary max-w-md mx-auto mb-5">
            Generate your first AI-powered SWOT analysis using the data from your business profile.
          </p>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="mm-btn mm-btn-primary focus-ring"
          >
            {isGenerating ? "Generating SWOT..." : "Generate SWOT Analysis"}
          </button>
          <p className="mm-secondary mt-4">
            Make sure your Business Profile is complete for the best results.
          </p>
        </div>
      )}
    </div>
  );
}
