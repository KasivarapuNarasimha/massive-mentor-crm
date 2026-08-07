"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  runHealthProbe,
  type HealthProbeState,
} from "@/lib/health-probe";

const DEFAULT_OK: HealthProbeState = {
  level: "ok",
  kind: null,
  title: "Connected",
  detail: null,
  checking: false,
  consecutiveFailures: 0,
  lastOkAt: null,
  nextRetryInMs: null,
  latencyMs: null,
  lastSuccessAt: null,
  services: {
    api: "unknown",
    database: "unknown",
    ai: "unknown",
    whatsapp: "unknown",
    email: "unknown",
  },
};

/**
 * Background connectivity indicator — never blocks CRM work.
 *
 * Soft: "Connection unstable. Retrying…" (amber badge)
 * Offline: "No Internet Connection"
 * Hard: sustained outage only (red alert)
 */
export function ApiConnectivityBanner() {
  const { token } = useAuth();
  const [state, setState] = useState<HealthProbeState>(DEFAULT_OK);
  const [checking, setChecking] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const probeRef = useRef<(force?: boolean) => Promise<void>>(async () => undefined);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleNext = useCallback((delayMs: number) => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      void probeRef.current(false);
    }, Math.max(1_000, delayMs));
  }, []);

  const runProbe = useCallback(
    async (force = false) => {
      if (!mountedRef.current) return;

      // Browser offline — do not hit the API
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        const offline = await runHealthProbe({ offline: true });
        if (!mountedRef.current) return;
        setState(offline);
        setChecking(false);
        clearTimer();
        return;
      }

      setChecking(true);
      try {
        const next = await runHealthProbe({ force });
        if (!mountedRef.current) return;
        setState(next);
        const delay =
          next.level === "ok"
            ? next.nextRetryInMs ?? 45_000
            : next.nextRetryInMs ?? 5_000;
        scheduleNext(delay);
      } finally {
        if (mountedRef.current) setChecking(false);
      }
    },
    [scheduleNext]
  );

  probeRef.current = runProbe;

  useEffect(() => {
    mountedRef.current = true;
    // Background only — next tick so first paint is never blocked
    const boot = setTimeout(() => void runProbe(false), 0);

    const onOnline = () => void runProbe(true);
    const onOffline = () => {
      void runHealthProbe({ offline: true }).then((s) => {
        if (mountedRef.current) {
          setState(s);
          setChecking(false);
        }
      });
      clearTimer();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void runProbe(false);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mountedRef.current = false;
      clearTimeout(boot);
      clearTimer();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [runProbe]);

  // Prefer soft UX when user is signed in or failure is transient
  const useSoft =
    state.level === "soft" ||
    (state.level === "hard" &&
      !!token &&
      state.consecutiveFailures < 5 &&
      (state.kind === "timeout" || state.kind === "restarting"));

  if (state.level === "ok") return null;

  if (state.level === "offline") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full bg-amber-950/95 border-b border-amber-700/60 text-amber-50 px-3 sm:px-5 py-2 text-xs sm:text-sm z-[80]"
        data-testid="api-connectivity-banner"
        data-level="offline"
      >
        <div className="max-w-6xl mx-auto flex items-center gap-3 min-w-0">
          <span className="font-semibold shrink-0">No Internet Connection</span>
          <span className="text-amber-100/90 truncate">
            {state.detail || "Waiting for network…"}
          </span>
        </div>
      </div>
    );
  }

  if (useSoft) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full bg-amber-500/10 border-b border-amber-500/25 text-amber-950 dark:text-amber-100 px-3 sm:px-5 py-1.5 text-[11px] sm:text-xs z-[80]"
        data-testid="api-connectivity-banner"
        data-level="soft"
      >
        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 font-medium">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"
              aria-hidden
            />
            Connection unstable. Retrying…
          </span>
          <span className="text-muted-foreground truncate min-w-0">
            <span className="font-medium text-foreground/80">{state.title}</span>
            {state.detail ? ` — ${state.detail}` : ""}
          </span>
          <button
            type="button"
            disabled={checking}
            onClick={() => void runProbe(true)}
            className="ml-auto shrink-0 min-h-8 px-2.5 rounded-lg border border-border text-[11px] font-medium hover:bg-muted disabled:opacity-50 focus-ring"
          >
            {checking ? "Checking…" : "Check now"}
          </button>
        </div>
      </div>
    );
  }

  // Sustained hard outage
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="w-full bg-red-950/95 border-b border-red-800/80 text-red-100 px-3 sm:px-5 py-2 text-xs sm:text-sm z-[80]"
      data-testid="api-connectivity-banner"
      data-level="hard"
    >
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <div className="min-w-0 flex-1">
          <span className="font-semibold">{state.title}</span>
          {state.detail && (
            <span className="text-red-200/90"> — {state.detail}</span>
          )}
        </div>
        <button
          type="button"
          disabled={checking}
          onClick={() => void runProbe(true)}
          className="shrink-0 min-h-9 px-3 rounded-lg bg-red-500 text-white text-xs font-semibold disabled:opacity-50 focus-ring"
        >
          {checking ? "Checking…" : "Retry"}
        </button>
      </div>
    </div>
  );
}
