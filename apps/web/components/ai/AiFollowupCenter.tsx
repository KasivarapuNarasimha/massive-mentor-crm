"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useDataVersion, emitDataChanged } from "@/lib/data-events";

export type AiFollowupRec = {
  id: string;
  entityType: string;
  entityId: string;
  contactId?: string | null;
  dealId?: string | null;
  actionType: string;
  title: string;
  reason: string;
  priority: string;
  urgency: string;
  confidence?: number | null;
  rankScore: number;
  buttons?: string[];
  contact?: {
    id: string;
    name: string;
    company?: string | null;
    city?: string | null;
    phone?: string | null;
    email?: string | null;
    status?: string;
    aiScore?: number | null;
    type?: string;
    value?: number | null;
    description?: string | null;
  } | null;
};

type Props = {
  token: string | null | undefined;
  /** compact = dashboard list; summary = today's action counts */
  mode?: "center" | "summary" | "both";
  className?: string;
  limit?: number;
};

type ActionFilter = "all" | "call" | "whatsapp" | "email" | "meeting" | "proposal";

const URGENCY_DOT: Record<string, string> = {
  red: "text-red-400",
  yellow: "text-amber-400",
  green: "text-emerald-400",
};

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

const FILTERS: { key: ActionFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "call", label: "Calls" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "email", label: "Email" },
  { key: "meeting", label: "Meetings" },
  { key: "proposal", label: "Proposals" },
];

/** Map engine action types into filter buckets */
function matchesFilter(rec: AiFollowupRec, filter: ActionFilter): boolean {
  if (filter === "all") return true;
  const t = rec.actionType;
  if (filter === "call") {
    return t === "call" || t === "high_priority" || t === "overdue" || t === "close_opportunity";
  }
  if (filter === "meeting") return t === "meeting";
  if (filter === "proposal") return t === "proposal";
  if (filter === "whatsapp") return t === "whatsapp";
  if (filter === "email") return t === "email";
  return t === filter;
}

/** Action label without embedding long company/address strings */
function actionHeadline(rec: AiFollowupRec): string {
  const t = rec.title || "";
  // Strip trailing " for Name", " with Name", " — Name", ": Name", " to Name"
  const stripped = t
    .replace(/\s+[—–-]\s+.+$/, "")
    .replace(/\s+(for|with|to)\s+.+$/i, "")
    .replace(/:\s*.+$/, (m) => {
      // Keep short labels like "High priority:" content before colon only if long after
      if (m.length > 24) return "";
      return m;
    })
    .trim();
  // Prefer known short labels by action type
  switch (rec.actionType) {
    case "call":
      return stripped.startsWith("📞") || /call/i.test(stripped) ? stripped || "📞 Call today" : "📞 Call today";
    case "whatsapp":
      return "💬 Send WhatsApp follow-up";
    case "email":
      return "📧 Send follow-up email";
    case "proposal":
      return "📄 Proposal pending";
    case "meeting":
      return stripped.includes("today")
        ? "📅 Meeting today"
        : stripped.includes("tomorrow")
          ? "📅 Meeting tomorrow"
          : "📅 Schedule meeting";
    case "high_priority":
      return "🔥 High priority lead";
    case "overdue":
      return "⚠ Overdue follow-up";
    case "close_opportunity":
      return "⭐ Opportunity to close";
    case "wait":
      return "⏳ Wait before next touch";
    default:
      return stripped || rec.title;
  }
}

function leadName(rec: AiFollowupRec): string {
  return rec.contact?.name?.trim() || extractNameFromTitle(rec.title) || "Lead";
}

function extractNameFromTitle(title: string): string | null {
  // e.g. "📞 Call Jane Doe today" / "🔥 High priority: Jane Doe"
  const m =
    title.match(
      /(?:Call|WhatsApp|email to|email|meeting with|meeting tomorrow with|meeting today with|close:|priority:|pending for|follow-up:|yourself to|task\(s\) for)\s+(.+?)(?:\s+today|\s+\(new lead\)|$)/i
    ) || title.match(/[—–-]\s*(.+)$/);
  if (!m?.[1]) return null;
  return m[1].replace(/\s*\([^)]*\)\s*$/, "").trim() || null;
}

function companyName(rec: AiFollowupRec): string {
  return (rec.contact?.company || "").trim();
}

function cityName(rec: AiFollowupRec): string {
  return (rec.contact?.city || "").trim();
}

function fullLeadTooltip(rec: AiFollowupRec): string {
  const parts = [
    leadName(rec),
    companyName(rec) && `Company: ${companyName(rec)}`,
    cityName(rec) && `City: ${cityName(rec)}`,
    rec.contact?.phone && `Phone: ${rec.contact.phone}`,
    rec.contact?.email && `Email: ${rec.contact.email}`,
    rec.contact?.status && `Status: ${rec.contact.status}`,
    rec.reason,
  ].filter(Boolean);
  return parts.join("\n");
}

function openAction(
  action: string,
  rec: AiFollowupRec,
  router: ReturnType<typeof useRouter>
) {
  const phone = rec.contact?.phone?.replace(/\D/g, "") || "";
  const email = rec.contact?.email || "";
  const contactId = rec.contactId || (rec.entityType === "contact" ? rec.entityId : null);

  switch (action) {
    case "call":
      if (phone) window.open(`tel:${phone}`, "_self");
      else toast.message("No phone on file — open the lead to add one.");
      if (contactId) router.push(`/dashboard/leads?highlight=${contactId}`);
      break;
    case "whatsapp":
      if (phone) {
        const wa = phone.startsWith("91") ? phone : phone.length === 10 ? `91${phone}` : phone;
        window.open(`https://wa.me/${wa}`, "_blank");
      } else toast.message("No phone for WhatsApp.");
      if (contactId) router.push(`/dashboard/ai-sales?contactId=${contactId}&tool=whatsapp`);
      break;
    case "email":
      if (email) window.open(`mailto:${email}`, "_self");
      else toast.message("No email on file.");
      if (contactId) router.push(`/dashboard/ai-sales?contactId=${contactId}&tool=email`);
      break;
    case "proposal":
      if (rec.dealId) router.push(`/dashboard/deals?highlight=${rec.dealId}`);
      else if (contactId) router.push(`/dashboard/ai-sales?contactId=${contactId}&tool=proposal`);
      else router.push("/dashboard/deals");
      break;
    case "meeting":
      router.push(
        contactId ? `/dashboard/meetings?contactId=${contactId}` : "/dashboard/meetings"
      );
      break;
    default:
      if (contactId) router.push(`/dashboard/leads?highlight=${contactId}`);
  }
}

function RecCardBody({ rec }: { rec: AiFollowupRec }) {
  const name = leadName(rec);
  const company = companyName(rec);
  const city = cityName(rec);
  const metaLine = [company, city].filter(Boolean).join(" · ");
  const tooltip = fullLeadTooltip(rec);

  return (
    <div className="min-w-0" title={tooltip}>
      <div className="text-sm font-medium text-zinc-100 leading-snug line-clamp-2">
        {actionHeadline(rec)}
      </div>
      <div className="mt-1 min-w-0">
        <div className="text-sm font-semibold text-white truncate" title={name}>
          {name}
        </div>
        {metaLine ? (
          <div className="text-xs text-zinc-400 truncate mt-0.5" title={metaLine}>
            {metaLine}
          </div>
        ) : null}
      </div>
      <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed line-clamp-2" title={rec.reason}>
        {rec.reason}
      </p>
      {rec.confidence != null && (
        <p className="text-[10px] text-zinc-600 mt-1">
          Confidence {Math.round(rec.confidence * 100)}% ·{" "}
          <span className="capitalize">{rec.priority}</span> priority
        </p>
      )}
    </div>
  );
}

export function AiFollowupCenter({ token, mode = "both", className = "", limit = 12 }: Props) {
  const router = useRouter();
  const dataVersion = useDataVersion();
  const [items, setItems] = useState<AiFollowupRec[]>([]);
  const [summary, setSummary] = useState<{
    counts: Record<string, number>;
    buckets: Record<string, AiFollowupRec[]>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [filter, setFilter] = useState<ActionFilter>("all");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const jobs: Promise<void>[] = [];
      if (mode === "center" || mode === "both") {
        jobs.push(
          api
            .get<{ items: AiFollowupRec[] }>(`/crm/ai/followup-engine?limit=${Math.max(limit, 40)}`, token)
            .then((res) => {
              if (res.success && res.data) setItems(res.data.items || []);
            })
        );
      }
      if (mode === "summary" || mode === "both") {
        jobs.push(
          api
            .get<{ counts: Record<string, number>; buckets: Record<string, AiFollowupRec[]> }>(
              "/crm/ai/followup-engine/summary",
              token
            )
            .then((res) => {
              if (res.success && res.data) setSummary(res.data);
            })
        );
      }
      await Promise.all(jobs);
    } catch {
      /* network */
    }
    setLoading(false);
  }, [token, mode, limit]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const sortedFiltered = useMemo(() => {
    return [...items]
      .filter((r) => matchesFilter(r, filter))
      .sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 9;
        const pb = PRIORITY_ORDER[b.priority] ?? 9;
        if (pa !== pb) return pa - pb;
        return (b.rankScore || 0) - (a.rankScore || 0);
      })
      .slice(0, limit);
  }, [items, filter, limit]);

  const filterCounts = useMemo(() => {
    const counts: Record<ActionFilter, number> = {
      all: items.length,
      call: 0,
      whatsapp: 0,
      email: 0,
      meeting: 0,
      proposal: 0,
    };
    for (const r of items) {
      for (const f of FILTERS) {
        if (f.key !== "all" && matchesFilter(r, f.key)) counts[f.key]++;
      }
    }
    return counts;
  }, [items]);

  const act = async (rec: AiFollowupRec, actionTaken: string, open = true) => {
    if (!token) return;
    setActing(rec.id);
    if (open) openAction(actionTaken, rec, router);
    const res = await api.post(
      `/crm/ai/followup-engine/${rec.id}/act`,
      { actionTaken },
      token
    );
    if (res.success) {
      toast.success(
        actionTaken === "dismiss" ? "Recommendation dismissed" : "Action logged — AI will move on"
      );
      emitDataChanged({ module: "contact", action: "update" });
      await load();
    } else {
      toast.error(res.error || "Could not log action");
    }
    setActing(null);
  };

  const refresh = async () => {
    if (!token) return;
    setLoading(true);
    await api.post("/crm/ai/followup-engine/refresh", {}, token);
    await load();
    toast.message("AI Follow-up Engine refreshed from live CRM data");
  };

  const showSummary = mode === "summary" || mode === "both";
  const showCenter = mode === "center" || mode === "both";

  return (
    <div className={`space-y-4 ${className}`}>
      {showSummary && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-base font-semibold text-white">Today&apos;s AI Actions</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Counts from live CRM signals — click a bucket to jump to a lead
              </p>
            </div>
            <button
              type="button"
              onClick={refresh}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-zinc-300"
            >
              Refresh
            </button>
          </div>
          {loading && !summary ? (
            <div className="h-16 bg-zinc-800/50 animate-pulse rounded-xl" />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(
                [
                  ["call", "📞 Calls"],
                  ["whatsapp", "💬 WhatsApp"],
                  ["email", "📧 Emails"],
                  ["proposal", "📄 Proposals"],
                  ["meeting", "📅 Meetings"],
                ] as const
              ).map(([key, label]) => {
                const n = summary?.counts?.[key] ?? 0;
                const first = summary?.buckets?.[key]?.[0];
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!first}
                    onClick={() => {
                      setFilter(key as ActionFilter);
                      if (first) openAction(key, first, router);
                    }}
                    className="text-left bg-zinc-950 border border-zinc-800 rounded-xl p-3 hover:border-zinc-600 disabled:opacity-50 transition-colors"
                  >
                    <div className="text-xs text-zinc-500">{label}</div>
                    <div className="text-2xl font-semibold tabular-nums text-white mt-0.5">{n}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showCenter && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-white">🤖 AI Follow-up Center</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Sorted by priority · Lead name, company &amp; city only
              </p>
            </div>
            <button
              type="button"
              onClick={refresh}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-zinc-300 shrink-0"
            >
              Refresh
            </button>
          </div>

          {/* Action filters */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {FILTERS.map((f) => {
              const active = filter === f.key;
              const count = filterCounts[f.key];
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                    active
                      ? "bg-white text-zinc-950 border-white"
                      : "bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-zinc-200"
                  }`}
                >
                  {f.label}
                  <span className={`ml-1 tabular-nums ${active ? "text-zinc-600" : "text-zinc-600"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {loading && !items.length ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-zinc-800/50 animate-pulse rounded-xl" />
              ))}
            </div>
          ) : sortedFiltered.length === 0 ? (
            <p className="text-sm text-zinc-500 py-6 text-center">
              {items.length === 0
                ? "No urgent follow-ups right now. Add leads or update CRM activity — the engine will recommend next steps automatically."
                : `No ${filter === "all" ? "" : filter + " "}recommendations in this filter.`}
            </p>
          ) : (
            <ul className="space-y-2 max-h-[28rem] overflow-auto pr-1">
              {sortedFiltered.map((rec) => (
                <li
                  key={rec.id}
                  className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`text-lg leading-none mt-0.5 shrink-0 ${URGENCY_DOT[rec.urgency] || "text-zinc-400"}`}
                      title={`${rec.priority} priority · ${rec.urgency}`}
                    >
                      ●
                    </span>
                    <div className="min-w-0 flex-1">
                      <RecCardBody rec={rec} />
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {(rec.buttons || ["call", "whatsapp", "email", "proposal", "meeting"]).map(
                          (btn) => (
                            <button
                              key={btn}
                              type="button"
                              disabled={acting === rec.id}
                              onClick={() => act(rec, btn, true)}
                              className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-white/10 hover:bg-white/20 text-zinc-200 capitalize disabled:opacity-50"
                            >
                              {btn}
                            </button>
                          )
                        )}
                        <button
                          type="button"
                          disabled={acting === rec.id}
                          onClick={() => act(rec, "dismiss", false)}
                          className="px-2.5 py-1 text-[11px] rounded-lg text-zinc-500 hover:text-zinc-300"
                        >
                          Dismiss
                        </button>
                        {rec.contactId && (
                          <button
                            type="button"
                            onClick={() =>
                              router.push(`/dashboard/leads?highlight=${rec.contactId}`)
                            }
                            className="px-2.5 py-1 text-[11px] rounded-lg text-sky-400/90 hover:text-sky-300"
                          >
                            Open lead
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Compact inline recommendation for a single lead row/card */
export function AiLeadRecommendationBadge({
  rec,
  token,
  onDone,
}: {
  rec: AiFollowupRec | null | undefined;
  token?: string | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  if (!rec) return null;

  const act = async (action: string) => {
    openAction(action, rec, router);
    if (token) {
      await api.post(`/crm/ai/followup-engine/${rec.id}/act`, { actionTaken: action }, token);
      emitDataChanged({ module: "contact", action: "update" });
      onDone?.();
    }
  };

  const headline = actionHeadline(rec);

  return (
    <div className="mt-2 rounded-lg border border-violet-500/30 bg-violet-500/5 px-2.5 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-violet-300/80 font-medium">
        AI Recommendation
      </div>
      <div className="text-xs text-zinc-200 mt-0.5 font-medium leading-snug line-clamp-2" title={headline}>
        {headline}
      </div>
      <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2" title={rec.reason}>
        {rec.reason}
      </p>
      {rec.confidence != null && (
        <p className="text-[10px] text-zinc-600 mt-0.5">
          Confidence {Math.round(rec.confidence * 100)}%
        </p>
      )}
      <div className="flex flex-wrap gap-1 mt-1.5">
        {(rec.buttons || ["call", "whatsapp", "email", "proposal"]).slice(0, 4).map((btn) => (
          <button
            key={btn}
            type="button"
            onClick={() => act(btn)}
            className="px-2 py-0.5 text-[10px] rounded-md bg-white/10 hover:bg-white/15 capitalize text-zinc-300"
          >
            {btn}
          </button>
        ))}
      </div>
    </div>
  );
}
