"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { captureGps, toLocationBody } from "@/lib/location-client";

/** Fixed strip height — keep in sync with DashboardShell FIELD_BAR_H */
export const FIELD_STATUS_BAR_HEIGHT_CLASS = "h-12"; // 48px

type FieldStatus = {
  state?: {
    status?: string;
    lastLocality?: string | null;
    lastCity?: string | null;
    lastFullAddress?: string | null;
    lastSource?: string | null;
    lastLat?: number | null;
    lastLng?: number | null;
    lastUpdatedAt?: string;
  } | null;
  activeField?: { id: string; startedAt: string; startLocality?: string | null } | null;
  openMeeting?: { meetingId: string; meeting?: { title?: string } | null } | null;
};

const STATUS_CLASS: Record<string, string> = {
  online: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  in_field: "bg-sky-500/25 text-sky-200 border-sky-400/50",
  meeting: "bg-violet-500/25 text-violet-200 border-violet-400/50",
  offline: "bg-zinc-700/50 text-zinc-400 border-zinc-600",
};

const STATUS_STYLE_FALLBACK = "bg-zinc-700/50 text-zinc-400 border-zinc-600";

function label(s?: string) {
  if (s === "in_field") return "On Field";
  if (s === "meeting") return "In Meeting";
  if (s === "online") return "Online";
  if (s === "loading") return "…";
  return "Offline";
}

/**
 * Dedicated location strip under the top navbar.
 * Fixed height (48px) — never wraps onto page titles/KPIs.
 */
export function FieldStatusBar() {
  const { token, isAuthenticated } = useAuth();
  const [data, setData] = useState<FieldStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      // Status bar data (field / location) — never throw; offline shows "Location not set"
      const res = await api.get<FieldStatus>("/location/me", token);
      if (res.success && res.data) setData(res.data);
    } catch {
      /* ApiClient already swallows network errors; belt-and-suspenders */
    }
    setLoaded(true);
  }, [token]);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      setLoaded(true);
      return;
    }
    load();
    const t = setInterval(load, 45_000);
    return () => clearInterval(t);
  }, [isAuthenticated, token, load]);

  // Always reserve the strip height (layout-stable even while loading / offline)
  if (!isAuthenticated || !token) {
    return (
      <div
        className={`${FIELD_STATUS_BAR_HEIGHT_CLASS} w-full border-b border-zinc-800 bg-zinc-900/95`}
        data-testid="field-status-bar"
        aria-hidden
      />
    );
  }

  const status = !loaded
    ? "loading"
    : data?.activeField
      ? "in_field"
      : data?.openMeeting
        ? "meeting"
        : data?.state?.status || "online";
  const place =
    data?.state?.lastFullAddress ||
    data?.state?.lastLocality ||
    data?.state?.lastCity ||
    (data?.state?.lastSource === "gps"
      ? "GPS active"
      : loaded
        ? "GPS not set — enable location"
        : "Detecting GPS…");
  const inField = !!data?.activeField;

  const run = async (path: string, successMsg: string) => {
    setBusy(true);
    try {
      const loc = await captureGps({ timeoutMs: 25000, force: true });
      if (loc.gpsDenied) {
        toast.message("GPS permission denied — enable browser location for accurate tracking");
      } else {
        toast.success(
          `GPS locked${loc.locality ? `: ${loc.locality}` : loc.city ? `: ${loc.city}` : ""}`
        );
      }
      const res = await api.post(path, toLocationBody(loc), token);
      if (res.success) {
        toast.success(successMsg);
        await load();
      } else {
        toast.error(res.error || "Action failed");
      }
    } catch {
      toast.error("Could not capture GPS location");
    }
    setBusy(false);
  };

  return (
    <div
      className={[
        FIELD_STATUS_BAR_HEIGHT_CLASS,
        "w-full border-b flex items-center gap-2 sm:gap-3",
        "px-3 sm:px-5 md:px-6",
        "overflow-hidden",
        inField ? "bg-sky-950/90 border-sky-800/60" : "bg-zinc-900/95 border-zinc-800",
      ].join(" ")}
      data-testid="field-status-bar"
      role="status"
      aria-live="polite"
    >
      <span
        className={`inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide px-2 sm:px-2.5 py-0.5 rounded-full border shrink-0 ${
          STATUS_CLASS[status] || STATUS_STYLE_FALLBACK
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            status === "online" || status === "in_field"
              ? "bg-emerald-400"
              : status === "meeting"
                ? "bg-violet-400"
                : "bg-zinc-500"
          }`}
          aria-hidden
        />
        {label(status)}
      </span>

      <div className="min-w-0 flex-1 flex items-center gap-1.5 text-xs sm:text-sm text-zinc-300 truncate">
        <span className="text-zinc-500 shrink-0 hidden sm:inline">Location:</span>
        <span
          className="font-medium text-white truncate"
          title={data?.state?.lastFullAddress || place}
        >
          {place}
        </span>
        {data?.state?.lastSource === "gps" && (
          <span className="shrink-0 text-[10px] text-emerald-500/80 font-medium">GPS</span>
        )}
        {data?.state?.lastSource === "ip" && (
          <span className="shrink-0 text-[10px] text-amber-500/80 font-medium">IP</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {!inField ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run("/location/field/start", "Field work started — you are On Field")}
            className="min-h-8 sm:min-h-9 px-2.5 sm:px-3 rounded-lg text-[11px] sm:text-xs font-semibold bg-sky-500 text-zinc-950 hover:bg-sky-400 disabled:opacity-50 touch-manipulation whitespace-nowrap"
            data-testid="start-field-work"
          >
            {busy ? "…" : "Start Field"}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => run("/location/field/end", "Field work ended")}
            className="min-h-8 sm:min-h-9 px-2.5 sm:px-3 rounded-lg text-[11px] sm:text-xs font-semibold bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-50 touch-manipulation whitespace-nowrap"
            data-testid="end-field-work"
          >
            {busy ? "…" : "End Field"}
          </button>
        )}
        <Link
          href="/dashboard/field-sales"
          className="min-h-8 sm:min-h-9 px-2.5 sm:px-3 rounded-lg text-[11px] sm:text-xs font-medium bg-white/10 text-zinc-200 hover:bg-white/15 border border-zinc-700 inline-flex items-center touch-manipulation whitespace-nowrap"
        >
          Map
        </Link>
      </div>
    </div>
  );
}
