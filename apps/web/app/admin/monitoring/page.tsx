"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PORTAL_TOKENS } from "@/lib/portal-config";
import { HealthDot, StatusBadge } from "@/components/admin/StatusBadge";
import { ProgressBar } from "@/components/admin/SimpleChart";
import { AdminDataTable, type AdminColumn } from "@/components/admin/AdminDataTable";
import { DeveloperRaw } from "@/components/admin/DeveloperRaw";

type Card = {
  label: string;
  status: string;
  value: string;
  detail?: string;
  percent?: number;
};

type EventRow = {
  id: string;
  time: string;
  event: string;
  severity: string;
  module: string;
};

export default function AdminMonitoringPage() {
  const [cards, setCards] = useState<Record<string, Card> | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [raw, setRaw] = useState<unknown>(null);

  useEffect(() => {
    const t = localStorage.getItem(PORTAL_TOKENS.admin);
    if (!t) return;
    (async () => {
      const [h, e] = await Promise.all([api.platformHealth(t), api.platformEvents(t)]);
      if (h.success && h.data) {
        const d = h.data as { cards?: Record<string, Card>; raw?: unknown };
        setCards(d.cards || null);
        setRaw(h.data);
      }
      if (e.success && e.data) {
        setEvents(
          (e.data as Array<Record<string, unknown>>).map((r) => ({
            id: String(r.id),
            time: r.time ? new Date(String(r.time)).toLocaleString() : "—",
            event: String(r.event || ""),
            severity: String(r.severity || "info"),
            module: String(r.module || "platform"),
          }))
        );
      }
    })();
  }, []);

  const cols: AdminColumn<EventRow>[] = [
    { key: "time", label: "Time" },
    { key: "event", label: "Event" },
    {
      key: "severity",
      label: "Severity",
      render: (r) => <StatusBadge value={r.severity === "info" ? "active" : r.severity} />,
    },
    { key: "module", label: "Module" },
  ];

  if (!cards) {
    return <div className="h-64 bg-card rounded-2xl animate-pulse max-w-7xl" />;
  }

  const order = [
    "api",
    "database",
    "cpu",
    "ram",
    "storage",
    "activeSessions",
    "activeBusinesses",
    "onlineUsers",
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">System Monitoring</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Professional health dashboard with color indicators — no raw JSON for operators.
        </p>
        <div className="flex flex-wrap gap-4 mt-3 text-sm">
          <HealthDot status="healthy" />
          <HealthDot status="warning" />
          <HealthDot status="critical" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {order.map((key) => {
          const c = cards[key];
          if (!c) return null;
          const border =
            c.status === "critical"
              ? "border-red-800/60 bg-red-950/20"
              : c.status === "warning"
                ? "border-amber-800/60 bg-amber-950/20"
                : "border-emerald-800/40 bg-emerald-950/10";
          return (
            <div key={key} className={`rounded-2xl border p-4 ${border}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</div>
                <HealthDot status={c.status} />
              </div>
              <div className="text-xl font-semibold text-foreground mt-2">{c.value}</div>
              {c.detail ? <div className="text-xs text-muted-foreground mt-1">{c.detail}</div> : null}
              {typeof c.percent === "number" ? (
                <div className="mt-3">
                  <ProgressBar
                    label="Utilization"
                    value={c.percent}
                    tone={c.percent >= 90 ? "amber" : "emerald"}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold">Recent Events</h2>
        <AdminDataTable
          rows={events}
          columns={cols}
          searchKeys={["event", "severity", "module"]}
          exportName="system-events"
          emptyMessage="No recent events"
        />
      </section>

      <DeveloperRaw data={raw} />
    </div>
  );
}
