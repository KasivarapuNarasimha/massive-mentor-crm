"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface Week {
  week: number;
  title: string;
  tasks: string[];
}

interface Roadmap {
  id: string;
  title: string;
  days: {
    title: string;
    weeks: Week[];
  };
  aiModel: string;
  generatedAt: string;
}

export default function RoadmapPage() {
  const { token } = useAuth();
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  const fetchRoadmap = async () => {
    if (!token) return;
    setIsLoading(true);
    const response = await api.getRoadmap(token);

    if (response.success && response.data?.roadmap) {
      setRoadmap(response.data.roadmap as Roadmap);
    } else {
      setRoadmap(null);
    }
    setIsLoading(false);
  };

  const handleGenerate = async () => {
    if (!token) return;

    setIsGenerating(true);

    const response = await api.generateRoadmap(token);

    if (response.success && response.data?.roadmap) {
      setRoadmap(response.data.roadmap as Roadmap);
    } else {
      toast.error(response.error || "Failed to generate roadmap. Please ensure your business profile is complete.");
    }

    setIsGenerating(false);
  };

  useEffect(() => {
    fetchRoadmap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]); // fetchRoadmap stable intent for token-driven data load

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">30-Day Growth Roadmap</h1>
          <p className="text-muted-foreground mt-1">Personalized weekly action plan based on your business profile</p>
        </div>

        <button
          onClick={handleGenerate}
          disabled={isGenerating || isLoading}
          className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary-hover focus-ring button-active transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isGenerating ? "Generating..." : roadmap ? "Regenerate Roadmap" : "Generate Roadmap"}
        </button>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-6">
          {/* Roadmap header skeleton */}
          <div className="h-28 bg-card border border-border rounded-2xl" />
          {/* Week cards skeleton */}
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-44 bg-card border border-border rounded-2xl" />
          ))}
        </div>
      ) : roadmap ? (
        <div className="space-y-8">
          {/* Header */}
          <div className="bg-card border border-border rounded-2xl p-6 sm:p-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold">{roadmap.title}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Generated on {formatDate(roadmap.generatedAt)} • {roadmap.aiModel}
                </p>
              </div>
              <div className="text-xs px-3 py-1 bg-muted text-muted-foreground rounded-full w-fit">
                4 Weeks • 30 Days
              </div>
            </div>
          </div>

          {/* Weeks */}
          <div className="space-y-6">
            {roadmap.days?.weeks?.map((week: Week, index: number) => (
              <div key={index} className="bg-card border border-border rounded-2xl p-6 sm:p-7">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="text-sm font-medium text-emerald-400 tracking-widest">WEEK {week.week}</div>
                    <h3 className="text-xl font-semibold mt-1">{week.title}</h3>
                  </div>
                  <div className="text-xs px-2.5 py-1 bg-muted text-muted-foreground rounded">
                    Days {(week.week - 1) * 7 + 1}–{week.week * 7}
                  </div>
                </div>

                <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 mt-4">
                  {week.tasks.map((task: string, taskIndex: number) => (
                    <li key={taskIndex} className="flex gap-3 text-sm leading-relaxed text-foreground">
                      <span className="text-emerald-400 mt-1 text-lg leading-none">→</span>
                      <span>{task}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="text-xs text-muted-foreground text-center pt-4">
            This roadmap is generated by AI based on your current business profile. Regenerate after making significant updates to your profile for the most relevant advice.
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl p-8 sm:p-12 text-center">
          <div className="mx-auto w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mb-6">
            <span className="text-3xl">🗺️</span>
          </div>
          <h3 className="text-2xl font-semibold mb-3">No Roadmap Yet</h3>
          <p className="text-muted-foreground max-w-md mx-auto mb-8">
            Generate your personalized 30-day growth roadmap. It will be broken down into 4 weekly focus areas with specific actionable tasks.
          </p>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-8 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary-hover focus-ring button-active transition-colors disabled:opacity-60"
          >
            {isGenerating ? "Generating Roadmap..." : "Generate 30-Day Roadmap"}
          </button>
          <p className="text-xs text-muted-foreground mt-6">
            Complete your Business Profile first for the best results.
          </p>
        </div>
      )}
    </div>
  );
}
