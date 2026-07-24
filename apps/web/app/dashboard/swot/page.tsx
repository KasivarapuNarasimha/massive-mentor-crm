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
      emerald: { bg: "bg-emerald-950/50", border: "border-emerald-800", text: "text-emerald-400", accent: "bg-emerald-500" },
      rose: { bg: "bg-rose-950/50", border: "border-rose-800", text: "text-rose-400", accent: "bg-rose-500" },
      blue: { bg: "bg-blue-950/50", border: "border-blue-800", text: "text-blue-400", accent: "bg-blue-500" },
      amber: { bg: "bg-amber-950/50", border: "border-amber-800", text: "text-amber-400", accent: "bg-amber-500" },
    };
    return colors[color];
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">SWOT Analysis</h1>
          <p className="text-muted-foreground mt-1">Strategic analysis powered by AI</p>
        </div>

        <button
          onClick={handleGenerate}
          disabled={isGenerating || isLoading}
          className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary-hover focus-ring button-active transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isGenerating ? "Generating..." : swot ? "Regenerate SWOT" : "Generate SWOT"}
        </button>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-6">
          <div className="h-24 bg-card border border-border rounded-2xl" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-64 bg-card border border-border rounded-2xl" />
            ))}
          </div>
        </div>
      ) : swot ? (
        <div className="space-y-8">
          {/* Summary */}
          <div className="bg-card border border-border rounded-2xl p-6 sm:p-8">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-medium text-muted-foreground tracking-widest">EXECUTIVE SUMMARY</div>
              <div className="text-xs text-muted-foreground">
                Generated on {formatDate(swot.createdAt)} • {swot.aiModel}
              </div>
            </div>
            <p className="text-lg leading-relaxed text-foreground">{swot.summary}</p>
          </div>

          {/* 2x2 SWOT Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {SWOT_CATEGORIES.map(({ key, label, color, description }) => {
              const items = swot[key];
              const colors = getColorClasses(color);

              return (
                <div key={key} className={`${colors.bg} border ${colors.border} rounded-2xl p-6 sm:p-7`}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-3 h-3 rounded-full ${colors.accent}`} />
                    <div>
                      <div className={`text-xl font-semibold ${colors.text}`}>{label}</div>
                      <div className="text-xs text-muted-foreground">{description}</div>
                    </div>
                  </div>

                  <ul className="space-y-3 mt-5">
                    {items.length > 0 ? (
                      items.map((item, index) => (
                        <li key={index} className="flex gap-3 text-sm leading-relaxed text-foreground">
                          <span className={`${colors.text} mt-1.5 block text-lg leading-none`}>•</span>
                          <span>{item}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-sm text-muted-foreground italic">No items generated</li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="text-xs text-muted-foreground text-center pt-4">
            This analysis was generated using AI based on your current business profile. Regenerate after updating your profile for more accurate insights.
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl p-8 sm:p-12 text-center">
          <div className="mx-auto w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mb-6">
            <span className="text-3xl">📊</span>
          </div>
          <h3 className="text-2xl font-semibold mb-3">No SWOT Analysis Yet</h3>
          <p className="text-muted-foreground max-w-md mx-auto mb-8">
            Generate your first AI-powered SWOT analysis using the data from your business profile.
          </p>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-8 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary-hover focus-ring button-active transition-colors disabled:opacity-60"
          >
            {isGenerating ? "Generating SWOT..." : "Generate SWOT Analysis"}
          </button>
          <p className="text-xs text-muted-foreground mt-6">
            Make sure your Business Profile is complete for the best results.
          </p>
        </div>
      )}
    </div>
  );
}
