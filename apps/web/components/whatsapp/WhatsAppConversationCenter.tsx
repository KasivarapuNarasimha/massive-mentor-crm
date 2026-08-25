"use client";

/**
 * Enterprise WhatsApp Conversation Center
 * Left: inbox list · Center: thread · Right: profile / AI / media / timeline
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useBusinessCurrency } from "@/lib/use-business-currency";

type Conv = {
  id: string;
  phone: string;
  contactId?: string | null;
  contactName: string;
  company?: string | null;
  status: string;
  unreadCount: number;
  labels?: string[];
  pinned?: boolean;
  snoozedUntil?: string | null;
  isSpam?: boolean;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  lastMessageDirection?: string | null;
  assignedToUserId?: string | null;
  assignedToName?: string | null;
};

type Msg = {
  id: string;
  body: string;
  direction: string;
  status: string;
  messageType?: string;
  isInternal?: boolean;
  transcript?: string | null;
  reactions?: Array<{ emoji: string; userId: string }>;
  createdAt: string;
  senderName?: string | null;
  error?: string | null;
};

const REACTION_EMOJIS = ["👍", "❤️", "👀", "✅"];
const DEFAULT_LABELS = [
  "🔥 Hot Lead",
  "🟡 Warm Lead",
  "❄ Cold Lead",
  "💰 High Value",
  "📞 Follow-up",
  "⚠ Payment Pending",
  "⭐ VIP Customer",
];

const STATUSES = [
  { key: "open", label: "Open" },
  { key: "pending", label: "Pending" },
  { key: "follow_up", label: "Follow-up" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "closed", label: "Closed" },
];

function statusBadge(status: string) {
  const map: Record<string, string> = {
    open: "mm-badge mm-badge-success",
    pending: "mm-badge mm-badge-warning",
    follow_up: "mm-badge mm-badge-primary",
    won: "mm-badge mm-badge-primary",
    lost: "mm-badge mm-badge-danger",
    closed: "mm-badge",
  };
  return map[status] || map.open;
}

function deliveryIcon(status: string) {
  if (status === "read") return "✓✓";
  if (status === "delivered") return "✓✓";
  if (status === "sent") return "✓";
  if (status === "failed") return "!";
  return "…";
}

export function WhatsAppConversationCenter() {
  const { token, role } = useAuth();
  const { money } = useBusinessCurrency();
  const canAssign = ["ceo", "owner", "business_admin", "admin", "sales_manager", "manager", "super_admin"].includes(
    (role || "").toLowerCase()
  );

  const [conversations, setConversations] = useState<Conv[]>([]);
  const [presetLabels, setPresetLabels] = useState<string[]>(DEFAULT_LABELS);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [typingAgents, setTypingAgents] = useState<string[]>([]);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastBody, setBroadcastBody] = useState("");
  const [broadcastName, setBroadcastName] = useState("Festival Wishes");
  const [automationOpen, setAutomationOpen] = useState(false);
  const [slaManagerMin, setSlaManagerMin] = useState(15);
  const [slaAdminMin, setSlaAdminMin] = useState(30);
  const [ruleName, setRuleName] = useState("Real Estate Team");
  const [ruleIndustry, setRuleIndustry] = useState("");
  const [ruleLocation, setRuleLocation] = useState("");
  const [ruleAssignee, setRuleAssignee] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [detail, setDetail] = useState<{
    conversation: Record<string, unknown>;
    contact: Record<string, unknown> | null;
  } | null>(null);
  const [composer, setComposer] = useState("");
  const [noteMode, setNoteMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiSummary, setAiSummary] = useState<Record<string, unknown> | null>(null);
  const [rightTab, setRightTab] = useState<"profile" | "media" | "timeline" | "summary">("profile");
  const [mediaData, setMediaData] = useState<Record<string, unknown> | null>(null);
  const [timeline, setTimeline] = useState<Array<Record<string, unknown>>>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name?: string; email?: string }>>([]);
  const [dash, setDash] = useState<Record<string, unknown> | null>(null);
  const [showDash, setShowDash] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Sync lock — state alone cannot block double-click before re-render */
  const sendLockRef = useRef(false);

  const loadList = useCallback(async () => {
    if (!token) return;
    const res = await api.listWaConversations(token, {
      search: search.trim() || undefined,
      status: statusFilter || undefined,
      label: labelFilter || undefined,
      unreadOnly: unreadOnly || undefined,
      pageSize: 50,
    });
    if (res.success && res.data) {
      setConversations((res.data.items || []) as Conv[]);
      if (Array.isArray(res.data.presetLabels)) {
        setPresetLabels(res.data.presetLabels as string[]);
      }
    }
    setLoadingList(false);
  }, [token, search, statusFilter, labelFilter, unreadOnly]);

  const loadThread = useCallback(
    async (id: string) => {
      if (!token) return;
      setLoadingThread(true);
      const [c, m] = await Promise.all([
        api.getWaConversation(id, token),
        api.listWaMessages(id, token),
      ]);
      if (c.success && c.data) {
        setDetail(c.data as { conversation: Record<string, unknown>; contact: Record<string, unknown> | null });
        if ((c.data as { conversation?: { aiSummary?: Record<string, unknown> } }).conversation?.aiSummary) {
          setAiSummary(
            (c.data as { conversation: { aiSummary: Record<string, unknown> } }).conversation.aiSummary
          );
        } else setAiSummary(null);
      }
      if (m.success && m.data?.items) {
        setMessages(m.data.items as Msg[]);
      }
      setLoadingThread(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      void api.waAiReplies(id, token).then((r) => {
        if (r.success && r.data?.suggestions) setAiSuggestions(r.data.suggestions);
      });
      void api.waSetTyping(id, false, token);
    },
    [token]
  );

  // Typing heartbeat while composing
  useEffect(() => {
    if (!token || !selectedId || !composer.trim() || noteMode) return;
    void api.waSetTyping(selectedId, true, token);
    const t = setTimeout(() => {
      void api.waSetTyping(selectedId, false, token);
    }, 4000);
    return () => clearTimeout(t);
  }, [composer, selectedId, token, noteMode]);

  useEffect(() => {
    if (!token || !selectedId) return;
    const t = setInterval(() => {
      void api.waGetTyping(selectedId, token).then((r) => {
        if (r.success && r.data?.agents) {
          setTypingAgents(r.data.agents.map((a) => a.name));
        }
      });
    }, 3000);
    return () => clearInterval(t);
  }, [token, selectedId]);

  useEffect(() => {
    void loadList();
    if (token) {
      void api.waDashboard(token).then((r) => {
        if (r.success && r.data) setDash(r.data);
      });
      if (canAssign) {
        void api.waAgents(token).then((r) => {
          if (r.success && r.data?.agents) {
            setAgents(r.data.agents as Array<{ id: string; name?: string; email?: string }>);
          }
        });
      }
    }
  }, [loadList, token, canAssign]);

  useEffect(() => {
    if (selectedId) void loadThread(selectedId);
  }, [selectedId, loadThread]);

  // Real-time-ish polling
  useEffect(() => {
    if (!token) return;
    pollRef.current = setInterval(() => {
      void loadList();
      if (selectedId) void loadThread(selectedId);
    }, 8000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [token, selectedId, loadList, loadThread]);

  const send = async () => {
    // Guard before setState — blocks double-click / double-send races
    if (!token || !selectedId || !composer.trim() || sending || sendLockRef.current) return;
    sendLockRef.current = true;
    setSending(true);
    try {
      if (noteMode) {
        const res = await api.addWaNote(selectedId, composer.trim(), token);
        if (!res.success) toast.error(res.error || "Note failed");
        else {
          setComposer("");
          await loadThread(selectedId);
        }
      } else {
        const res = await api.sendWaMessage(selectedId, composer.trim(), token);
        if (!res.success) toast.error(res.error || "Send failed");
        else {
          setComposer("");
          await loadThread(selectedId);
          await loadList();
        }
      }
    } finally {
      sendLockRef.current = false;
      setSending(false);
    }
  };

  const loadMedia = async () => {
    if (!token || !selectedId) return;
    const res = await api.waMedia(selectedId, token);
    if (res.success && res.data) setMediaData(res.data);
  };

  const loadTimeline = async () => {
    if (!token || !selectedId) return;
    const res = await api.waTimeline(selectedId, token);
    if (res.success && res.data?.items) setTimeline(res.data.items);
  };

  useEffect(() => {
    if (rightTab === "media") void loadMedia();
    if (rightTab === "timeline") void loadTimeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightTab, selectedId]);

  const contact = detail?.contact;
  const conv = detail?.conversation;

  return (
    <div className="h-full mm-card overflow-hidden flex flex-col rounded-lg">
      {/* Mini dashboard strip */}
      {dash && (
        <div className="border-b border-border px-3 py-2 flex flex-wrap gap-2 items-center bg-card">
          <button
            type="button"
            onClick={() => setShowDash((v) => !v)}
            className="mm-btn mm-btn-ghost h-9 px-2 text-xs"
          >
            {showDash ? "Hide stats" : "Show stats"}
          </button>
          {showDash && (
            <div className="flex flex-wrap gap-3 text-xs w-full sm:w-auto">
              <Stat label="Open" value={String(dash.openConversations ?? 0)} />
              <Stat
                label="Closed"
                value={String(dash.closedConversations ?? 0)}
              />
              <Stat
                label="Unread"
                value={String(
                  dash.unreadConversations ?? dash.unreadMessages ?? 0
                )}
              />
              <Stat
                label="Sent today"
                value={String(dash.messagesSentToday ?? dash.todayReplies ?? 0)}
              />
              <Stat
                label="Received today"
                value={String(dash.messagesReceivedToday ?? 0)}
              />
              <Stat
                label="Avg response"
                value={
                  dash.averageResponseTimeMinutes != null
                    ? `${dash.averageResponseTimeMinutes}m`
                    : "—"
                }
              />
              <Stat
                label="Avg resolution"
                value={
                  dash.averageResolutionTimeMinutes != null
                    ? `${dash.averageResolutionTimeMinutes}m`
                    : "—"
                }
              />
              <Stat
                label="CSAT"
                value={
                  dash.averageCsat != null ? String(dash.averageCsat) : "—"
                }
              />
              {Array.isArray(dash.topExecutives) &&
                (dash.topExecutives as Array<{ name?: string; conversations?: number }>)
                  .slice(0, 3)
                  .map((ex, i) => (
                    <Stat
                      key={i}
                      label={`Top SE${i + 1}`}
                      value={`${ex.name || "—"} (${ex.conversations ?? 0})`}
                    />
                  ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12">
        {/* Left: conversation list */}
        <aside className="lg:col-span-3 border-r border-border flex flex-col min-h-0 max-h-[40vh] lg:max-h-none">
          <div className="p-2.5 space-y-2 border-b border-border">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void loadList()}
              placeholder="Search name, phone, company…"
              className="mm-input w-full text-sm min-h-9"
            />
            <div className="flex flex-wrap gap-1.5">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="mm-input text-[11px] min-h-9 h-9 py-0 flex-1"
              >
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                value={labelFilter}
                onChange={(e) => setLabelFilter(e.target.value)}
                className="mm-input text-[11px] min-h-9 h-9 py-0 flex-1"
              >
                <option value="">All labels</option>
                {presetLabels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground px-1">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => setUnreadOnly(e.target.checked)}
                />
                Unread
              </label>
              <button
                type="button"
                onClick={() => void loadList()}
                className="mm-btn mm-btn-secondary h-9 px-2.5 text-[11px]"
              >
                Go
              </button>
              {canAssign && (
                <>
                  <button
                    type="button"
                    onClick={() => setBroadcastOpen(true)}
                    className="mm-btn mm-btn-secondary h-9 px-2.5 text-[11px]"
                  >
                    Broadcast
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setAutomationOpen(true);
                      if (!token) return;
                      const res = await api.waGetSla(token);
                      if (res.success && res.data) {
                        setSlaManagerMin(
                          Number(res.data.escalateManagerMinutes ?? 15)
                        );
                        setSlaAdminMin(
                          Number(res.data.escalateAdminMinutes ?? 30)
                        );
                      }
                    }}
                    className="mm-btn mm-btn-secondary h-9 px-2.5 text-[11px]"
                  >
                    SLA & Rules
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="p-3 space-y-2" aria-busy="true" aria-label="Loading conversations">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="mm-skeleton h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-6 text-center" role="status">
                <p className="text-sm font-medium text-foreground mb-1">No conversations yet</p>
                <p className="mm-secondary leading-relaxed">
                  Send a WhatsApp message from a lead to start a thread.
                </p>
              </div>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-3 py-2 min-h-[48px] border-b border-border hover:bg-muted/50 ${
                    selectedId === c.id ? "bg-accent border-l-2 border-l-primary" : ""
                  }`}
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-sm truncate">
                      {c.pinned ? "📌 " : ""}
                      {c.contactName}
                    </span>
                    {c.unreadCount > 0 && (
                      <span className="shrink-0 text-[10px] font-semibold bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {c.lastMessagePreview || c.phone}
                  </div>
                  {(c.labels || []).length > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-1">
                      {(c.labels || []).slice(0, 3).map((l) => (
                        <span
                          key={l}
                          className="mm-badge text-[9px] px-1.5 py-0"
                        >
                          {l}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between mt-1 items-center gap-2">
                    <span className={statusBadge(c.status)}>
                      {c.status}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {c.assignedToName || "Unassigned"}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Center: thread */}
        <section className="lg:col-span-5 flex flex-col min-h-0 border-r border-border">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center mm-secondary p-6">
              Select a conversation to start chatting
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-border flex flex-wrap items-center gap-2 bg-card">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate">
                    {String(conv?.contactName || "…")}
                  </div>
                  <div className="mm-secondary truncate">
                    {String(conv?.phone || "")}
                  </div>
                </div>
                <select
                  value={String(conv?.status || "open")}
                  onChange={async (e) => {
                    if (!token || !selectedId) return;
                    const res = await api.setWaConversationStatus(
                      selectedId,
                      e.target.value,
                      token
                    );
                    if (res.success) {
                      toast.success("Status updated");
                      await loadThread(selectedId);
                      await loadList();
                    } else toast.error(res.error || "Failed");
                  }}
                  className="mm-input text-[11px] min-h-9 h-9 py-0 w-28"
                >
                  {STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {canAssign && agents.length > 0 && (
                  <select
                    value={String(conv?.assignedToUserId || "")}
                    onChange={async (e) => {
                      if (!token || !selectedId || !e.target.value) return;
                      const res = await api.assignWaConversation(
                        selectedId,
                        e.target.value,
                        token
                      );
                      if (res.success) {
                        toast.success("Assigned");
                        await loadThread(selectedId);
                        await loadList();
                      } else toast.error(res.error || "Failed");
                    }}
                    className="mm-input text-[11px] min-h-9 h-9 py-0 max-w-[140px]"
                  >
                    <option value="">Assign…</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name || a.email}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  title="Pin (max 10)"
                  className="mm-btn mm-btn-secondary h-9 px-2 text-xs"
                  onClick={async () => {
                    if (!token || !selectedId) return;
                    const res = await api.waTogglePin(selectedId, token);
                    if (res.success) {
                      toast.success(
                        (res.data as { pinned?: boolean })?.pinned
                          ? "Pinned"
                          : "Unpinned"
                      );
                      await loadList();
                    } else toast.error(res.error || "Pin failed");
                  }}
                >
                  📌
                </button>
                <select
                  className="mm-input text-[11px] min-h-9 h-9 py-0 w-auto"
                  defaultValue=""
                  onChange={async (e) => {
                    if (!token || !selectedId || !e.target.value) return;
                    const preset = e.target.value;
                    e.target.value = "";
                    if (preset === "custom") {
                      const raw = window.prompt(
                        "Snooze until (YYYY-MM-DD HH:mm or ISO)",
                        ""
                      );
                      if (!raw?.trim()) return;
                      const until = new Date(raw.trim());
                      if (Number.isNaN(until.getTime())) {
                        toast.error("Invalid date/time");
                        return;
                      }
                      const res = await api.waSnooze(
                        selectedId,
                        { until: until.toISOString() },
                        token
                      );
                      if (res.success) {
                        toast.success("Conversation snoozed");
                        setSelectedId(null);
                        await loadList();
                      } else toast.error(res.error || "Snooze failed");
                      return;
                    }
                    const res = await api.waSnooze(
                      selectedId,
                      { preset },
                      token
                    );
                    if (res.success) {
                      toast.success("Conversation snoozed");
                      setSelectedId(null);
                      await loadList();
                    } else toast.error(res.error || "Snooze failed");
                  }}
                >
                  <option value="">Snooze…</option>
                  <option value="1h">1 Hour</option>
                  <option value="tomorrow">Tomorrow Morning</option>
                  <option value="next_week">Next Week</option>
                  <option value="custom">Custom Date & Time</option>
                </select>
                <select
                  className="mm-input text-[11px] min-h-9 h-9 py-0 w-auto max-w-[130px]"
                  defaultValue=""
                  onChange={async (e) => {
                    if (!token || !selectedId || !e.target.value) return;
                    const cur = conversations.find((x) => x.id === selectedId);
                    const labels = [...new Set([...(cur?.labels || []), e.target.value])];
                    const res = await api.waSetLabels(selectedId, labels, token);
                    e.target.value = "";
                    if (res.success) {
                      toast.success("Label added");
                      await loadList();
                    } else toast.error(res.error || "Failed");
                  }}
                >
                  <option value="">Label…</option>
                  {presetLabels.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                <select
                  className="mm-input text-[11px] min-h-9 h-9 py-0 w-auto"
                  defaultValue=""
                  onChange={async (e) => {
                    if (!token || !selectedId || !e.target.value) return;
                    const format = e.target.value;
                    e.target.value = "";
                    const url = api.waExportUrl(selectedId, format);
                    try {
                      const res = await fetch(url, {
                        headers: { Authorization: `Bearer ${token}` },
                      });
                      if (!res.ok) throw new Error("Export failed");
                      const blob = await res.blob();
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `whatsapp-export.${format === "xlsx" ? "csv" : format}`;
                      a.click();
                      toast.success("Export downloaded");
                    } catch {
                      toast.error("Export failed");
                    }
                  }}
                >
                  <option value="">Export…</option>
                  <option value="txt">Text</option>
                  <option value="csv">Excel/CSV</option>
                  <option value="pdf">PDF (text)</option>
                </select>
                <button
                  type="button"
                  className="mm-btn mm-btn-danger h-9 px-2.5 text-[11px]"
                  onClick={async () => {
                    if (!token || !selectedId) return;
                    if (!confirm("Mark as spam and close?")) return;
                    const res = await api.waMarkSpam(selectedId, true, token);
                    if (res.success) {
                      toast.success("Marked spam & blocked");
                      setSelectedId(null);
                      await loadList();
                    } else toast.error(res.error || "Failed");
                  }}
                >
                  Spam
                </button>
                {canAssign && (
                  <button
                    type="button"
                    className="mm-btn mm-btn-secondary h-9 px-2.5 text-[11px]"
                    title="Merge another conversation into this one"
                    onClick={async () => {
                      if (!token || !selectedId) return;
                      const secondaryId = window.prompt(
                        "Merge into this chat — enter the other conversation ID (messages, labels, pins move here; other thread is deleted):"
                      );
                      if (!secondaryId?.trim()) return;
                      if (
                        !confirm(
                          "Merge conversations? This cannot be undone."
                        )
                      )
                        return;
                      const res = await api.waMerge(
                        selectedId,
                        secondaryId.trim(),
                        token
                      );
                      if (res.success) {
                        toast.success("Conversations merged");
                        await loadThread(selectedId);
                        await loadList();
                      } else toast.error(res.error || "Merge failed");
                    }}
                  >
                    Merge
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {loadingThread ? (
                  <p className="mm-secondary">Loading messages…</p>
                ) : (
                  messages.map((m) => {
                    const isNote = m.isInternal || m.direction === "internal";
                    const isIn = m.direction === "inbound";
                    return (
                      <div
                        key={m.id}
                        className={`flex ${isIn ? "justify-start" : "justify-end"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-lg px-3 py-2 text-sm border ${
                            isNote
                              ? "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-100"
                              : isIn
                                ? "bg-muted border-border text-foreground"
                                : "bg-primary/10 border-primary/20 text-foreground"
                          }`}
                        >
                          {isNote && (
                            <div className="text-[10px] uppercase text-amber-700 dark:text-amber-300 mb-0.5 font-medium">
                              Private note
                            </div>
                          )}
                          <div className="whitespace-pre-wrap break-words">{m.body}</div>
                          {m.transcript && (
                            <div className="mt-1 text-[11px] text-muted-foreground border-t border-border pt-1">
                              🎙 {m.transcript}
                            </div>
                          )}
                          {m.messageType === "audio" && !m.transcript && token && (
                            <button
                              type="button"
                              className="text-[10px] text-primary mt-1 underline"
                              onClick={async () => {
                                const res = await api.waTranscribe(m.id, token);
                                if (res.success) {
                                  toast.success("Transcript ready");
                                  if (selectedId) await loadThread(selectedId);
                                } else toast.error(res.error || "Transcribe failed");
                              }}
                            >
                              Transcribe voice note
                            </button>
                          )}
                          <div className="flex flex-wrap items-center justify-end gap-1.5 mt-1 text-[10px] text-muted-foreground">
                            {(m.reactions || []).length > 0 && (
                              <span className="mr-auto">
                                {(m.reactions || []).map((r) => r.emoji).join(" ")}
                              </span>
                            )}
                            {REACTION_EMOJIS.map((em) => (
                              <button
                                key={em}
                                type="button"
                                className="opacity-60 hover:opacity-100"
                                title="Internal reaction"
                                onClick={async () => {
                                  if (!token) return;
                                  await api.waReact(m.id, em, token);
                                  if (selectedId) await loadThread(selectedId);
                                }}
                              >
                                {em}
                              </button>
                            ))}
                            <span>
                              {new Date(m.createdAt).toLocaleString("en-IN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                day: "2-digit",
                                month: "short",
                              })}
                            </span>
                            {!isIn && !isNote && (
                              <span
                                className={
                                  m.status === "read"
                                    ? "text-emerald-600"
                                    : m.status === "delivered"
                                      ? "text-emerald-600/70"
                                      : m.status === "failed"
                                        ? "text-destructive"
                                        : ""
                                }
                                title={m.status}
                              >
                                {deliveryIcon(m.status)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                {typingAgents.length > 0 && (
                  <p className="text-xs text-muted-foreground italic px-1">
                    {typingAgents.join(", ")} is replying…
                  </p>
                )}
                <div ref={bottomRef} />
              </div>

              {/* AI suggestions */}
              {aiSuggestions.length > 0 && !noteMode && (
                <div className="px-3 py-2 border-t border-border bg-muted/40 space-y-1">
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                    AI reply suggestions
                  </div>
                  <div className="flex flex-col gap-1">
                    {aiSuggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setComposer(s)}
                        className="text-left text-xs px-2 py-1.5 rounded-lg border border-border bg-card hover:bg-muted/60"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Composer */}
              <div className="p-2.5 border-t border-border space-y-2 bg-card">
                <div className="flex gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setNoteMode(false)}
                    className={`mm-btn h-9 px-2.5 text-[11px] ${
                      !noteMode ? "mm-btn-primary" : "mm-btn-secondary"
                    }`}
                  >
                    Message
                  </button>
                  <button
                    type="button"
                    onClick={() => setNoteMode(true)}
                    className={`mm-btn h-9 px-2.5 text-[11px] ${
                      noteMode
                        ? "border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                        : "mm-btn-secondary"
                    }`}
                  >
                    Private note
                  </button>
                  <button
                    type="button"
                    className="mm-btn mm-btn-secondary h-9 px-2.5 text-[11px] ml-auto"
                    onClick={async () => {
                      if (!token || !selectedId) return;
                      const tomorrow = new Date();
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      tomorrow.setHours(10, 0, 0, 0);
                      const res = await api.waFollowUp(
                        selectedId,
                        tomorrow.toISOString(),
                        undefined,
                        token
                      );
                      if (res.success) toast.success("Follow-up task created for tomorrow 10:00");
                      else toast.error(res.error || "Failed");
                    }}
                  >
                    Remind tomorrow 10:00
                  </button>
                </div>
                <div className="flex gap-2">
                  <textarea
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    rows={2}
                    placeholder={
                      noteMode
                        ? "Private note (customer will never see this)…"
                        : "Type a WhatsApp message…"
                    }
                    className="mm-input flex-1 text-sm resize-none min-h-[52px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={sending || !composer.trim()}
                    onClick={() => void send()}
                    className="mm-btn mm-btn-primary self-end h-9 px-4 text-sm disabled:opacity-50"
                  >
                    {sending ? "…" : noteMode ? "Save" : "Send"}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Right: profile / media / timeline / summary */}
        <aside className="lg:col-span-4 flex flex-col min-h-0 max-h-[40vh] lg:max-h-none bg-card">
          <div className="mm-tabs text-[11px]" role="tablist">
            {(
              [
                ["profile", "Profile"],
                ["media", "Media"],
                ["timeline", "Timeline"],
                ["summary", "AI Summary"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={rightTab === k}
                data-active={rightTab === k ? "true" : undefined}
                onClick={() => setRightTab(k)}
                className="mm-tab flex-1 justify-center px-2 py-2 text-[11px]"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3 text-sm">
            {!selectedId ? (
              <p className="mm-secondary">Select a conversation</p>
            ) : rightTab === "profile" ? (
              <div className="space-y-2">
                <Field label="Name" value={String(contact?.name || conv?.contactName || "—")} />
                <Field label="Company" value={String(contact?.company || conv?.company || "—")} />
                <Field label="Phone" value={String(contact?.phone || conv?.phone || "—")} />
                <Field label="Lead status" value={String(contact?.status || "—")} />
                <Field
                  label="Deal value"
                  value={
                    contact?.dealValueLabel
                      ? String(contact.dealValueLabel)
                      : contact?.value != null
                        ? money(Number(contact.value))
                        : "—"
                  }
                />
                <Field
                  label="Assigned to"
                  value={String(
                    contact?.assignedToName || conv?.assignedToName || "—"
                  )}
                />
                <Field
                  label="Lead score"
                  value={
                    contact?.aiScore != null ? String(contact.aiScore) : "—"
                  }
                />
                <Field
                  label="Last follow-up"
                  value={
                    contact?.lastContactedAt
                      ? new Date(String(contact.lastContactedAt)).toLocaleString("en-IN")
                      : "—"
                  }
                />
                <Field
                  label="Next follow-up"
                  value={
                    contact?.nextFollowUp
                      ? new Date(String(contact.nextFollowUp)).toLocaleString("en-IN")
                      : "—"
                  }
                />
              </div>
            ) : rightTab === "media" ? (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                  Shared files
                </h4>
                {((mediaData?.sentFromLibrary as Array<Record<string, unknown>>) || [])
                  .length === 0 &&
                ((mediaData?.messages as Array<Record<string, unknown>>) || []).length ===
                  0 ? (
                  <p className="mm-secondary">No media in this conversation yet.</p>
                ) : (
                  <>
                    {((mediaData?.sentFromLibrary as Array<Record<string, unknown>>) || []).map(
                      (f) => (
                        <div
                          key={String(f.id)}
                          className="mm-card rounded-lg px-2 py-1.5 text-xs"
                        >
                          📄 {String(f.assetName)} · {String(f.status)}
                        </div>
                      )
                    )}
                    {((mediaData?.messages as Array<Record<string, unknown>>) || []).map((f) => (
                      <div
                        key={String(f.id)}
                        className="mm-card rounded-lg px-2 py-1.5 text-xs"
                      >
                        {String(f.messageType || "file")}: {String(f.body || f.mediaName || "")}
                      </div>
                    ))}
                  </>
                )}
              </div>
            ) : rightTab === "timeline" ? (
              <ol className="space-y-2">
                {timeline.length === 0 ? (
                  <p className="mm-secondary">No timeline events</p>
                ) : (
                  timeline.map((ev) => (
                    <li
                      key={String(ev.id)}
                      className="border-l-2 border-border pl-2 text-xs"
                    >
                      <div className="font-medium">{String(ev.title)}</div>
                      {ev.detail ? (
                        <div className="text-muted-foreground truncate">{String(ev.detail)}</div>
                      ) : null}
                      <div className="text-[10px] text-muted-foreground">
                        {ev.at ? new Date(String(ev.at)).toLocaleString("en-IN") : ""}
                      </div>
                    </li>
                  ))
                )}
              </ol>
            ) : (
              <div className="space-y-3">
                <button
                  type="button"
                  className="mm-btn mm-btn-secondary w-full min-h-9 h-9 text-xs font-medium"
                  onClick={async () => {
                    if (!token || !selectedId) return;
                    toast.message("Generating summary…");
                    const res = await api.waSummarize(selectedId, token);
                    if (res.success && res.data) {
                      setAiSummary(res.data);
                      toast.success("Summary ready");
                    } else toast.error(res.error || "Summary failed");
                  }}
                >
                  Summarize Conversation
                </button>
                {aiSummary ? (
                  <div className="space-y-2 text-xs">
                    <Field label="Requirement" value={String(aiSummary.requirement || "—")} />
                    <Field label="Budget" value={String(aiSummary.budget || "—")} />
                    <Field label="Objections" value={String(aiSummary.objections || "—")} />
                    <Field label="Next action" value={String(aiSummary.nextAction || "—")} />
                    <Field
                      label="Close probability"
                      value={`${aiSummary.probability ?? "—"}%`}
                    />
                  </div>
                ) : (
                  <p className="mm-secondary">
                    Click to generate AI summary of this chat.
                  </p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {automationOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="mm-card rounded-lg w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-sm">SLA & auto-assignment</h3>
            <p className="mm-secondary">
              Escalate unanswered chats automatically. New WhatsApp threads match rules by industry/location.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">Notify manager (min)</span>
                <input
                  type="number"
                  min={1}
                  className="mm-input w-full text-sm min-h-9"
                  value={slaManagerMin}
                  onChange={(e) => setSlaManagerMin(Number(e.target.value) || 15)}
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">Notify admin (min)</span>
                <input
                  type="number"
                  min={1}
                  className="mm-input w-full text-sm min-h-9"
                  value={slaAdminMin}
                  onChange={(e) => setSlaAdminMin(Number(e.target.value) || 30)}
                />
              </label>
            </div>
            <button
              type="button"
              className="mm-btn mm-btn-secondary w-full min-h-9 h-9 text-sm"
              onClick={async () => {
                if (!token) return;
                const res = await api.waUpdateSla(
                  {
                    isActive: true,
                    escalateManagerMinutes: slaManagerMin,
                    escalateAdminMinutes: slaAdminMin,
                  },
                  token
                );
                if (res.success) toast.success("SLA policy saved");
                else toast.error(res.error || "Failed");
              }}
            >
              Save SLA policy
            </button>
            <hr className="border-border" />
            <h4 className="text-sm font-medium">New auto-assign rule</h4>
            <input
              className="mm-input w-full text-sm min-h-9"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="Rule name e.g. Hyderabad Sales"
            />
            <input
              className="mm-input w-full text-sm min-h-9"
              value={ruleIndustry}
              onChange={(e) => setRuleIndustry(e.target.value)}
              placeholder="Industry contains (e.g. Real Estate)"
            />
            <input
              className="mm-input w-full text-sm min-h-9"
              value={ruleLocation}
              onChange={(e) => setRuleLocation(e.target.value)}
              placeholder="Location contains (e.g. Hyderabad)"
            />
            <select
              className="mm-input w-full text-sm min-h-9"
              value={ruleAssignee}
              onChange={(e) => setRuleAssignee(e.target.value)}
            >
              <option value="">Assign to…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.email}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                type="button"
                className="mm-btn mm-btn-secondary flex-1 min-h-9 h-9"
                onClick={() => setAutomationOpen(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="mm-btn mm-btn-primary flex-1 min-h-9 h-9 text-sm"
                onClick={async () => {
                  if (!token) return;
                  if (!ruleName.trim() || !ruleAssignee) {
                    toast.error("Name and assignee required");
                    return;
                  }
                  const conditions: Record<string, string> = {};
                  if (ruleIndustry.trim()) conditions.industry = ruleIndustry.trim();
                  if (ruleLocation.trim())
                    conditions.locationContains = ruleLocation.trim();
                  const res = await api.waSaveRule(
                    {
                      name: ruleName.trim(),
                      priority: 50,
                      isActive: true,
                      conditions,
                      assignToUserId: ruleAssignee,
                    },
                    token
                  );
                  if (res.success) {
                    toast.success("Auto-assign rule saved");
                    setRuleIndustry("");
                    setRuleLocation("");
                  } else toast.error(res.error || "Failed");
                }}
              >
                Save rule
              </button>
            </div>
          </div>
        </div>
      )}

      {broadcastOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="mm-card rounded-lg w-full max-w-md p-5 space-y-3">
            <h3 className="font-semibold text-sm">Broadcast campaign</h3>
            <p className="mm-secondary">
              Sends approved free-text (or Meta template name) to filtered leads. Track delivery in history.
            </p>
            <input
              className="mm-input w-full text-sm min-h-9"
              value={broadcastName}
              onChange={(e) => setBroadcastName(e.target.value)}
              placeholder="Campaign name"
            />
            <textarea
              className="mm-input w-full text-sm min-h-[100px]"
              value={broadcastBody}
              onChange={(e) => setBroadcastBody(e.target.value)}
              placeholder="Message body or leave blank if using template only"
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="mm-btn mm-btn-secondary flex-1 min-h-9 h-9"
                onClick={() => setBroadcastOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mm-btn mm-btn-primary flex-1 min-h-9 h-9 text-sm"
                onClick={async () => {
                  if (!token) return;
                  const res = await api.waCreateBroadcast(
                    {
                      name: broadcastName,
                      body: broadcastBody || "Hello from Massive Mentor!",
                      audienceFilter: { type: "lead" },
                      sendNow: true,
                    },
                    token
                  );
                  if (res.success) {
                    toast.success("Broadcast started");
                    setBroadcastOpen(false);
                  } else toast.error(res.error || "Broadcast failed");
                }}
              >
                Send to Leads
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-2.5 py-1.5 bg-card">
      <div className="mm-secondary uppercase tracking-wide">{label}</div>
      <div className="font-medium text-sm break-words mt-0.5">{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-2 py-1">
      <span className="mm-secondary">{label}: </span>
      <span className="font-semibold tabular-nums text-sm">{value}</span>
    </div>
  );
}
