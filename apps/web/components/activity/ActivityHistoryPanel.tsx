"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

export type HistoryRangeKey = "today" | "yesterday" | "7d" | "30d" | "custom" | "all";

type HistoryItem = {
  id: string;
  actorUserId: string;
  actorName: string;
  actorEmail?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  changes?: Array<{
    field: string;
    oldValue?: unknown;
    newValue?: unknown;
    oldLabel?: string | null;
    newLabel?: string | null;
  }>;
  createdAt: string;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function rangeToDates(key: HistoryRangeKey, customFrom?: string, customTo?: string) {
  const now = new Date();
  if (key === "all") return {};
  if (key === "today") {
    return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
  }
  if (key === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return { from: startOfDay(y).toISOString(), to: endOfDay(y).toISOString() };
  }
  if (key === "7d") {
    const from = new Date(now);
    from.setDate(from.getDate() - 7);
    return { from: from.toISOString(), to: now.toISOString() };
  }
  if (key === "30d") {
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    return { from: from.toISOString(), to: now.toISOString() };
  }
  if (key === "custom") {
    return {
      from: customFrom ? new Date(customFrom).toISOString() : undefined,
      to: customTo ? endOfDay(new Date(customTo)).toISOString() : undefined,
    };
  }
  return {};
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

type Props = {
  token: string | null | undefined;
  mode: "contact" | "member" | "deal";
  contactId?: string;
  dealId?: string;
  memberUserId?: string;
  title?: string;
  className?: string;
};

const ACTION_FILTERS = [
  { value: "", label: "All types" },
  { value: "created", label: "Created" },
  { value: "updated", label: "Updates" },
  { value: "assigned", label: "Assignments" },
  { value: "note_added", label: "Notes added" },
  { value: "note_edited", label: "Notes edited" },
  { value: "task_completed", label: "Follow-ups done" },
  { value: "email_sent", label: "Emails" },
];

export function ActivityHistoryPanel({
  token,
  mode,
  contactId,
  dealId,
  memberUserId,
  title,
  className = "",
}: Props) {
  const [range, setRange] = useState<HistoryRangeKey>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [action, setAction] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [memberMeta, setMemberMeta] = useState<{
    name: string | null;
    email: string | null;
    actionCounts?: Record<string, number>;
  } | null>(null);

  const dates = useMemo(
    () => rangeToDates(range, customFrom, customTo),
    [range, customFrom, customTo]
  );

  const load = useCallback(async () => {
    if (!token) return;
    if (mode === "contact" && !contactId) return;
    if (mode === "deal" && !dealId) return;
    if (mode === "member" && !memberUserId) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === "contact" && contactId) {
        const res = await api.getContactHistory(token, contactId, {
          ...dates,
          action: action || undefined,
          search: search.trim() || undefined,
          pageSize: 100,
        });
        if (!res.success || !res.data) {
          setError(res.error || "Failed to load history");
          setItems([]);
          return;
        }
        setItems(res.data.items as HistoryItem[]);
        setTotal(res.data.total);
        setMemberMeta(null);
      } else if (mode === "deal" && dealId) {
        const res = await api.getDealHistory(token, dealId, {
          ...dates,
          action: action || undefined,
          search: search.trim() || undefined,
          pageSize: 100,
        });
        if (!res.success || !res.data) {
          setError(res.error || "Failed to load deal history");
          setItems([]);
          return;
        }
        setItems(res.data.items as unknown as HistoryItem[]);
        setTotal(res.data.total);
        setMemberMeta(null);
      } else if (mode === "member" && memberUserId) {
        const res = await api.getMemberActivityTimeline(token, memberUserId, {
          ...dates,
          action: action || undefined,
          search: search.trim() || undefined,
          pageSize: 100,
        });
        if (!res.success || !res.data) {
          setError(res.error || "Failed to load member history");
          setItems([]);
          return;
        }
        setItems(res.data.items as HistoryItem[]);
        setTotal(res.data.total);
        setMemberMeta({
          name: res.data.member.name,
          email: res.data.member.email,
          actionCounts: res.data.actionCounts,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [token, mode, contactId, dealId, memberUserId, dates, action, search]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={`rounded-xl border border-border bg-card/40 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {title || (mode === "member" ? "Member History" : "Lead History")}
          </h3>
          {memberMeta ? (
            <p className="text-xs text-muted-foreground">
              {memberMeta.name || memberMeta.email} · {total} events
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{total} events</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted/40"
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-border/70">
        {(
          [
            ["today", "Today"],
            ["yesterday", "Yesterday"],
            ["7d", "7 days"],
            ["30d", "30 days"],
            ["custom", "Custom"],
            ["all", "All"],
          ] as Array<[HistoryRangeKey, string]>
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setRange(k)}
            className={`text-xs px-2.5 py-1 rounded-full border ${
              range === k
                ? "bg-sky-500/20 border-sky-500/40 text-sky-200"
                : "border-border text-muted-foreground hover:bg-muted/30"
            }`}
          >
            {label}
          </button>
        ))}
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="text-xs px-2 py-1 rounded-lg border border-border bg-background"
        >
          {ACTION_FILTERS.map((a) => (
            <option key={a.value || "all"} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search lead / note / actor…"
          className="text-xs px-2.5 py-1.5 rounded-lg border border-border bg-background min-w-[10rem] flex-1"
        />
      </div>

      {range === "custom" ? (
        <div className="flex flex-wrap gap-2 px-4 py-2 border-b border-border/50">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="text-xs px-2 py-1 rounded-lg border border-border bg-background"
          />
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="text-xs px-2 py-1 rounded-lg border border-border bg-background"
          />
        </div>
      ) : null}

      {memberMeta?.actionCounts ? (
        <div className="flex flex-wrap gap-2 px-4 py-2 text-[11px] text-muted-foreground border-b border-border/40">
          {Object.entries(memberMeta.actionCounts)
            .slice(0, 8)
            .map(([k, v]) => (
              <span key={k} className="px-2 py-0.5 rounded-full bg-muted/30 border border-border/50">
                {k.replace(/_/g, " ")}: {v}
              </span>
            ))}
        </div>
      ) : null}

      <div className="max-h-[28rem] overflow-y-auto px-4 py-3 space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading history…</p>
        ) : error ? (
          <p className="text-sm text-red-300">{error}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No activity events yet. History is recorded from this point forward for real actions.
          </p>
        ) : (
          items.map((ev) => (
            <div key={ev.id} className="relative pl-4 border-l border-border/80">
              <div className="absolute -left-1 top-1.5 h-2 w-2 rounded-full bg-sky-400/80" />
              <div className="text-[11px] text-muted-foreground">{formatWhen(ev.createdAt)}</div>
              <div className="text-sm text-foreground mt-0.5">
                <span className="font-medium">{ev.actorName}</span>
                <span className="text-muted-foreground"> · {ev.summary}</span>
              </div>
              {ev.changes && ev.changes.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {ev.changes.map((c, i) => (
                    <li key={`${ev.id}-${c.field}-${i}`}>
                      <span className="text-foreground/80">{c.field}</span>:{" "}
                      {String(c.oldLabel ?? c.oldValue ?? "—")} →{" "}
                      {String(c.newLabel ?? c.newValue ?? "—")}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
