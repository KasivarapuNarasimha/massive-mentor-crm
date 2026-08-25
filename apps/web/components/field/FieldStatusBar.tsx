"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { captureGps, toLocationBody } from "@/lib/location-client";

/** Fixed strip height — keep in sync with DashboardShell FIELD_BAR_H */
export const FIELD_STATUS_BAR_HEIGHT_CLASS = "h-11"; // 44px — denser enterprise strip

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
  online: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
  in_field: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30",
  meeting: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30",
  offline: "bg-muted text-muted-foreground border-border",
};

const STATUS_STYLE_FALLBACK = "bg-muted text-muted-foreground border-border";

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
        className={`${FIELD_STATUS_BAR_HEIGHT_CLASS} w-full border-b border-border bg-white dark:bg-card`}
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
        "w-full border-b border-border flex items-center gap-2 sm:gap-3",
        "px-3 sm:px-5 md:px-6",
        "overflow-hidden bg-white dark:bg-card",
        inField ? "bg-sky-50 dark:bg-sky-950/40" : "",
      ].join(" ")}
      data-testid="field-status-bar"
      role="status"
      aria-live="polite"
    >
      <span
        className={`inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border shrink-0 ${
          STATUS_CLASS[status] || STATUS_STYLE_FALLBACK
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            status === "online" || status === "in_field"
              ? "bg-emerald-500"
              : status === "meeting"
                ? "bg-blue-500"
                : "bg-muted-foreground"
          }`}
          aria-hidden
        />
        {label(status)}
      </span>

      <div className="min-w-0 flex-1 flex items-center gap-1.5 text-xs text-muted-foreground truncate">
        <span className="text-muted-foreground shrink-0 hidden sm:inline">Location:</span>
        <span
          className="font-medium text-foreground truncate"
          title={data?.state?.lastFullAddress || place}
        >
          {place}
        </span>
        {data?.state?.lastSource === "gps" && (
          <span className="shrink-0 text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">GPS</span>
        )}
        {data?.state?.lastSource === "ip" && (
          <span className="shrink-0 text-[10px] text-amber-700 dark:text-amber-400 font-medium">IP</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {!inField ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run("/location/field/start", "Field work started — you are On Field")}
            className="h-8 min-h-8 px-2.5 rounded-md text-[11px] sm:text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary-hover disabled:opacity-50 touch-manipulation whitespace-nowrap"
            data-testid="start-field-work"
          >
            {busy ? "…" : "Start Field"}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => run("/location/field/end", "Field work ended")}
            className="h-8 min-h-8 px-2.5 rounded-md text-[11px] sm:text-xs font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 touch-manipulation whitespace-nowrap"
            data-testid="end-field-work"
          >
            {busy ? "…" : "End Field"}
          </button>
        )}
        <Link
          href="/dashboard/field-sales"
          className="h-8 min-h-8 px-2.5 rounded-md text-[11px] sm:text-xs font-medium bg-card text-foreground hover:bg-muted border border-border inline-flex items-center touch-manipulation whitespace-nowrap"
        >
          Map
        </Link>
      </div>
    </div>
  );
}
