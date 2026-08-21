"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

export type NoteEntityType = "contact" | "deal" | "meeting";

export type EntityOption = {
  id: string;
  label: string;
  sublabel?: string;
};

type Props = {
  entityType: NoteEntityType;
  value: string;
  onChange: (id: string, option?: EntityOption | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** When set, show this as the selected label without requiring a search hit */
  selectedLabel?: string;
};

function formatMeetingLabel(m: {
  title?: string;
  scheduledAt?: string | null;
}): string {
  const title = m.title?.trim() || "Untitled meeting";
  if (!m.scheduledAt) return title;
  try {
    const d = new Date(m.scheduledAt);
    if (Number.isNaN(d.getTime())) return title;
    return `${title} · ${d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    })}`;
  } catch {
    return title;
  }
}

export function EntitySearchSelect({
  entityType,
  value,
  onChange,
  disabled,
  placeholder,
  className = "",
  selectedLabel,
}: Props) {
  const { token } = useAuth();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<EntityOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [displayLabel, setDisplayLabel] = useState(selectedLabel || "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (selectedLabel) setDisplayLabel(selectedLabel);
  }, [selectedLabel]);

  useEffect(() => {
    // Reset search when entity type changes
    setQuery("");
    setOptions([]);
    if (!value) setDisplayLabel("");
  }, [entityType, value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const fetchOptions = useCallback(
    async (q: string) => {
      if (!token) return;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", "1");
        params.set("pageSize", "25");
        if (q.trim()) params.set("search", q.trim());

        if (entityType === "contact") {
          params.set("sortBy", "updatedAt");
          params.set("sortDir", "desc");
          const res = await api.getCrmContacts(`?${params.toString()}`, token);
          const data = (res.data || {}) as {
            contacts?: Array<{
              id: string;
              name?: string;
              company?: string | null;
              phone?: string | null;
              email?: string | null;
              type?: string;
            }>;
          };
          const list = Array.isArray(data.contacts) ? data.contacts : [];
          setOptions(
            list.map((c) => ({
              id: c.id,
              label: c.name || "Unnamed contact",
              sublabel: [c.type, c.company, c.phone || c.email]
                .filter(Boolean)
                .join(" · "),
            }))
          );
        } else if (entityType === "deal") {
          params.set("sortBy", "updatedAt");
          params.set("sortDir", "desc");
          const res = await api.getCrmDeals(`?${params.toString()}`, token);
          const data = (res.data || {}) as {
            deals?: Array<{
              id: string;
              title?: string;
              stage?: string;
              contact?: { name?: string } | null;
            }>;
            items?: Array<{
              id: string;
              title?: string;
              stage?: string;
              contact?: { name?: string } | null;
            }>;
          };
          const list = Array.isArray(data.deals)
            ? data.deals
            : Array.isArray(data.items)
              ? data.items
              : [];
          setOptions(
            list.map((d) => ({
              id: d.id,
              label: d.title || "Untitled deal",
              sublabel: [d.stage, d.contact?.name].filter(Boolean).join(" · "),
            }))
          );
        } else {
          params.set("sortBy", "scheduledAt");
          params.set("sortDir", "desc");
          const res = await api.getCrmMeetings(`?${params.toString()}`, token);
          const data = (res.data || {}) as {
            meetings?: Array<{
              id: string;
              title?: string;
              scheduledAt?: string | null;
            }>;
            items?: Array<{
              id: string;
              title?: string;
              scheduledAt?: string | null;
            }>;
          };
          const list = Array.isArray(data.meetings)
            ? data.meetings
            : Array.isArray(data.items)
              ? data.items
              : [];
          setOptions(
            list.map((m) => ({
              id: m.id,
              label: formatMeetingLabel(m),
              sublabel: undefined,
            }))
          );
        }
      } catch {
        setOptions([]);
      }
      setLoading(false);
    },
    [token, entityType]
  );

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchOptions(query);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, fetchOptions]);

  const typeLabel =
    entityType === "contact" ? "contact" : entityType === "deal" ? "deal" : "meeting";

  const ph =
    placeholder ||
    (entityType === "contact"
      ? "Search contacts..."
      : entityType === "deal"
        ? "Search deals..."
        : "Search meetings...");

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      {value && displayLabel ? (
        <div className="flex items-center gap-2 min-h-11 bg-background border border-border rounded-xl px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{displayLabel}</div>
            <div className="text-[11px] text-muted-foreground capitalize">Selected {typeLabel}</div>
          </div>
          {!disabled && (
            <button
              type="button"
              className="text-xs px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 shrink-0"
              onClick={() => {
                onChange("", null);
                setDisplayLabel("");
                setQuery("");
                setOpen(true);
              }}
            >
              Change
            </button>
          )}
        </div>
      ) : (
        <>
          <label className="sr-only" htmlFor={listId}>
            Select {typeLabel}
          </label>
          <input
            id={listId}
            type="search"
            autoComplete="off"
            disabled={disabled}
            value={query}
            placeholder={ph}
            onFocus={() => {
              setOpen(true);
              if (options.length === 0) void fetchOptions(query);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            className="w-full bg-background border border-border rounded-xl px-4 py-3 sm:py-2.5 text-base sm:text-sm min-h-11 focus-ring"
          />
        </>
      )}

      {open && !value && (
        <div
          role="listbox"
          className="absolute z-40 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-border bg-card shadow-lg"
        >
          {loading && (
            <div className="px-3 py-2.5 text-xs text-muted-foreground">Searching…</div>
          )}
          {!loading && options.length === 0 && (
            <div className="px-3 py-2.5 text-xs text-muted-foreground">
              No {typeLabel}s found. Try a different search.
            </div>
          )}
          {!loading &&
            options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="option"
                className="w-full text-left px-3 py-2.5 hover:bg-white/10 border-b border-border/50 last:border-0"
                onClick={() => {
                  onChange(opt.id, opt);
                  setDisplayLabel(opt.label);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <div className="text-sm font-medium truncate">{opt.label}</div>
                {opt.sublabel ? (
                  <div className="text-[11px] text-muted-foreground truncate">{opt.sublabel}</div>
                ) : null}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
