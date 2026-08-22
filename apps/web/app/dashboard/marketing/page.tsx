"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useAiQuotaModalOptional } from "@/lib/ai-quota-modal-context";
import { friendlyError } from "@/lib/user-messages";

interface ReelIdea {
  title: string;
  description: string;
  hook: string;
}

interface AdCopies {
  facebook: string[];
  instagram: string[];
  google: string[];
}

interface MarketingPlanWeek {
  week: number;
  focus: string;
  channels: string[];
  tasks: string[];
  kpis: string[];
}

interface MarketingPlan {
  overview: string;
  weeks: MarketingPlanWeek[];
}

interface MarketingResult {
  reelIdeas: ReelIdea[];
  adCopies: AdCopies;
  hashtags: string[];
  marketingPlan: MarketingPlan;
}

export default function MarketingAIPage() {
  const { token } = useAuth();
  const quotaModal = useAiQuotaModalOptional();

  const [formData, setFormData] = useState({
    businessName: "",
    industry: "",
    location: "",
    targetAudience: "",
    goal: "",
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<MarketingResult | null>(null);
  const [usedInputs, setUsedInputs] = useState<{
    businessName?: string;
    industry?: string;
  } | null>(null);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token) return;

    const { businessName, industry, targetAudience, goal } = formData;

    if (!businessName || !industry || !targetAudience || !goal) {
      toast.error("Please fill in Business Name, Industry, Target Audience, and Business Goal.");
      return;
    }

    setIsGenerating(true);

    const response = await api.generateMarketing(formData, token);

    if (response.success && response.data?.result) {
      setResult(response.data.result as MarketingResult);
      setUsedInputs(response.data.inputs);
      toast.success("Marketing content generated successfully!");
    } else if (!quotaModal?.handleAiQuotaResponse(response)) {
      toast.error(
        friendlyError(response.error, "Failed to generate marketing content. Please try again.")
      );
    }

    setIsGenerating(false);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const copyAllHashtags = () => {
    if (!result) return;
    const text = result.hashtags.join(" ");
    copyToClipboard(text, "All hashtags");
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Marketing AI</h1>
          <p className="text-muted-foreground mt-1">Generate targeted marketing content powered by AI</p>
        </div>
      </div>

      {/* Input Form */}
      <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 mb-8">
        <h2 className="text-xl font-semibold mb-6">Marketing Brief</h2>

        <form onSubmit={handleGenerate} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Business Name *</label>
              <input
                type="text"
                value={formData.businessName}
                onChange={(e) => handleChange("businessName", e.target.value)}
                placeholder="Acme Coffee Co."
                className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-white/30"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Industry *</label>
              <input
                type="text"
                value={formData.industry}
                onChange={(e) => handleChange("industry", e.target.value)}
                placeholder="Coffee / Food & Beverage"
                className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-white/30"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Location</label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => handleChange("location", e.target.value)}
                placeholder="San Francisco, CA"
                className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-white/30"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Target Audience *</label>
              <input
                type="text"
                value={formData.targetAudience}
                onChange={(e) => handleChange("targetAudience", e.target.value)}
                placeholder="Young professionals aged 25-35 who value quality coffee"
                className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-white/30"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">Business Goal *</label>
            <textarea
              value={formData.goal}
              onChange={(e) => handleChange("goal", e.target.value)}
              placeholder="Increase brand awareness and drive more foot traffic to our new location"
              rows={3}
              className="w-full px-4 py-3 bg-background border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-white/30 resize-y"
              required
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isGenerating}
              className="w-full sm:w-auto px-8 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary-hover focus-ring button-active transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <div className="w-4 h-4 border-2 border-foreground border-t-transparent rounded-full animate-spin" />
                  Generating Marketing Content...
                </>
              ) : (
                "Generate Marketing Content"
              )}
            </button>
            <p className="text-xs text-muted-foreground mt-2">
              This will use AI to create personalized reel ideas, ad copies, hashtags, and a 30-day plan.
            </p>
          </div>
        </form>
      </div>

      {/* Results */}
      {isGenerating && (
        <div className="space-y-6 animate-pulse">
          <div className="h-8 bg-muted rounded w-48" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-6 h-48" />
          ))}
        </div>
      )}

      {result && !isGenerating && (
        <div className="space-y-8">
          {/* Used Inputs Summary */}
          {usedInputs && (
            <div className="text-sm text-muted-foreground">
              Generated for: <span className="text-foreground font-medium">{usedInputs.businessName}</span> • {usedInputs.industry}
            </div>
          )}

          {/* Reel Ideas */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-semibold tracking-tight">Reel Ideas</h2>
              <span className="text-xs px-3 py-1 bg-white/10 text-white/60 rounded-full">{result.reelIdeas.length} ideas</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {result.reelIdeas.map((idea, index) => (
                <div key={index} className="bg-card border border-border rounded-2xl p-5 hover:border-border transition-colors">
                  <div className="font-semibold text-foreground mb-2">{idea.title}</div>
                  <p className="text-sm text-muted-foreground mb-3">{idea.description}</p>
                  <div className="text-xs text-emerald-400 font-mono bg-background px-3 py-1.5 rounded-lg border border-border">
                    Hook: {idea.hook}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Ad Copies */}
          <section>
            <h2 className="text-2xl font-semibold tracking-tight mb-4">Ad Copies</h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {(["facebook", "instagram", "google"] as const).map((platform) => (
                <div key={platform} className="bg-card border border-border rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="font-semibold capitalize">{platform} Ads</div>
                    <button
                      onClick={() => copyToClipboard(result.adCopies[platform].join("\n\n"), `${platform} ad copies`)}
                      className="text-xs px-2.5 py-1 bg-white/5 hover:bg-white/10 rounded-md transition-colors"
                    >
                      Copy All
                    </button>
                  </div>
                  <div className="space-y-4 text-sm">
                    {result.adCopies[platform].map((copy, idx) => (
                      <div key={idx} className="bg-background border border-border p-3 rounded-xl text-muted-foreground leading-relaxed">
                        {copy}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Hashtags */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-semibold tracking-tight">Hashtags</h2>
              <button
                onClick={copyAllHashtags}
                className="text-xs px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
              >
                Copy All
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {result.hashtags.map((tag, index) => (
                <button
                  key={index}
                  onClick={() => copyToClipboard(tag, "Hashtag")}
                  className="px-3 py-1.5 bg-card border border-border hover:border-white/30 rounded-full text-sm text-muted-foreground transition-colors"
                >
                  {tag}
                </button>
              ))}
            </div>
          </section>

          {/* 30-Day Marketing Plan */}
          <section>
            <h2 className="text-2xl font-semibold tracking-tight mb-4">30-Day Marketing Plan</h2>

            <div className="bg-card border border-border rounded-2xl p-6 mb-6">
              <div className="text-sm text-muted-foreground mb-2">STRATEGY OVERVIEW</div>
              <p className="text-foreground leading-relaxed">{result.marketingPlan.overview}</p>
            </div>

            <div className="space-y-4">
              {result.marketingPlan.weeks.map((week) => (
                <div key={week.week} className="bg-card border border-border rounded-2xl p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="text-xs font-mono bg-white/10 text-foreground px-2.5 py-1 rounded">WEEK {week.week}</div>
                    <div className="font-semibold text-lg">{week.focus}</div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
                    <div>
                      <div className="text-muted-foreground text-xs tracking-widest mb-2">CHANNELS</div>
                      <div className="flex flex-wrap gap-1.5">
                        {week.channels.map((ch, i) => (
                          <span key={i} className="px-2 py-0.5 bg-muted rounded text-xs">{ch}</span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-muted-foreground text-xs tracking-widest mb-2">KEY TASKS</div>
                      <ul className="space-y-1 text-muted-foreground">
                        {week.tasks.map((task, i) => (
                          <li key={i} className="flex gap-2">• {task}</li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <div className="text-muted-foreground text-xs tracking-widest mb-2">KPIs</div>
                      <ul className="space-y-1 text-emerald-400 text-sm">
                        {week.kpis.map((kpi, i) => (
                          <li key={i}>→ {kpi}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="text-center pt-4">
            <button
              onClick={() => {
                setResult(null);
                setUsedInputs(null);
              }}
              className="text-sm text-muted-foreground hover:text-foreground underline"
            >
              Generate new content
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
