"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageShell, PageHeader } from "@/components/ui/PageShell";
import { formatCurrency, parseAmount } from "@/lib/currency";
import { CurrencyAmountInput } from "@/components/ui/CurrencyAmountInput";

type Workflow = {
  id: string;
  type: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  rules?: { minAmount?: number; autoApproveBelow?: number; currency?: string };
  steps?: Array<{
    id: string;
    level: number;
    name?: string | null;
    approverRole?: string | null;
  }>;
  _count?: { requests: number };
};

type ApprovalRequest = {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  amount?: number | null;
  currency?: string | null;
  status: string;
  currentLevel: number;
  maxLevel: number;
  createdAt: string;
  decidedAt?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  requestedBy?: { id: string; name: string | null; email: string };
  workflow?: { id: string; name: string; type: string } | null;
  actions?: Array<{
    id: string;
    action: string;
    level: number;
    comment?: string | null;
    createdAt: string;
    actor?: { name: string | null; email: string };
  }>;
};

type Stats = {
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
  total: number;
  byType: Array<{ type: string; count: number }>;
};

const TYPES = [
  "discount",
  "proposal",
  "invoice",
  "expense",
  "leave",
  "purchase",
  "custom",
];

const STATUS_BADGE: Record<string, string> = {
  pending: "mm-badge mm-badge-warning",
  approved: "mm-badge mm-badge-success",
  rejected: "mm-badge mm-badge-danger",
  cancelled: "mm-badge",
};

export default function ApprovalsPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<"inbox" | "mine" | "all" | "workflows" | "report">("inbox");
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [comment, setComment] = useState<Record<string, string>>({});

  // New request form
  const [showSubmit, setShowSubmit] = useState(false);
  const [form, setForm] = useState({
    type: "custom",
    title: "",
    description: "",
    amount: "",
  });

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (statusFilter) q.set("status", statusFilter);
      if (typeFilter) q.set("type", typeFilter);
      if (tab === "mine") q.set("mine", "1");
      if (tab === "inbox") q.set("status", statusFilter || "pending");

      const [reqRes, wfRes, stRes] = await Promise.all([
        api.get<{
          requests: ApprovalRequest[];
          total: number;
        }>(`/approvals/requests?${q.toString()}`, token),
        api.get<{ workflows: Workflow[] }>("/approvals/workflows", token),
        api.get<Stats>("/approvals/stats", token),
      ]);
      if (reqRes.success && reqRes.data) setRequests(reqRes.data.requests || []);
      if (wfRes.success && wfRes.data) setWorkflows(wfRes.data.workflows || []);
      if (stRes.success && stRes.data) setStats(stRes.data);
    } catch {
      toast.error("Failed to load approvals");
    }
    setLoading(false);
  }, [token, tab, statusFilter, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: "approve" | "reject" | "cancel") => {
    if (!token) return;
    setBusyId(id);
    const res = await api.post(
      `/approvals/requests/${id}/act`,
      { action, comment: comment[id] || undefined },
      token
    );
    setBusyId(null);
    if (res.success) {
      toast.success(`Request ${action}d`);
      void load();
    } else toast.error(res.error || "Action failed");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    const res = await api.post(
      "/approvals/requests",
      {
        type: form.type,
        title: form.title.trim(),
        description: form.description || undefined,
        amount: form.amount ? parseAmount(form.amount) ?? undefined : undefined,
      },
      token
    );
    if (res.success) {
      toast.success("Submitted for approval");
      setShowSubmit(false);
      setForm({ type: "custom", title: "", description: "", amount: "" });
      void load();
    } else toast.error(res.error || "Submit failed");
  };

  const exportCsv = () => {
    const rows = [
      ["ID", "Type", "Title", "Status", "Amount", "Currency", "Level", "Requester", "Created"].join(","),
      ...requests.map((r) =>
        [
          r.id,
          r.type,
          `"${(r.title || "").replace(/"/g, '""')}"`,
          r.status,
          r.amount ?? "",
          r.currency || "",
          `${r.currentLevel}/${r.maxLevel}`,
          r.requestedBy?.email || "",
          r.createdAt,
        ].join(",")
      ),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `approvals-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  const exportPrint = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <html><head><title>Approvals Report</title>
      <style>body{font-family:system-ui;padding:24px} table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #ccc;padding:8px;text-align:left;font-size:12px}</style></head><body>
      <h1>Approvals Report</h1>
      <p>Generated ${new Date().toLocaleString()}</p>
      <table><thead><tr>
        <th>Type</th><th>Title</th><th>Status</th><th>Amount</th><th>Requester</th><th>Created</th>
      </tr></thead><tbody>
      ${requests
        .map(
          (r) =>
            `<tr><td>${r.type}</td><td>${r.title}</td><td>${r.status}</td><td>${r.amount ?? ""}</td><td>${r.requestedBy?.email || ""}</td><td>${new Date(r.createdAt).toLocaleString()}</td></tr>`
        )
        .join("")}
      </tbody></table></body></html>
    `);
    w.document.close();
    w.print();
  };

  const kpis = useMemo(() => stats, [stats]);

  return (
    <PageShell wide>
      <PageHeader
        title="Approvals"
        description="Multi-level approval workflows — pending, approved, rejected, cancelled."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowSubmit(true)}
              className="mm-btn mm-btn-primary focus-ring"
            >
              New request
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="mm-btn mm-btn-secondary"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={exportPrint}
              className="mm-btn mm-btn-secondary"
            >
              Export PDF
            </button>
          </div>
        }
      />

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          {[
            { label: "Pending", value: kpis.pending },
            { label: "Approved", value: kpis.approved },
            { label: "Rejected", value: kpis.rejected },
            { label: "Cancelled", value: kpis.cancelled },
            { label: "Total", value: kpis.total },
          ].map((k) => (
            <div key={k.label} className="mm-kpi-card">
              <div className="mm-kpi-label">{k.label}</div>
              <div className="mm-kpi-value">{k.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mm-tabs mb-4 overflow-x-auto" role="tablist">
        {(
          [
            ["inbox", "Inbox"],
            ["mine", "My requests"],
            ["all", "All"],
            ["workflows", "Workflows"],
            ["report", "Report"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            data-active={tab === key ? "true" : undefined}
            onClick={() => setTab(key)}
            className="mm-tab shrink-0"
          >
            {label}
          </button>
        ))}
      </div>

      {(tab === "inbox" || tab === "mine" || tab === "all") && (
        <div className="mm-filter-bar mb-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="mm-input w-auto min-w-[9rem]"
          >
            <option value="">All statuses</option>
            {["pending", "approved", "rejected", "cancelled"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="mm-input w-auto min-w-[9rem]"
          >
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="h-40 mm-card animate-pulse" />
      ) : tab === "workflows" ? (
        <div className="space-y-2">
          <p className="mm-secondary">
            Default multi-level workflows are provisioned per business. Configure thresholds
            via API <code className="text-muted-foreground">PUT /api/approvals/workflows</code>.
          </p>
          {workflows.map((w) => (
            <div key={w.id} className="mm-card p-3.5 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[13px] font-medium text-foreground">{w.name}</div>
                  <div className="mm-secondary mt-0.5">
                    {w.type} · {w.enabled ? "enabled" : "disabled"} ·{" "}
                    {w._count?.requests ?? 0} requests
                  </div>
                  {w.description && (
                    <p className="mm-secondary mt-2">{w.description}</p>
                  )}
                </div>
                <span className="mm-badge">
                  {w.steps?.length || 0} levels
                </span>
              </div>
              <ol className="mt-3 space-y-1 mm-secondary">
                {(w.steps || []).map((s) => (
                  <li key={s.id}>
                    Level {s.level}: {s.name || s.approverRole || "Approver"}
                    {s.approverRole ? ` (${s.approverRole})` : ""}
                  </li>
                ))}
              </ol>
              {w.rules && (w.rules.minAmount != null || w.rules.autoApproveBelow != null) && (
                <p className="mm-secondary mt-2">
                  Rules: min {w.rules.minAmount ?? "—"} · auto-approve below{" "}
                  {w.rules.autoApproveBelow ?? "—"}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : tab === "report" ? (
        <div className="mm-table-wrap">
          <table className="mm-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.byType || []).map((t) => (
                <tr key={t.type}>
                  <td className="capitalize">{t.type}</td>
                  <td className="tabular-nums">{t.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mm-secondary p-3 border-t border-border">
            Use Export CSV / PDF for full request history with filters applied on the All
            tab.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.length === 0 && (
            <div className="mm-secondary py-12 text-center border border-dashed border-border rounded-lg">
              No approval requests yet. Create an expense/invoice above threshold or submit a
              custom request.
            </div>
          )}
          {requests.map((r) => (
            <div
              key={r.id}
              className="mm-card p-3.5 sm:p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-foreground">{r.title}</span>
                    <span className={STATUS_BADGE[r.status] || STATUS_BADGE.pending}>
                      {r.status}
                    </span>
                    <span className="mm-badge capitalize">
                      {r.type}
                    </span>
                  </div>
                  {r.description && (
                    <p className="mm-secondary mt-1">{r.description}</p>
                  )}
                  <div className="mm-secondary mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      By {r.requestedBy?.name || r.requestedBy?.email || "—"}
                    </span>
                    <span>
                      Level {r.currentLevel}/{r.maxLevel}
                    </span>
                    {r.amount != null && (
                      <span>
                        {formatCurrency(r.amount, r.currency)}
                      </span>
                    )}
                    <span>{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {r.actions && r.actions.length > 0 && (
                <div className="mm-secondary border-t border-border pt-2 space-y-0.5">
                  {r.actions.map((a) => (
                    <div key={a.id}>
                      L{a.level} · {a.action} · {a.actor?.name || a.actor?.email}
                      {a.comment ? ` — ${a.comment}` : ""}
                      <span>
                        {" "}
                        · {new Date(a.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {r.status === "pending" && (
                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <input
                    value={comment[r.id] || ""}
                    onChange={(e) =>
                      setComment((c) => ({ ...c, [r.id]: e.target.value }))
                    }
                    placeholder="Comment (optional)"
                    className="mm-input flex-1"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void act(r.id, "approve")}
                      className="mm-btn h-9 px-3 text-xs font-semibold border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-950/60 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void act(r.id, "reject")}
                      className="mm-btn mm-btn-danger h-9 px-3 text-xs font-semibold disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void act(r.id, "cancel")}
                      className="mm-btn mm-btn-secondary h-9 px-3 text-xs disabled:opacity-50"
                      title="Requester or admin can cancel (enforced by API)"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showSubmit && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 dark:bg-black/60"
            aria-label="Close"
            onClick={() => setShowSubmit(false)}
          />
          <form
            onSubmit={submit}
            className="relative z-10 w-full sm:max-w-md bg-card border border-border rounded-t-xl sm:rounded-lg p-4 sm:p-5 space-y-3 adaptive-form shadow-lg safe-bottom"
          >
            <h3 className="font-semibold text-base tracking-tight">New approval request</h3>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="mm-input"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Title *"
              className="mm-input"
            />
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Description"
              className="mm-input"
            />
            <CurrencyAmountInput
              value={form.amount}
              onValueChange={(raw) => setForm({ ...form, amount: raw })}
              placeholder="Amount (optional)"
              className="mm-input"
            />
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowSubmit(false)}
                className="mm-btn mm-btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="mm-btn mm-btn-primary flex-1 focus-ring"
              >
                Submit
              </button>
            </div>
          </form>
        </div>
      )}
    </PageShell>
  );
}
