"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PageShell, PageHeader } from "@/components/ui/PageShell";
import { formatCurrency } from "@/lib/currency";

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

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-300 border-red-500/30",
  cancelled: "bg-muted/40 text-muted-foreground border-border",
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
        amount: form.amount ? Number(form.amount) : undefined,
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
              className="min-h-11 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
            >
              New request
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="min-h-11 px-4 rounded-xl bg-white/10 text-sm border border-border"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={exportPrint}
              className="min-h-11 px-4 rounded-xl bg-white/10 text-sm border border-border"
            >
              Export PDF
            </button>
          </div>
        }
      />

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {[
            { label: "Pending", value: kpis.pending, tone: "text-amber-300" },
            { label: "Approved", value: kpis.approved, tone: "text-emerald-300" },
            { label: "Rejected", value: kpis.rejected, tone: "text-red-300" },
            { label: "Cancelled", value: kpis.cancelled, tone: "text-muted-foreground" },
            { label: "Total", value: kpis.total, tone: "text-foreground" },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-2xl border border-border bg-card p-4"
            >
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {k.label}
              </div>
              <div className={`text-2xl font-semibold tabular-nums mt-1 ${k.tone}`}>
                {k.value}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
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
            onClick={() => setTab(key)}
            className={`min-h-10 px-3 rounded-xl text-sm border ${
              tab === key
                ? "bg-primary text-primary-foreground border-white"
                : "bg-card text-muted-foreground border-border"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {(tab === "inbox" || tab === "mine" || tab === "all") && (
        <div className="flex flex-wrap gap-2 mb-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-background border border-border rounded-xl px-3 py-2 text-sm min-h-10"
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
            className="bg-background border border-border rounded-xl px-3 py-2 text-sm min-h-10"
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
        <div className="h-40 rounded-2xl bg-card animate-pulse" />
      ) : tab === "workflows" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Default multi-level workflows are provisioned per business. Configure thresholds
            via API <code className="text-muted-foreground">PUT /api/approvals/workflows</code>.
          </p>
          {workflows.map((w) => (
            <div
              key={w.id}
              className="rounded-2xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-foreground">{w.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {w.type} · {w.enabled ? "enabled" : "disabled"} ·{" "}
                    {w._count?.requests ?? 0} requests
                  </div>
                  {w.description && (
                    <p className="text-sm text-muted-foreground mt-2">{w.description}</p>
                  )}
                </div>
                <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded-full border border-border text-muted-foreground">
                  {w.steps?.length || 0} levels
                </span>
              </div>
              <ol className="mt-3 space-y-1 text-xs text-muted-foreground">
                {(w.steps || []).map((s) => (
                  <li key={s.id}>
                    Level {s.level}: {s.name || s.approverRole || "Approver"}
                    {s.approverRole ? ` (${s.approverRole})` : ""}
                  </li>
                ))}
              </ol>
              {w.rules && (w.rules.minAmount != null || w.rules.autoApproveBelow != null) && (
                <p className="text-xs text-muted-foreground mt-2">
                  Rules: min {w.rules.minAmount ?? "—"} · auto-approve below{" "}
                  {w.rules.autoApproveBelow ?? "—"}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : tab === "report" ? (
        <div className="rounded-2xl border border-border bg-card p-4 overflow-x-auto">
          <table className="mm-table">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Count</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.byType || []).map((t) => (
                <tr key={t.type} className="border-b border-border/60">
                  <td className="py-2 pr-3 text-foreground capitalize">{t.type}</td>
                  <td className="py-2 pr-3 tabular-nums">{t.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground mt-4">
            Use Export CSV / PDF for full request history with filters applied on the All
            tab.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.length === 0 && (
            <div className="text-sm text-muted-foreground py-12 text-center border border-dashed border-border rounded-2xl">
              No approval requests yet. Create an expense/invoice above threshold or submit a
              custom request.
            </div>
          )}
          {requests.map((r) => (
            <div
              key={r.id}
              className="rounded-2xl border border-border bg-card p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{r.title}</span>
                    <span
                      className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                        STATUS_STYLE[r.status] || STATUS_STYLE.pending
                      }`}
                    >
                      {r.status}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground capitalize">
                      {r.type}
                    </span>
                  </div>
                  {r.description && (
                    <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                  )}
                  <div className="text-[11px] text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1">
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
                <div className="text-[11px] text-muted-foreground border-t border-border pt-2 space-y-0.5">
                  {r.actions.map((a) => (
                    <div key={a.id}>
                      L{a.level} · {a.action} · {a.actor?.name || a.actor?.email}
                      {a.comment ? ` — ${a.comment}` : ""}
                      <span className="text-muted-foreground">
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
                    className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-sm min-h-10"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void act(r.id, "approve")}
                      className="min-h-10 px-3 rounded-xl text-xs font-semibold bg-emerald-500 text-white disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void act(r.id, "reject")}
                      className="min-h-10 px-3 rounded-xl text-xs font-semibold bg-red-500/90 text-white disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void act(r.id, "cancel")}
                      className="min-h-10 px-3 rounded-xl text-xs font-medium bg-white/10 border border-border disabled:opacity-50"
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
            className="absolute inset-0 bg-black/70"
            aria-label="Close"
            onClick={() => setShowSubmit(false)}
          />
          <form
            onSubmit={submit}
            className="relative z-10 w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-3"
          >
            <h3 className="font-semibold text-lg">New approval request</h3>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm min-h-11"
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
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm min-h-11"
            />
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Description"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm h-20"
            />
            <input
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="Amount (optional)"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm min-h-11"
            />
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowSubmit(false)}
                className="flex-1 min-h-11 rounded-xl bg-white/10"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 min-h-11 rounded-xl bg-primary text-primary-foreground font-medium"
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
