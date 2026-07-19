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

type PlanContextValue = {
  tier: PlanTier;
  plan: string | null;
  isTrial: boolean;
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
  const [loading, setLoading] = useState(true);
  const [lockFeature, setLockFeature] = useState<FeatureKey | null>(null);

  const refresh = useCallback(async () => {
    if (!token || !isAuthenticated) {
      setLoading(false);
      return;
    }
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
      setTier(resolvePlanTier(p, !!a.isTrial));
    }
    setLoading(false);
  }, [token, isAuthenticated]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      loading,
      can,
      requireFeature,
      openLock,
      closeLock,
      refresh,
    }),
    [tier, plan, isTrial, loading, can, requireFeature, openLock, closeLock, refresh]
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
