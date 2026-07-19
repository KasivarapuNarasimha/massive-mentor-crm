"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { captureGps, toLocationBody } from "@/lib/location-client";
import { usePortal } from "@/lib/portal-context";

type TeamMember = {
  userId: string;
  name: string;
  email?: string;
  status: string;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  fullAddress?: string | null;
  lat?: number | null;
  lng?: number | null;
  source?: string | null;
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
  latitude?: number | null;
  longitude?: number | null;
  source?: string;
  browser?: string | null;
  device?: string | null;
  publicIp?: string | null;
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
    heartbeat: "Heartbeat",
  };
  return map[t] || t;
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
  const [myStatus, setMyStatus] = useState<{
    state?: { status?: string; lastLocality?: string; lastCity?: string } | null;
    activeField?: { id: string; startedAt: string } | null;
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
  const [insights, setInsights] = useState<{
    currentLocality?: string | null;
    currentCity?: string | null;
    travelledKm?: number;
    totalStayMin?: number;
    visits?: Array<{ meetingTitle?: string; locality?: string | null; stayedMin?: number | null }>;
    officeInsight?: { distanceKm: number | null; travelMinutes: number | null; officeLabel: string } | null;
  } | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [officeLat, setOfficeLat] = useState("");
  const [officeLng, setOfficeLng] = useState("");
  const [officeLabel, setOfficeLabel] = useState("Office");

  const load = useCallback(async () => {
    if (!token) return;
    const [st, live, hist, ins] = await Promise.all([
      api.get("/location/me", token),
      isManager ? api.get("/location/live", token) : Promise.resolve({ success: false, data: null }),
      api.get(
        `/location/history?pageSize=40${selectedUserId ? `&userId=${selectedUserId}` : ""}`,
        token
      ),
      api.get(
        `/location/insights${selectedUserId ? `?userId=${selectedUserId}` : ""}`,
        token
      ),
    ]);
    if (st.success) setMyStatus(st.data as typeof myStatus);
    if (live.success && live.data) {
      const d = live.data as {
        team?: TeamMember[];
        office?: typeof office;
      };
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
    if (ins.success) setInsights(ins.data as typeof insights);
  }, [token, isManager, selectedUserId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const withLocation = async (fn: (body: Record<string, unknown>) => Promise<void>) => {
    setBusy(true);
    try {
      const loc = await captureGps({ timeoutMs: 15000, force: true });
      if (loc.gpsDenied) {
        toast.message("GPS unavailable — recording with city-level IP fallback only");
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
      if (res.success) toast.success("Field work started");
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
    const lat = parseFloat(officeLat);
    const lng = parseFloat(officeLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast.error("Enter valid office coordinates");
      return;
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
      if (format === "json") {
        const j = await res.json();
        const blob = new Blob([JSON.stringify(j, null, 2)], {
          type: "application/json",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `location-${type}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast.success("Report downloaded");
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `location-${type}.${format === "xlsx" ? "xlsx" : "csv"}`;
      a.click();
      toast.success("Report downloaded");
    } catch {
      toast.error("Export failed");
    }
  };

  const mapCenter = useMemo(() => {
    const withGps = team.filter((t) => t.lat != null && t.lng != null);
    if (withGps[0]) return { lat: withGps[0].lat!, lng: withGps[0].lng! };
    if (office) return { lat: office.lat, lng: office.lng };
    return { lat: 16.5062, lng: 80.648 }; // default coastal India approx
  }, [team, office]);

  const osmEmbed = `https://www.openstreetmap.org/export/embed.html?bbox=${
    mapCenter.lng - 0.08
  }%2C${mapCenter.lat - 0.06}%2C${mapCenter.lng + 0.08}%2C${mapCenter.lat + 0.06}&layer=mapnik&marker=${mapCenter.lat}%2C${mapCenter.lng}`;

  return (
    <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Field Sales Location</h1>
          <p className="text-zinc-400 mt-1 text-sm leading-relaxed">
            Login records device + location for attendance.{" "}
            <strong className="text-zinc-200">Field tracking is manual:</strong> press{" "}
            <strong className="text-sky-400">Start Field Work</strong> to go On Field (GPS
            preferred). Live map and team list appear for managers after field sessions exist.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          {!myStatus?.activeField ? (
            <button
              type="button"
              disabled={busy}
              onClick={startField}
              className="w-full sm:w-auto min-h-12 px-5 py-3 rounded-xl bg-sky-500 text-zinc-950 text-sm font-semibold hover:bg-sky-400 disabled:opacity-50 shadow-lg shadow-sky-500/20 touch-manipulation"
              data-testid="page-start-field-work"
            >
              {busy ? "Getting GPS…" : "▶ Start Field Work"}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={endField}
              className="w-full sm:w-auto min-h-12 px-5 py-3 rounded-xl bg-amber-500 text-zinc-950 text-sm font-semibold hover:bg-amber-400 disabled:opacity-50 touch-manipulation"
              data-testid="page-end-field-work"
            >
              {busy ? "Saving…" : "■ End Field Work"}
            </button>
          )}
        </div>
      </div>

      {myStatus?.activeField && (
        <div className="mb-6 rounded-2xl border border-sky-500/40 bg-sky-500/10 p-4 flex flex-wrap items-center gap-3">
          <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-sky-500 text-zinc-950">
            On Field
          </span>
          <div className="text-sm text-sky-100">
            Tracking active
            {myStatus.state?.lastLocality || myStatus.state?.lastCity
              ? ` · ${myStatus.state?.lastLocality || myStatus.state?.lastCity}`
              : ""}
            {myStatus.activeField.startedAt
              ? ` · since ${new Date(myStatus.activeField.startedAt).toLocaleTimeString()}`
              : ""}
          </div>
        </div>
      )}

      {/* My status + insights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">My Status</div>
          <div
            className={`inline-flex px-2.5 py-1 rounded-full text-xs border ${
              STATUS_STYLE[myStatus?.state?.status || "offline"] || STATUS_STYLE.offline
            }`}
          >
            {statusLabel(myStatus?.state?.status || "offline")}
          </div>
          <div className="mt-3 text-sm text-zinc-300">
            {myStatus?.state?.lastLocality || myStatus?.state?.lastCity || "—"}
          </div>
          {myStatus?.activeField && (
            <div className="text-xs text-sky-400 mt-2">
              Field session since {new Date(myStatus.activeField.startedAt).toLocaleTimeString()}
            </div>
          )}
          {myStatus?.openMeeting?.meeting && (
            <div className="text-xs text-violet-300 mt-1">
              In meeting: {myStatus.openMeeting.meeting.title}
            </div>
          )}
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Today Travel</div>
          <div className="text-2xl font-semibold tabular-nums">
            {insights?.travelledKm ?? 0} <span className="text-sm text-zinc-500">km</span>
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            Customer time: {insights?.totalStayMin ?? 0} min · Visits:{" "}
            {insights?.visits?.length ?? 0}
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
            Distance from Office
          </div>
          {insights?.officeInsight ? (
            <>
              <div className="text-2xl font-semibold tabular-nums">
                {insights.officeInsight.distanceKm ?? "—"}{" "}
                <span className="text-sm text-zinc-500">km</span>
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                ~{insights.officeInsight.travelMinutes ?? "—"} min to{" "}
                {insights.officeInsight.officeLabel}
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-500">
              Set office coordinates (admin) to see distance insights. GPS required for distance.
            </p>
          )}
        </div>
      </div>

      {/* Live team + map */}
      {isManager && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Sales Team Live Location</h2>
              <button
                type="button"
                onClick={load}
                className="text-xs px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15"
              >
                Refresh
              </button>
            </div>
            <div className="space-y-2 max-h-80 overflow-auto">
              {team.length === 0 ? (
                <p className="text-sm text-zinc-500">No live locations yet. Team members log in or start field work.</p>
              ) : (
                team.map((m) => (
                  <button
                    key={m.userId}
                    type="button"
                    onClick={() => setSelectedUserId(m.userId)}
                    className={`w-full text-left p-3 rounded-xl border transition-colors ${
                      selectedUserId === m.userId
                        ? "border-sky-500/50 bg-sky-500/5"
                        : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate">{m.name}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${
                          STATUS_STYLE[m.status] || STATUS_STYLE.offline
                        }`}
                      >
                        {statusLabel(m.status)}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-400 mt-1 truncate">
                      {[m.locality, m.city].filter(Boolean).join(" · ") ||
                        (m.source === "ip" ? `${m.city || "City unknown"} (IP)` : "—")}
                    </div>
                    <div className="text-[10px] text-zinc-600 mt-0.5 flex justify-between">
                      <span>
                        {m.lastUpdatedAt
                          ? new Date(m.lastUpdatedAt).toLocaleString()
                          : ""}
                      </span>
                      {m.distanceFromOfficeKm != null && (
                        <span>
                          {m.distanceFromOfficeKm} km · ~{m.travelMinutes} min
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden min-h-[320px]">
            <iframe
              title="Team map"
              className="w-full h-full min-h-[320px] border-0 grayscale-[20%]"
              src={osmEmbed}
            />
            <div className="p-2 text-[10px] text-zinc-600 border-t border-zinc-800">
              OpenStreetMap · Markers use last GPS when available.{" "}
              <a
                className="text-sky-500 hover:underline"
                href={`https://www.openstreetmap.org/?mlat=${mapCenter.lat}&mlon=${mapCenter.lng}#map=13/${mapCenter.lat}/${mapCenter.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                Open full map
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Office settings (admin) */}
      {isManager &&
        ["ceo", "owner", "business_admin", "admin", "super_admin"].includes(role) && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-6">
            <h2 className="font-semibold mb-3">Office Location (for distance insights)</h2>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <input
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm"
                placeholder="Latitude"
                value={officeLat}
                onChange={(e) => setOfficeLat(e.target.value)}
              />
              <input
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm"
                placeholder="Longitude"
                value={officeLng}
                onChange={(e) => setOfficeLng(e.target.value)}
              />
              <input
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm"
                placeholder="Label (e.g. Benz Circle Office)"
                value={officeLabel}
                onChange={(e) => setOfficeLabel(e.target.value)}
              />
              <button
                type="button"
                onClick={saveOffice}
                className="px-4 py-2 rounded-xl bg-white text-zinc-950 text-sm font-medium"
              >
                Save Office
              </button>
            </div>
          </div>
        )}

      {/* Reports */}
      {isManager && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-6">
          <h2 className="font-semibold mb-3">Reports</h2>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["attendance", "Daily Attendance"],
                ["travel", "Daily Travel"],
                ["visits", "Customer Visits"],
                ["productivity", "Field Productivity"],
                ["route", "Route History"],
              ] as const
            ).map(([type, label]) => (
              <div key={type} className="flex flex-wrap gap-1 items-center">
                <span className="text-[10px] text-zinc-500 w-full sm:w-auto sm:mr-1">{label}</span>
                <button
                  type="button"
                  onClick={() => exportReport(type, "csv")}
                  className="px-2.5 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/15"
                >
                  CSV
                </button>
                <button
                  type="button"
                  onClick={() => exportReport(type, "xlsx")}
                  className="px-2.5 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400"
                >
                  Excel
                </button>
                <button
                  type="button"
                  onClick={() => exportReport(type, "pdf")}
                  className="px-2.5 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400"
                >
                  PDF
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">
            Location History{selectedUserId ? " (selected)" : " (you)"}
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
          <p className="py-8 text-center text-zinc-500 text-sm">
            No location events yet. Log in or start field work to begin tracking.
          </p>
        ) : (
          <>
            {/* Mobile / tablet cards — no wide table squeeze */}
            <div className="md:hidden space-y-3">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-white">{eventLabel(h.eventType)}</span>
                    <span className="text-[10px] text-zinc-500 whitespace-nowrap">
                      {new Date(h.recordedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm text-zinc-300">
                    {h.locality || h.city || "—"}
                  </div>
                  {(h.fullAddress || h.source === "ip") && (
                    <div className="text-xs text-zinc-500 break-words">
                      {h.fullAddress || `${h.city || ""} (${h.source})`}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-600">
                    <span>{[h.device, h.browser].filter(Boolean).join(" · ") || "—"}</span>
                    {h.publicIp && <span className="font-mono">{h.publicIp}</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block table-scroll">
              <table className="mm-table min-w-[720px]">
                <thead className="text-xs text-zinc-500 border-b border-zinc-800">
                  <tr>
                    <th className="text-left py-2 pr-2">Date / Time</th>
                    <th className="text-left py-2 pr-2">Event</th>
                    <th className="text-left py-2 pr-2">Area</th>
                    <th className="text-left py-2 pr-2">Address</th>
                    <th className="text-left py-2 pr-2">Device</th>
                    <th className="text-left py-2">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {history.map((h) => (
                    <tr key={h.id} className="text-zinc-300">
                      <td className="py-2 pr-2 whitespace-nowrap text-xs">
                        {new Date(h.recordedAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-2 text-xs">{eventLabel(h.eventType)}</td>
                      <td className="py-2 pr-2 text-xs max-w-[120px] truncate">
                        {h.locality || h.city || "—"}
                      </td>
                      <td
                        className="py-2 pr-2 text-xs max-w-[200px] truncate"
                        title={h.fullAddress || ""}
                      >
                        {h.fullAddress ||
                          (h.source === "ip" ? `${h.city || ""} ${h.source}` : "—")}
                      </td>
                      <td className="py-2 pr-2 text-xs">
                        {[h.device, h.browser].filter(Boolean).join(" · ")}
                      </td>
                      <td className="py-2 text-xs font-mono text-zinc-500">
                        {h.publicIp || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
