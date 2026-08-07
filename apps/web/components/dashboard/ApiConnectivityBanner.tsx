"use client";

import { useCallback, useEffect, useState } from "react";
import { api, API_BASE_URL, getApiOrigin } from "@/lib/api";

/**
 * Shows a non-blocking banner when the backend is unreachable.
 * Polls /health so users know to start the API instead of seeing silent crashes.
 */
export function ApiConnectivityBanner() {
  const [down, setDown] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const probe = useCallback(async () => {
    setChecking(true);
    // 10s — prod incident: 4s was too aggressive during restarts / brief stalls
    const res = await api.checkHealth(10_000);
    setDown(!res.ok);
    setDetail(res.error || (!res.ok ? `HTTP ${res.status}` : null));
    setChecking(false);
  }, []);

  useEffect(() => {
    void probe();
    const t = setInterval(() => void probe(), 20_000);
    const onOnline = () => void probe();
    const onOffline = () => {
      setDown(true);
      setDetail("Browser reports offline");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [probe]);

  if (!down) return null;

  return (
    <div
      role="alert"
      className="w-full bg-red-950/95 border-b border-red-800/80 text-red-100 px-3 sm:px-5 py-2 text-xs sm:text-sm z-[80]"
      data-testid="api-connectivity-banner"
    >
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <div className="min-w-0 flex-1">
          <span className="font-semibold">API unreachable</span>
          <span className="text-red-200/90">
            {" "}
            — dashboard data cannot load. Backend should be at{" "}
            <code className="text-red-100 bg-red-900/50 px-1 rounded">{getApiOrigin()}</code>
            {" "}
            (client uses <code className="text-red-100 bg-red-900/50 px-1 rounded">{API_BASE_URL}</code>).
          </span>
          {detail && (
            <div className="text-[11px] text-red-300/90 mt-0.5 truncate" title={detail}>
              {detail}
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={checking}
          onClick={() => void probe()}
          className="shrink-0 min-h-9 px-3 rounded-lg bg-red-500 text-white text-xs font-semibold disabled:opacity-50"
        >
          {checking ? "Checking…" : "Retry"}
        </button>
      </div>
    </div>
  );
}
