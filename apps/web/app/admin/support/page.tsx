"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { PORTAL_TOKENS } from "@/lib/portal-config";
import { toast } from "sonner";
import { AdminDataTable, type AdminColumn } from "@/components/admin/AdminDataTable";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { KpiCard } from "@/components/admin/KpiCard";
import { DeveloperRaw } from "@/components/admin/DeveloperRaw";

type Ticket = {
  id: string;
  subject: string;
  business: string;
  priority: string;
  status: string;
  createdAt: string;
  assignedTo: string;
};

type AuditRow = {
  id: string;
  date: string;
  admin: string;
  action: string;
  business: string;
  ip: string;
  device: string;
};

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [raw, setRaw] = useState<unknown>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [form, setForm] = useState({ subject: "", body: "", businessId: "", priority: "normal" });

  const token = () => localStorage.getItem(PORTAL_TOKENS.admin) || "";

  const load = async () => {
    const t = token();
    const [tk, au] = await Promise.all([
      api.platformListTickets(t, statusFilter || undefined),
      api.platformAudit(t),
    ]);
    if (tk.success && tk.data) {
      setTickets(
        (tk.data as Array<Record<string, unknown>>).map((x) => ({
          id: String(x.id),
          subject: String(x.subject || ""),
          business: String((x.business as { name?: string })?.name || "—"),
          priority: String(x.priority || "normal"),
          status: String(x.status || "open"),
          createdAt: x.createdAt ? new Date(String(x.createdAt)).toLocaleString() : "—",
          assignedTo: String(x.assignedToUserId || "Unassigned"),
        }))
      );
    }
    if (au.success && au.data) {
      const list = au.data as Array<Record<string, unknown>>;
      setAudit(
        list.map((r) => ({
          id: String(r.id),
          date: r.date || r.createdAt ? new Date(String(r.date || r.createdAt)).toLocaleString() : "—",
          admin: String(r.admin || r.actorUserId || "system"),
          action: String(r.action || ""),
          business: String(r.businessName || r.businessId || "—"),
          ip: String(r.ip || "—"),
          device: String(r.device || r.userAgent || "—").slice(0, 48),
        }))
      );
      setRaw({ tickets: tk.data, audit: au.data });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (dateFrom) {
        const d = new Date(t.createdAt).getTime();
        if (!Number.isNaN(d) && d < new Date(dateFrom).getTime()) return false;
      }
      return true;
    });
  }, [tickets, priorityFilter, dateFrom]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await api.platformCreateTicket(
      {
        subject: form.subject,
        body: form.body,
        businessId: form.businessId || undefined,
        priority: form.priority,
      },
      token()
    );
    if (res.success) {
      toast.success("Ticket created");
      setForm({ subject: "", body: "", businessId: "", priority: "normal" });
      load();
    } else toast.error(res.error || "Failed");
  };

  const setTicketStatus = async (id: string, status: string) => {
    const res = await api.platformUpdateTicket(id, status, token());
    if (res.success) {
      toast.success(`Ticket → ${status}`);
      load();
    } else toast.error(res.error || "Failed");
  };

  const ticketCols: AdminColumn<Ticket>[] = [
    { key: "id", label: "Ticket ID", render: (r) => <span className="font-mono text-xs">{r.id.slice(0, 10)}…</span> },
    { key: "subject", label: "Subject" },
    { key: "business", label: "Business" },
    { key: "priority", label: "Priority", render: (r) => <StatusBadge value={r.priority} /> },
    { key: "status", label: "Status", render: (r) => <StatusBadge value={r.status} /> },
    { key: "createdAt", label: "Created Date" },
    { key: "assignedTo", label: "Assigned To" },
    {
      key: "actions",
      label: "Actions",
      sortable: false,
      filterable: false,
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          <button type="button" onClick={() => setTicketStatus(r.id, "in_progress")} className="text-[10px] px-2 py-1 rounded bg-white/10">
            In progress
          </button>
          <button type="button" onClick={() => setTicketStatus(r.id, "resolved")} className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-300">
            Resolve
          </button>
          <button type="button" onClick={() => setTicketStatus(r.id, "closed")} className="text-[10px] px-2 py-1 rounded bg-white/5">
            Close
          </button>
        </div>
      ),
    },
  ];

  const auditCols: AdminColumn<AuditRow>[] = [
    { key: "date", label: "Date" },
    { key: "admin", label: "Admin" },
    { key: "action", label: "Action" },
    { key: "business", label: "Business" },
    { key: "ip", label: "IP" },
    { key: "device", label: "Device" },
  ];

  const openCount = tickets.filter((t) => t.status === "open" || t.status === "in_progress").length;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Support Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tickets and platform audit in professional tables. Support login is on each business Manage page.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total Tickets" value={tickets.length} />
        <KpiCard label="Open / Active" value={openCount} tone="warning" />
        <KpiCard label="Audit Events" value={audit.length} tone="info" />
        <KpiCard label="Resolved" value={tickets.filter((t) => t.status === "resolved").length} tone="success" />
      </div>

      <form onSubmit={create} className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <h2 className="font-semibold">New ticket</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          <input
            required
            placeholder="Subject"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground min-h-11"
          />
          <select
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground min-h-11"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
          <input
            placeholder="Business ID (optional)"
            value={form.businessId}
            onChange={(e) => setForm({ ...form, businessId: e.target.value })}
            className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground min-h-11 sm:col-span-2"
          />
          <textarea
            required
            placeholder="Details"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            className="sm:col-span-2 bg-background border border-border rounded-xl p-3 text-sm text-foreground min-h-[90px]"
          />
        </div>
        <button type="submit" className="min-h-11 px-4 bg-primary text-primary-foreground rounded-xl text-sm font-medium">
          Create ticket
        </button>
      </form>

      <section className="space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <h2 className="font-semibold mr-auto">Tickets</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground"
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground"
          >
            <option value="">All priorities</option>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground"
          />
        </div>
        <AdminDataTable
          rows={filteredTickets}
          columns={ticketCols}
          searchKeys={["id", "subject", "business", "status", "priority"]}
          exportName="support-tickets"
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Platform Audit</h2>
        <AdminDataTable
          rows={audit}
          columns={auditCols}
          searchKeys={["admin", "action", "business", "ip"]}
          exportName="platform-audit"
        />
      </section>

      <DeveloperRaw data={raw} />
    </div>
  );
}
