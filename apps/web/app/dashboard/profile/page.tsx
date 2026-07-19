"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  SUPPORTED_CURRENCIES,
  type CurrencyCode,
  detectDefaultCurrency,
  getRevenueRangesForCurrency,
  migrateRevenueRange,
  isCurrencyCode,
  setAppCurrency,
} from "@/lib/currency";

const INDUSTRIES = [
  "SaaS / Software",
  "E-commerce",
  "Consulting",
  "Agency",
  "Healthcare",
  "Education",
  "Finance",
  "Real Estate",
  "Manufacturing",
  "Retail",
  "Other",
];

const STAGES = [
  { value: "idea", label: "Idea Stage" },
  { value: "mvp", label: "MVP / Pre-revenue" },
  { value: "early_revenue", label: "Early Revenue" },
  { value: "growth", label: "Growth Stage" },
  { value: "scaling", label: "Scaling" },
];

const EMPLOYEE_COUNTS = [1, 2, 3, 5, 10, 25, 50, 100];

interface Profile {
  businessName?: string;
  industry?: string;
  description?: string;
  employeeCount?: number | null;
  currency?: string | null;
  annualRevenue?: string;
  stage?: string;
  targetMarket?: string;
  mainProduct?: string;
  location?: string;
}

export default function BusinessProfilePage() {
  const { token } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState({
    businessName: "",
    industry: "",
    description: "",
    employeeCount: null as number | null,
    currency: "INR" as CurrencyCode,
    annualRevenue: "",
    stage: "",
    targetMarket: "",
    mainProduct: "",
    location: "",
  });

  // Load existing profile
  useEffect(() => {
    async function loadProfile() {
      if (!token) return;

      setIsLoading(true);
      const response = await api.getProfile(token);

      if (response.success && response.data?.profile) {
        const p = response.data.profile as Profile;
        const currency: CurrencyCode = isCurrencyCode(p.currency || "")
          ? (p.currency as CurrencyCode)
          : detectDefaultCurrency({
              location: p.location,
              locale: typeof navigator !== "undefined" ? navigator.language : undefined,
            });
        const annualRevenue = migrateRevenueRange(p.annualRevenue || "", currency);
        setAppCurrency(currency);
        setFormData({
          businessName: p.businessName || "",
          industry: p.industry || "",
          description: p.description || "",
          employeeCount: p.employeeCount ?? null,
          currency,
          annualRevenue,
          stage: p.stage || "",
          targetMarket: p.targetMarket || "",
          mainProduct: p.mainProduct || "",
          location: p.location || "",
        });
      } else {
        // New profile — default currency from browser / India-first
        const cur = detectDefaultCurrency({
          locale: typeof navigator !== "undefined" ? navigator.language : undefined,
        });
        setAppCurrency(cur);
        setFormData((prev) => ({
          ...prev,
          currency: cur,
        }));
      }
      setIsLoading(false);
    }

    loadProfile();
  }, [token]);

  const revenueRanges = useMemo(
    () => getRevenueRangesForCurrency(formData.currency),
    [formData.currency]
  );

  // Ensure selected revenue is valid for currency (keep legacy string if custom)
  const revenueOptions = useMemo(() => {
    if (formData.annualRevenue && !revenueRanges.includes(formData.annualRevenue)) {
      return [formData.annualRevenue, ...revenueRanges];
    }
    return revenueRanges;
  }, [formData.annualRevenue, revenueRanges]);

  const handleChange = (field: string, value: string | number | null) => {
    setFormData((prev) => {
      if (field === "currency" && typeof value === "string" && isCurrencyCode(value)) {
        const nextCurrency = value as CurrencyCode;
        return {
          ...prev,
          currency: nextCurrency,
          annualRevenue: migrateRevenueRange(prev.annualRevenue, nextCurrency),
        };
      }
      if (field === "location" && typeof value === "string") {
        // Only auto-set currency if user hasn't explicitly chosen something non-default yet
        // and location strongly implies a market — always suggest when location changes from empty
        const inferred = detectDefaultCurrency({ location: value, locale: navigator?.language });
        const shouldUpdateCurrency =
          !prev.location || prev.currency === detectDefaultCurrency({ location: prev.location });
        return {
          ...prev,
          location: value,
          ...(shouldUpdateCurrency
            ? {
                currency: inferred,
                annualRevenue: migrateRevenueRange(prev.annualRevenue, inferred),
              }
            : {}),
        };
      }
      return { ...prev, [field]: value };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setIsSaving(true);

    // Prepare data for API
    const payload = {
      ...formData,
      employeeCount: formData.employeeCount ? Number(formData.employeeCount) : null,
    };

    const response = await api.updateProfile(payload, token);

    if (response.success) {
      setAppCurrency(formData.currency);
      toast.success("Profile saved successfully");
    } else {
      toast.error(response.error || "Failed to save. Please try again.");
    }

    setIsSaving(false);
  };

  if (isLoading) {
    return (
      <div className="w-full max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Business Profile</h1>
          <p className="text-zinc-400 mt-2">This information powers your Health Score, SWOT, and AI Mentor.</p>
        </div>

        <div className="space-y-8 animate-pulse">
          {/* Basic Information skeleton */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8">
            <Skeleton className="h-6 w-40 mb-6" />
            <div className="space-y-6">
              <div>
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-12 w-full rounded-xl" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Skeleton className="h-4 w-20 mb-2" />
                  <Skeleton className="h-12 w-full rounded-xl" />
                </div>
                <div>
                  <Skeleton className="h-4 w-20 mb-2" />
                  <Skeleton className="h-12 w-full rounded-xl" />
                </div>
              </div>
            </div>
          </div>

          {/* Description skeleton */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8">
            <Skeleton className="h-6 w-48 mb-6" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>

          {/* Business Details skeleton */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8">
            <Skeleton className="h-6 w-40 mb-6" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[...Array(4)].map((_, i) => (
                <div key={i}>
                  <Skeleton className="h-4 w-28 mb-2" />
                  <Skeleton className="h-12 w-full rounded-xl" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Business Profile</h1>
        <p className="text-zinc-400 mt-2">This information powers your Health Score, SWOT, and AI Mentor.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Basic Information */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
          <h2 className="font-semibold text-lg mb-6">Basic Information</h2>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Business Name *</label>
              <input
                type="text"
                value={formData.businessName}
                onChange={(e) => handleChange("businessName", e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-white/30"
                placeholder="Acme Corp"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Industry *</label>
                <select
                  value={formData.industry}
                  onChange={(e) => handleChange("industry", e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-white/30"
                  required
                >
                  <option value="">Select industry...</option>
                  {INDUSTRIES.map((ind) => (
                    <option key={ind} value={ind}>{ind}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Current Stage</label>
                <select
                  value={formData.stage}
                  onChange={(e) => handleChange("stage", e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-white/30"
                >
                  <option value="">Select stage...</option>
                  {STAGES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
          <h2 className="font-semibold text-lg mb-2">About Your Business</h2>
          <p className="text-sm text-zinc-500 mb-4">Help the AI understand what you do (this is very important).</p>

          <textarea
            value={formData.description}
            onChange={(e) => handleChange("description", e.target.value)}
            rows={5}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white resize-y focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-white/30"
            placeholder="We help small e-commerce brands increase customer lifetime value through personalized email marketing automation..."
          />
          <div className="text-xs text-zinc-500 mt-1.5 text-right">{formData.description.length} / 2000</div>
        </div>

        {/* Business Details */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
          <h2 className="font-semibold text-lg mb-6">Business Details</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Team Size</label>
              <select
                value={formData.employeeCount ?? ""}
                onChange={(e) => handleChange("employeeCount", e.target.value ? parseInt(e.target.value) : null)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-white/30"
              >
                <option value="">Select team size...</option>
                {EMPLOYEE_COUNTS.map((num) => (
                  <option key={num} value={num}>{num} {num === 1 ? "person" : "people"}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Currency</label>
              <select
                value={formData.currency}
                onChange={(e) => handleChange("currency", e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-white/30"
                aria-label="Business currency"
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-zinc-500 mt-1.5">
                Default follows your location (India → INR). Used for dashboards, invoices &amp; AI.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Annual Revenue</label>
              <select
                value={formData.annualRevenue}
                onChange={(e) => handleChange("annualRevenue", e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-white/30"
                aria-label="Annual revenue range"
              >
                <option value="">Select revenue range…</option>
                {revenueOptions.map((range) => (
                  <option key={range} value={range}>
                    {range}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Main Product / Service</label>
              <input
                type="text"
                value={formData.mainProduct}
                onChange={(e) => handleChange("mainProduct", e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-white/30"
                placeholder="Email marketing platform"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Primary Location</label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => handleChange("location", e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-white/30"
                placeholder="San Francisco, CA"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-zinc-300 mb-2">Target Market / Ideal Customer</label>
              <input
                type="text"
                value={formData.targetMarket}
                onChange={(e) => handleChange("targetMarket", e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-white/30"
                placeholder="Early-stage brands in your market (describe size in your currency)"
              />
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className="px-8 py-3 bg-white text-zinc-950 rounded-xl font-medium hover:bg-zinc-200 focus-ring button-active transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSaving ? "Saving..." : "Save Profile"}
          </button>
        </div>

        <p className="text-xs text-zinc-500">
          This data is used to generate accurate Health Scores, SWOT analyses, and personalized AI advice.
        </p>
      </form>
    </div>
  );
}
