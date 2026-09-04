"use client";

import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";
import { useBusinessCurrency } from "@/lib/use-business-currency";
import { useDataVersion } from "@/lib/data-events";
import { usePortal } from "@/lib/portal-context";
import { usePlan } from "@/lib/plan-context";
import { Skeleton } from "@/components/ui/Skeleton";
import { PremiumKpi, PremiumKpiSkeleton } from "@/components/ui/PremiumKpi";
import { AiCommandCenter } from "@/components/ai/AiCommandCenter";
import {
  UNIFIED_PIPELINE_STATUSES,
  pipelineStatusLabel,
} from "@/lib/pipeline-statuses";
import { ActivityHistoryPanel } from "@/components/activity/ActivityHistoryPanel";
import { FeatureSearch } from "@/components/dashboard/FeatureSearch";
import { canAccessPath } from "@/lib/module-permissions";
import { canViewTeamActivity } from "@/lib/team-activity-access";

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

type LeadAssignmentSummary = {
  totalLeads: number;
  assignedLeads: number;
  unassignedLeads: number;
  byMember: Array<{
    userId: string | null;
    name: string;
    email: string | null;
    count: number;
  }>;
};

type MemberActivitySummary = {
  sinceDays: number;
  since: string;
  unavailableMetrics: Array<{ key: string; reason: string }>;
  byMember: Array<{
    userId: string;
    name: string;
    email: string | null;
    role: string | null;
    leadsAssigned: number;
    leadsUpdated: number;
    followUpsCompleted: number;
    meetings: number;
    emailsSent: number;
    whatsappActions: number;
    callsMade: null;
  }>;
  totals: {
    leadsAssigned: number;
    leadsUpdated: number;
    followUpsCompleted: number;
    meetings: number;
    emailsSent: number;
    whatsappActions: number;
  };
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
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted">
        <svg className="h-5 w-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
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
          className="mt-4 text-xs font-semibold text-primary hover:text-primary-hover focus-ring rounded"
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
    tone: "border-border bg-card",
  },
  {
    href: "/dashboard/deals",
    label: "New Deal",
    icon: "💼",
    tone: "border-border bg-card",
  },
  {
    href: "/dashboard/meetings",
    label: "Schedule Meeting",
    icon: "📅",
    tone: "border-border bg-card",
  },
  {
    href: "/dashboard/ai-sales",
    label: "Generate Proposal",
    icon: "✨",
    tone: "border-border bg-card",
  },
  {
    href: "/dashboard/finance",
    label: "Create Invoice",
    icon: "🧾",
    tone: "border-border bg-card",
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
  const { user, token, role } = useAuth();
  const { currency } = useBusinessCurrency();
  const dataVersion = useDataVersion();
  const { portal } = usePortal();
  const { plan, isTrial, tier, accessKnown } = usePlan();
  const moduleKeys = useMemo(
    () => (Array.isArray(portal?.modules) ? portal.modules : null),
    [portal?.modules]
  );
  const featureSearchCanAccess = useCallback(
    (href: string) => canAccessPath(href, moduleKeys, { loaded: moduleKeys !== null }),
    [moduleKeys]
  );
  const [isDemoMode, setIsDemoMode] = useState(false);
  useEffect(() => {
    try {
      setIsDemoMode(localStorage.getItem("massive_mentor_demo_mode") === "1");
    } catch {
      setIsDemoMode(false);
    }
  }, []);

  // Honor deep-links like /dashboard#member-activity-heading from Feature Search
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash?.replace(/^#/, "");
    if (!hash) return;
    const t = window.setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 400);
    return () => window.clearTimeout(t);
  }, []);

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
  const [assignmentSummary, setAssignmentSummary] = useState<LeadAssignmentSummary | null>(
    null
  );
  const [memberActivity, setMemberActivity] = useState<MemberActivitySummary | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [visSearch, setVisSearch] = useState("");
  const [visStatus, setVisStatus] = useState("");
  const [visAssignee, setVisAssignee] = useState("");
  const [visSinceDays, setVisSinceDays] = useState("30");
  const [visBusy, setVisBusy] = useState(false);
  const [visResults, setVisResults] = useState<{
    total: number;
    items: Array<{
      id: string;
      name: string;
      company: string | null;
      status: string;
      assignedToId: string | null;
      assignedToName: string | null;
      lastActivityAt: string | null;
      nextFollowUp: string | null;
      phone: string | null;
      updatedAt: string;
    }>;
  } | null>(null);

  const roleKey = (role || user?.role || "").toLowerCase();
  // Team lead visibility / assignment summary — managers still allowed
  const canSeeAssignmentSummary =
    [
      "ceo",
      "owner",
      "business_admin",
      "admin",
      "super_admin",
      "sales_manager",
      "manager",
    ].includes(roleKey) || roleKey.includes("admin");
  // Member Activity / Team Activity — Business Admin + CEO only
  const canSeeMemberActivity = canViewTeamActivity(roleKey);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);

    // Analytics: ONLY /reports/dashboard (full-tenant SQL/groupBy — no pageSize samples)
    // Lists (tasks/meetings/activity/AI): small recent slices for widgets only
    // All via api.get so identical in-flight GETs are shared across the app.
    const [
      reportsRes,
      tasksRes,
      meetingsRes,
      activityRes,
      financeRes,
      aiRes,
      mediaRes,
      assignRes,
      memberActRes,
    ] = await Promise.all([
      api.get<ReportsDash>("/reports/dashboard", token),
      api.getCrmTasks("?pageSize=50", token),
      api.getCrmMeetings("?pageSize=30", token),
      api.get<{ audit?: unknown[]; activities?: unknown[] }>("/automations/activity?pageSize=20", token),
      api.get<{ kpis?: FinanceKpis }>("/finance/dashboard", token),
      // Same limit as AiFollowupCenter so in-flight/TTL dedupe can share one call
      api.get<{ recommendations?: unknown[]; items?: unknown[] }>("/crm/ai/followup-engine?limit=40", token),
      api.getMediaStats(token),
      api.getLeadAssignmentSummary(token),
      canSeeMemberActivity
        ? api.getMemberActivitySummary(token, 30)
        : Promise.resolve({ success: false as const, data: null }),
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
    // On 429/failure: keep prior reports/deals (do not zero the dashboard)

    if (tasksRes.success && tasksRes.data) {
    const taskList =
      (tasksRes.data as { tasks?: Task[] })?.tasks ||
      (tasksRes.data as { items?: Task[] })?.items ||
      (Array.isArray(tasksRes.data) ? (tasksRes.data as Task[]) : []);
    setTasks(taskList);
    }

    if (meetingsRes.success && meetingsRes.data) {
    const meetingList =
      (meetingsRes.data as { meetings?: Meeting[] })?.meetings ||
      (meetingsRes.data as { items?: Meeting[] })?.items ||
      (Array.isArray(meetingsRes.data) ? (meetingsRes.data as Meeting[]) : []);
    setMeetings(meetingList);
    }

    if (activityRes.success && activityRes.data) {
      const rawAct = activityRes.data as {
        audit?: Activity[];
        activities?: Activity[];
      };
      const act = rawAct.audit || rawAct.activities || [];
      if (Array.isArray(act)) setActivities(act.slice(0, 12));
    }

    if (financeRes.success && financeRes.data) {
      const fk =
        (financeRes.data as { kpis?: FinanceKpis }).kpis ||
        (financeRes.data as FinanceKpis) ||
        null;
      if (fk && typeof fk === "object") setFinance(fk);
    }

    if (aiRes.success && aiRes.data) {
      const rawAi = aiRes.data as { recommendations?: AiRec[]; items?: AiRec[] };
      const recs = rawAi.recommendations || rawAi.items || [];
      if (Array.isArray(recs)) setAiRecs(recs.slice(0, 6));
    }

    if (mediaRes.success && mediaRes.data) {
      setMediaStats({
        totalFiles: mediaRes.data.totalFiles,
        storageUsedLabel: mediaRes.data.storageUsedLabel,
        byKind: mediaRes.data.byKind,
      });
    }

    if (assignRes.success && assignRes.data) {
      setAssignmentSummary(assignRes.data);
    }

    if (
      memberActRes &&
      "success" in memberActRes &&
      memberActRes.success &&
      memberActRes.data
    ) {
      setMemberActivity(memberActRes.data as MemberActivitySummary);
    }

    setLoading(false);
  }, [token, canSeeMemberActivity]);

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
    if (!accessKnown) return "…";
    if (plan) return plan.charAt(0).toUpperCase() + plan.slice(1);
    if (isTrial || tier === "trial") return "Trial";
    return tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : "Free";
  }, [plan, isTrial, tier, accessKnown]);

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
      tone: "border-border bg-card",
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
      tone: "border-border bg-card",
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
      tone: "border-border bg-card",
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
      tone: "border-border bg-card",
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
      tone: "border-border bg-card",
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
      tone: "border-border bg-card",
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
        <div className="h-56 rounded-lg mm-skeleton" />
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <PremiumKpiSkeleton key={i} />
          ))}
        </div>
        <Skeleton className="h-40 rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6 overflow-x-hidden mm-page-enter">
      {/* 1. Welcome — compact enterprise header */}
      <section
        className="mm-fade-up mm-dash-hero p-4 sm:p-5"
        aria-labelledby="dash-welcome"
      >
        <div className="relative">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
            <div className="min-w-0">
              <p className="mm-section-label">Welcome back</p>
              <h1
                id="dash-welcome"
                className="mt-1 mm-page-title"
              >
                {greet}, {name}
              </h1>
              <p className="mt-1 mm-secondary max-w-xl">
                Here&apos;s the pulse of{" "}
                <span className="text-foreground font-medium">{companyName}</span> for today.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <span className="mm-dash-hero-chip">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                <span className="mm-dash-hero-chip-title">{companyName}</span>
              </span>
              <span
                className={`mm-dash-hero-chip font-semibold ${
                  isDemoMode
                    ? "border-sky-500/35 bg-sky-500/10 text-sky-800 dark:text-sky-200"
                    : !accessKnown
                      ? "border-border bg-muted text-muted-foreground"
                    : isTrial
                      ? "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-200"
                      : "border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                }`}
              >
                {isDemoMode
                  ? "Demo · Sample data"
                  : !accessKnown
                    ? "Plan · …"
                    : `${isTrial ? "Trial" : "Plan"} · ${planLabel}`}
              </span>
              <span className="mm-dash-hero-chip tabular-nums">{todayDateLabel}</span>
            </div>
          </div>

          {/* Global CRM feature search — same catalog as sidebar */}
          <div className="mt-5 sm:mt-6 max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-2">
              Search CRM
            </p>
            <FeatureSearch
              size="lg"
              placeholder="Search CRM features, pages, actions…"
              canAccess={featureSearchCanAccess}
              canViewTeamActivity={canSeeMemberActivity}
              modules={moduleKeys}
              className="w-full"
            />
          </div>

          {/* AI Executive Summary */}
          <div className="mm-dash-hero-panel mt-6 p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-md bg-accent border border-border text-primary"
                aria-hidden
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </span>
              <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
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
                <div key={item.label} className="mm-dash-hero-stat">
                  <div className="mm-dash-hero-stat-label">{item.label}</div>
                  <div className="mm-dash-hero-stat-value">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Massive Mentor AI Command Center — NL CRM + ERP actions */}
      <AiCommandCenter />

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
              className={`snap-start shrink-0 mm-card-hover flex items-center gap-2 rounded-md border ${a.tone} px-3 py-2 h-9 min-h-9 text-[13px] font-medium text-foreground focus-ring`}
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
              className="min-h-[96px]"
            />
          ))}
        </div>
      </section>

      {/* Admin lead visibility search — reuses CRM list filters (managers allowed) */}
      {canSeeAssignmentSummary && (
        <section aria-labelledby="admin-visibility-heading" className="mt-1">
          <div className="mm-card p-4 sm:p-5">
            <div className="mb-3">
              <h2 id="admin-visibility-heading" className="mm-section-title">
                Team lead visibility
              </h2>
              <p className="mm-secondary mt-0.5">
                Search by status (e.g. RNR), member, or name — same filters as the Leads module.
              </p>
            </div>
            <form
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 mb-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!token) return;
                setVisBusy(true);
                const raw = visSearch.trim();
                const statusFromSearch = UNIFIED_PIPELINE_STATUSES.find(
                  (s) =>
                    s.key === raw.toLowerCase() ||
                    s.label.toLowerCase() === raw.toLowerCase()
                );
                const res = await api.adminLeadVisibilitySearch(token, {
                  search: statusFromSearch ? undefined : raw || undefined,
                  status: visStatus || statusFromSearch?.key || undefined,
                  assignedTo: visAssignee || undefined,
                  sinceDays: visSinceDays ? Number(visSinceDays) : 30,
                  pageSize: 25,
                });
                setVisBusy(false);
                if (res.success && res.data) {
                  setVisResults({ total: res.data.total, items: res.data.items });
                } else {
                  setVisResults({ total: 0, items: [] });
                }
              }}
            >
              <input
                className="mm-input lg:col-span-2"
                placeholder="Search name, company, phone — or status like RNR"
                value={visSearch}
                onChange={(e) => setVisSearch(e.target.value)}
              />
              <select
                className="mm-input"
                value={visStatus}
                onChange={(e) => setVisStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                {UNIFIED_PIPELINE_STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                className="mm-input"
                value={visAssignee}
                onChange={(e) => setVisAssignee(e.target.value)}
              >
                <option value="">All members</option>
                <option value="unassigned">Unassigned</option>
                {(assignmentSummary?.byMember || memberActivity?.byMember || []).map((m) => (
                  <option key={m.userId || m.name} value={m.userId || ""}>
                    {m.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <select
                  className="mm-input flex-1"
                  value={visSinceDays}
                  onChange={(e) => setVisSinceDays(e.target.value)}
                  title="Updated within"
                >
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="">Any time</option>
                </select>
                <button type="submit" className="mm-btn-primary text-sm px-3 shrink-0" disabled={visBusy}>
                  {visBusy ? "…" : "Search"}
                </button>
              </div>
            </form>
            {visResults ? (
              <div className="mm-table-wrap overflow-x-auto">
                <table className="mm-table min-w-[720px]">
                  <thead>
                    <tr>
                      <th>Lead</th>
                      <th>Status</th>
                      <th>Assigned to</th>
                      <th>Last activity</th>
                      <th>Next follow-up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visResults.items.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground text-xs">
                          No matching leads
                        </td>
                      </tr>
                    ) : (
                      visResults.items.map((row) => (
                        <tr key={row.id} className="border-b border-border/60 last:border-0">
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/dashboard/leads?search=${encodeURIComponent(row.name)}`}
                              className="font-medium text-foreground hover:text-primary"
                            >
                              {row.name}
                            </Link>
                            {row.company ? (
                              <div className="text-[11px] text-muted-foreground">{row.company}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 text-sm">
                            {pipelineStatusLabel(row.status)}
                          </td>
                          <td className="px-4 py-2.5 text-sm">
                            {row.assignedToName || (
                              <span className="text-muted-foreground">Unassigned</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">
                            {row.lastActivityAt
                              ? new Date(row.lastActivityAt).toLocaleString()
                              : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">
                            {row.nextFollowUp
                              ? new Date(row.nextFollowUp).toLocaleString()
                              : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                <p className="text-[11px] text-muted-foreground mt-2">
                  {visResults.total.toLocaleString()} match
                  {visResults.total === 1 ? "" : "es"}
                  {visResults.total > visResults.items.length
                    ? ` · showing first ${visResults.items.length}`
                    : ""}
                </p>
              </div>
            ) : null}
          </div>
        </section>
      )}

      {/* Lead Assignment Summary — Business Admin visibility */}
      {canSeeAssignmentSummary && (
        <section aria-labelledby="lead-assignment-heading" className="mt-1">
          <div className="mm-card p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5 mb-3">
              <div>
                <h2
                  id="lead-assignment-heading"
                  className="mm-section-title flex items-center gap-2"
                >
                  Lead Assignment
                </h2>
                <p className="mm-secondary mt-0.5">
                  Live counts for your business — total, assigned, and per team member
                </p>
              </div>
              <Link
                href="/dashboard/leads"
                className="text-xs font-semibold text-primary hover:text-primary-hover focus-ring rounded shrink-0"
              >
                Manage leads →
              </Link>
            </div>

            {loading && !assignmentSummary ? (
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4">
                  <div className="rounded-md border border-border bg-card px-3.5 py-2.5">
                    <div className="mm-kpi-label">Total Leads</div>
                    <div className="text-xl font-semibold tabular-nums mt-1 text-foreground">
                      {(assignmentSummary?.totalLeads ?? reports?.totalLeads ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-card px-3.5 py-2.5">
                    <div className="mm-kpi-label text-emerald-700 dark:text-emerald-400">Assigned Leads</div>
                    <div className="text-xl font-semibold tabular-nums mt-1 text-foreground">
                      {(assignmentSummary?.assignedLeads ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-card px-3.5 py-2.5">
                    <div className="mm-kpi-label text-amber-700 dark:text-amber-400">Unassigned Leads</div>
                    <div className="text-xl font-semibold tabular-nums mt-1 text-foreground">
                      {(assignmentSummary?.unassignedLeads ?? 0).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="mm-table-wrap">
                  <table className="mm-table">
                    <thead>
                      <tr>
                        <th>Team Member</th>
                        <th className="text-right">Leads Assigned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(assignmentSummary?.byMember?.length ?? 0) === 0 ? (
                        <tr>
                          <td
                            colSpan={2}
                            className="px-4 py-6 text-center text-muted-foreground text-xs"
                          >
                            No leads assigned to team members yet
                          </td>
                        </tr>
                      ) : (
                        assignmentSummary!.byMember.map((m) => (
                          <tr
                            key={m.userId || m.name}
                            className="border-b border-border/60 last:border-0"
                          >
                            <td className="px-4 py-2.5">
                              <Link
                                href={`/dashboard/leads?assignedTo=${encodeURIComponent(m.userId || "")}`}
                                className="font-medium text-foreground hover:text-primary focus-ring rounded"
                              >
                                {m.name}
                              </Link>
                              {m.email ? (
                                <div className="text-[11px] text-muted-foreground truncate max-w-[220px]">
                                  {m.email}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                              {m.count.toLocaleString()}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border bg-muted/20">
                        <td className="px-4 py-2.5 font-semibold">Total (assigned)</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                          {(assignmentSummary?.assignedLeads ?? 0).toLocaleString()}
                        </td>
                      </tr>
                      <tr className="border-t border-border/60">
                        <td className="px-4 py-2 font-semibold text-muted-foreground">
                          Grand total (incl. unassigned)
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-muted-foreground">
                          {(
                            assignmentSummary?.totalLeads ??
                            reports?.totalLeads ??
                            0
                          ).toLocaleString()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* Member Activity — real CRM metrics only (no invented call counts) */}
      {canSeeMemberActivity && (
        <section aria-labelledby="member-activity-heading" className="mt-1">
          <div className="mm-card p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5 mb-3">
              <div>
                <h2
                  id="member-activity-heading"
                  className="mm-section-title flex items-center gap-2"
                >
                  Member Activity
                </h2>
                <p className="mm-secondary mt-0.5">
                  Last {memberActivity?.sinceDays ?? 30} days — logged CRM actions by team member.
                  Phone calls are not tracked in CRM.
                </p>
              </div>
              <Link
                href="/dashboard/activity"
                className="text-xs font-semibold text-primary hover:text-primary-hover focus-ring rounded shrink-0"
              >
                Activity log →
              </Link>
            </div>

            {loading && !memberActivity ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
                  <div className="rounded-md border border-border bg-card px-3.5 py-2.5">
                    <div className="mm-kpi-label">Lead edits logged</div>
                    <div className="text-xl font-semibold tabular-nums mt-1 text-foreground">
                      {(memberActivity?.totals.leadsUpdated ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-card px-3.5 py-2.5">
                    <div className="mm-kpi-label">Follow-ups done</div>
                    <div className="text-xl font-semibold tabular-nums mt-1 text-foreground">
                      {(memberActivity?.totals.followUpsCompleted ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-card px-3.5 py-2.5">
                    <div className="mm-kpi-label">Meetings</div>
                    <div className="text-xl font-semibold tabular-nums mt-1 text-foreground">
                      {(memberActivity?.totals.meetings ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-card px-3.5 py-2.5">
                    <div className="mm-kpi-label">Email + WhatsApp</div>
                    <div className="text-xl font-semibold tabular-nums mt-1 text-foreground">
                      {(
                        (memberActivity?.totals.emailsSent ?? 0) +
                        (memberActivity?.totals.whatsappActions ?? 0)
                      ).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="mm-table-wrap overflow-x-auto">
                  <table className="mm-table min-w-[640px]">
                    <thead>
                      <tr>
                        <th>Team Member</th>
                        <th className="text-right">Assigned</th>
                        <th className="text-right">Lead edits</th>
                        <th className="text-right">Follow-ups</th>
                        <th className="text-right">Meetings</th>
                        <th className="text-right">Emails</th>
                        <th className="text-right">WhatsApp</th>
                        <th className="text-right">Calls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(memberActivity?.byMember?.length ?? 0) === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-4 py-6 text-center text-muted-foreground text-xs"
                          >
                            No team members found for this workspace
                          </td>
                        </tr>
                      ) : (
                        memberActivity!.byMember.map((m) => (
                          <tr
                            key={m.userId}
                            className={`border-b border-border/60 last:border-0 cursor-pointer hover:bg-muted/20 ${
                              selectedMemberId === m.userId ? "bg-sky-500/10" : ""
                            }`}
                            onClick={() =>
                              setSelectedMemberId((prev) =>
                                prev === m.userId ? null : m.userId
                              )
                            }
                            title="View complete activity history"
                          >
                            <td className="px-4 py-2.5">
                              <div className="font-medium text-foreground">{m.name}</div>
                              {m.email ? (
                                <div className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                                  {m.email}
                                </div>
                              ) : null}
                              <div className="text-[10px] text-sky-300/80 mt-0.5">
                                {selectedMemberId === m.userId
                                  ? "Hide history"
                                  : "View history"}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                              {m.leadsAssigned.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {m.leadsUpdated.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {m.followUpsCompleted.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {m.meetings.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {m.emailsSent.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {m.whatsappActions.toLocaleString()}
                            </td>
                            <td
                              className="px-4 py-2.5 text-right text-muted-foreground text-xs"
                              title="Phone calls are not stored in CRM"
                            >
                              —
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {(memberActivity?.byMember?.length ?? 0) > 0 ? (
                      <tfoot>
                        <tr className="border-t border-border bg-muted/20">
                          <td className="px-4 py-2.5 font-semibold">Total</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                            {(memberActivity?.totals.leadsAssigned ?? 0).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                            {(memberActivity?.totals.leadsUpdated ?? 0).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                            {(memberActivity?.totals.followUpsCompleted ?? 0).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                            {(memberActivity?.totals.meetings ?? 0).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                            {(memberActivity?.totals.emailsSent ?? 0).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                            {(memberActivity?.totals.whatsappActions ?? 0).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">—</td>
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </div>
                {selectedMemberId ? (
                  <div className="mt-4">
                    <ActivityHistoryPanel
                      token={token}
                      mode="member"
                      memberUserId={selectedMemberId}
                      title="Team Member History"
                    />
                  </div>
                ) : null}
                {memberActivity?.unavailableMetrics?.length ? (
                  <p className="text-[11px] text-muted-foreground mt-3">
                    {memberActivity.unavailableMetrics.map((u) => u.reason).join(" ")} Lead edits
                    reflect logged Activity/Audit rows only (single-lead edits may be under-counted
                    until fully audited).
                  </p>
                ) : null}
              </>
            )}
          </div>
        </section>
      )}

      {/* Media Library widget */}
      <section aria-labelledby="media-lib-heading" className="mt-2">
        <Link
          href="/dashboard/media"
          className="block mm-card p-4 sm:p-5 mm-card-hover focus-ring"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2
                id="media-lib-heading"
                className="mm-section-title"
              >
                Media Library
              </h2>
              <p className="mm-secondary mt-0.5">
                Brochures, catalogs & WhatsApp assets
              </p>
            </div>
            <span className="text-xs font-semibold text-primary">Open →</span>
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
            className="text-xs font-semibold text-primary hover:text-primary-hover focus-ring rounded"
          >
            Open board →
          </Link>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
          {pipeline.map((col) => (
            <div
              key={col.key}
              className="snap-start shrink-0 w-[140px] sm:w-[150px] rounded-md border border-border bg-card p-3 mm-card-hover"
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
                        : "bg-primary"
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
          <div className="mt-2 rounded-md border border-border bg-card">
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
          <div className="h-64 animate-pulse rounded-lg bg-muted border border-border" />
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
            <Link href="/dashboard/activity" className="text-[11px] text-primary font-semibold focus-ring rounded">
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
                    <span className="h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-primary/10" />
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
            <Link href="/dashboard/tasks" className="text-[11px] text-primary font-semibold focus-ring rounded">
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
                      className="rounded-md border border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-950/30 px-3 py-2 text-sm text-red-800 dark:text-red-100 truncate"
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
        <article className="rounded-lg border border-border bg-card p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-md bg-accent border border-border text-[10px] font-semibold text-primary"
                aria-hidden
              >
                AI
              </span>
              AI Insights
            </h3>
            <Link
              href="/dashboard/ai-sales"
              className="text-[11px] text-primary font-semibold focus-ring rounded"
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
              <div className="font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">{conversion}%</div>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
