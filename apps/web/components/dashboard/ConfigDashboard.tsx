"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { API_BASE_URL } from "@/lib/api";
import { DashboardWidgetHost, type RuntimeWidget } from "@/components/dashboard/DashboardWidgetHost";
import { usePortal } from "@/lib/portal-context";
import { useDataVersion } from "@/lib/data-events";
import { toast } from "sonner";

const DATE_PRESETS = [
  { key: "all", label: "All time" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "ytd", label: "YTD" },
];

/**
 * Role-driven dashboard: no dashboard-picker.
 * Business Admin uses Role selector to switch the entire portal workspace.
 * Dashboard key always comes from the active role's defaultDashboardKey.
 */
export function ConfigDashboard() {
  const { token, role: authRole } = useAuth();
  const { portal, workspaceRole, setWorkspaceRole, isLoading: portalLoading } = usePortal();
  const viewRole = portal?.role || workspaceRole || authRole || "sales_executive";
  const dashboardKey = portal?.defaultDashboardKey || "main";

  const [preset, setPreset] = useState("all");
  const [widgets, setWidgets] = useState<RuntimeWidget[]>([]);
  const [dashLabel, setDashLabel] = useState("");
  const [loading, setLoading] = useState(true);
  // Live refresh when CRM/finance data changes (no full page reload)
  const dataVersion = useDataVersion();

  const loadData = useCallback(async () => {
    if (!token || !dashboardKey) return;
    setLoading(true);
    try {
      const url = `${API_BASE_URL}/dashboards/${encodeURIComponent(dashboardKey)}?role=${encodeURIComponent(viewRole)}&preset=${encodeURIComponent(preset)}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await response.json();
      if (json.success && json.data) {
        setWidgets(json.data.widgets || []);
        setDashLabel(json.data.dashboard?.label || portal?.portalLabel || "Dashboard");
      } else {
        toast.error(json.error || "Failed to load dashboard");
        setWidgets([]);
        setDashLabel(portal?.portalLabel || "Dashboard");
      }
    } catch {
      toast.error("Network error loading dashboard");
    }
    setLoading(false);
  }, [token, dashboardKey, viewRole, preset, portal?.portalLabel]);

  useEffect(() => {
    loadData();
  }, [loadData, dataVersion]);

  const selectClass =
    "bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-600";

  const roleOptions =
    portal?.workspaceRoles?.length
      ? portal.workspaceRoles
      : [{ key: viewRole, label: viewRole.replace(/_/g, " ") }];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold truncate">
            {portal?.portalLabel || dashLabel || "Dashboard"}
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Role: <span className="text-zinc-300 font-mono">{viewRole}</span>
            {portal?.isWorkspacePreview ? " · preview" : ""} · business workspace only
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {/* Role selector — controls entire portal (sidebar, dashboards, AI, permissions). Not a dashboard picker. */}
          {portal?.canSwitchWorkspace && (
            <div className="flex items-center gap-2">
              <label htmlFor="overview-role" className="text-xs text-zinc-500 shrink-0">
                Role
              </label>
              <select
                id="overview-role"
                className={selectClass + " min-w-[160px]"}
                value={workspaceRole || portal.role}
                disabled={portalLoading}
                onChange={(e) => setWorkspaceRole(e.target.value)}
                aria-label="Select role workspace"
              >
                {roleOptions.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <select
            className={selectClass}
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            aria-label="Date range"
          >
            {DATE_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={loadData}
            className="px-3 py-2 text-sm rounded-xl bg-white/10 border border-zinc-800 hover:bg-white/15"
          >
            Refresh
          </button>
        </div>
      </div>

      <DashboardWidgetHost widgets={widgets} loading={loading || portalLoading} />
    </div>
  );
}
