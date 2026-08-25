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
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-5 lg:py-6 overflow-x-hidden pb-20 md:pb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="mm-page-title">Marketing AI</h1>
          <p className="mm-secondary mt-1">Generate targeted marketing content powered by AI</p>
        </div>
      </div>

      <div className="mm-card p-4 sm:p-5 mb-4">
        <h2 className="text-sm font-semibold mb-3">Marketing Brief</h2>

        <form onSubmit={handleGenerate} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="mm-label">Business Name *</label>
              <input
                type="text"
                value={formData.businessName}
                onChange={(e) => handleChange("businessName", e.target.value)}
                placeholder="Acme Coffee Co."
                className="mm-input"
                required
              />
            </div>

            <div>
              <label className="mm-label">Industry *</label>
              <input
                type="text"
                value={formData.industry}
                onChange={(e) => handleChange("industry", e.target.value)}
                placeholder="Coffee / Food & Beverage"
                className="mm-input"
                required
              />
            </div>

            <div>
              <label className="mm-label">Location</label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => handleChange("location", e.target.value)}
                placeholder="San Francisco, CA"
                className="mm-input"
              />
            </div>

            <div>
              <label className="mm-label">Target Audience *</label>
              <input
                type="text"
                value={formData.targetAudience}
                onChange={(e) => handleChange("targetAudience", e.target.value)}
                placeholder="Young professionals aged 25-35 who value quality coffee"
                className="mm-input"
                required
              />
            </div>
          </div>

          <div>
            <label className="mm-label">Business Goal *</label>
            <textarea
              value={formData.goal}
              onChange={(e) => handleChange("goal", e.target.value)}
              placeholder="Increase brand awareness and drive more foot traffic to our new location"
              rows={3}
              className="mm-input resize-y"
              required
            />
          </div>

          <div className="pt-1">
            <button
              type="submit"
              disabled={isGenerating}
              className={`mm-btn mm-btn-primary w-full sm:w-auto focus-ring ${isGenerating ? "mm-btn-loading" : ""}`}
            >
              {isGenerating ? "Generating Marketing Content..." : "Generate Marketing Content"}
            </button>
            <p className="mm-secondary mt-2">
              This will use AI to create personalized reel ideas, ad copies, hashtags, and a 30-day plan.
            </p>
          </div>
        </form>
      </div>

      {isGenerating && (
        <div className="space-y-3 animate-pulse">
          <div className="h-6 bg-muted rounded w-40" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="mm-card p-4 h-36" />
          ))}
        </div>
      )}

      {result && !isGenerating && (
        <div className="space-y-5">
          {usedInputs && (
            <div className="mm-secondary">
              Generated for: <span className="text-foreground font-medium">{usedInputs.businessName}</span> • {usedInputs.industry}
            </div>
          )}

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold tracking-tight">Reel Ideas</h2>
              <span className="mm-badge">{result.reelIdeas.length} ideas</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {result.reelIdeas.map((idea, index) => (
                <div key={index} className="mm-card p-3.5">
                  <div className="text-[13px] font-semibold text-foreground mb-1.5">{idea.title}</div>
                  <p className="mm-secondary mb-2">{idea.description}</p>
                  <div className="text-xs font-mono bg-muted px-2.5 py-1.5 rounded border border-border text-foreground">
                    Hook: {idea.hook}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold tracking-tight mb-3">Ad Copies</h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
              {(["facebook", "instagram", "google"] as const).map((platform) => (
                <div key={platform} className="mm-card p-3.5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[13px] font-semibold capitalize">{platform} Ads</div>
                    <button
                      onClick={() => copyToClipboard(result.adCopies[platform].join("\n\n"), `${platform} ad copies`)}
                      className="mm-btn mm-btn-ghost h-8 min-h-8 px-2 text-xs"
                    >
                      Copy All
                    </button>
                  </div>
                  <div className="space-y-2 text-[13px]">
                    {result.adCopies[platform].map((copy, idx) => (
                      <div key={idx} className="bg-muted border border-border p-2.5 rounded-md text-muted-foreground leading-relaxed">
                        {copy}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold tracking-tight">Hashtags</h2>
              <button
                onClick={copyAllHashtags}
                className="mm-btn mm-btn-ghost h-8 min-h-8 px-2.5 text-xs"
              >
                Copy All
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {result.hashtags.map((tag, index) => (
                <button
                  key={index}
                  onClick={() => copyToClipboard(tag, "Hashtag")}
                  className="mm-badge hover:border-border"
                >
                  {tag}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold tracking-tight mb-3">30-Day Marketing Plan</h2>

            <div className="mm-card p-4 mb-3">
              <div className="mm-secondary mb-1.5 uppercase tracking-wide">Strategy overview</div>
              <p className="text-[13px] text-foreground leading-relaxed">{result.marketingPlan.overview}</p>
            </div>

            <div className="space-y-2.5">
              {result.marketingPlan.weeks.map((week) => (
                <div key={week.week} className="mm-card p-4">
                  <div className="flex items-center gap-2.5 mb-3">
                    <span className="mm-badge mm-badge-primary font-mono">WEEK {week.week}</span>
                    <div className="text-[13px] font-semibold">{week.focus}</div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[13px]">
                    <div>
                      <div className="mm-secondary uppercase tracking-wide mb-1.5">Channels</div>
                      <div className="flex flex-wrap gap-1">
                        {week.channels.map((ch, i) => (
                          <span key={i} className="mm-badge">{ch}</span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mm-secondary uppercase tracking-wide mb-1.5">Key tasks</div>
                      <ul className="space-y-1 text-muted-foreground">
                        {week.tasks.map((task, i) => (
                          <li key={i} className="flex gap-2">• {task}</li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <div className="mm-secondary uppercase tracking-wide mb-1.5">KPIs</div>
                      <ul className="space-y-1 text-muted-foreground">
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

          <div className="text-center pt-2">
            <button
              onClick={() => {
                setResult(null);
                setUsedInputs(null);
              }}
              className="mm-btn mm-btn-ghost text-xs underline"
            >
              Generate new content
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
