"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import {
  canAccessFeature,
  resolvePlanTier,
  type FeatureKey,
  type PlanTier,
  FEATURE_LABELS,
  requiredPlanName,
} from "@/lib/plan-entitlements";
import { FeatureLockModal } from "@/components/billing/FeatureLockModal";
import { subscribeDataChanged } from "@/lib/data-events";

type PlanContextValue = {
  tier: PlanTier;
  plan: string | null;
  isTrial: boolean;
  planStatus: string | null;
  loading: boolean;
  can: (feature: FeatureKey) => boolean;
  requireFeature: (feature: FeatureKey) => boolean;
  openLock: (feature: FeatureKey) => void;
  closeLock: () => void;
  refresh: () => Promise<void>;
};

const PlanContext = createContext<PlanContextValue | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const { token, isAuthenticated } = useAuth();
  const [tier, setTier] = useState<PlanTier>("trial");
  const [plan, setPlan] = useState<string | null>(null);
  const [isTrial, setIsTrial] = useState(true);
  const [planStatus, setPlanStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lockFeature, setLockFeature] = useState<FeatureKey | null>(null);

  const refresh = useCallback(async () => {
    if (!token || !isAuthenticated) {
      setLoading(false);
      return;
    }
    try {
      const res = await api.get<{
        access: {
          isTrial: boolean;
          plan?: string | null;
          planStatus?: string;
        };
      }>("/billing/access", token);
      if (res.success && res.data?.access) {
        const a = res.data.access;
        const p = a.plan || null;
        setPlan(p);
        setIsTrial(!!a.isTrial);
        setPlanStatus(a.planStatus || null);
        setTier(resolvePlanTier(p, !!a.isTrial));
      }
    } finally {
      setLoading(false);
    }
  }, [token, isAuthenticated]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live sync: Super Admin plan changes must appear without re-login
  useEffect(() => {
    if (!token || !isAuthenticated) return;
    const unsub = subscribeDataChanged((ev) => {
      if (ev.module === "billing" || ev.module === "all") void refresh();
    });
    const onFocus = () => void refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    // Poll modestly so admin-side plan updates propagate without hard refresh
    const poll = window.setInterval(() => void refresh(), 45_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      unsub();
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [token, isAuthenticated, refresh]);

  const can = useCallback(
    (feature: FeatureKey) => canAccessFeature(tier, feature),
    [tier]
  );

  const openLock = useCallback((feature: FeatureKey) => {
    setLockFeature(feature);
  }, []);

  const closeLock = useCallback(() => setLockFeature(null), []);

  /** Returns true if allowed; otherwise opens lock modal and returns false */
  const requireFeature = useCallback(
    (feature: FeatureKey) => {
      if (canAccessFeature(tier, feature)) return true;
      setLockFeature(feature);
      return false;
    },
    [tier]
  );

  const value = useMemo(
    () => ({
      tier,
      plan,
      isTrial,
      planStatus,
      loading,
      can,
      requireFeature,
      openLock,
      closeLock,
      refresh,
    }),
    [tier, plan, isTrial, planStatus, loading, can, requireFeature, openLock, closeLock, refresh]
  );

  return (
    <PlanContext.Provider value={value}>
      {children}
      <FeatureLockModal
        open={!!lockFeature}
        feature={lockFeature}
        featureLabel={lockFeature ? FEATURE_LABELS[lockFeature] : ""}
        requiredPlan={lockFeature ? requiredPlanName(lockFeature) : "Professional"}
        onClose={closeLock}
      />
    </PlanContext.Provider>
  );
}

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) {
    // Safe fallback when used outside provider (e.g. auth pages)
    return {
      tier: "enterprise",
      plan: null,
      isTrial: false,
      planStatus: "active",
      loading: false,
      can: () => true,
      requireFeature: () => true,
      openLock: () => undefined,
      closeLock: () => undefined,
      refresh: async () => undefined,
    };
  }
  return ctx;
}
