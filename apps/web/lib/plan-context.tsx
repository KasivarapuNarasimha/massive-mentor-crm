"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import { emitDataChanged, subscribeDataChanged } from "@/lib/data-events";
import { connectBillingStream } from "@/lib/billing-realtime";

type PlanContextValue = {
  tier: PlanTier;
  plan: string | null;
  isTrial: boolean;
  planStatus: string | null;
  licenseStatus: string | null;
  trialDaysRemaining: number | null;
  isLocked: boolean;
  /** open | connecting | closed | error — for diagnostics */
  liveStatus: "idle" | "connecting" | "open" | "closed" | "error";
  loading: boolean;
  /** False until first successful access/SSE apply — avoid flashing Trial on 429 */
  accessKnown: boolean;
  can: (feature: FeatureKey) => boolean;
  requireFeature: (feature: FeatureKey) => boolean;
  openLock: (feature: FeatureKey) => void;
  closeLock: () => void;
  refresh: () => Promise<void>;
};

const PlanContext = createContext<PlanContextValue | null>(null);

/** Fallback only — real-time SSE is primary */
const FALLBACK_POLL_MS = 5 * 60_000;

export function PlanProvider({ children }: { children: ReactNode }) {
  const { token, isAuthenticated } = useAuth();
  // Do not default to Trial — that falsely labels paid workspaces when /billing/access 429s.
  const [tier, setTier] = useState<PlanTier>("trial");
  const [plan, setPlan] = useState<string | null>(null);
  const [isTrial, setIsTrial] = useState(false);
  const [planStatus, setPlanStatus] = useState<string | null>(null);
  const [licenseStatus, setLicenseStatus] = useState<string | null>(null);
  const [trialDaysRemaining, setTrialDaysRemaining] = useState<number | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [liveStatus, setLiveStatus] = useState<PlanContextValue["liveStatus"]>("idle");
  const [loading, setLoading] = useState(true);
  /** True after at least one successful /billing/access (or SSE apply). */
  const [accessKnown, setAccessKnown] = useState(false);
  const [lockFeature, setLockFeature] = useState<FeatureKey | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);

  const applyAccess = useCallback(
    (a: {
      isTrial?: boolean;
      plan?: string | null;
      planStatus?: string | null;
      licenseStatus?: string | null;
      trialDaysRemaining?: number | null;
      isLocked?: boolean;
    }) => {
      const p = a.plan ?? null;
      const trial = !!a.isTrial;
      setPlan(p);
      setIsTrial(trial);
      setPlanStatus(a.planStatus ?? null);
      setLicenseStatus(a.licenseStatus ?? null);
      setTrialDaysRemaining(
        !trial
          ? null
          : a.trialDaysRemaining == null
            ? null
            : Math.min(Math.max(0, a.trialDaysRemaining), 30)
      );
      setIsLocked(!!a.isLocked);
      setTier(resolvePlanTier(p, trial));
    },
    []
  );

  const refresh = useCallback(async () => {
    if (!token || !isAuthenticated) {
      setLoading(false);
      return;
    }
    if (refreshInFlight.current) {
      await refreshInFlight.current;
      return;
    }
    const run = (async () => {
      try {
        const res = await api.get<{
          access: {
            isTrial: boolean;
            plan?: string | null;
            planStatus?: string;
            licenseStatus?: string | null;
            trialDaysRemaining?: number | null;
            isLocked?: boolean;
          };
        }>("/billing/access", token);
        if (res.success && res.data?.access) {
          applyAccess(res.data.access);
          setAccessKnown(true);
        }
        // On 429/network failure: keep last-known plan (do not flip to Trial).
      } finally {
        setLoading(false);
        refreshInFlight.current = null;
      }
    })();
    refreshInFlight.current = run;
    await run;
  }, [token, isAuthenticated, applyAccess]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Primary: SSE real-time stream from Super Admin / payment activations
  useEffect(() => {
    if (!token || !isAuthenticated) return;

    const disconnect = connectBillingStream(
      token,
      (payload) => {
        // Apply push payload immediately for instant UI
        if (
          payload.plan !== undefined ||
          payload.isTrial !== undefined ||
          payload.planStatus !== undefined
        ) {
          applyAccess({
            plan: payload.plan,
            isTrial: payload.isTrial,
            planStatus: payload.planStatus,
            licenseStatus: payload.licenseStatus,
            trialDaysRemaining: payload.trialDaysRemaining,
            isLocked: payload.isLocked,
          });
          setAccessKnown(true);
        }
        // Connect-time snapshots already carry access — do NOT refresh+emit
        // (that re-fetches /billing/access and reloads the whole dashboard).
        const isSnapshot =
          payload.source === "snapshot" || payload.type === "subscription_snapshot";
        if (isSnapshot) return;

        // Real subscription changes: authoritative re-fetch + notify other UI
        void refresh().then(() => {
          emitDataChanged({ module: "billing", action: "update" });
        });
      },
      {
        onStatus: (s) => setLiveStatus(s),
      }
    );

    return () => {
      disconnect();
      setLiveStatus("closed");
    };
  }, [token, isAuthenticated, applyAccess, refresh]);

  // Secondary: local events (same-tab payment success) + focus
  useEffect(() => {
    if (!token || !isAuthenticated) return;
    const unsub = subscribeDataChanged((ev) => {
      if (ev.module === "billing" || ev.module === "all") void refresh();
    });
    const onFocus = () => void refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    // Fallback poll only (5 min) — not the primary sync path
    const poll = window.setInterval(() => void refresh(), FALLBACK_POLL_MS);
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
      licenseStatus,
      trialDaysRemaining,
      isLocked,
      liveStatus,
      loading,
      accessKnown,
      can,
      requireFeature,
      openLock,
      closeLock,
      refresh,
    }),
    [
      tier,
      plan,
      isTrial,
      accessKnown,
      planStatus,
      licenseStatus,
      trialDaysRemaining,
      isLocked,
      liveStatus,
      loading,
      can,
      requireFeature,
      openLock,
      closeLock,
      refresh,
    ]
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
    return {
      tier: "enterprise",
      plan: null,
      isTrial: false,
      planStatus: "active",
      licenseStatus: "active",
      trialDaysRemaining: null,
      isLocked: false,
      liveStatus: "idle",
      loading: false,
      accessKnown: true,
      can: () => true,
      requireFeature: () => true,
      openLock: () => undefined,
      closeLock: () => undefined,
      refresh: async () => undefined,
    };
  }
  return ctx;
}
