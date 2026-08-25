"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { ExportFiltersBar } from "@/components/ui/ExportFiltersBar";
import { ActivityEventCard } from "@/components/ui/ActivityEventCard";
import { formatActivityEvent, isDebugPayloadMode } from "@/lib/format-activity";

interface Activity {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  details?: unknown;
  createdAt: string;
}

interface AuditRow {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
  actor?: { email: string; name: string | null } | null;
}

export default function ActivityTimelinePage() {
  const { token } = useAuth();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [debugMode, setDebugMode] = useState(false);

  useEffect(() => {
    setDebugMode(isDebugPayloadMode());
  }, []);

  const toggleDebug = () => {
    try {
      const next = !debugMode;
      if (next) localStorage.setItem("massive_mentor_debug_payloads", "1");
      else localStorage.removeItem("massive_mentor_debug_payloads");
      setDebugMode(next);
    } catch {
      /* ignore */
    }
  };

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    const params = new URLSearchParams();
    if (entityType) params.set("entityType", entityType);
    if (action) params.set("action", action);
    if (search) params.set("search", search);
    const res = await api.get(`/automations/activity?${params}`, token);
    if (res.success && res.data) {
      const data = res.data as {
        activities?: Activity[];
        audit?: AuditRow[];
      };
      setActivities(data.activities || []);
      setAudit(data.audit || []);
    } else {
      setActivities([]);
      setAudit([]);
    }
    setIsLoading(false);
  }, [token, entityType, action, search]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = () => {
    const rows = [
      ["timestamp", "user", "action", "module", "summary", "ip"],
      ...audit.map((a) => {
        const f = formatActivityEvent({
          action: a.action,
          entityType: a.entityType,
          entityId: a.entityId,
          metadata: a.metadata,
        });
        return [
          a.createdAt,
          a.actor?.email || "",
          f.headline,
          a.entityType || "",
          f.summary,
          a.ip || "",
        ];
      }),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-5 lg:py-6 overflow-x-hidden pb-20 md:pb-6">
      <div className="flex flex-wrap items-start justify-between gap-2.5 mb-4">
        <div>
          <h1 className="mm-page-title mb-1">Activity & Audit Log</h1>
          <p className="mm-secondary">
            Human-readable trail of important account and CRM actions.
          </p>
        </div>
        {process.env.NODE_ENV === "development" && (
          <button
            type="button"
            onClick={toggleDebug}
            className="mm-btn mm-btn-ghost h-8 min-h-8 px-2.5 text-[11px]"
            title="Show raw JSON payloads under each card"
          >
            {debugMode ? "Hide developer payloads" : "Developer mode"}
          </button>
        )}
      </div>

      <ExportFiltersBar
        module="audit"
        token={token}
        search={search}
        onSearchChange={setSearch}
        className="mb-3"
      />

      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div className="hidden" />
        <button
          type="button"
          onClick={exportCsv}
          className="mm-btn mm-btn-secondary h-9"
        >
          Export audit CSV
        </button>
      </div>

      <div className="mm-filter-bar mb-4">
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="mm-input w-full sm:w-auto"
        >
          <option value="">All modules</option>
          <option value="contact">Contact</option>
          <option value="deal">Deal</option>
          <option value="task">Task</option>
          <option value="invoice">Invoice</option>
          <option value="expense">Expense</option>
          <option value="payment">Payment</option>
          <option value="user">User</option>
          <option value="whatsapp_message">WhatsApp</option>
        </select>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="mm-input w-full sm:w-auto"
        >
          <option value="">All actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="login">Login</option>
          <option value="import">Import</option>
          <option value="export">Export</option>
          <option value="ai">AI</option>
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search email, module, details…"
          className="mm-input flex-1 w-full sm:min-w-[160px]"
        />
        <button
          type="button"
          onClick={load}
          className="mm-btn mm-btn-secondary h-9 touch-manipulation w-full sm:w-auto"
        >
          Filter
        </button>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-40 mm-card" />
      ) : (
        <div className="space-y-5">
          <section>
            <h2 className="mm-secondary font-semibold mb-2.5">
              Audit trail ({audit.length})
            </h2>
            {audit.length === 0 ? (
              <div className="mm-card mm-empty text-muted-foreground text-sm">
                No audit entries yet.
              </div>
            ) : (
              <div className="space-y-2">
                {audit.map((a) => (
                  <ActivityEventCard
                    key={a.id}
                    action={a.action}
                    entityType={a.entityType}
                    entityId={a.entityId}
                    metadata={a.metadata}
                    actorLabel={a.actor?.name || a.actor?.email}
                    ip={a.ip}
                    createdAt={a.createdAt}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mm-secondary font-semibold mb-2.5">
              CRM activity ({activities.length})
            </h2>
            {activities.length === 0 ? (
              <div className="mm-secondary">No CRM activity rows yet.</div>
            ) : (
              <div className="space-y-2">
                {activities.map((a) => (
                  <ActivityEventCard
                    key={a.id}
                    action={a.action}
                    entityType={a.entityType}
                    entityId={a.entityId}
                    details={a.details}
                    createdAt={a.createdAt}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
