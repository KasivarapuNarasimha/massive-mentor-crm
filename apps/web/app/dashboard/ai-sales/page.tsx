"use client";

import { useState, useEffect, Suspense } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { parseAmount } from "@/lib/currency";
import { useBusinessCurrency } from "@/lib/use-business-currency";
import { LanguageSelector, getLanguageLabel } from "@/components/ai/LanguageSelector";
import { useDataVersion } from "@/lib/data-events";

/** Safe numeric deal amount — never string-concatenate Decimal/API strings. */
function dealAmount(value: unknown): number {
  return parseAmount(value as string | number | null | undefined) ?? 0;
}

interface Contact {
  id: string;
  name: string;
  company?: string;
  status: string;
  value?: number;
  aiScore?: number;
  type?: string;
  phone?: string;
}

interface Deal {
  id: string;
  title: string;
  value?: number;
  stage: string;
}

interface MeetingOption {
  id: string;
  title: string;
  scheduledAt: string;
  notes?: string | null;
  outcome?: string | null;
  durationMin?: number | null;
  contact?: { id: string; name: string; company?: string | null; type?: string | null } | null;
  deal?: { id: string; title: string } | null;
}

type ReminderType = "call" | "email" | "whatsapp" | "meeting" | "follow_up";
type ReminderPriority = "high" | "medium" | "low";

interface AiReminderItem {
  id: string;
  title: string;
  description: string;
  dueAt: string;
  priority: ReminderPriority;
  type: ReminderType;
  assignedUserId: string;
  assignedUserName: string | null;
  assignedUserEmail: string;
  contactId: string | null;
  dealId: string | null;
  meetingId: string | null;
  /** Client-only: task created */
  createdTaskId?: string;
}

interface KpiData {
  totalLeads: number;
  totalClients: number;
  totalDealsValue: number;
  conversionRate: number;
  pipelineValue: number;
  tasksDue: number;
  meetingsToday: number;
}

function AiSalesIntelligencePageInner() {
  const { token } = useAuth();
  const { money } = useBusinessCurrency();
  const dataVersion = useDataVersion();
  const searchParams = useSearchParams();
  const meetingIdFromUrl = searchParams.get("meetingId") || "";

  const [kpis, setKpis] = useState<KpiData>({
    totalLeads: 0,
    totalClients: 0,
    totalDealsValue: 0,
    conversionRate: 0,
    pipelineValue: 0,
    tasksDue: 0,
    meetingsToday: 0,
  });

  const [leads, setLeads] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [meetings, setMeetings] = useState<MeetingOption[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState("");
  const [meetingSearch, setMeetingSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // AI result states
  const [leadScoreResult, setLeadScoreResult] = useState<unknown>(null);
  const [followUpResult, setFollowUpResult] = useState<unknown>(null);
  const [proposalResult, setProposalResult] = useState<unknown>(null);
  const [forecastResult, setForecastResult] = useState<unknown>(null);
  const [nextActionResult, setNextActionResult] = useState<unknown>(null);
  const [meetingSummaryResult, setMeetingSummaryResult] = useState<unknown>(null);
  const [reminders, setReminders] = useState<AiReminderItem[]>([]);
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [creatingReminderId, setCreatingReminderId] = useState<string | null>(null);

  const [selectedContactId, setSelectedContactId] = useState("");
  const [selectedDealId, setSelectedDealId] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  /** Progressive status while meeting summary is running (null = idle) */
  const [meetingSummaryStatus, setMeetingSummaryStatus] = useState<string | null>(null);

  // WhatsApp Generator (Feature 2 - production quality)
  const [waTone, setWaTone] = useState<"Professional" | "Friendly" | "Sales">("Professional");
  const [waLanguage, setWaLanguage] = useState("auto");
  const [waMessage, setWaMessage] = useState("");
  const [waHistory, setWaHistory] = useState<
    Array<{
      id?: string;
      content?: string;
      body?: string;
      createdAt?: string;
      tone?: string;
      language?: string;
    }>
  >([]);
  const [waLoadingHistory, setWaLoadingHistory] = useState(false);
  const [selectedContactPhone, setSelectedContactPhone] = useState<string | null>(null);

  // Load data for KPIs and selectors
  const loadData = async () => {
    if (!token) return;
    setIsLoading(true);

    try {
      // KPI money totals: always from full-tenant /reports/dashboard SQL aggregates
      // (same as main CRM dashboard). Never sum a paginated deals page client-side —
      // that under-counts large workspaces and used to string-concatenate Decimal values.
      // Selectors only need a recent subset for AI tools (score, WhatsApp, etc.).
      type ReportsDash = {
        totalLeads?: number;
        totalClients?: number;
        totalDealValue?: number;
        pipelineValue?: number;
        conversionRate?: number;
        tasksDue?: number;
        meetingsToday?: number;
        wonDeals?: number;
        lostDeals?: number;
      };

      const [reportsRes, leadsPickRes, dealsRes, tasksRes, meetingsRes] = await Promise.all([
        api.get<ReportsDash>("/reports/dashboard", token),
        api.getCrmContacts("?type=lead&page=1&pageSize=50&sortBy=updatedAt&sortDir=desc", token),
        // Deal picker only — not used for Total/Pipeline KPI math
        api.getCrmDeals("?page=1&pageSize=100&sortBy=updatedAt&sortDir=desc", token),
        api.getCrmTasks("?page=1&pageSize=50", token),
        api.getCrmMeetings("?page=1&pageSize=100&sortBy=scheduledAt&sortDir=desc", token),
      ]);

      type ListMeta = { contacts?: Contact[]; total?: number };
      const leadsPick = (leadsPickRes.data as ListMeta | undefined)?.contacts || [];
      const reports = (reportsRes.success && reportsRes.data ? reportsRes.data : null) as ReportsDash | null;

      const dealsData = dealsRes.data as { deals?: Deal[]; total?: number } | undefined;
      const dealRows = dealsData?.deals || [];
      const tasksData = tasksRes.data as { tasks?: { status?: string }[] } | undefined;
      const tasks = tasksData?.tasks || [];
      const meetingsData = meetingsRes.data as { meetings?: MeetingOption[]; total?: number } | undefined;
      const meetingsList = meetingsData?.meetings || [];

      // Prefer server aggregates; fall back to safe numeric sum of loaded deals only
      const fallbackTotal = dealRows.reduce((sum, d) => sum + dealAmount(d.value), 0);
      const fallbackPipeline = dealRows
        .filter((d) => !["closed_won", "closed_lost"].includes(d.stage))
        .reduce((sum, d) => sum + dealAmount(d.value), 0);

      const totalDealsValue =
        reports && typeof reports.totalDealValue === "number"
          ? reports.totalDealValue
          : fallbackTotal;
      const pipelineValue =
        reports && typeof reports.pipelineValue === "number"
          ? reports.pipelineValue
          : fallbackPipeline;

      let conversionRate = 0;
      if (reports && typeof reports.conversionRate === "number") {
        conversionRate = reports.conversionRate;
      } else {
        const wonDeals = dealRows.filter((d) => d.stage === "closed_won").length;
        const closedDeals = dealRows.filter((d) =>
          ["closed_won", "closed_lost"].includes(d.stage)
        ).length;
        conversionRate = closedDeals > 0 ? Math.round((wonDeals / closedDeals) * 100) : 0;
      }

      const today = new Date().toISOString().split("T")[0];
      const meetingsToday =
        reports && typeof reports.meetingsToday === "number"
          ? reports.meetingsToday
          : meetingsList.filter((m) => m.scheduledAt?.startsWith(today)).length;
      const tasksDue =
        reports && typeof reports.tasksDue === "number"
          ? reports.tasksDue
          : tasks.filter((t: { status?: string }) => t.status !== "done").length;

      const totalLeads =
        reports && typeof reports.totalLeads === "number"
          ? reports.totalLeads
          : typeof (leadsPickRes.data as ListMeta | undefined)?.total === "number"
            ? (leadsPickRes.data as ListMeta).total!
            : leadsPick.length;
      const totalClients =
        reports && typeof reports.totalClients === "number" ? reports.totalClients : 0;

      setKpis({
        totalLeads,
        totalClients,
        totalDealsValue: Math.round(dealAmount(totalDealsValue)),
        conversionRate,
        pipelineValue: Math.round(dealAmount(pipelineValue)),
        tasksDue,
        meetingsToday,
      });

      // Subset for AI tool dropdowns only (scoring / follow-up / WhatsApp)
      setLeads(leadsPick);
      setDeals(
        dealRows.map((d) => ({
          ...d,
          value: d.value == null ? undefined : dealAmount(d.value),
        }))
      );
      setMeetings(meetingsList);
    } catch {
      toast.error("Failed to load CRM data");
    }

    setIsLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [token, dataVersion]);

  // Deep-link from Meetings page: /dashboard/ai-sales?meetingId=…
  useEffect(() => {
    if (meetingIdFromUrl) {
      setSelectedMeetingId(meetingIdFromUrl);
    }
  }, [meetingIdFromUrl]);

  const unwrapAiPayload = (res: { data?: unknown; success?: boolean }) => {
    const d = res.data;
    if (
      d &&
      typeof d === "object" &&
      "data" in (d as object) &&
      (d as { data?: unknown }).data != null
    ) {
      return (d as { data: unknown }).data;
    }
    return d ?? res;
  };

  const runAi = async (endpoint: string, body: Record<string, unknown>, setter: (v: unknown) => void, label: string) => {
    if (!token) return;
    setIsGenerating(true);
    try {
      const res = await api.post(`/crm/ai/${endpoint}`, body, token);
      if (res.success) {
        setter(unwrapAiPayload(res));
        toast.success(`${label} generated`);
      } else {
        toast.error(res.error || "AI generation failed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI call failed";
      toast.error(msg.includes("Network") ? "Network error — is the API running on port 4000?" : msg);
    }
    setIsGenerating(false);
  };

  const generateReminders = async () => {
    if (!token) return;
    if (!selectedContactId && !selectedDealId && !selectedMeetingId) {
      toast.error("Select a lead/client, deal, or meeting first");
      return;
    }
    setRemindersLoading(true);
    setReminders([]);
    setIsGenerating(true);
    try {
      const res = await api.post(
        "/crm/ai/reminders",
        {
          contactId: selectedContactId || undefined,
          dealId: selectedDealId || undefined,
          meetingId: selectedMeetingId || undefined,
        },
        token
      );
      if (res.success) {
        const payload = unwrapAiPayload(res) as {
          reminders?: AiReminderItem[];
        };
        const list = Array.isArray(payload?.reminders)
          ? payload.reminders
          : Array.isArray((res.data as { reminders?: AiReminderItem[] })?.reminders)
            ? (res.data as { reminders: AiReminderItem[] }).reminders
            : [];
        setReminders(list);
        toast.success(
          list.length
            ? `${list.length} reminder suggestion${list.length === 1 ? "" : "s"} ready`
            : "No reminders returned — try again"
        );
      } else {
        toast.error(res.error || "Failed to generate reminders");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate reminders";
      toast.error(msg);
    }
    setRemindersLoading(false);
    setIsGenerating(false);
  };

  const createTaskFromReminder = async (rem: AiReminderItem) => {
    if (!token) return;
    setCreatingReminderId(rem.id);
    try {
      const res = await api.createCrmTask(
        {
          title: rem.title,
          description: [
            rem.description,
            `Type: ${rem.type}`,
            rem.meetingId ? `From meeting ${rem.meetingId}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
          dueDate: rem.dueAt,
          status: "todo",
          priority: rem.priority,
          contactId: rem.contactId || selectedContactId || null,
          dealId: rem.dealId || selectedDealId || null,
        },
        token
      );
      if (res.success) {
        const task =
          (res.data as { task?: { id?: string } })?.task ||
          (res.data as { id?: string }) ||
          {};
        const taskId = (task as { id?: string }).id;
        setReminders((prev) =>
          prev.map((r) =>
            r.id === rem.id ? { ...r, createdTaskId: taskId || "created" } : r
          )
        );
        toast.success("Task created in CRM");
        try {
          const { emitDataChanged } = await import("@/lib/data-events");
          emitDataChanged({ module: "task", action: "create" });
        } catch {
          /* ignore */
        }
      } else {
        toast.error(res.error || "Could not create task");
      }
    } catch {
      toast.error("Could not create task");
    }
    setCreatingReminderId(null);
  };

  /** Create a follow-up task from an AI text suggestion (user-confirmed). */
  const createFollowUpFromSuggestion = async (suggestion: string) => {
    if (!token || !selectedContactId) {
      toast.error("Select a lead/contact first");
      return;
    }
    const lead = leads.find((l) => l.id === selectedContactId);
    const due = new Date();
    due.setDate(due.getDate() + 1);
    const title =
      suggestion.length > 80
        ? `Follow up: ${lead?.name || "contact"}`
        : suggestion;
    const res = await api.createCrmTask(
      {
        contactId: selectedContactId,
        title,
        description: [
          suggestion,
          lead?.name ? `Lead: ${lead.name}` : null,
          lead?.phone ? `Phone: ${lead.phone}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        dueDate: due.toISOString(),
        status: "todo",
        priority: "medium",
      },
      token
    );
    if (res.success) {
      toast.success("Follow-up task created");
      try {
        const { emitDataChanged } = await import("@/lib/data-events");
        emitDataChanged({ module: "task", action: "create" });
      } catch {
        /* ignore */
      }
    } else {
      toast.error(res.error || "Could not create follow-up task");
    }
  };

  /** Create a task from Next Best Action recommendation. */
  const createTaskFromNextAction = async () => {
    if (!token) return;
    const n = nextActionResult as Record<string, unknown> | null;
    if (!n) return;
    if (!selectedContactId && !selectedDealId) {
      toast.error("Select a contact or deal first");
      return;
    }
    const action = String(n.action || "Next best action");
    const reason = String(n.reason || "");
    const priorityRaw = String(n.priority || "medium").toLowerCase();
    const priority = ["low", "medium", "high"].includes(priorityRaw)
      ? priorityRaw
      : "medium";
    const due = new Date();
    due.setDate(due.getDate() + 1);
    const res = await api.createCrmTask(
      {
        contactId: selectedContactId || null,
        dealId: selectedDealId || null,
        title: action.length > 120 ? action.slice(0, 117) + "…" : action,
        description: [reason, n.timing ? `Timing: ${String(n.timing)}` : null]
          .filter(Boolean)
          .join("\n"),
        dueDate: due.toISOString(),
        status: "todo",
        priority,
      },
      token
    );
    if (res.success) {
      toast.success("Task created from recommendation");
      try {
        const { emitDataChanged } = await import("@/lib/data-events");
        emitDataChanged({ module: "task", action: "create" });
      } catch {
        /* ignore */
      }
    } else {
      toast.error(res.error || "Could not create task");
    }
  };

  const addReminderToCalendar = (rem: AiReminderItem) => {
    const start = new Date(rem.dueAt);
    if (Number.isNaN(start.getTime())) {
      toast.error("Invalid due date on reminder");
      return;
    }
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const fmt = (d: Date) =>
      d
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
    const details = [
      rem.description,
      `Priority: ${rem.priority}`,
      `Type: ${rem.type}`,
      rem.assignedUserEmail ? `Assigned: ${rem.assignedUserEmail}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const url =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      `&text=${encodeURIComponent(rem.title)}` +
      `&dates=${fmt(start)}/${fmt(end)}` +
      `&details=${encodeURIComponent(details)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    toast.success("Opening calendar…");
  };

  /** Meeting summary with progressive loading messages (5–10s feels intentional) */
  const generateMeetingSummary = async () => {
    if (!token) return;
    if (!selectedMeetingId) {
      toast.error("Select a meeting first");
      return;
    }

    const steps = [
      "🤖 Analyzing meeting...",
      "Generating executive summary...",
      "Creating action items...",
    ];
    setMeetingSummaryResult(null);
    setIsGenerating(true);
    setMeetingSummaryStatus(steps[0]);

    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setMeetingSummaryStatus(steps[1]), 1800));
    timers.push(setTimeout(() => setMeetingSummaryStatus(steps[2]), 4000));

    try {
      const res = await api.post(
        "/crm/ai/meeting-summary",
        { meetingId: selectedMeetingId },
        token
      );
      timers.forEach(clearTimeout);
      if (res.success) {
        setMeetingSummaryStatus(null);
        setMeetingSummaryResult(unwrapAiPayload(res));
        toast.success("AI Meeting Summary generated successfully.");
      } else {
        setMeetingSummaryStatus(null);
        toast.error(res.error || "AI generation failed");
      }
    } catch (err) {
      timers.forEach(clearTimeout);
      setMeetingSummaryStatus(null);
      const msg = err instanceof Error ? err.message : "AI call failed";
      toast.error(
        msg.includes("Network")
          ? "Network error — is the API running on port 4000?"
          : msg
      );
    }
    setIsGenerating(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  // WhatsApp specific helpers
  const loadWaHistory = async (contactId: string) => {
    if (!token || !contactId) return;
    setWaLoadingHistory(true);
    try {
      const res = await api.get(`/crm/ai/whatsapp/history?contactId=${contactId}`, token);
      if (res.success && res.data) {
        setWaHistory(
          (Array.isArray(res.data) ? res.data : []) as Array<{
            id?: string;
            content?: string;
            body?: string;
            createdAt?: string;
            tone?: string;
            language?: string;
          }>
        );
      }
    } catch {
      // silent
    }
    setWaLoadingHistory(false);
  };

  const generateWhatsApp = async () => {
    if (!token || !selectedContactId) return;
    setIsGenerating(true);
    setWaMessage("");
    try {
      const res = await api.post(
        `/crm/ai/whatsapp`,
        {
          contactId: selectedContactId,
          tone: waTone,
          language: waLanguage,
        },
        token
      );
      const data = res.data as { message?: string } | undefined;
      if (res.success && data?.message) {
        const msg = data.message;
        setWaMessage(msg);
        toast.success("WhatsApp message generated");
        // Reload history
        await loadWaHistory(selectedContactId);
      } else {
        toast.error(res.error || "Failed to generate WhatsApp message");
      }
    } catch {
      toast.error("Massive Mentor AI could not generate that message. Please try again.");
    }
    setIsGenerating(false);
  };

  const openInWhatsApp = (message: string) => {
    if (!selectedContactPhone) {
      toast.error("No phone number available for this lead");
      return;
    }
    const phone = selectedContactPhone.replace(/[^0-9]/g, "");
    if (!phone) {
      toast.error("Invalid phone number");
      return;
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  };

  const copyWaMessage = (msg: string) => {
    copyToClipboard(msg);
  };

  // Load phone + history when contact changes
  useEffect(() => {
    if (!selectedContactId) {
      setSelectedContactPhone(null);
      setWaMessage("");
      setWaHistory([]);
      return;
    }

    // Try to find phone from loaded leads
    const lead = leads.find((l) => l.id === selectedContactId);
    if (lead?.phone) {
      setSelectedContactPhone(lead.phone);
    } else {
      // fallback: fetch full contact
      (async () => {
        if (!token) return;
        const detail = await api.getCrmContact(selectedContactId, token);
        const payload = detail.data as { contact?: Contact; phone?: string } | Contact | null;
        const c =
          payload && typeof payload === "object" && "contact" in payload
            ? payload.contact
            : (payload as Contact | null);
        if (c?.phone) setSelectedContactPhone(c.phone);
      })();
    }

    loadWaHistory(selectedContactId);
    setWaMessage("");
  }, [selectedContactId, leads, token]);

  return (
    <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">AI Sales Intelligence</h1>
        <p className="text-muted-foreground mt-2">AI-powered tools for your CRM, powered by Massive Mentor AI.</p>
      </div>

      {/* CRM Dashboard KPIs */}
      <div className="mb-10">
        <h2 className="text-xl font-semibold mb-4 tracking-tight">CRM Dashboard</h2>
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(7)].map((_, i) => <div key={i} className="h-24 bg-card border border-border rounded-2xl animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            <KpiCard label="Total Leads" value={kpis.totalLeads} />
            <KpiCard label="Clients" value={kpis.totalClients} />
            <KpiCard label="Pipeline Value" value={money(kpis.pipelineValue)} />
            <KpiCard label="Total Deals Value" value={money(kpis.totalDealsValue)} />
            <KpiCard label="Conversion Rate" value={`${kpis.conversionRate}%`} />
            <KpiCard label="Tasks Due" value={kpis.tasksDue} />
            <KpiCard label="Meetings Today" value={kpis.meetingsToday} />
          </div>
        )}
      </div>

      {/* AI Tools */}
      <div className="space-y-8">
        {/* Lead Scoring */}
        <div className="bg-card border border-border rounded-2xl p-6">
          <h3 className="font-semibold mb-4">AI Lead Scoring (0-100)</h3>
          <div className="flex flex-col md:flex-row gap-3 mb-4">
            <select
              value={selectedContactId}
              onChange={(e) => setSelectedContactId(e.target.value)}
              className="flex-1 min-w-[160px] bg-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:border-border"
              title="Select a lead"
            >
              <option value="">Select a Lead</option>
              {leads.map(l => {
                const full = `${l.name}${l.company ? ` (${l.company})` : ''}`;
                return <option key={l.id} value={l.id} title={full}>{full.length > 45 ? full.slice(0,42) + '...' : full}</option>;
              })}
            </select>
            <button
              onClick={() => runAi("lead-score", { contactId: selectedContactId }, setLeadScoreResult, "Lead Score")}
              disabled={!selectedContactId || isGenerating}
              className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium disabled:opacity-50"
            >
              Score Lead
            </button>
          </div>
          {!!leadScoreResult && (
            <div className="mt-3 p-4 bg-background border border-border rounded-xl">
              <div className="text-3xl font-bold tabular-nums text-emerald-400">{(leadScoreResult as {score?: number}).score}</div>
              <p className="text-sm text-muted-foreground mt-1">{(leadScoreResult as {explanation?: string}).explanation}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => {
                    const ls = leadScoreResult as {score?: number, explanation?: string};
                    copyToClipboard(`${ls.score}: ${ls.explanation}`);
                  }}
                  className="text-xs px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg border border-white/10"
                >
                  Copy
                </button>
                {selectedContactId ? (
                  <button
                    type="button"
                    onClick={() => {
                      const ls = leadScoreResult as { score?: number; explanation?: string };
                      void createFollowUpFromSuggestion(
                        `Follow up on scored lead (${ls.score ?? "—"}/100): ${ls.explanation || "AI lead score follow-up"}`
                      );
                    }}
                    className="text-xs px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 rounded-lg border border-emerald-500/30"
                  >
                    Create Follow-up Task
                  </button>
                ) : null}
                {selectedContactPhone ? (
                  <button
                    type="button"
                    onClick={() => {
                      document
                        .getElementById("ai-whatsapp-generator")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className="text-xs px-3 py-1.5 bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 rounded-lg border border-sky-500/30"
                  >
                    Draft WhatsApp
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* Follow-up Suggestions (kept compact) */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-card border border-border rounded-2xl p-6">
            <h3 className="font-semibold mb-4">AI Follow-up Suggestions</h3>
            <div className="flex gap-3 mb-4">
              <select 
                value={selectedContactId} 
                onChange={e=>setSelectedContactId(e.target.value)} 
                className="flex-1 min-w-[140px] bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-border"
                title="Select Lead/Client"
              >
                <option value="">Select Lead/Client</option>
                {leads.map(l => {
                  const full = l.name + (l.company ? ` (${l.company})` : '');
                  return <option key={l.id} value={l.id} title={full}>{full.length > 40 ? full.slice(0,37)+'...' : full}</option>;
                })}
              </select>
              <button onClick={() => runAi("follow-up", { contactId: selectedContactId }, setFollowUpResult, "Suggestions")} disabled={!selectedContactId || isGenerating} className="px-5 bg-white/10 rounded-xl text-sm">Generate</button>
            </div>
            {followUpResult && (followUpResult as Record<string, unknown>).suggestions ? (
              <ul className="text-sm space-y-2 text-muted-foreground">
                {((followUpResult as Record<string, unknown>).suggestions as string[]).map(
                  (s: string, i: number) => (
                    <li
                      key={i}
                      className="flex flex-col sm:flex-row sm:items-start gap-2 rounded-xl border border-border/60 bg-background/50 px-3 py-2"
                    >
                      <span className="flex-1 text-foreground">• {s}</span>
                      <button
                        type="button"
                        onClick={() => void createFollowUpFromSuggestion(s)}
                        disabled={!selectedContactId}
                        className="shrink-0 text-xs px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 rounded-lg border border-emerald-500/30 disabled:opacity-50"
                      >
                        Create Task
                      </button>
                    </li>
                  )
                )}
              </ul>
            ) : null}
          </div>
        </div>

        {/* Production Quality AI WhatsApp Generator (Feature 2) */}
        <div id="ai-whatsapp-generator" className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">AI WhatsApp Generator</h3>
              {selectedContactPhone && (
                <span className="text-xs text-emerald-400">Phone ready for WhatsApp</span>
              )}
            </div>

            {/* Contact + Controls */}
            <div className="flex flex-col md:flex-row gap-3 mb-4">
              <select
                value={selectedContactId}
                onChange={(e) => setSelectedContactId(e.target.value)}
                className="flex-1 min-w-[160px] bg-background border border-border rounded-xl px-4 py-2.5 text-foreground text-sm focus:outline-none focus:border-border"
                title="Select Lead / Contact"
              >
                <option value="">Select Lead / Contact</option>
                {leads.map((l) => {
                  const full = `${l.name}${l.company ? ` (${l.company})` : ''}`;
                  return (
                    <option key={l.id} value={l.id} title={full}>
                      {full.length > 45 ? full.slice(0,42) + '...' : full}
                    </option>
                  );
                })}
              </select>

              {/* Tone Selector */}
              <div className="flex rounded-xl overflow-hidden border border-border">
                {(["Professional", "Friendly", "Sales"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setWaTone(t)}
                    disabled={isGenerating}
                    className={`px-4 py-2 text-sm transition-colors ${
                      waTone === t
                        ? "bg-primary text-primary-foreground font-medium"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Reusable Language Selector */}
              <LanguageSelector
                value={waLanguage}
                onChange={setWaLanguage}
                disabled={isGenerating}
                className="min-w-[180px]"
              />

              <button
                onClick={generateWhatsApp}
                disabled={!selectedContactId || isGenerating}
                className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium disabled:opacity-50 hover:bg-primary-hover"
              >
                {isGenerating ? "Generating..." : "Generate Message"}
              </button>
            </div>

            {/* Generated Message Display */}
            {waMessage && (
              <div className="mt-4 p-4 bg-background border border-border rounded-xl">
                <div className="flex items-center justify-between mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                  <span>
                    {waTone} • {getLanguageLabel(waLanguage)}
                  </span>
                  <span>Ready to send</span>
                </div>
                <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed mb-4 p-3 bg-card rounded-lg border border-border">
                  {waMessage}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => copyWaMessage(waMessage)}
                    className="px-4 py-1.5 text-sm bg-white/10 hover:bg-white/20 rounded-lg border border-white/20"
                  >
                    📋 Copy
                  </button>
                  <button
                    onClick={() => openInWhatsApp(waMessage)}
                    className="px-4 py-1.5 text-sm bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg border border-emerald-500/30"
                  >
                    💬 Open in WhatsApp
                  </button>
                </div>
              </div>
            )}

            {/* History for selected lead */}
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium text-muted-foreground">Previous Messages for this Lead</div>
                {waLoadingHistory && <div className="text-xs text-muted-foreground">Loading...</div>}
              </div>
              {waHistory.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">No saved messages yet for this lead.</div>
              ) : (
                <div className="space-y-3 max-h-72 overflow-auto pr-1">
                  {waHistory.map((item, idx) => (
                    <div key={idx} className="p-3 bg-background border border-border rounded-xl text-sm">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
                        <span>
                          {item.createdAt
                            ? new Date(item.createdAt).toLocaleString()
                            : "—"}{" "}
                          • {item.tone || "—"} • {getLanguageLabel(item.language || "auto")}
                        </span>
                      </div>
                      <div className="text-foreground whitespace-pre-wrap text-sm mb-2 leading-snug">
                        {item.content || item.body || ""}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => copyWaMessage(String(item.content || item.body || ""))}
                          className="text-xs px-3 py-0.5 bg-white/5 hover:bg-white/10 rounded border border-white/10"
                        >
                          Copy
                        </button>
                        <button
                          onClick={() => openInWhatsApp(String(item.content || item.body || ""))}
                          className="text-xs px-3 py-0.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded border border-emerald-500/20"
                        >
                          Open WhatsApp
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground">Messages are automatically saved with tone + language. Generation uses AI for natural fluency in the chosen language.</p>
          </div>

        {/* Proposal, Forecast, Next Best Action */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-card border border-border rounded-2xl p-6">
            <h3 className="font-semibold mb-4">AI Proposal Generator</h3>
            <select 
              value={selectedDealId} 
              onChange={e=>setSelectedDealId(e.target.value)} 
              className="w-full mb-3 bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-border"
              title="Select a deal"
            >
              <option value="">Select Deal</option>
              {deals.map(d => {
                const full = `${d.title} (${d.stage})`;
                return <option key={d.id} value={d.id} title={full}>{full.length > 45 ? full.slice(0,42) + '...' : full}</option>;
              })}
            </select>
            <button onClick={() => runAi("proposal", { dealId: selectedDealId }, setProposalResult, "Proposal")} disabled={!selectedDealId || isGenerating} className="w-full py-2 bg-white/10 rounded-xl text-sm mb-3">Generate Proposal</button>
            {!!proposalResult ? (() => {
              const p = proposalResult as Record<string, unknown>;

              const formatText = (val: unknown): string => {
                if (val == null) return '';
                if (Array.isArray(val)) return val.map(v => `• ${String(v)}`).join('\n');
                if (typeof val === 'object') {
                  return Object.entries(val as Record<string, unknown>)
                    .map(([k, v]) => `${k}: ${formatText(v)}`)
                    .join('\n');
                }
                return String(val);
              };

              const renderList = (items: unknown, title: string) => {
                if (!items) return null;
                const arr = Array.isArray(items) ? items : [items];
                if (arr.length === 0) return null;
                return (
                  <div className="mt-1">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">{title}</div>
                    <ul className="list-disc pl-4 text-sm text-foreground space-y-0.5">
                      {arr.map((item, i) => <li key={i}>{String(item)}</li>)}
                    </ul>
                  </div>
                );
              };

              const renderObjectAsCard = (obj: unknown, title: string) => {
                if (!obj || typeof obj !== 'object') return null;
                const entries = Object.entries(obj as Record<string, unknown>);
                if (entries.length === 0) return null;
                return (
                  <div className="mt-1 bg-card border border-border rounded p-2 text-xs">
                    <div className="text-muted-foreground uppercase tracking-wider mb-1">{title}</div>
                    {entries.map(([k, v]) => (
                      <div key={k} className="flex gap-2 mb-0.5">
                        <span className="text-muted-foreground min-w-[80px]">{k}:</span>
                        <span className="text-foreground">{formatText(v)}</span>
                      </div>
                    ))}
                  </div>
                );
              };

              const renderSolution = (sol: unknown) => {
                if (!sol) return null;
                if (typeof sol === 'string') {
                  return <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{sol}</p>;
                }
                if (typeof sol === 'object' && sol !== null) {
                  const s = sol as Record<string, unknown>;
                  return (
                    <div className="mt-1 space-y-2 text-sm">
                      {s.description ? (
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider">Description</div>
                          <p className="text-foreground whitespace-pre-wrap">{String(s.description)}</p>
                        </div>
                      ) : null}
                      {renderList(s.keyFeatures, 'Key Features')}
                      {renderList(s.deliverables, 'Deliverables')}
                      {renderList(s.benefits, 'Benefits')}
                      {/* fallback for other keys */}
                      {Object.keys(s).filter(k => !['description','keyFeatures','deliverables','benefits'].includes(k)).length > 0 ? (
                        renderObjectAsCard(s, 'Additional Solution Details')
                      ) : null}
                    </div>
                  );
                }
                return <p className="mt-1 text-sm text-foreground">{String(sol)}</p>;
              };

              const renderPricing = (pr: unknown) => {
                if (!pr) return null;
                if (typeof pr === 'string') {
                  return <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{pr}</p>;
                }
                if (typeof pr === 'object' && pr !== null) {
                  const pObj = pr as Record<string, unknown>;
                  return (
                    <div className="mt-1 space-y-2 text-sm">
                      {pObj.totalPrice ? (
                        <div>
                          <span className="text-xs text-muted-foreground uppercase tracking-wider">Total Price: </span>
                          <span className="font-medium text-emerald-400">{String(pObj.totalPrice)}</span>
                        </div>
                      ) : null}
                      {pObj.breakdown ? (
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Breakdown</div>
                          {Array.isArray(pObj.breakdown) ? (
                            <div className="space-y-1">
                              {pObj.breakdown.map((item: unknown, i: number) => {
                                if (typeof item === "object" && item) {
                                  const row = item as Record<string, unknown>;
                                  return (
                                    <div key={i} className="flex justify-between bg-card px-2 py-1 rounded text-xs border border-border">
                                      <span>
                                        {String(
                                          row.item || row.name || row.description || JSON.stringify(item)
                                        )}
                                      </span>
                                      <span className="font-mono">
                                        {String(row.cost || row.price || row.amount || "")}
                                      </span>
                                    </div>
                                  );
                                }
                                return <div key={i} className="text-xs">• {String(item)}</div>;
                              })}
                            </div>
                          ) : (
                            renderObjectAsCard(pObj.breakdown, 'Breakdown')
                          )}
                        </div>
                      ) : null}
                      {pObj.paymentTerms ? (
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider">Payment Terms</div>
                          <p className="text-foreground">{String(pObj.paymentTerms)}</p>
                        </div>
                      ) : null}
                      {pObj.validity ? (
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider">Validity</div>
                          <p className="text-foreground">{String(pObj.validity)}</p>
                        </div>
                      ) : null}
                      {/* other pricing fields as card */}
                      {Object.keys(pObj).filter(k => !['totalPrice','breakdown','paymentTerms','validity'].includes(k)).length > 0 && (
                        renderObjectAsCard(pObj, 'Additional Pricing Details')
                      )}
                    </div>
                  );
                }
                return <p className="mt-1 text-sm text-foreground">{String(pr)}</p>;
              };

              const renderGeneral = (val: unknown) => {
                if (val == null || val === '') return null;
                if (Array.isArray(val)) {
                  return <ul className="list-disc pl-4 mt-1 text-sm text-foreground space-y-0.5">{val.map((v,i) => <li key={i}>{String(v)}</li>)}</ul>;
                }
                if (typeof val === 'object') {
                  return renderObjectAsCard(val, 'Details');
                }
                return <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{String(val)}</p>;
              };

              const formatProposalText = (proposal: Record<string, unknown>) => {
                let text = '';
                if (proposal.title) text += `Title: ${proposal.title}\n\n`;
                if (proposal.executiveSummary) text += `Executive Summary:\n${proposal.executiveSummary}\n\n`;
                if (proposal.solution) {
                  text += `Solution:\n${formatText(proposal.solution)}\n\n`;
                }
                if (proposal.pricing) {
                  text += `Pricing:\n${formatText(proposal.pricing)}\n\n`;
                }
                if (proposal.timeline) text += `Timeline: ${proposal.timeline}\n\n`;
                if (proposal.nextSteps) text += `Next Steps: ${proposal.nextSteps}\n\n`;
                return text.trim();
              };

              return (
                <div className="text-sm text-muted-foreground bg-background p-4 rounded border border-border max-h-80 overflow-auto space-y-4">
                  {p.title ? (
                    <div>
                      <strong className="text-foreground text-xs uppercase tracking-wider">Title</strong>
                      {renderGeneral(p.title)}
                    </div>
                  ) : null}
                  {p.executiveSummary ? (
                    <div>
                      <strong className="text-foreground text-xs uppercase tracking-wider">Executive Summary</strong>
                      {renderGeneral(p.executiveSummary)}
                    </div>
                  ) : null}
                  {p.solution ? (
                    <div>
                      <strong className="text-foreground text-xs uppercase tracking-wider">Solution</strong>
                      {renderSolution(p.solution)}
                    </div>
                  ) : null}
                  {p.pricing ? (
                    <div>
                      <strong className="text-foreground text-xs uppercase tracking-wider">Pricing</strong>
                      {renderPricing(p.pricing)}
                    </div>
                  ) : null}
                  {p.timeline ? (
                    <div>
                      <strong className="text-foreground text-xs uppercase tracking-wider">Timeline</strong>
                      {renderGeneral(p.timeline)}
                    </div>
                  ) : null}
                  {p.nextSteps ? (
                    <div>
                      <strong className="text-foreground text-xs uppercase tracking-wider">Next Steps</strong>
                      {renderGeneral(p.nextSteps)}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                    <button
                      onClick={() => copyToClipboard(formatProposalText(p))}
                      className="text-xs px-3 py-1 bg-white/10 hover:bg-white/20 rounded border border-white/10"
                    >
                      📋 Copy Proposal
                    </button>
                    <button
                      onClick={() => {
                        const text = formatProposalText(p);
                        const blob = new Blob([text], { type: 'application/pdf' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'proposal.pdf';
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="text-xs px-3 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded border border-emerald-500/20"
                    >
                      📄 Download PDF
                    </button>
                    <button
                      onClick={() => {
                        const text = formatProposalText(p);
                        const blob = new Blob([text], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'proposal.docx';
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="text-xs px-3 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded border border-blue-500/20"
                    >
                      📝 Download DOCX
                    </button>
                  </div>
                </div>
              );
            })() : null}
          </div>

          <div className="bg-card border border-border rounded-2xl p-6">
            <h3 className="font-semibold mb-4">AI Sales Forecast</h3>
            <button onClick={() => runAi("forecast", {}, setForecastResult, "Forecast")} disabled={isGenerating} className="w-full py-2 bg-white/10 rounded-xl text-sm mb-3">Generate Forecast</button>
            {!!forecastResult ? (() => {
              const f = forecastResult as Record<string, unknown>;
              const revenue = f.forecastRevenue as number | undefined;
              const winRate = f.winRate as number | undefined;
              const insights = (f.insights as string[] | undefined) || [];
              return (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-background border border-border rounded-xl p-3">
                      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Expected Revenue</div>
                      <div className="text-lg font-semibold text-emerald-400 tabular-nums">{money(revenue)}</div>
                    </div>
                    <div className="bg-background border border-border rounded-xl p-3">
                      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">Win Rate</div>
                      <div className="text-lg font-semibold text-foreground tabular-nums">{winRate != null ? `${winRate}%` : '—'}</div>
                    </div>
                  </div>
                  {insights.length > 0 && (
                    <div className="bg-background border border-border rounded-xl p-3">
                      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Insights</div>
                      <ul className="text-sm text-foreground space-y-1 list-disc list-inside">
                        {insights.map((ins: string, i: number) => <li key={i}>{ins}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })() : null}
          </div>

          <div className="bg-card border border-border rounded-2xl p-6">
            <h3 className="font-semibold mb-4">AI Next Best Action</h3>
            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <select 
                value={selectedContactId} 
                onChange={e=>setSelectedContactId(e.target.value)} 
                className="flex-1 min-w-[140px] bg-background border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-border"
                title="Select contact"
              >
                <option value="">Contact</option>
                {leads.map(l => {
                  const full = l.name + (l.company ? ` (${l.company})` : '');
                  return <option key={l.id} value={l.id} title={full}>{full.length > 40 ? full.slice(0,37)+'...' : full}</option>;
                })}
              </select>
              <select 
                value={selectedDealId} 
                onChange={e=>setSelectedDealId(e.target.value)} 
                className="flex-1 min-w-[140px] bg-background border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-border"
                title="Select deal"
              >
                <option value="">Deal</option>
                {deals.map(d => {
                  const full = `${d.title} (${d.stage})`;
                  return <option key={d.id} value={d.id} title={full}>{full.length > 40 ? full.slice(0,37)+'...' : full}</option>;
                })}
              </select>
            </div>
            <button onClick={() => {
              if (selectedContactId) runAi("next-action", { entityType: "contact", entityId: selectedContactId }, setNextActionResult, "Action");
              else if (selectedDealId) runAi("next-action", { entityType: "deal", entityId: selectedDealId }, setNextActionResult, "Action");
            }} disabled={isGenerating} className="w-full py-2 bg-white/10 rounded-xl text-sm">Get Next Best Action</button>
            {!!nextActionResult ? (() => {
              const n = nextActionResult as Record<string, unknown>;
              return (
                <div className="mt-2 bg-background border border-border rounded-xl p-4 space-y-2">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground mb-0.5">Recommended Action</div>
                    <div className="text-foreground font-medium">{String(n.action || '—')}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground mb-0.5">Reason</div>
                    <div className="text-sm text-foreground">{String(n.reason || '—')}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground mb-0.5">Priority</div>
                    <div className="text-sm text-emerald-400">{String(n.priority || '—')}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground mb-0.5">Timing</div>
                    <div className="text-sm text-emerald-400">{String(n.timing || '—')}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                    <button
                      type="button"
                      onClick={() => void createTaskFromNextAction()}
                      disabled={!selectedContactId && !selectedDealId}
                      className="text-xs px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 rounded-lg border border-emerald-500/30 disabled:opacity-50"
                    >
                      Create Task
                    </button>
                    {selectedContactId ? (
                      <a
                        href="/dashboard/leads"
                        className="text-xs px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg border border-white/10"
                      >
                        Open Leads
                      </a>
                    ) : null}
                    {selectedContactPhone ? (
                      <button
                        type="button"
                        onClick={() => {
                          document
                            .getElementById("ai-whatsapp-generator")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                        className="text-xs px-3 py-1.5 bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 rounded-lg border border-sky-500/30"
                      >
                        Draft WhatsApp
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })() : null}
          </div>
        </div>

        {/* Meeting Summary + Reminders */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-card border border-border rounded-2xl p-6">
            <h3 className="font-semibold mb-1">AI Meeting Summary</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Pick a meeting by title — no internal IDs. AI reads notes, discussion, and outcome.
            </p>

            <label className="block text-xs text-muted-foreground mb-1.5">Search meetings</label>
            <input
              type="search"
              value={meetingSearch}
              onChange={(e) => setMeetingSearch(e.target.value)}
              placeholder="Search by title, client, date…"
              className="w-full mb-3 bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground min-h-11"
            />

            <label className="block text-xs text-muted-foreground mb-1.5">Meeting</label>
            <select
              value={selectedMeetingId}
              onChange={(e) => {
                setSelectedMeetingId(e.target.value);
                setMeetingSummaryResult(null);
                setMeetingSummaryStatus(null);
              }}
              className="w-full mb-3 bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-foreground min-h-11"
              aria-label="Select meeting to summarize"
            >
              <option value="">Select a meeting…</option>
              {meetings
                .filter((m) => {
                  const q = meetingSearch.trim().toLowerCase();
                  if (!q) return true;
                  const when = m.scheduledAt
                    ? new Date(m.scheduledAt).toLocaleString()
                    : "";
                  const contact = m.contact?.name || "";
                  const company = m.contact?.company || "";
                  return (
                    m.title.toLowerCase().includes(q) ||
                    contact.toLowerCase().includes(q) ||
                    company.toLowerCase().includes(q) ||
                    when.toLowerCase().includes(q)
                  );
                })
                .map((m) => {
                  const when = m.scheduledAt
                    ? new Date(m.scheduledAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "No date";
                  const who =
                    m.contact?.name ||
                    m.deal?.title ||
                    "No client linked";
                  const label = `${m.title} · ${when} · ${who}`;
                  return (
                    <option key={m.id} value={m.id} title={label}>
                      {label.length > 80 ? `${label.slice(0, 77)}…` : label}
                    </option>
                  );
                })}
            </select>

            {selectedMeetingId && (() => {
              const m = meetings.find((x) => x.id === selectedMeetingId);
              if (!m) return null;
              return (
                <div className="mb-3 rounded-xl border border-border bg-background/80 p-3 text-xs text-muted-foreground space-y-1">
                  <div className="text-sm text-foreground font-medium">{m.title}</div>
                  <div>
                    {m.scheduledAt
                      ? new Date(m.scheduledAt).toLocaleString()
                      : "—"}
                    {m.durationMin ? ` · ${m.durationMin} min` : ""}
                  </div>
                  <div>
                    Client/Lead:{" "}
                    <span className="text-foreground">
                      {m.contact?.name || "Not linked"}
                      {m.contact?.company ? ` (${m.contact.company})` : ""}
                    </span>
                  </div>
                  {(m.notes || m.outcome) && (
                    <div className="pt-1 border-t border-border mt-1 space-y-0.5">
                      {m.notes ? (
                        <p className="line-clamp-2">
                          Notes: <span className="text-muted-foreground">{m.notes}</span>
                        </p>
                      ) : null}
                      {m.outcome ? (
                        <p>
                          Outcome: <span className="text-muted-foreground">{m.outcome}</span>
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })()}

            <button
              type="button"
              onClick={() => void generateMeetingSummary()}
              disabled={isGenerating || !selectedMeetingId}
              className="w-full min-h-11 py-2.5 bg-primary text-primary-foreground font-medium rounded-xl text-sm disabled:opacity-50"
              aria-busy={!!meetingSummaryStatus}
            >
              {meetingSummaryStatus ? "Working…" : "Generate AI Summary"}
            </button>

            {meetingSummaryStatus && (
              <div
                className="mt-4 rounded-xl border border-violet-500/30 bg-violet-950/40 px-4 py-3 space-y-2"
                role="status"
                aria-live="polite"
                data-testid="meeting-summary-loading"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="inline-block h-5 w-5 shrink-0 rounded-full border-2 border-violet-400/30 border-t-violet-300 animate-spin"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-violet-100">
                      {meetingSummaryStatus}
                    </p>
                    <p className="text-[11px] text-violet-300/70 mt-0.5">
                      This usually takes a few seconds — keep this tab open.
                    </p>
                  </div>
                </div>
                <div className="h-1 w-full rounded-full bg-violet-950 overflow-hidden">
                  <div className="h-full w-1/3 rounded-full bg-violet-400/80 animate-pulse" />
                </div>
              </div>
            )}

            {!!meetingSummaryResult && !meetingSummaryStatus && (() => {
              const s = meetingSummaryResult as Record<string, unknown>;
              const exec =
                (typeof s.executiveSummary === "string" && s.executiveSummary) ||
                (typeof s.summary === "string" && s.summary) ||
                "";
              const points = (Array.isArray(s.keyDiscussionPoints)
                ? s.keyDiscussionPoints
                : Array.isArray(s.keyPoints)
                  ? s.keyPoints
                  : []) as string[];
              const actions = (Array.isArray(s.actionItems) ? s.actionItems : []) as string[];
              const followUps = (Array.isArray(s.followUpTasks) ? s.followUpTasks : []) as string[];
              const next =
                typeof s.nextMeetingRecommendation === "string"
                  ? s.nextMeetingRecommendation
                  : s.nextMeetingRecommendation == null
                    ? ""
                    : String(s.nextMeetingRecommendation || "");

              const copyAll = () => {
                const text = [
                  "Executive Summary",
                  exec,
                  "",
                  "Key Discussion Points",
                  ...points.map((p) => `• ${p}`),
                  "",
                  "Action Items",
                  ...actions.map((p) => `• ${p}`),
                  "",
                  "Follow-up Tasks",
                  ...followUps.map((p) => `• ${p}`),
                  "",
                  "Next Meeting",
                  next || "—",
                ].join("\n");
                copyToClipboard(text);
              };

              return (
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={copyAll}
                      className="text-xs text-emerald-400 hover:text-emerald-300 underline"
                    >
                      Copy all
                    </button>
                  </div>
                  <div className="rounded-xl border border-border bg-background p-3">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                      Executive Summary
                    </div>
                    <p className="text-foreground leading-relaxed">{exec || "—"}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-background p-3">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                      Key Discussion Points
                    </div>
                    {points.length ? (
                      <ul className="space-y-1 text-foreground">
                        {points.map((p, i) => (
                          <li key={i}>• {String(p)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">—</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-border bg-background p-3">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                      Action Items
                    </div>
                    {actions.length ? (
                      <ul className="space-y-1 text-foreground">
                        {actions.map((p, i) => (
                          <li key={i}>• {String(p)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">—</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-border bg-background p-3">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                      Follow-up Tasks
                    </div>
                    {followUps.length ? (
                      <ul className="space-y-1 text-foreground">
                        {followUps.map((p, i) => (
                          <li key={i}>• {String(p)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">—</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-border bg-background p-3">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                      Next Meeting Recommendation
                    </div>
                    <p className="text-foreground">{next || "—"}</p>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="bg-card border border-border rounded-2xl p-6">
            <h3 className="font-semibold mb-1">AI Reminder Suggestions</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Built from the selected lead/client, deal, and/or meeting — dates are relative to
              today (or the meeting date), not demo years.
            </p>
            <div className="flex flex-wrap gap-2 mb-3 text-[11px] text-muted-foreground">
              {selectedContactId && (
                <span className="px-2 py-1 rounded-lg bg-background border border-border text-muted-foreground">
                  Contact selected
                </span>
              )}
              {selectedDealId && (
                <span className="px-2 py-1 rounded-lg bg-background border border-border text-muted-foreground">
                  Deal selected
                </span>
              )}
              {selectedMeetingId && (
                <span className="px-2 py-1 rounded-lg bg-background border border-border text-muted-foreground">
                  Meeting selected
                </span>
              )}
              {!selectedContactId && !selectedDealId && !selectedMeetingId && (
                <span className="text-amber-400/90">
                  Select a contact, deal, or meeting above
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void generateReminders()}
              disabled={
                isGenerating ||
                remindersLoading ||
                (!selectedContactId && !selectedDealId && !selectedMeetingId)
              }
              className="w-full min-h-11 py-2.5 bg-white/10 rounded-xl text-sm disabled:opacity-50"
            >
              {remindersLoading ? "Generating reminders…" : "Get Reminders"}
            </button>

            {remindersLoading && (
              <div
                className="mt-4 rounded-xl border border-sky-500/30 bg-sky-950/30 px-4 py-3 flex items-center gap-3"
                role="status"
                aria-live="polite"
              >
                <span className="inline-block h-5 w-5 rounded-full border-2 border-sky-400/30 border-t-sky-300 animate-spin" />
                <p className="text-sm text-sky-100">
                  Analyzing CRM context and scheduling real follow-ups…
                </p>
              </div>
            )}

            {reminders.length > 0 && !remindersLoading && (
              <ul className="mt-4 space-y-3">
                {reminders.map((rem) => {
                  const due = new Date(rem.dueAt);
                  const dueLabel = Number.isNaN(due.getTime())
                    ? rem.dueAt
                    : due.toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      });
                  const priorityClass =
                    rem.priority === "high"
                      ? "bg-red-500/15 text-red-300 border-red-500/30"
                      : rem.priority === "low"
                        ? "bg-muted/40 text-muted-foreground border-border"
                        : "bg-amber-500/15 text-amber-200 border-amber-500/30";
                  const typeLabel =
                    rem.type === "follow_up"
                      ? "Follow-up"
                      : rem.type.charAt(0).toUpperCase() + rem.type.slice(1);
                  return (
                    <li
                      key={rem.id}
                      className="rounded-xl border border-border bg-background p-3 space-y-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">{rem.title}</div>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                            {rem.description}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${priorityClass}`}
                        >
                          {rem.priority}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>
                          Due: <span className="text-muted-foreground">{dueLabel}</span>
                        </span>
                        <span>
                          Type: <span className="text-muted-foreground">{typeLabel}</span>
                        </span>
                        <span>
                          Assigned:{" "}
                          <span className="text-muted-foreground">
                            {rem.assignedUserName || rem.assignedUserEmail}
                          </span>
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          disabled={
                            !!rem.createdTaskId || creatingReminderId === rem.id
                          }
                          onClick={() => void createTaskFromReminder(rem)}
                          className="min-h-9 px-3 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-50"
                        >
                          {rem.createdTaskId
                            ? "Task created ✓"
                            : creatingReminderId === rem.id
                              ? "Creating…"
                              : "Create Task"}
                        </button>
                        <button
                          type="button"
                          onClick={() => addReminderToCalendar(rem)}
                          className="min-h-9 px-3 rounded-lg text-xs font-medium bg-white/10 text-foreground border border-border hover:bg-white/15"
                        >
                          Add to Calendar
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-8">All AI outputs are generated by Massive Mentor AI. Results can be copied for use in proposals or CRM records.</p>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="text-xs text-muted-foreground mb-1 tracking-widest">{label.toUpperCase()}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default function AiSalesIntelligencePage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-muted-foreground text-sm">Loading AI Sales Intelligence…</div>
      }
    >
      <AiSalesIntelligencePageInner />
    </Suspense>
  );
}
