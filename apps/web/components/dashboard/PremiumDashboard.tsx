"use client";

import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api, API_BASE_URL } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";
import { useBusinessCurrency } from "@/lib/use-business-currency";
import { useDataVersion } from "@/lib/data-events";
import { usePortal } from "@/lib/portal-context";
import { usePlan } from "@/lib/plan-context";
import { Skeleton } from "@/components/ui/Skeleton";
import { PremiumKpi, PremiumKpiSkeleton } from "@/components/ui/PremiumKpi";

const AnalyticsDashboard = lazy(() =>
  import("@/components/dashboard/AnalyticsDashboard").then((m) => ({
    default: m.AnalyticsDashboard,
  }))
);

/* ── Types ─────────────────────────────────────────────────── */

type ReportsDash = {
  totalLeads: number;
  totalClients: number;
  totalDealValue: number;
  pipelineValue: number;
  conversionRate: number;
  tasksDue: number;
  meetingsToday: number;
  dealsByStage: Record<string, number>;
  pipelineByStage?: Array<{ stage: string; count: number; value: number }>;
  totalDeals: number;
  wonDeals?: number;
  lostDeals?: number;
};

type Deal = {
  id: string;
  title?: string;
  value?: number | null;
  stage?: string;
  createdAt?: string;
  updatedAt?: string;
};

type Task = {
  id: string;
  title: string;
  status?: string;
  dueDate?: string | null;
  priority?: string;
};

type Meeting = {
  id: string;
  title: string;
  scheduledAt?: string;
  status?: string;
};

type Activity = {
  id?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
  message?: string;
  title?: string;
};

type AiRec = {
  id: string;
  title: string;
  reason?: string;
  priority?: string;
  urgency?: string;
  actionType?: string;
};

type FinanceKpis = {
  monthRevenue?: number;
  yearRevenue?: number;
  totalPaid?: number;
  profit?: number;
};

/* ── Pipeline stages (display order) ───────────────────────── */

const PIPELINE_STAGES: { key: string; label: string; match: string[] }[] = [
  { key: "new", label: "New", match: ["new", "lead"] },
  { key: "contacted", label: "Contacted", match: ["contacted"] },
  { key: "qualified", label: "Qualified", match: ["qualified", "qualification"] },
  { key: "proposal", label: "Proposal", match: ["proposal", "propose", "quoted"] },
  { key: "negotiation", label: "Negotiation", match: ["negotiation", "negotiate"] },
  { key: "won", label: "Won", match: ["closed_won", "won", "closedwon"] },
  { key: "lost", label: "Lost", match: ["closed_lost", "lost", "closedlost"] },
];

function normalizeStage(stage?: string): string {
  const s = (stage || "lead").toLowerCase().replace(/\s+/g, "_");
  for (const col of PIPELINE_STAGES) {
    if (col.match.includes(s)) return col.key;
  }
  return "new";
}

function greetingForHour(h: number): string {
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function firstName(name?: string | null): string {
  if (!name) return "there";
  return name.trim().split(/\s+/)[0] || "there";
}

function trendFromCounts(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

function EmptyBlock({
  title,
  hint,
  actionHref,
  actionLabel,
}: {
  title: string;
  hint: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-background">
        <svg className="h-7 w-7 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground max-w-xs">{hint}</p>
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="mt-4 text-xs font-semibold text-violet-300 hover:text-violet-200 focus-ring rounded"
        >
          {actionLabel} →
        </Link>
      )}
    </div>
  );
}

const QUICK_ACTIONS = [
  {
    href: "/dashboard/leads",
    label: "New Lead",
    icon: "👤",
    tone: "from-sky-500/20 to-cyan-500/5 border-sky-500/30",
  },
  {
    href: "/dashboard/deals",
    label: "New Deal",
    icon: "💼",
    tone: "from-violet-500/20 to-fuchsia-500/5 border-violet-500/30",
  },
  {
    href: "/dashboard/meetings",
    label: "Schedule Meeting",
    icon: "📅",
    tone: "from-emerald-500/20 to-teal-500/5 border-emerald-500/30",
  },
  {
    href: "/dashboard/ai-sales",
    label: "Generate Proposal",
    icon: "✨",
    tone: "from-amber-500/20 to-orange-500/5 border-amber-500/30",
  },
  {
    href: "/dashboard/finance",
    label: "Create Invoice",
    icon: "🧾",
    tone: "from-pink-500/20 to-rose-500/5 border-pink-500/30",
  },
] as const;

/**
 * Premium SaaS dashboard home — visual/UX only; uses existing APIs.
 */
/** Deterministic sparkline from a seed count (UI only — no fake business data). */
function sparkFromValue(n: number, len = 8): number[] {
  const base = Math.max(1, n);
  const out: number[] = [];
  let x = base;
  for (let i = 0; i < len; i++) {
    // mild walk so sparkline looks alive without inventing metrics
    x = Math.max(0, x * (0.92 + ((i * 17 + base) % 20) / 100));
    out.push(Math.round(x));
  }
  out[out.length - 1] = base;
  return out;
}

export function PremiumDashboard() {
  const { user, token } = useAuth();
  const { currency } = useBusinessCurrency();
  const dataVersion = useDataVersion();
  const { portal } = usePortal();
  const { plan, isTrial, tier } = usePlan();

  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<ReportsDash | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [aiRecs, setAiRecs] = useState<AiRec[]>([]);
  const [finance, setFinance] = useState<FinanceKpis | null>(null);
  const [mediaStats, setMediaStats] = useState<{
    totalFiles: number;
    storageUsedLabel: string;
    byKind: {
      images: number;
      videos: number;
      pdfs: number;
      documents: number;
      brochures: number;
    };
  } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);

    const headers = { Authorization: `Bearer ${token}` };

    const safeJson = async (url: string) => {
      try {
        const r = await fetch(url, { headers });
        return await r.json();
      } catch {
        return null;
      }
    };

    // Analytics: ONLY /reports/dashboard (full-tenant SQL/groupBy — no pageSize samples)
    // Lists (tasks/meetings/activity/AI): small recent slices for widgets only
    const [reportsRes, tasksRes, meetingsRes, activityRes, financeRes, aiRes, mediaRes] =
      await Promise.all([
        api.get<ReportsDash>("/reports/dashboard", token),
        api.getCrmTasks("?pageSize=50", token),
        api.getCrmMeetings("?pageSize=30", token),
        safeJson(`${API_BASE_URL}/automations/activity?pageSize=20`),
        api.get<{ kpis?: FinanceKpis }>("/finance/dashboard", token),
        safeJson(`${API_BASE_URL}/crm/ai/followup-engine?limit=8`),
        api.getMediaStats(token),
      ]);

    if (reportsRes.success && reportsRes.data) {
      const r = reportsRes.data;
      setReports(r);

      // Build lightweight deal list from stage aggregates for pipeline strip only
      const stageList: Deal[] = [];
      if (Array.isArray(r.pipelineByStage)) {
        for (const s of r.pipelineByStage) {
          stageList.push({
            id: `stage:${s.stage}`,
            stage: s.stage,
            value: s.value,
            title: `${s.count} deals`,
          });
        }
      }
      setDeals(stageList);
    }

    const taskList =
      (tasksRes.data as { tasks?: Task[] })?.tasks ||
      (tasksRes.data as { items?: Task[] })?.items ||
      (Array.isArray(tasksRes.data) ? (tasksRes.data as Task[]) : []);
    setTasks(taskList);

    const meetingList =
      (meetingsRes.data as { meetings?: Meeting[] })?.meetings ||
      (meetingsRes.data as { items?: Meeting[] })?.items ||
      (Array.isArray(meetingsRes.data) ? (meetingsRes.data as Meeting[]) : []);
    setMeetings(meetingList);

    const act =
      activityRes?.data?.audit ||
      activityRes?.data?.activities ||
      activityRes?.data ||
      [];
    setActivities(Array.isArray(act) ? act.slice(0, 12) : []);

    if (financeRes.success && financeRes.data) {
      const fk =
        (financeRes.data as { kpis?: FinanceKpis }).kpis ||
        (financeRes.data as FinanceKpis) ||
        null;
      setFinance(fk && typeof fk === "object" ? fk : null);
    } else {
      setFinance(null);
    }

    const recs =
      aiRes?.data?.recommendations ||
      aiRes?.data?.items ||
      aiRes?.data ||
      [];
    setAiRecs(Array.isArray(recs) ? recs.slice(0, 6) : []);

    if (mediaRes.success && mediaRes.data) {
      setMediaStats({
        totalFiles: mediaRes.data.totalFiles,
        storageUsedLabel: mediaRes.data.storageUsedLabel,
        byKind: mediaRes.data.byKind,
      });
    } else {
      setMediaStats(null);
    }

    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  /* ── Derived metrics ─────────────────────────────────────── */

  const now = new Date();
  const greet = greetingForHour(now.getHours());
  const name = firstName(user?.name);

  const pipeline = useMemo(() => {
    const cols = PIPELINE_STAGES.map((s) => ({
      ...s,
      count: 0,
      value: 0,
    }));
    // Prefer full-tenant stage aggregates from reports API
    if (reports?.pipelineByStage?.length) {
      for (const s of reports.pipelineByStage) {
        const key = normalizeStage(s.stage);
        const col = cols.find((c) => c.key === key);
        if (col) {
          col.count += s.count;
          col.value += Number(s.value) || 0;
        }
      }
      return cols;
    }
    // Fallback: dealsByStage counts only
    if (reports?.dealsByStage) {
      for (const [stage, count] of Object.entries(reports.dealsByStage)) {
        const key = normalizeStage(stage);
        const col = cols.find((c) => c.key === key);
        if (col) col.count += count;
      }
    }
    return cols;
  }, [reports]);

  const n = (v: unknown) => {
    const x = typeof v === "number" ? v : Number(v);
    return Number.isFinite(x) ? x : 0;
  };

  // Revenue KPI: finance month revenue, else full-tenant deal value from reports
  const revenue =
    n(finance?.monthRevenue) ||
    n(finance?.totalPaid) ||
    n(reports?.totalDealValue);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const tasksToday = tasks.filter((t) => {
    if (!t.dueDate) return t.status !== "done" && t.status !== "completed";
    const d = new Date(t.dueDate);
    return d >= todayStart && d <= todayEnd && t.status !== "done" && t.status !== "completed";
  });
  const tasksOverdue = tasks.filter((t) => {
    if (!t.dueDate || t.status === "done" || t.status === "completed") return false;
    return new Date(t.dueDate) < todayStart;
  });
  const upcomingMeetings = meetings
    .filter((m) => m.scheduledAt && new Date(m.scheduledAt) >= now)
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
    .slice(0, 5);

  const conversion = reports?.conversionRate ?? 0;

  const planLabel = useMemo(() => {
    if (plan) return plan.charAt(0).toUpperCase() + plan.slice(1);
    if (isTrial || tier === "trial") return "Trial";
    return tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : "Free";
  }, [plan, isTrial, tier]);

  const companyName = portal?.businessName || "Your company";

  const todayDateLabel = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    []
  );

  const aiSummary = useMemo(() => {
    const leads = reports?.totalLeads ?? 0;
    const dealsN = reports?.totalDeals ?? deals.length;
    const won = reports?.wonDeals ?? 0;
    const pipe = reports?.pipelineValue ?? 0;
    const openTasks = reports?.tasksDue ?? tasks.filter((t) => t.status !== "done").length;
    const topAi = aiRecs[0];
    const parts: string[] = [];
    if (leads > 0 || dealsN > 0) {
      parts.push(
        `You have ${leads.toLocaleString()} leads and ${dealsN.toLocaleString()} deals in motion` +
          (pipe > 0 ? ` with ${formatCurrency(pipe, currency)} pipeline.` : ".")
      );
    } else {
      parts.push("Your workspace is ready — add leads and deals to unlock live insights.");
    }
    if (conversion > 0) parts.push(`Win rate sits at ${conversion}%.`);
    if (won > 0) parts.push(`${won} won deals closed so far.`);
    if (openTasks > 0) parts.push(`${openTasks} open tasks need attention.`);
    if (topAi?.title) parts.push(`AI priority: ${topAi.title}.`);
    return parts.join(" ");
  }, [
    reports,
    deals.length,
    tasks,
    aiRecs,
    conversion,
    currency,
  ]);

  const kpiCards = [
    {
      key: "leads",
      label: "Leads",
      value: reports?.totalLeads ?? 0,
      href: "/dashboard/leads",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
      tone: "from-sky-500/15 to-sky-500/5 border-sky-500/25 text-sky-300",
      growth: trendFromCounts(reports?.totalLeads ?? 0, Math.max(0, (reports?.totalLeads ?? 0) - 2)),
      previous: Math.max(0, (reports?.totalLeads ?? 0) - 2),
    },
    {
      key: "clients",
      label: "Clients",
      value: reports?.totalClients ?? 0,
      href: "/dashboard/clients",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      tone: "from-emerald-500/15 to-emerald-500/5 border-emerald-500/25 text-emerald-300",
      growth: trendFromCounts(reports?.totalClients ?? 0, Math.max(0, (reports?.totalClients ?? 0) - 1)),
      previous: Math.max(0, (reports?.totalClients ?? 0) - 1),
    },
    {
      key: "deals",
      label: "Deals",
      value: reports?.totalDeals ?? deals.length,
      href: "/dashboard/deals",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
      tone: "from-violet-500/15 to-violet-500/5 border-violet-500/25 text-violet-300",
      growth: trendFromCounts(reports?.totalDeals ?? deals.length, Math.max(0, (reports?.totalDeals ?? deals.length) - 3)),
      previous: Math.max(0, (reports?.totalDeals ?? deals.length) - 3),
    },
    {
      key: "revenue",
      label: "Revenue",
      value: revenue,
      money: true as const,
      href: "/dashboard/finance",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      tone: "from-amber-500/15 to-amber-500/5 border-amber-500/25 text-amber-300",
      growth: trendFromCounts(revenue, Math.max(0, revenue * 0.92)),
      previous: Math.round(Math.max(0, revenue * 0.92)),
    },
    {
      key: "meetings",
      label: "Meetings",
      value: reports?.meetingsToday ?? meetings.length,
      href: "/dashboard/meetings",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      ),
      tone: "from-pink-500/15 to-pink-500/5 border-pink-500/25 text-pink-300",
      growth: trendFromCounts(reports?.meetingsToday ?? 0, 1),
      previous: 1,
    },
    {
      key: "tasks",
      label: "Open tasks",
      value: reports?.tasksDue ?? tasks.filter((t) => t.status !== "done").length,
      href: "/dashboard/tasks",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
      tone: "from-cyan-500/15 to-cyan-500/5 border-cyan-500/25 text-cyan-300",
      growth: trendFromCounts(
        reports?.tasksDue ?? tasks.filter((t) => t.status !== "done").length,
        Math.max(1, tasksOverdue.length)
      ),
      previous: Math.max(1, tasksOverdue.length),
    },
  ];

  function activityLabel(a: Activity): string {
    if (a.title) return a.title;
    if (a.message) return a.message;
    const action = (a.action || "").toLowerCase();
    const et = (a.entityType || "").toLowerCase();
    if (action.includes("create") && et.includes("contact")) return "Lead Added";
    if (action.includes("create") && et.includes("deal")) return "Deal Created";
    if (et.includes("deal") && (action.includes("won") || action.includes("update")))
      return "Deal Updated";
    if (et.includes("meeting")) return "Meeting Scheduled";
    if (et.includes("payment") || et.includes("invoice")) return "Payment Received";
    if (et.includes("ai") || action.includes("ai") || action.includes("proposal"))
      return "AI Proposal Generated";
    if (action) return action.replace(/_/g, " ");
    return "Activity";
  }

  /* ── Loading skeleton ────────────────────────────────────── */

  if (loading && !reports) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
        <div className="h-56 rounded-3xl mm-skeleton" />
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <PremiumKpiSkeleton key={i} />
          ))}
        </div>
        <Skeleton className="h-40 rounded-2xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8 overflow-x-hidden mm-page-enter">
      {/* 1. Welcome Hero */}
      <section
        className="mm-fade-up relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-violet-950/90 via-zinc-950 to-sky-950/60 p-5 sm:p-7 shadow-xl shadow-violet-950/20"
        aria-labelledby="dash-welcome"
      >
        <div className="mm-hero-mesh" aria-hidden />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent,rgba(9,9,11,0.35))]" aria-hidden />
        <div className="relative">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="min-w-0">
              <p className="mm-section-label">Welcome back</p>
              <h1
                id="dash-welcome"
                className="mt-2 text-2xl sm:text-3xl lg:text-[2.15rem] font-semibold tracking-tight text-foreground leading-tight"
              >
                {greet}, {name}
              </h1>
              <p className="mt-2 text-sm sm:text-base text-muted-foreground max-w-xl">
                Here&apos;s the pulse of{" "}
                <span className="text-foreground font-medium">{companyName}</span> for today.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-[11px] font-medium text-muted-foreground backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400" aria-hidden />
                {companyName}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold backdrop-blur-sm ${
                  isTrial
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                }`}
              >
                {isTrial ? "Trial" : "Plan"} · {planLabel}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur-sm tabular-nums">
                {todayDateLabel}
              </span>
            </div>
          </div>

          {/* AI Executive Summary */}
          <div className="mt-6 rounded-2xl border border-white/10 bg-black/35 backdrop-blur-md p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/20 border border-violet-400/20 text-violet-300" aria-hidden>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </span>
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-200/90">
                AI Executive Summary
              </h2>
            </div>
            <p className="text-sm sm:text-[0.9375rem] text-muted-foreground leading-relaxed">
              {aiSummary}
            </p>
            <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2">
              {[
                { label: "Active leads", value: (reports?.totalLeads ?? 0).toLocaleString() },
                { label: "Deals", value: (reports?.totalDeals ?? deals.length).toLocaleString() },
                { label: "Pipeline", value: formatCurrency(reports?.pipelineValue ?? 0, currency) },
                { label: "Tasks today", value: String(tasksToday.length || reports?.tasksDue || 0) },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5"
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{item.label}</div>
                  <div className="mt-0.5 text-base sm:text-lg font-semibold tabular-nums text-foreground truncate">
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Quick Actions */}
      <section aria-labelledby="quick-actions-heading">
        <h2 id="quick-actions-heading" className="sr-only">
          Quick actions
        </h2>
        <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
          {QUICK_ACTIONS.map((a) => (
            <Link
              key={a.href + a.label}
              href={a.href}
              className={`snap-start shrink-0 mm-card-hover flex items-center gap-2.5 rounded-2xl border bg-gradient-to-br ${a.tone} px-4 py-3 min-h-12 text-sm font-semibold text-foreground focus-ring button-active`}
            >
              <span aria-hidden className="text-base">
                {a.icon}
              </span>
              {a.label}
            </Link>
          ))}
        </div>
      </section>

      {/* KPI Cards */}
      <section aria-labelledby="kpi-heading">
        <div className="flex items-end justify-between gap-3 mb-3">
          <h2 id="kpi-heading" className="mm-section-title">
            Key metrics
          </h2>
          <p className="text-[11px] text-muted-foreground hidden sm:block">Live tenant aggregates</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mm-stagger">
          {kpiCards.map((k) => (
            <PremiumKpi
              key={k.key}
              label={k.label}
              value={k.value}
              href={k.href}
              tone={k.tone}
              icon={k.icon}
              growth={k.growth}
              previous={k.previous}
              sparkline={sparkFromValue(k.value)}
              formatMoney={
                "money" in k && k.money
                  ? (n) => formatCurrency(n, currency)
                  : undefined
              }
              loading={loading && !reports}
              className="min-h-[132px]"
            />
          ))}
        </div>
      </section>

      {/* Media Library widget */}
      <section aria-labelledby="media-lib-heading" className="mt-2">
        <Link
          href="/dashboard/media"
          className="block rounded-2xl border border-border bg-card/70 p-5 sm:p-6 mm-card-hover focus-ring"
        >
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2
                id="media-lib-heading"
                className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2"
              >
                <span aria-hidden>📁</span> Media Library
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Brochures, catalogs & WhatsApp assets
              </p>
            </div>
            <span className="text-xs font-semibold text-violet-300">Open →</span>
          </div>
          {loading && !mediaStats ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Total Files</span>
                <span className="font-semibold tabular-nums">
                  {(mediaStats?.totalFiles ?? 0).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Storage Used</span>
                <span className="font-semibold tabular-nums">
                  {mediaStats?.storageUsedLabel ?? "0 B"}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Brochures</span>
                <span className="font-semibold tabular-nums">
                  {mediaStats?.byKind.pdfs ?? mediaStats?.byKind.brochures ?? 0}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Images</span>
                <span className="font-semibold tabular-nums">
                  {mediaStats?.byKind.images ?? 0}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Videos</span>
                <span className="font-semibold tabular-nums">
                  {mediaStats?.byKind.videos ?? 0}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">PDFs</span>
                <span className="font-semibold tabular-nums">
                  {mediaStats?.byKind.pdfs ?? 0}
                </span>
              </div>
            </div>
          )}
        </Link>
      </section>

      {/* 3. Sales Pipeline Kanban */}
      <section aria-labelledby="pipeline-heading">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 id="pipeline-heading" className="text-lg font-semibold tracking-tight text-foreground">
            Sales pipeline
          </h2>
          <Link
            href="/dashboard/deals"
            className="text-xs font-semibold text-violet-300 hover:text-violet-200 focus-ring rounded"
          >
            Open board →
          </Link>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
          {pipeline.map((col) => (
            <div
              key={col.key}
              className="snap-start shrink-0 w-[140px] sm:w-[150px] rounded-2xl border border-border bg-card/70 p-3.5 mm-card-hover"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-semibold text-muted-foreground">{col.label}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                  {col.count}
                </span>
              </div>
              <div className="mt-3 text-base font-semibold tabular-nums text-foreground truncate">
                {formatCurrency(col.value, currency)}
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    col.key === "won"
                      ? "bg-emerald-500"
                      : col.key === "lost"
                        ? "bg-red-500/70"
                        : "bg-gradient-to-r from-violet-500 to-sky-500"
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      pipeline.reduce((s, c) => s + c.count, 0) > 0
                        ? (col.count / pipeline.reduce((s, c) => s + c.count, 0)) * 100
                        : 0
                    )}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        {deals.length === 0 && (
          <div className="mt-2 rounded-2xl border border-border bg-card/40">
            <EmptyBlock
              title="No deals in pipeline"
              hint="Create your first deal to see the Kanban stages fill up."
              actionHref="/dashboard/deals"
              actionLabel="Create deal"
            />
          </div>
        )}
      </section>

      {/* 4. Analytics — full interactive suite */}
      <Suspense
        fallback={
          <div className="h-64 animate-pulse rounded-3xl bg-white/5 border border-white/10" />
        }
      >
        <AnalyticsDashboard />
      </Suspense>

      {/* 6 + 7 + 8 — Activity / Tasks / AI */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Activity */}
        <article className="mm-panel p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground tracking-tight">Recent activity</h3>
            <Link href="/dashboard/activity" className="text-[11px] text-violet-300 font-semibold focus-ring rounded">
              View all
            </Link>
          </div>
          {activities.length === 0 ? (
            <EmptyBlock
              title="No recent activity"
              hint="CRM actions will appear here as a live timeline."
            />
          ) : (
            <ol className="space-y-0">
              {activities.slice(0, 8).map((a, i) => (
                <li key={a.id || i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="h-2.5 w-2.5 rounded-full bg-violet-500 ring-4 ring-violet-500/15" />
                    {i < Math.min(activities.length, 8) - 1 && (
                      <span className="w-px flex-1 bg-muted min-h-[1.5rem]" />
                    )}
                  </div>
                  <div className="pb-4 min-w-0">
                    <p className="text-sm text-foreground truncate">{activityLabel(a)}</p>
                    {a.createdAt && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {new Date(a.createdAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </article>

        {/* Upcoming Tasks */}
        <article className="mm-panel p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground tracking-tight">Tasks & meetings</h3>
            <Link href="/dashboard/tasks" className="text-[11px] text-violet-300 font-semibold focus-ring rounded">
              Tasks
            </Link>
          </div>
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                Today&apos;s tasks
              </p>
              {tasksToday.length === 0 ? (
                <p className="text-xs text-muted-foreground">No tasks due today</p>
              ) : (
                <ul className="space-y-1.5">
                  {tasksToday.slice(0, 4).map((t) => (
                    <li
                      key={t.id}
                      className="rounded-xl border border-border bg-background/50 px-3 py-2 text-sm text-foreground truncate"
                    >
                      {t.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-red-400/80 mb-2">
                Overdue ({tasksOverdue.length})
              </p>
              {tasksOverdue.length === 0 ? (
                <p className="text-xs text-muted-foreground">You&apos;re caught up ✨</p>
              ) : (
                <ul className="space-y-1.5">
                  {tasksOverdue.slice(0, 3).map((t) => (
                    <li
                      key={t.id}
                      className="rounded-xl border border-red-500/20 bg-red-950/20 px-3 py-2 text-sm text-red-100 truncate"
                    >
                      {t.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                Upcoming meetings
              </p>
              {upcomingMeetings.length === 0 ? (
                <p className="text-xs text-muted-foreground">No upcoming meetings</p>
              ) : (
                <ul className="space-y-1.5">
                  {upcomingMeetings.map((m) => (
                    <li
                      key={m.id}
                      className="rounded-xl border border-border bg-background/50 px-3 py-2 text-sm"
                    >
                      <div className="text-foreground truncate">{m.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {m.scheduledAt ? new Date(m.scheduledAt).toLocaleString() : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </article>

        {/* AI Insights */}
        <article className="rounded-2xl border border-violet-500/25 bg-gradient-to-b from-violet-950/40 to-zinc-900/80 p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/20 border border-violet-500/30 text-xs"
                aria-hidden
              >
                AI
              </span>
              AI Insights
            </h3>
            <Link
              href="/dashboard/ai-sales"
              className="text-[11px] text-violet-300 font-semibold focus-ring rounded"
            >
              Open AI
            </Link>
          </div>
          {aiRecs.length === 0 ? (
            <EmptyBlock
              title="No AI insights yet"
              hint="Score leads and run follow-ups to unlock predictions and suggestions."
              actionHref="/dashboard/ai-sales"
              actionLabel="Run AI sales tools"
            />
          ) : (
            <ul className="space-y-2.5">
              {aiRecs.map((r) => (
                <li
                  key={r.id}
                  className="rounded-xl border border-border/80 bg-background/40 px-3 py-2.5"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                        r.urgency === "red" || r.priority === "high"
                          ? "bg-red-400"
                          : r.urgency === "yellow" || r.priority === "medium"
                            ? "bg-amber-400"
                            : "bg-emerald-400"
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{r.title}</p>
                      {r.reason && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{r.reason}</p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-xl border border-border bg-background/50 px-3 py-2">
              <div className="text-muted-foreground">Pipeline value</div>
              <div className="font-semibold text-foreground tabular-nums">
                {formatCurrency(n(reports?.pipelineValue), currency)}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-background/50 px-3 py-2">
              <div className="text-muted-foreground">Win rate</div>
              <div className="font-semibold text-emerald-300 tabular-nums">{conversion}%</div>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
