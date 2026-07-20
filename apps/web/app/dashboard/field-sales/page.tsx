"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  captureGps,
  startWatchGps,
  toLocationBody,
  gpsStatusLabel,
  type CapturedLocation,
} from "@/lib/location-client";
import { usePortal } from "@/lib/portal-context";
import { PageHeader, PageShell } from "@/components/ui/PageShell";

type TeamMember = {
  userId: string;
  name: string;
  email?: string;
  status: string;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  fullAddress?: string | null;
  lat?: number | null;
  lng?: number | null;
  source?: string | null;
  accuracyM?: number | null;
  speedMps?: number | null;
  movementStatus?: string | null;
  travelledKmToday?: number;
  lastUpdatedAt?: string;
  distanceFromOfficeKm?: number | null;
  travelMinutes?: number | null;
  lastEventType?: string | null;
};

type HistoryItem = {
  id: string;
  eventType: string;
  recordedAt: string;
  locality?: string | null;
  city?: string | null;
  fullAddress?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source?: string;
  accuracyM?: number | null;
  speedMps?: number | null;
  segmentDistanceKm?: number | null;
  browser?: string | null;
  device?: string | null;
};

type Insights = {
  fullAddress?: string | null;
  currentLocality?: string | null;
  currentCity?: string | null;
  currentState?: string | null;
  currentCountry?: string | null;
  currentPincode?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  source?: string | null;
  movementStatus?: string | null;
  speedKmh?: number | null;
  lastUpdatedAt?: string | null;
  travelledKm?: number;
  totalStayMin?: number;
  visits?: Array<{ meetingTitle?: string; locality?: string | null; stayedMin?: number | null }>;
  officeInsight?: { distanceKm: number | null; travelMinutes: number | null; officeLabel: string } | null;
  route?: Array<{ lat: number | null; lng: number | null; at: string; address?: string | null }>;
};

const STATUS_STYLE: Record<string, string> = {
  online: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  in_field: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  meeting: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  offline: "bg-zinc-700/40 text-zinc-400 border-zinc-600",
};

function statusLabel(s: string) {
  if (s === "in_field") return "In Field";
  if (s === "meeting") return "Meeting";
  if (s === "online") return "Online";
  return "Offline";
}

function eventLabel(t: string) {
  const map: Record<string, string> = {
    login: "Login",
    logout: "Logout",
    field_start: "Field Work Start",
    field_end: "Field Work End",
    meeting_checkin: "Meeting Check-in",
    meeting_checkout: "Meeting Check-out",
    heartbeat: "GPS Update",
  };
  return map[t] || t;
}

function formatAddress(parts: {
  fullAddress?: string | null;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
}) {
  if (parts.fullAddress) return parts.fullAddress;
  return (
    [parts.locality, parts.city, parts.state, parts.pincode, parts.country]
      .filter(Boolean)
      .join(", ") || "Waiting for GPS address…"
  );
}

function StatCard({
  label,
  value,
  sub,
  tone = "border-zinc-800",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: string;
}) {
  return (
    <div
      className={`rounded-2xl border bg-gradient-to-br from-white/[0.04] to-zinc-950/80 p-4 sm:p-5 ${tone} min-h-[110px] flex flex-col`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </div>
      <div className="mt-2 text-xl sm:text-2xl font-semibold tabular-nums text-white tracking-tight">
        {value}
      </div>
      {sub ? <div className="mt-auto pt-2 text-xs text-zinc-500 leading-relaxed">{sub}</div> : null}
    </div>
  );
}

export default function FieldSalesPage() {
  const { token, user } = useAuth();
  const { portal } = usePortal();
  const role = portal?.role || user?.role || "";
  const isManager = [
    "ceo",
    "owner",
    "business_admin",
    "admin",
    "sales_manager",
    "manager",
    "super_admin",
  ].includes(role);

  const [busy, setBusy] = useState(false);
  const [gpsLive, setGpsLive] = useState<CapturedLocation | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [myStatus, setMyStatus] = useState<{
    state?: {
      status?: string;
      lastLocality?: string | null;
      lastCity?: string | null;
      lastState?: string | null;
      lastFullAddress?: string | null;
      lastPincode?: string | null;
      lastLat?: number | null;
      lastLng?: number | null;
      lastSource?: string | null;
      lastAccuracyM?: number | null;
      lastSpeedMps?: number | null;
      movementStatus?: string | null;
      travelledKmToday?: number | null;
      lastUpdatedAt?: string;
    } | null;
    activeField?: { id: string; startedAt: string; totalTravelledKm?: number | null } | null;
    openMeeting?: { meetingId: string; meeting?: { title: string } } | null;
  } | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [office, setOffice] = useState<{
    lat: number;
    lng: number;
    address?: string | null;
    label?: string;
  } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [officeLat, setOfficeLat] = useState("");
  const [officeLng, setOfficeLng] = useState("");
  const [officeLabel, setOfficeLabel] = useState("Office");
  const stopWatchRef = useRef<(() => void) | null>(null);
  const lastHeartbeatRef = useRef(0);

  const load = useCallback(async () => {
    if (!token) return;
    const [st, live, hist, ins] = await Promise.all([
      api.get("/location/me", token),
      isManager ? api.get("/location/live", token) : Promise.resolve({ success: false, data: null }),
      api.get(
        `/location/history?pageSize=50${selectedUserId ? `&userId=${selectedUserId}` : ""}`,
        token
      ),
      api.get(
        `/location/insights${selectedUserId ? `?userId=${selectedUserId}` : ""}`,
        token
      ),
    ]);
    if (st.success) setMyStatus(st.data as typeof myStatus);
    if (live.success && live.data) {
      const d = live.data as { team?: TeamMember[]; office?: typeof office };
      setTeam(d.team || []);
      setOffice(d.office || null);
      if (d.office) {
        setOfficeLat(String(d.office.lat));
        setOfficeLng(String(d.office.lng));
        setOfficeLabel(d.office.label || "Office");
      }
    }
    if (hist.success && hist.data) {
      setHistory((hist.data as { items?: HistoryItem[] }).items || []);
    }
    if (ins.success) setInsights(ins.data as Insights);
  }, [token, isManager, selectedUserId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 45_000);
    return () => clearInterval(t);
  }, [load]);

  // Continuous high-accuracy GPS while field session is active
  useEffect(() => {
    if (!token || !myStatus?.activeField) {
      stopWatchRef.current?.();
      stopWatchRef.current = null;
      return;
    }

    stopWatchRef.current?.();
    stopWatchRef.current = startWatchGps({
      onUpdate: (loc) => {
        setGpsLive(loc);
        setGpsError(null);
        const now = Date.now();
        // Heartbeat to server at most every 12s while in field
        if (now - lastHeartbeatRef.current < 12_000) return;
        lastHeartbeatRef.current = now;
        void api
          .post("/location/events", { eventType: "heartbeat", ...toLocationBody(loc) }, token)
          .then(() => load())
          .catch(() => undefined);
      },
      onError: (err) => {
        setGpsError(err instanceof Error ? err.message : "GPS error");
      },
    });

    return () => {
      stopWatchRef.current?.();
      stopWatchRef.current = null;
    };
  }, [token, myStatus?.activeField?.id, load]);

  // Initial GPS permission request on page open
  useEffect(() => {
    void captureGps({ timeoutMs: 20000, force: true }).then((loc) => {
      setGpsLive(loc);
      if (loc.gpsDenied) {
        setGpsError("GPS permission denied or unavailable. Enable location for accurate tracking.");
      }
    });
  }, []);

  const withLocation = async (fn: (body: Record<string, unknown>) => Promise<void>) => {
    setBusy(true);
    try {
      const loc = await captureGps({ timeoutMs: 25000, force: true });
      setGpsLive(loc);
      if (loc.gpsDenied) {
        toast.message("GPS unavailable — enable browser location for accurate tracking");
        setGpsError("GPS permission denied or unavailable");
      } else {
        setGpsError(null);
        toast.success(
          loc.locality || loc.city
            ? `GPS locked · ${loc.locality || loc.city}`
            : "GPS locked"
        );
      }
      await fn(toLocationBody(loc));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Location action failed");
    }
    setBusy(false);
  };

  const startField = () =>
    withLocation(async (body) => {
      const res = await api.post("/location/field/start", body, token);
      if (res.success) toast.success("Field work started — live GPS tracking on");
      else toast.error(res.error || "Failed");
    });

  const endField = () =>
    withLocation(async (body) => {
      const res = await api.post("/location/field/end", body, token);
      if (res.success) toast.success("Field work ended");
      else toast.error(res.error || "Failed");
    });

  const saveOffice = async () => {
    if (!token) return;
    let lat = parseFloat(officeLat);
    let lng = parseFloat(officeLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const loc = await captureGps({ timeoutMs: 20000, force: true });
      if (loc.latitude == null) {
        toast.error("Enter coordinates or allow GPS");
        return;
      }
      lat = loc.latitude;
      lng = loc.longitude!;
      setOfficeLat(String(lat));
      setOfficeLng(String(lng));
    }
    const res = await api.put(
      "/location/office",
      { lat, lng, label: officeLabel || "Office" },
      token
    );
    if (res.success) {
      toast.success("Office location saved");
      load();
    } else toast.error(res.error || "Failed");
  };

  const exportReport = async (type: string, format: string) => {
    if (!token) return;
    const q = new URLSearchParams({ type, format });
    if (selectedUserId) q.set("userId", selectedUserId);
    const url = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api"}/location/reports?${q}`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        toast.error("Export failed");
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `location-${type}.${format === "xlsx" ? "xlsx" : format === "pdf" ? "pdf" : "csv"}`;
      a.click();
      toast.success("Report downloaded");
    } catch {
      toast.error("Export failed");
    }
  };

  const displayLat = gpsLive?.latitude ?? insights?.lat ?? myStatus?.state?.lastLat ?? null;
  const displayLng = gpsLive?.longitude ?? insights?.lng ?? myStatus?.state?.lastLng ?? null;
  const displayAddress = formatAddress({
    fullAddress: gpsLive?.fullAddress || insights?.fullAddress || myStatus?.state?.lastFullAddress,
    locality: gpsLive?.locality || insights?.currentLocality || myStatus?.state?.lastLocality,
    city: gpsLive?.city || insights?.currentCity || myStatus?.state?.lastCity,
    state: gpsLive?.state || insights?.currentState || myStatus?.state?.lastState,
    pincode: gpsLive?.pincode || insights?.currentPincode || myStatus?.state?.lastPincode,
    country: gpsLive?.country || insights?.currentCountry,
  });
  const accuracy =
    gpsLive?.accuracyM ?? insights?.accuracyM ?? myStatus?.state?.lastAccuracyM ?? null;
  const speedKmh =
    gpsLive?.speedMps != null
      ? Math.round(gpsLive.speedMps * 3.6 * 10) / 10
      : insights?.speedKmh ??
        (myStatus?.state?.lastSpeedMps != null
          ? Math.round(myStatus.state.lastSpeedMps * 3.6 * 10) / 10
          : null);
  const travelToday =
    insights?.travelledKm ??
    myStatus?.state?.travelledKmToday ??
    myStatus?.activeField?.totalTravelledKm ??
    0;
  const movement =
    gpsLive?.speedMps != null && gpsLive.speedMps > 0.8
      ? "Moving"
      : insights?.movementStatus === "moving" || myStatus?.state?.movementStatus === "moving"
        ? "Moving"
        : displayLat != null
          ? "Stationary"
          : "—";
  const lastSync =
    insights?.lastUpdatedAt || myStatus?.state?.lastUpdatedAt
      ? new Date(
          insights?.lastUpdatedAt || myStatus?.state?.lastUpdatedAt || ""
        ).toLocaleString()
      : "—";

  const mapCenter = useMemo(() => {
    if (displayLat != null && displayLng != null) return { lat: displayLat, lng: displayLng };
    const withGps = team.find((t) => t.lat != null && t.lng != null);
    if (withGps) return { lat: withGps.lat!, lng: withGps.lng! };
    if (office) return { lat: office.lat, lng: office.lng };
    return { lat: 16.5062, lng: 80.648 };
  }, [displayLat, displayLng, team, office]);

  const routePts = (insights?.route || []).filter(
    (p) => p.lat != null && p.lng != null
  ) as Array<{ lat: number; lng: number }>;
  const osmEmbed = useMemo(() => {
    const pad = 0.04;
    let minLat = mapCenter.lat - pad;
    let maxLat = mapCenter.lat + pad;
    let minLng = mapCenter.lng - pad;
    let maxLng = mapCenter.lng + pad;
    for (const p of routePts) {
      minLat = Math.min(minLat, p.lat - 0.01);
      maxLat = Math.max(maxLat, p.lat + 0.01);
      minLng = Math.min(minLng, p.lng - 0.01);
      maxLng = Math.max(maxLng, p.lng + 0.01);
    }
    return `https://www.openstreetmap.org/export/embed.html?bbox=${minLng}%2C${minLat}%2C${maxLng}%2C${maxLat}&layer=mapnik&marker=${mapCenter.lat}%2C${mapCenter.lng}`;
  }, [mapCenter, routePts]);

  const gpsLabel = gpsStatusLabel({
    source: gpsLive?.source || insights?.source || myStatus?.state?.lastSource,
    gpsDenied: gpsLive?.gpsDenied,
    permissionState: gpsLive?.permissionState,
    latitude: displayLat,
  });

  return (
    <PageShell wide>
      <PageHeader
        title="Field Sales Location"
        eyebrow="GPS tracking"
        description="High-accuracy GPS with live address, route distance, and manager visibility. Enable browser location for best results."
        actions={
          !myStatus?.activeField ? (
            <button
              type="button"
              disabled={busy}
              onClick={startField}
              className="mm-btn mm-btn-primary min-h-11 px-5 bg-sky-500 border-0 text-zinc-950 hover:bg-sky-400"
            >
              {busy ? "Getting GPS…" : "▶ Start Field Work"}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={endField}
              className="mm-btn min-h-11 px-5 bg-amber-500 text-zinc-950 border-0 hover:bg-amber-400"
            >
              {busy ? "Saving…" : "■ End Field Work"}
            </button>
          )
        }
      />

      {myStatus?.activeField && (
        <div className="mb-5 rounded-2xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide bg-sky-500 text-zinc-950">
            Live GPS
          </span>
          <span className="text-sm text-sky-100">
            Field session since {new Date(myStatus.activeField.startedAt).toLocaleTimeString()}
            {gpsError ? ` · ${gpsError}` : " · Watching position…"}
          </span>
        </div>
      )}

      {/* Professional KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mb-6">
        <StatCard
          label="Current location"
          value={
            <span className="text-base sm:text-lg line-clamp-2 leading-snug">
              {displayLat != null
                ? `${displayLat.toFixed(5)}, ${displayLng?.toFixed(5)}`
                : "—"}
            </span>
          }
          sub={displayAddress}
          tone="border-sky-500/25"
        />
        <StatCard
          label="GPS status"
          value={<span className="text-lg">{gpsLabel}</span>}
          sub={
            myStatus?.state?.status
              ? `Work status: ${statusLabel(myStatus.state.status)}`
              : "Enable browser location"
          }
          tone={
            displayLat != null ? "border-emerald-500/25" : "border-amber-500/30"
          }
        />
        <StatCard
          label="Travel today"
          value={
            <>
              {Number(travelToday || 0).toFixed(2)}{" "}
              <span className="text-sm font-normal text-zinc-500">km</span>
            </>
          }
          sub={`Visits: ${insights?.visits?.length ?? 0} · Stay ${insights?.totalStayMin ?? 0} min`}
          tone="border-violet-500/25"
        />
        <StatCard
          label="Distance from office"
          value={
            insights?.officeInsight?.distanceKm != null ? (
              <>
                {insights.officeInsight.distanceKm}{" "}
                <span className="text-sm font-normal text-zinc-500">km</span>
              </>
            ) : (
              "—"
            )
          }
          sub={
            insights?.officeInsight
              ? `~${insights.officeInsight.travelMinutes ?? "—"} min · ${insights.officeInsight.officeLabel}`
              : "Set office coordinates below"
          }
          tone="border-fuchsia-500/20"
        />
        <StatCard
          label="Speed / movement"
          value={
            speedKmh != null ? (
              <>
                {speedKmh} <span className="text-sm font-normal text-zinc-500">km/h</span>
              </>
            ) : (
              movement
            )
          }
          sub={`Status: ${movement}`}
          tone="border-cyan-500/20"
        />
        <StatCard
          label="Accuracy · last sync"
          value={
            accuracy != null ? (
              <>
                ±{Math.round(accuracy)}{" "}
                <span className="text-sm font-normal text-zinc-500">m</span>
              </>
            ) : (
              "—"
            )
          }
          sub={lastSync}
          tone="border-zinc-700"
        />
      </div>

      {/* Address detail card */}
      <div className="mm-panel p-4 sm:p-5 mb-6">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 mb-2">
          Full address
        </div>
        <p className="text-sm sm:text-base text-zinc-100 leading-relaxed">{displayAddress}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-500">
          {gpsLive?.pincode || insights?.currentPincode || myStatus?.state?.lastPincode ? (
            <span className="px-2 py-1 rounded-lg bg-white/5 border border-white/10">
              PIN {gpsLive?.pincode || insights?.currentPincode || myStatus?.state?.lastPincode}
            </span>
          ) : null}
          {(gpsLive?.city || insights?.currentCity || myStatus?.state?.lastCity) && (
            <span className="px-2 py-1 rounded-lg bg-white/5 border border-white/10">
              {gpsLive?.city || insights?.currentCity || myStatus?.state?.lastCity}
            </span>
          )}
          {(gpsLive?.state || insights?.currentState || myStatus?.state?.lastState) && (
            <span className="px-2 py-1 rounded-lg bg-white/5 border border-white/10">
              {gpsLive?.state || insights?.currentState || myStatus?.state?.lastState}
            </span>
          )}
          {(gpsLive?.country || insights?.currentCountry) && (
            <span className="px-2 py-1 rounded-lg bg-white/5 border border-white/10">
              {gpsLive?.country || insights?.currentCountry}
            </span>
          )}
        </div>
      </div>

      {/* Manager live + map */}
      {isManager && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 items-stretch">
          <div className="mm-panel p-4 sm:p-5 flex flex-col min-h-[340px]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white">Team live location</h2>
              <button
                type="button"
                onClick={() => void load()}
                className="text-xs px-2.5 py-1 rounded-lg border border-white/10 text-zinc-400 hover:text-white"
              >
                Refresh
              </button>
            </div>
            <div className="space-y-2 flex-1 overflow-auto max-h-96">
              {team.length === 0 ? (
                <p className="text-sm text-zinc-500 py-8 text-center">
                  No live GPS yet. Team members should allow location and start field work.
                </p>
              ) : (
                team.map((m) => (
                  <button
                    key={m.userId}
                    type="button"
                    onClick={() => setSelectedUserId(m.userId)}
                    className={`w-full text-left p-3 rounded-xl border transition-colors ${
                      selectedUserId === m.userId
                        ? "border-sky-500/50 bg-sky-500/10"
                        : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm text-white truncate">{m.name}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${
                          STATUS_STYLE[m.status] || STATUS_STYLE.offline
                        }`}
                      >
                        {statusLabel(m.status)}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-400 mt-1 line-clamp-2">
                      {m.fullAddress ||
                        [m.locality, m.city, m.state, m.pincode].filter(Boolean).join(", ") ||
                        (m.source === "gps" ? "GPS fix (address pending)" : "GPS not available")}
                    </div>
                    <div className="text-[10px] text-zinc-600 mt-1 flex flex-wrap justify-between gap-2">
                      <span>
                        {m.lastUpdatedAt ? new Date(m.lastUpdatedAt).toLocaleString() : ""}
                      </span>
                      <span>
                        Today {Number(m.travelledKmToday || 0).toFixed(2)} km
                        {m.distanceFromOfficeKm != null
                          ? ` · Office ${m.distanceFromOfficeKm} km`
                          : ""}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="mm-panel overflow-hidden flex flex-col min-h-[340px]">
            <iframe
              title="Field map"
              className="w-full flex-1 min-h-[280px] border-0"
              src={osmEmbed}
            />
            <div className="p-2.5 text-[10px] text-zinc-500 border-t border-zinc-800 flex flex-wrap justify-between gap-2">
              <span>
                Route points today: {routePts.length}
                {routePts.length > 1 ? " (path stored on server)" : ""}
              </span>
              <a
                className="text-sky-400 hover:underline"
                href={`https://www.openstreetmap.org/?mlat=${mapCenter.lat}&mlon=${mapCenter.lng}#map=14/${mapCenter.lat}/${mapCenter.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                Open full map
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Office + reports for managers */}
      {isManager &&
        ["ceo", "owner", "business_admin", "admin", "super_admin"].includes(role) && (
          <div className="mm-panel p-4 sm:p-5 mb-6">
            <h2 className="text-sm font-semibold text-white mb-3">Office location</h2>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <input
                className="mm-input"
                placeholder="Latitude"
                value={officeLat}
                onChange={(e) => setOfficeLat(e.target.value)}
              />
              <input
                className="mm-input"
                placeholder="Longitude"
                value={officeLng}
                onChange={(e) => setOfficeLng(e.target.value)}
              />
              <input
                className="mm-input"
                placeholder="Label"
                value={officeLabel}
                onChange={(e) => setOfficeLabel(e.target.value)}
              />
              <button type="button" onClick={() => void saveOffice()} className="mm-btn mm-btn-primary">
                Save office
              </button>
            </div>
          </div>
        )}

      {isManager && (
        <div className="mm-panel p-4 sm:p-5 mb-6">
          <h2 className="text-sm font-semibold text-white mb-3">Reports</h2>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["attendance", "Attendance"],
                ["travel", "Travel"],
                ["visits", "Visits"],
                ["route", "Route"],
              ] as const
            ).map(([type, label]) => (
              <button
                key={type}
                type="button"
                onClick={() => void exportReport(type, "csv")}
                className="mm-btn mm-btn-secondary min-h-9 px-3 text-xs"
              >
                {label} CSV
              </button>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      <div className="mm-panel p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">
            Location history{selectedUserId ? " (selected)" : ""}
          </h2>
          {selectedUserId && (
            <button
              type="button"
              className="text-xs text-zinc-500 hover:text-zinc-300"
              onClick={() => setSelectedUserId("")}
            >
              Clear selection
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <div className="mm-empty py-10">
            <p className="text-sm text-zinc-400">No GPS points yet</p>
            <p className="text-xs text-zinc-600 mt-1">
              Start field work with location permission to record the route.
            </p>
          </div>
        ) : (
          <div className="mm-table-wrap">
            <table className="mm-table min-w-[800px]">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Address</th>
                  <th>Coords</th>
                  <th>Segment</th>
                  <th>Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="text-xs whitespace-nowrap">
                      {new Date(h.recordedAt).toLocaleString()}
                    </td>
                    <td className="text-xs">{eventLabel(h.eventType)}</td>
                    <td className="text-xs max-w-[240px]">
                      <div className="truncate" title={h.fullAddress || ""}>
                        {h.fullAddress ||
                          [h.locality, h.city, h.pincode].filter(Boolean).join(", ") ||
                          (h.source === "gps" ? "GPS point" : "No GPS")}
                      </div>
                    </td>
                    <td className="text-xs tabular-nums whitespace-nowrap">
                      {h.latitude != null
                        ? `${h.latitude.toFixed(5)}, ${h.longitude?.toFixed(5)}`
                        : "—"}
                    </td>
                    <td className="text-xs tabular-nums">
                      {h.segmentDistanceKm != null
                        ? `${h.segmentDistanceKm.toFixed(3)} km`
                        : "—"}
                    </td>
                    <td className="text-xs tabular-nums">
                      {h.accuracyM != null ? `±${Math.round(h.accuracyM)} m` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  );
}
