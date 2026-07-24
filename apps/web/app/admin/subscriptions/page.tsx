"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PORTAL_TOKENS } from "@/lib/portal-config";
import { AdminDataTable, type AdminColumn } from "@/components/admin/AdminDataTable";
import { StatusBadge } from "@/components/admin/StatusBadge";

type Row = {
  id: string;
  name: string;
  plan: string;
  planStatus: string;
  licenseStatus: string;
  ownerEmail: string;
};

export default function AdminSubscriptionsPage() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const t = localStorage.getItem(PORTAL_TOKENS.admin);
    if (!t) return;
    api.platformListBusinesses(t, { pageSize: 500 }).then((res) => {
      if (res.success && res.data) {
        setRows(
          (res.data.businesses as Array<Record<string, unknown>>).map((b) => ({
            id: String(b.id),
            name: String(b.name || ""),
            plan: String(b.plan || ""),
            planStatus: String(b.planStatus || ""),
            licenseStatus: String(b.licenseStatus || ""),
            ownerEmail: String((b.owner as { email?: string })?.email || "—"),
          }))
        );
      }
    });
  }, []);

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
    { key: "ownerEmail", label: "Owner" },
    { key: "plan", label: "Plan", render: (r) => <span className="capitalize">{r.plan}</span> },
    { key: "planStatus", label: "Plan Status", render: (r) => <StatusBadge value={r.planStatus} /> },
    { key: "licenseStatus", label: "License", render: (r) => <StatusBadge value={r.licenseStatus} /> },
    {
      key: "actions",
      label: "Actions",
      sortable: false,
      filterable: false,
      render: (r) => (
        <Link href={`/admin/businesses/${r.id}`} className="text-xs text-violet-300">
          Manage plan →
        </Link>
      ),
    },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Subscription Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Trial · Basic · Professional · Enterprise — manage renewals from the business page.
        </p>
      </div>
      <AdminDataTable
        rows={rows}
        columns={columns}
        searchKeys={["name", "ownerEmail", "plan", "planStatus"]}
        exportName="subscriptions"
        emptyMessage="No customer subscriptions yet."
      />
    </div>
  );
}
