"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PORTAL_TOKENS } from "@/lib/portal-config";
import { KpiCard } from "@/components/admin/KpiCard";
import { BarChart } from "@/components/admin/SimpleChart";
import { AdminDataTable, type AdminColumn } from "@/components/admin/AdminDataTable";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { DeveloperRaw } from "@/components/admin/DeveloperRaw";

type BizRow = {
  id: string;
  name: string;
  status: string;
  plan: string;
  ownerEmail: string;
  users: number;
  leads: number;
  deals: number;
  aiUsage: number;
  whatsapp: number;
  lastActive: string;
};

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<{
    kpis: Record<string, number | string | null>;
    charts: {
      dailyUsage: Array<{ date: string; count: number }>;
      monthlyUsage: Array<{ month: string; count: number }>;
      loginTrend: Array<{ date: string; count: number }>;
      aiRequests: Array<{ date: string; count: number }>;
    };
    businesses: BizRow[];
  } | null>(null);

  useEffect(() => {
    const t = localStorage.getItem(PORTAL_TOKENS.admin);
    if (!t) return;
    api.platformUsageDashboard(t).then((res) => {
      if (res.success && res.data) {
        setData({
          kpis: res.data.kpis,
          charts: res.data.charts,
          businesses: (res.data.businesses as Array<Record<string, unknown>>).map((b) => ({
            id: String(b.id),
            name: String(b.name || ""),
            status: String(b.status || ""),
            plan: String(b.plan || ""),
            ownerEmail: String(b.ownerEmail || "—"),
            users: Number(b.users || 0),
            leads: Number(b.leads || 0),
            deals: Number(b.deals || 0),
            aiUsage: Number(b.aiUsage || 0),
            whatsapp: Number(b.whatsapp || 0),
            lastActive: b.lastActive ? new Date(String(b.lastActive)).toLocaleString() : "—",
          })),
        });
      }
    });
  }, []);

  if (!data) {
    return <div className="h-64 bg-zinc-900 rounded-2xl animate-pulse max-w-7xl" />;
  }

  const k = data.kpis;
  const money = (n: unknown) => {
    try {
      // Super Admin platform view — INR default for platform billing metrics
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(Number(n || 0));
    } catch {
      return `₹${Number(n || 0).toLocaleString()}`;
    }
  };

  const columns: AdminColumn<BizRow>[] = [
    {
      key: "name",
      label: "Business",
      render: (r) => (
        <Link href={`/admin/businesses/${r.id}`} className="hover:text-violet-300 font-medium">
          {r.name}
        </Link>
      ),
    },
    { key: "ownerEmail", label: "Owner" },
    { key: "plan", label: "Plan", render: (r) => <span className="capitalize">{r.plan}</span> },
    { key: "status", label: "Status", render: (r) => <StatusBadge value={r.status} /> },
    { key: "users", label: "Users" },
    { key: "leads", label: "Leads" },
    { key: "deals", label: "Deals" },
    { key: "aiUsage", label: "AI" },
    { key: "whatsapp", label: "WhatsApp" },
    { key: "lastActive", label: "Last Active" },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Usage Analytics</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Platform-wide KPIs and trends — presented as cards and charts, not raw JSON.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard label="Total Users" value={Number(k.totalUsers || 0)} />
        <KpiCard label="Total Leads" value={Number(k.totalLeads || 0)} />
        <KpiCard label="Total Deals" value={Number(k.totalDeals || 0)} />
        <KpiCard label="AI Usage" value={Number(k.aiUsage || 0)} tone="info" />
        <KpiCard label="WhatsApp Messages" value={Number(k.whatsappMessages || 0)} />
        <KpiCard label="Email Count" value={Number(k.emailCount || 0)} />
        <KpiCard label="Storage Used" value={`${Number(k.storageUsedMb || 0)} MB`} />
        <KpiCard
          label="Last Active"
          value={k.lastActive ? new Date(String(k.lastActive)).toLocaleDateString() : "—"}
        />
        <KpiCard label="Revenue" value={money(k.revenue)} tone="success" />
        <KpiCard label="Active Users (7d)" value={Number(k.activeUsers || 0)} tone="info" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <BarChart
          title="Daily Usage (logins)"
          color="bg-violet-500"
          points={data.charts.dailyUsage.map((d) => ({ label: d.date, value: d.count }))}
        />
        <BarChart
          title="Login Trend"
          color="bg-sky-500"
          points={data.charts.loginTrend.map((d) => ({ label: d.date, value: d.count }))}
        />
        <BarChart
          title="Monthly Usage (new businesses)"
          color="bg-emerald-500"
          points={data.charts.monthlyUsage.map((d) => ({ label: d.month, value: d.count }))}
        />
        <BarChart
          title="AI Requests (proxy trend)"
          color="bg-amber-500"
          points={data.charts.aiRequests.map((d) => ({ label: d.date, value: d.count }))}
        />
      </div>

      <section>
        <h2 className="font-semibold mb-3">Per-business usage</h2>
        <AdminDataTable
          rows={data.businesses}
          columns={columns}
          searchKeys={["name", "ownerEmail", "plan", "status"]}
          exportName="usage-by-business"
        />
      </section>

      <DeveloperRaw data={data} />
    </div>
  );
}
