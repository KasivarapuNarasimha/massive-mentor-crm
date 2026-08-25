"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader, PageShell } from "@/components/ui/PageShell";

type SessionRow = {
  id: string;
  userId?: string;
  userEmail?: string;
  userName?: string | null;
  deviceName?: string | null;
  browser?: string | null;
  os?: string | null;
  ipAddress?: string | null;
  locationLabel?: string | null;
  loginTime?: string;
  lastActivity?: string;
  isCurrent?: boolean;
};

type HistoryRow = {
  id: string;
  eventType: string;
  success: boolean;
  userEmail?: string | null;
  userName?: string | null;
  ipAddress?: string | null;
  deviceName?: string | null;
  locationLabel?: string | null;
  createdAt: string;
};

type DeviceRow = {
  browser: string;
  os: string;
  activeSessions: number;
  userCount: number;
  lastSeen: string;
};

export default function SecurityPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [failed, setFailed] = useState(0);
  const [policy, setPolicy] = useState<{ plan: string; maxConcurrentSessions: number } | null>(
    null
  );
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [users, setUsers] = useState<
    Array<{
      id: string;
      email: string;
      name: string | null;
      lastLoginAt?: string | null;
      passwordChangedAt?: string | null;
      mfaEnabled?: boolean;
    }>
  >([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await api.getSecurityDashboard(token);
    if (!res.success) {
      if (/admin|permission|403|Only Business/i.test(res.error || "")) {
        setForbidden(true);
      } else {
        toast.error(res.error || "Failed to load security dashboard");
      }
      setLoading(false);
      return;
    }
    setForbidden(false);
    const d = res.data!;
    setSessions((d.activeSessions || []) as SessionRow[]);
    setHistory((d.loginHistory || []) as HistoryRow[]);
    setDevices((d.devices || []) as DeviceRow[]);
    setFailed(d.failedLoginsLast7Days || 0);
    setPolicy(d.sessionPolicy || null);
    setCurrentSessionId(d.currentSessionId || null);
    setUsers((d.users || []) as typeof users);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const terminate = async (id: string) => {
    if (!token) return;
    if (!confirm("End this session? The user will need to sign in again on that device.")) return;
    setBusyId(id);
    const res = await api.terminateSession(id, token);
    if (res.success) {
      toast.success("Session terminated");
      await load();
    } else toast.error(res.error || "Failed");
    setBusyId(null);
  };

  const terminateAllOthers = async () => {
    if (!token) return;
    if (!confirm("End all other sessions for every user? They will be signed out elsewhere."))
      return;
    // Terminate others for each unique user in active sessions (except current user session handled per-user on self)
    setBusyId("all");
    const res = await api.terminateOtherSessions(token);
    if (res.success) {
      toast.success(`Terminated ${res.data?.terminated ?? 0} of your other sessions`);
      await load();
    } else toast.error(res.error || "Failed");
    setBusyId(null);
  };

  const fmt = (d?: string | null) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleString();
    } catch {
      return d;
    }
  };

  const eventLabel = (t: string) =>
    ({
      login: "Login",
      logout: "Logout",
      failed_login: "Failed login",
      password_changed: "Password changed",
      new_device: "New device",
      force_logout: "Force logout",
      session_limit: "Session limit",
    })[t] || t.replace(/_/g, " ");

  if (loading) {
    return (
      <PageShell wide>
        <div className="h-40 mm-skeleton rounded-lg" aria-busy="true" />
      </PageShell>
    );
  }

  if (forbidden) {
    return (
      <PageShell wide>
        <PageHeader
          title="Security"
          description="Only Business Admins can view the organization security dashboard."
          eyebrow="Access control"
        />
        <div className="mm-card p-4 sm:p-5 mm-secondary">
          Ask your Business Admin for access, or review your own sessions after we expand personal
          security settings.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell wide>
      <PageHeader
        title="Security"
        eyebrow="Enterprise"
        description="Active sessions, devices, and login history — designed to prevent shared logins and protect your license seats."
        actions={
          <button
            type="button"
            onClick={() => void terminateAllOthers()}
            disabled={busyId === "all"}
            className="mm-btn mm-btn-secondary"
          >
            End my other sessions
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[
          {
            label: "Active sessions",
            value: String(sessions.length),
          },
          {
            label: "Failed logins (7d)",
            value: String(failed),
          },
          {
            label: "Devices online",
            value: String(devices.length),
          },
          {
            label: "Session limit",
            value:
              policy?.maxConcurrentSessions === 0
                ? "Unlimited"
                : `${policy?.maxConcurrentSessions ?? "—"} / user`,
          },
        ].map((k) => (
          <div key={k.label} className="mm-kpi-card">
            <div className="mm-kpi-label">{k.label}</div>
            <div className="mm-kpi-value">{k.value}</div>
            {k.label === "Session limit" && policy?.plan && (
              <div className="mm-kpi-meta capitalize">Plan: {policy.plan}</div>
            )}
          </div>
        ))}
      </div>

      <section className="mm-card p-4 sm:p-5 mb-4">
        <h2 className="mm-section-title mb-3">Active sessions</h2>
        <div className="mm-table-wrap">
          <table className="mm-table min-w-[800px]">
            <thead>
              <tr>
                <th>User</th>
                <th>Device</th>
                <th>IP / Location</th>
                <th>Login</th>
                <th>Last activity</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center mm-secondary py-8">
                    No active sessions
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.id} data-selected={s.id === currentSessionId ? "true" : undefined}>
                    <td>
                      <div className="font-medium text-foreground">{s.userName || "—"}</div>
                      <div className="mm-secondary">{s.userEmail}</div>
                      {s.id === currentSessionId && (
                        <span className="mm-badge mm-badge-success mt-1">Current</span>
                      )}
                    </td>
                    <td>
                      <div className="text-foreground">{s.deviceName || "—"}</div>
                      <div className="mm-secondary">
                        {s.browser} · {s.os}
                      </div>
                    </td>
                    <td>
                      <div className="tabular-nums mm-secondary">{s.ipAddress || "—"}</div>
                      <div className="mm-secondary">{s.locationLabel || "—"}</div>
                    </td>
                    <td className="mm-secondary whitespace-nowrap">{fmt(s.loginTime)}</td>
                    <td className="mm-secondary whitespace-nowrap">{fmt(s.lastActivity)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        disabled={busyId === s.id || s.id === currentSessionId}
                        onClick={() => void terminate(s.id)}
                        className="mm-btn mm-btn-danger h-9 px-3 text-xs"
                      >
                        End
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <section className="mm-card p-4 sm:p-5">
          <h2 className="mm-section-title mb-3">Devices</h2>
          {devices.length === 0 ? (
            <p className="mm-secondary">No devices online</p>
          ) : (
            <ul className="space-y-2">
              {devices.map((d, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                >
                  <div>
                    <div className="text-sm text-foreground font-medium">
                      {d.browser} on {d.os}
                    </div>
                    <div className="mm-secondary">
                      {d.activeSessions} session(s) · {d.userCount} user(s) · last {fmt(d.lastSeen)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mm-card p-4 sm:p-5">
          <h2 className="mm-section-title mb-3">User security snapshot</h2>
          <div className="mm-table-wrap max-h-72 overflow-y-auto">
            <table className="mm-table min-w-full">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Last login</th>
                  <th>Password changed</th>
                  <th>MFA</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="text-sm text-foreground">{u.name || "—"}</div>
                      <div className="mm-secondary">{u.email}</div>
                    </td>
                    <td className="mm-secondary whitespace-nowrap">{fmt(u.lastLoginAt)}</td>
                    <td className="mm-secondary whitespace-nowrap">{fmt(u.passwordChangedAt)}</td>
                    <td>
                      {u.mfaEnabled ? (
                        <span className="mm-badge mm-badge-success">On</span>
                      ) : (
                        <span className="mm-badge">Off</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 mm-secondary">
            MFA/2FA is architected (flags reserved) and can be enabled later without redesigning
            sessions.
          </p>
        </section>
      </div>

      <section className="mm-card p-4 sm:p-5">
        <h2 className="mm-section-title mb-3">Login history</h2>
        <div className="mm-table-wrap">
          <table className="mm-table min-w-[720px]">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>User</th>
                <th>Device</th>
                <th>IP / Location</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center mm-secondary py-8">
                    No history yet
                  </td>
                </tr>
              ) : (
                history.map((h) => (
                  <tr key={h.id}>
                    <td className="mm-secondary whitespace-nowrap">{fmt(h.createdAt)}</td>
                    <td>
                      {h.eventType === "failed_login" ? (
                        <span className="mm-badge mm-badge-danger">{eventLabel(h.eventType)}</span>
                      ) : h.eventType === "force_logout" ? (
                        <span className="mm-badge mm-badge-warning">{eventLabel(h.eventType)}</span>
                      ) : (
                        <span className="mm-badge">{eventLabel(h.eventType)}</span>
                      )}
                    </td>
                    <td>
                      <div className="text-foreground text-sm">{h.userName || "—"}</div>
                      <div className="mm-secondary">{h.userEmail}</div>
                    </td>
                    <td className="mm-secondary">{h.deviceName || "—"}</td>
                    <td className="mm-secondary">
                      {h.ipAddress || "—"}
                      {h.locationLabel ? ` · ${h.locationLabel}` : ""}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </PageShell>
  );
}
