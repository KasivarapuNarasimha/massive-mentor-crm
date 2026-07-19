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
        <div className="h-40 mm-skeleton rounded-2xl" aria-busy="true" />
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
        <div className="mm-panel p-6 text-sm text-zinc-400">
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
            className="mm-btn mm-btn-secondary text-sm"
          >
            End my other sessions
          </button>
        }
      />

      {/* Policy strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          {
            label: "Active sessions",
            value: String(sessions.length),
            tone: "from-violet-500/15 border-violet-500/25",
          },
          {
            label: "Failed logins (7d)",
            value: String(failed),
            tone: "from-rose-500/15 border-rose-500/25",
          },
          {
            label: "Devices online",
            value: String(devices.length),
            tone: "from-sky-500/15 border-sky-500/25",
          },
          {
            label: "Session limit",
            value:
              policy?.maxConcurrentSessions === 0
                ? "Unlimited"
                : `${policy?.maxConcurrentSessions ?? "—"} / user`,
            tone: "from-emerald-500/15 border-emerald-500/25",
          },
        ].map((k) => (
          <div
            key={k.label}
            className={`rounded-2xl border bg-gradient-to-br ${k.tone} to-transparent p-4`}
          >
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
              {k.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{k.value}</div>
            {k.label === "Session limit" && policy?.plan && (
              <div className="text-[11px] text-zinc-500 mt-1 capitalize">Plan: {policy.plan}</div>
            )}
          </div>
        ))}
      </div>

      {/* Active sessions */}
      <section className="mm-panel p-4 sm:p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-3">Active sessions</h2>
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
                  <td colSpan={6} className="text-center text-zinc-500 py-8">
                    No active sessions
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.id} data-selected={s.id === currentSessionId ? "true" : undefined}>
                    <td>
                      <div className="font-medium text-white">{s.userName || "—"}</div>
                      <div className="text-xs text-zinc-500">{s.userEmail}</div>
                      {s.id === currentSessionId && (
                        <span className="text-[10px] text-emerald-400 font-semibold">Current</span>
                      )}
                    </td>
                    <td>
                      <div className="text-zinc-200">{s.deviceName || "—"}</div>
                      <div className="text-xs text-zinc-500">
                        {s.browser} · {s.os}
                      </div>
                    </td>
                    <td>
                      <div className="tabular-nums text-zinc-300">{s.ipAddress || "—"}</div>
                      <div className="text-xs text-zinc-500">{s.locationLabel || "—"}</div>
                    </td>
                    <td className="text-xs text-zinc-400">{fmt(s.loginTime)}</td>
                    <td className="text-xs text-zinc-400">{fmt(s.lastActivity)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        disabled={busyId === s.id || s.id === currentSessionId}
                        onClick={() => void terminate(s.id)}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-red-900/50 text-red-400 hover:bg-red-950/40 disabled:opacity-40"
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Devices */}
        <section className="mm-panel p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-white mb-3">Devices</h2>
          {devices.length === 0 ? (
            <p className="text-sm text-zinc-500">No devices online</p>
          ) : (
            <ul className="space-y-2">
              {devices.map((d, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2.5"
                >
                  <div>
                    <div className="text-sm text-white font-medium">
                      {d.browser} on {d.os}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {d.activeSessions} session(s) · {d.userCount} user(s) · last {fmt(d.lastSeen)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Password / MFA snapshot */}
        <section className="mm-panel p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-white mb-3">User security snapshot</h2>
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
                      <div className="text-sm text-white">{u.name || "—"}</div>
                      <div className="text-xs text-zinc-500">{u.email}</div>
                    </td>
                    <td className="text-xs text-zinc-400">{fmt(u.lastLoginAt)}</td>
                    <td className="text-xs text-zinc-400">{fmt(u.passwordChangedAt)}</td>
                    <td className="text-xs">
                      {u.mfaEnabled ? (
                        <span className="text-emerald-400">On</span>
                      ) : (
                        <span className="text-zinc-500">Off</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-zinc-600">
            MFA/2FA is architected (flags reserved) and can be enabled later without redesigning
            sessions.
          </p>
        </section>
      </div>

      {/* Login history */}
      <section className="mm-panel p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white mb-3">Login history</h2>
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
                  <td colSpan={5} className="text-center text-zinc-500 py-8">
                    No history yet
                  </td>
                </tr>
              ) : (
                history.map((h) => (
                  <tr key={h.id}>
                    <td className="text-xs text-zinc-400 whitespace-nowrap">{fmt(h.createdAt)}</td>
                    <td>
                      <span
                        className={`text-xs font-medium ${
                          h.eventType === "failed_login"
                            ? "text-rose-400"
                            : h.eventType === "force_logout"
                              ? "text-amber-400"
                              : "text-zinc-200"
                        }`}
                      >
                        {eventLabel(h.eventType)}
                      </span>
                    </td>
                    <td className="text-xs">
                      <div className="text-zinc-200">{h.userName || "—"}</div>
                      <div className="text-zinc-500">{h.userEmail}</div>
                    </td>
                    <td className="text-xs text-zinc-400">{h.deviceName || "—"}</td>
                    <td className="text-xs text-zinc-400">
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
