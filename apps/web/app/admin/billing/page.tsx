"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PORTAL_TOKENS } from "@/lib/portal-config";
import { toast } from "sonner";
import { AdminDataTable, type AdminColumn } from "@/components/admin/AdminDataTable";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { KpiCard } from "@/components/admin/KpiCard";

type Inv = {
  id: string;
  number: string;
  business: string;
  kind: string;
  amount: number;
  status: string;
  plan: string;
  createdAt: string;
};

export default function AdminBillingPage() {
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [businesses, setBusinesses] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({ businessId: "", kind: "subscription", amount: "", notes: "" });

  const token = () => localStorage.getItem(PORTAL_TOKENS.admin) || "";

  const load = async () => {
    const t = token();
    const [inv, biz] = await Promise.all([
      api.platformListInvoices(t),
      api.platformListBusinesses(t, { pageSize: 500 }),
    ]);
    if (inv.success && inv.data) {
      setInvoices(
        (inv.data as Array<Record<string, unknown>>).map((x) => ({
          id: String(x.id),
          number: String(x.number || ""),
          business: String((x.business as { name?: string })?.name || "—"),
          kind: String(x.kind || ""),
          amount: Number(x.amount || 0),
          status: String(x.status || ""),
          plan: String(x.plan || "—"),
          createdAt: x.createdAt ? new Date(String(x.createdAt)).toLocaleString() : "—",
        }))
      );
    }
    if (biz.success && biz.data) {
      setBusinesses(
        (biz.data.businesses as Array<Record<string, unknown>>).map((b) => ({
          id: String(b.id),
          name: String(b.name || ""),
        }))
      );
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await api.platformCreateInvoice(
      {
        businessId: form.businessId,
        kind: form.kind,
        amount: parseFloat(form.amount),
        notes: form.notes || undefined,
      },
      token()
    );
    if (res.success) {
      toast.success("Invoice created");
      setForm({ businessId: "", kind: "subscription", amount: "", notes: "" });
      load();
    } else toast.error(res.error || "Failed");
  };

  const markPaid = async (id: string) => {
    const res = await api.platformMarkInvoicePaid(id, token());
    if (res.success) {
      toast.success("Marked paid");
      load();
    } else toast.error(res.error || "Failed");
  };

  const columns: AdminColumn<Inv>[] = [
    { key: "number", label: "Invoice #", render: (r) => <span className="font-mono text-xs">{r.number}</span> },
    { key: "business", label: "Business" },
    { key: "kind", label: "Kind", render: (r) => <span className="capitalize">{r.kind}</span> },
    {
      key: "amount",
      label: "Amount",
      render: (r) => <span className="tabular-nums">₹{r.amount.toLocaleString()}</span>,
      exportValue: (r) => r.amount,
    },
    { key: "status", label: "Status", render: (r) => <StatusBadge value={r.status} /> },
    { key: "plan", label: "Plan" },
    { key: "createdAt", label: "Created" },
    {
      key: "actions",
      label: "Actions",
      sortable: false,
      filterable: false,
      render: (r) =>
        r.status !== "paid" ? (
          <button
            type="button"
            onClick={() => markPaid(r.id)}
            className="text-xs px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-300"
          >
            Mark paid
          </button>
        ) : (
          <span className="text-xs text-zinc-500">—</span>
        ),
    },
  ];

  const unpaid = invoices.filter((i) => i.status === "open" || i.status === "overdue");
  const paidTotal = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount, 0);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-zinc-400 mt-1">Setup charges, subscription payments, invoice history.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Invoices" value={invoices.length} />
        <KpiCard label="Unpaid" value={unpaid.length} tone="warning" />
        <KpiCard label="Paid revenue" value={`₹${paidTotal.toLocaleString()}`} tone="success" />
        <KpiCard
          label="Open amount"
          value={`₹${unpaid.reduce((s, i) => s + i.amount, 0).toLocaleString()}`}
          tone="danger"
        />
      </div>

      <form onSubmit={create} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 grid sm:grid-cols-2 gap-3">
        <h2 className="sm:col-span-2 font-semibold">Create invoice</h2>
        <select
          required
          value={form.businessId}
          onChange={(e) => setForm({ ...form, businessId: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm min-h-11 text-white"
        >
          <option value="">Select business</option>
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm min-h-11 text-white"
        >
          <option value="setup">Setup charge</option>
          <option value="subscription">Subscription</option>
          <option value="renewal">Renewal</option>
          <option value="adjustment">Adjustment</option>
        </select>
        <input
          type="number"
          step="0.01"
          required
          placeholder="Amount"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm min-h-11 text-white"
        />
        <input
          placeholder="Notes"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm min-h-11 text-white"
        />
        <button type="submit" className="sm:col-span-2 min-h-11 bg-white text-zinc-950 rounded-xl font-medium">
          Create invoice
        </button>
      </form>

      <AdminDataTable
        rows={invoices}
        columns={columns}
        searchKeys={["number", "business", "kind", "status"]}
        exportName="platform-invoices"
        emptyMessage="No platform invoices yet."
      />
    </div>
  );
}