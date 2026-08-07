"use client";

import { useEffect, useRef, useState } from "react";
import {
  getHealthSnapshot,
  subscribeHealthProbe,
  type HealthProbeState,
  type ServiceStatus,
} from "@/lib/health-probe";

type Overall = "online" | "degraded" | "offline";

function overallFrom(state: HealthProbeState | null): Overall {
  if (!state) return "degraded";
  if (state.level === "offline" || state.level === "hard") return "offline";
  if (state.level === "soft") return "degraded";
  const s = state.services;
  if (s.api === "down") return "offline";
  if (
    s.api === "degraded" ||
    s.database === "down" ||
    s.database === "degraded" ||
    s.ai === "down" ||
    s.email === "down" ||
    s.whatsapp === "down"
  ) {
    return "degraded";
  }
  if (s.api === "up" || state.level === "ok") return "online";
  return "degraded";
}

function labelOverall(o: Overall): string {
  if (o === "online") return "Online";
  if (o === "degraded") return "Degraded";
  return "Offline";
}

function dotClass(o: Overall): string {
  if (o === "online") return "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]";
  if (o === "degraded") return "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]";
  return "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]";
}

function serviceLabel(s: ServiceStatus): string {
  switch (s) {
    case "up":
      return "Healthy";
    case "down":
      return "Down";
    case "degraded":
      return "Degraded";
    case "not_configured":
      return "Not configured";
    default:
      return "Unknown";
  }
}

function serviceColor(s: ServiceStatus): string {
  switch (s) {
    case "up":
      return "text-emerald-400";
    case "down":
      return "text-red-400";
    case "degraded":
      return "text-amber-300";
    case "not_configured":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

function formatAgo(ts: number | null): string {
  if (!ts) return "—";
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 5) return "Just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return new Date(ts).toLocaleTimeString();
}

function Row({
  label,
  status,
}: {
  label: string;
  status: ServiceStatus;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${serviceColor(status)}`}>{serviceLabel(status)}</span>
    </div>
  );
}

/**
 * Compact nav status: 🟢 Online / 🟡 Degraded / 🔴 Offline
 * Reads cached health probe only — never fires its own requests.
 */
export function SystemStatusIndicator() {
  const [state, setState] = useState<HealthProbeState | null>(() => getHealthSnapshot());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);

  useEffect(() => subscribeHealthProbe(setState), []);

  // Refresh "last check" relative time while open
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick((n) => n + 1), 5_000);
    return () => clearInterval(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const overall = overallFrom(state);
  const services = state?.services ?? {
    api: "unknown",
    database: "unknown",
    ai: "unknown",
    whatsapp: "unknown",
    email: "unknown",
  };

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/80 px-2 sm:px-2.5 py-1 min-h-9 text-[10px] sm:text-[11px] font-medium text-foreground hover:bg-muted focus-ring"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`System status: ${labelOverall(overall)}`}
        data-testid="system-status-indicator"
        title="System status"
      >
        <span
          className={`inline-block h-2 w-2 rounded-full shrink-0 ${dotClass(overall)}`}
          aria-hidden
        />
        <span className="hidden sm:inline">{labelOverall(overall)}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="System status details"
          className="absolute right-0 mt-2 w-[min(100vw-2rem,18rem)] rounded-xl border border-border bg-card shadow-xl z-[70] p-3 sm:p-3.5 mm-fade-in"
        >
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotClass(overall)}`} />
            <span className="text-sm font-semibold">{labelOverall(overall)}</span>
          </div>

          <div className="divide-y divide-border/60">
            <Row label="API" status={services.api} />
            <Row label="Database" status={services.database} />
            <Row label="AI Provider" status={services.ai} />
            <Row label="WhatsApp" status={services.whatsapp} />
            <Row label="Email" status={services.email} />
          </div>

          <div className="mt-2 pt-2 border-t border-border space-y-1 text-[11px] text-muted-foreground">
            <div className="flex justify-between gap-2">
              <span>Last successful check</span>
              <span className="text-foreground/80 font-medium tabular-nums">
                {formatAgo(state?.lastSuccessAt ?? null)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Current latency</span>
              <span className="text-foreground/80 font-medium tabular-nums">
                {state?.latencyMs != null ? `${state.latencyMs} ms` : "—"}
              </span>
            </div>
          </div>

          {state?.level !== "ok" && state?.detail ? (
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              {state.title}: {state.detail}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
