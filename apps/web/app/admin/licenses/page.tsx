"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PORTAL_TOKENS } from "@/lib/portal-config";
import { AdminDataTable, type AdminColumn } from "@/components/admin/AdminDataTable";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { KpiCard } from "@/components/admin/KpiCard";

type Row = {
  id: string;
  name: string;
  plan: string;
  licenseKey: string;
  licenseStatus: string;
  status: string;
  trialEndsAt: string;
  subscriptionEndsAt: string;
};

export default function AdminLicensesPage() {
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const t = localStorage.getItem(PORTAL_TOKENS.admin);
    if (!t) return;
    api.platformListLicenses(t, filter || undefined).then((res) => {
      if (res.success && res.data) {
        setRows(
          (res.data as Array<Record<string, unknown>>).map((r) => ({
            id: String(r.id),
            name: String(r.name || ""),
            plan: String(r.plan || ""),
            licenseKey: String(r.licenseKey || "—"),
            licenseStatus: String(r.licenseStatus || ""),
            status: String(r.status || ""),
            trialEndsAt: r.trialEndsAt ? new Date(String(r.trialEndsAt)).toLocaleDateString() : "—",
            subscriptionEndsAt: r.subscriptionEndsAt
              ? new Date(String(r.subscriptionEndsAt)).toLocaleDateString()
              : "—",
          }))
        );
      }
    });
  }, [filter]);

  const columns: AdminColumn<Row>[] = [
    {
      key: "name",
      label: "Business",
      render: (r) => (
        <Link href={`/admin/businesses/${r.id}`} className="font-medium hover:text-violet-300">
          {r.name}
        </Link>
      ),
    },
    { key: "licenseKey", label: "License Key", render: (r) => <span className="font-mono text-xs">{r.licenseKey}</span> },
    { key: "plan", label: "Plan", render: (r) => <span className="capitalize">{r.plan}</span> },
    { key: "licenseStatus", label: "License", render: (r) => <StatusBadge value={r.licenseStatus} /> },
    { key: "status", label: "Business", render: (r) => <StatusBadge value={r.status} /> },
    { key: "trialEndsAt", label: "Trial Ends" },
    { key: "subscriptionEndsAt", label: "Subscription Ends" },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">License Management</h1>
        <p className="text-sm text-zinc-400 mt-1">Active, trial, and expired licenses across customers.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total" value={rows.length} />
        <KpiCard label="Active" value={rows.filter((r) => r.licenseStatus === "active").length} tone="success" />
        <KpiCard label="Trial" value={rows.filter((r) => r.licenseStatus === "trial").length} tone="info" />
        <KpiCard label="Expired" value={rows.filter((r) => r.licenseStatus === "expired").length} tone="danger" />
      </div>
      <div className="flex gap-2">
        {["", "active", "trial", "expired"].map((f) => (
          <button
            key={f || "all"}
            type="button"
            onClick={() => setFilter(f)}
            className={`min-h-10 px-3 rounded-xl text-sm capitalize ${
              filter === f ? "bg-violet-500 text-zinc-950" : "bg-white/10"
            }`}
          >
            {f || "all"}
          </button>
        ))}
      </div>
      <AdminDataTable
        rows={rows}
        columns={columns}
        searchKeys={["name", "licenseKey", "plan", "licenseStatus"]}
        exportName="licenses"
      />
    </div>
  );
}