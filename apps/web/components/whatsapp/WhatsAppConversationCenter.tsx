"use client";

/**
 * Enterprise WhatsApp Conversation Center
 * Left: inbox list · Center: thread · Right: profile / AI / media / timeline
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";

type Conv = {
  id: string;
  phone: string;
  contactId?: string | null;
  contactName: string;
  company?: string | null;
  status: string;
  unreadCount: number;
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
  createdAt: string;
  senderName?: string | null;
  error?: string | null;
};

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
    open: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    pending: "bg-amber-500/15 text-amber-200 border-amber-500/30",
    follow_up: "bg-sky-500/15 text-sky-200 border-sky-500/30",
    won: "bg-violet-500/15 text-violet-200 border-violet-500/30",
    lost: "bg-red-500/15 text-red-300 border-red-500/30",
    closed: "bg-white/10 text-muted-foreground border-border",
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
  const canAssign = ["ceo", "owner", "business_admin", "admin", "sales_manager", "manager", "super_admin"].includes(
    (role || "").toLowerCase()
  );

  const [conversations, setConversations] = useState<Conv[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
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

  const loadList = useCallback(async () => {
    if (!token) return;
    const res = await api.listWaConversations(token, {
      search: search.trim() || undefined,
      status: statusFilter || undefined,
      unreadOnly: unreadOnly || undefined,
      pageSize: 50,
    });
    if (res.success && res.data) {
      setConversations((res.data.items || []) as Conv[]);
    }
    setLoadingList(false);
  }, [token, search, statusFilter, unreadOnly]);

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
    },
    [token]
  );

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
    if (!token || !selectedId || !composer.trim()) return;
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
    <div className="h-full rounded-2xl border border-border bg-card/30 overflow-hidden flex flex-col">
      {/* Mini dashboard strip */}
      {dash && (
        <div className="border-b border-border px-3 py-2 flex flex-wrap gap-2 items-center bg-card/50">
          <button
            type="button"
            onClick={() => setShowDash((v) => !v)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {showDash ? "Hide stats" : "Show stats"}
          </button>
          {showDash && (
            <div className="flex flex-wrap gap-3 text-xs w-full sm:w-auto">
              <Stat label="Open" value={String(dash.openConversations ?? 0)} />
              <Stat label="Unread" value={String(dash.unreadMessages ?? 0)} />
              <Stat label="New today" value={String(dash.todayNewChats ?? 0)} />
              <Stat label="Replies today" value={String(dash.todayReplies ?? 0)} />
              <Stat label="Resolved today" value={String(dash.resolvedToday ?? 0)} />
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
                className="mm-input text-[11px] min-h-8 py-0 flex-1"
              >
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
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
                className="text-[11px] px-2 rounded-lg border border-border"
              >
                Go
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingList ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : conversations.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No conversations yet. Send a WhatsApp message from a lead to start a thread.
              </p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-border/50 hover:bg-white/5 ${
                    selectedId === c.id ? "bg-primary/10 border-l-2 border-l-primary" : ""
                  }`}
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-sm truncate">{c.contactName}</span>
                    {c.unreadCount > 0 && (
                      <span className="shrink-0 text-[10px] font-semibold bg-emerald-600 text-white rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {c.lastMessagePreview || c.phone}
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${statusBadge(c.status)}`}>
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
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-6">
              Select a conversation to start chatting
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-border flex flex-wrap items-center gap-2 bg-card/40">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate">
                    {String(conv?.contactName || "…")}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
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
                  className="mm-input text-[11px] min-h-8 py-0 w-28"
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
                    className="mm-input text-[11px] min-h-8 py-0 max-w-[140px]"
                  >
                    <option value="">Assign…</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name || a.email}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {loadingThread ? (
                  <p className="text-sm text-muted-foreground">Loading messages…</p>
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
                          className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                            isNote
                              ? "bg-amber-500/10 border border-amber-500/30 text-amber-50"
                              : isIn
                                ? "bg-white/10 border border-border"
                                : "bg-emerald-600/25 border border-emerald-500/30"
                          }`}
                        >
                          {isNote && (
                            <div className="text-[10px] uppercase text-amber-300/90 mb-0.5">
                              Private note
                            </div>
                          )}
                          <div className="whitespace-pre-wrap break-words">{m.body}</div>
                          <div className="flex justify-end gap-2 mt-1 text-[10px] text-muted-foreground">
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
                                    ? "text-sky-400"
                                    : m.status === "failed"
                                      ? "text-red-400"
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
                <div ref={bottomRef} />
              </div>

              {/* AI suggestions */}
              {aiSuggestions.length > 0 && !noteMode && (
                <div className="px-3 py-2 border-t border-border bg-violet-500/5 space-y-1">
                  <div className="text-[10px] font-semibold uppercase text-violet-300">
                    AI reply suggestions
                  </div>
                  <div className="flex flex-col gap-1">
                    {aiSuggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setComposer(s)}
                        className="text-left text-xs px-2 py-1.5 rounded-lg border border-violet-500/20 hover:bg-violet-500/10"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Composer */}
              <div className="p-2.5 border-t border-border space-y-2 bg-card/40">
                <div className="flex gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setNoteMode(false)}
                    className={`px-2 py-1 rounded-lg border ${
                      !noteMode ? "border-primary bg-primary/10" : "border-border"
                    }`}
                  >
                    Message
                  </button>
                  <button
                    type="button"
                    onClick={() => setNoteMode(true)}
                    className={`px-2 py-1 rounded-lg border ${
                      noteMode ? "border-amber-500/50 bg-amber-500/10" : "border-border"
                    }`}
                  >
                    Private note
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 rounded-lg border border-border ml-auto"
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
                    className="mm-input flex-1 text-sm resize-none min-h-[56px]"
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
                    className="px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50 self-end min-h-11"
                  >
                    {sending ? "…" : noteMode ? "Save" : "Send"}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Right: profile / media / timeline / summary */}
        <aside className="lg:col-span-4 flex flex-col min-h-0 max-h-[40vh] lg:max-h-none">
          <div className="flex border-b border-border text-[11px]">
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
                onClick={() => setRightTab(k)}
                className={`flex-1 px-2 py-2 ${
                  rightTab === k
                    ? "border-b-2 border-primary text-foreground font-medium"
                    : "text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3 text-sm">
            {!selectedId ? (
              <p className="text-muted-foreground text-xs">Select a conversation</p>
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
                        ? formatCurrency(Number(contact.value))
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
                  <p className="text-xs text-muted-foreground">No media in this conversation yet.</p>
                ) : (
                  <>
                    {((mediaData?.sentFromLibrary as Array<Record<string, unknown>>) || []).map(
                      (f) => (
                        <div
                          key={String(f.id)}
                          className="rounded-lg border border-border px-2 py-1.5 text-xs"
                        >
                          📄 {String(f.assetName)} · {String(f.status)}
                        </div>
                      )
                    )}
                    {((mediaData?.messages as Array<Record<string, unknown>>) || []).map((f) => (
                      <div
                        key={String(f.id)}
                        className="rounded-lg border border-border px-2 py-1.5 text-xs"
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
                  <p className="text-xs text-muted-foreground">No timeline events</p>
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
                  className="w-full min-h-9 rounded-xl border border-violet-500/40 bg-violet-500/10 text-xs font-medium"
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
                  <p className="text-xs text-muted-foreground">
                    Click to generate AI summary of this chat.
                  </p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-medium break-words">{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-2 py-1">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
