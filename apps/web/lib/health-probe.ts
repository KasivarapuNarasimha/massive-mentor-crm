/**
 * Resilient API connectivity probing for the CRM shell.
 * - Exponential backoff: 5s → 10s → 20s → max 60s
 * - Success cache ~45s
 * - Differentiated failure kinds
 * - Log identical failures once (no toast spam)
 */

import { api, getApiOrigin } from "@/lib/api";

export type HealthFailureKind =
  | "offline"
  | "timeout"
  | "restarting"
  | "unavailable"
  | "auth_expired"
  | "unknown";

export type HealthUiLevel = "ok" | "soft" | "hard" | "offline";

export type HealthProbeState = {
  level: HealthUiLevel;
  kind: HealthFailureKind | null;
  title: string;
  detail: string | null;
  checking: boolean;
  consecutiveFailures: number;
  lastOkAt: number | null;
  nextRetryInMs: number | null;
};

const SUCCESS_CACHE_MS = 45_000;
const BACKOFF_STEPS_MS = [5_000, 10_000, 20_000, 60_000] as const;
const PROBE_TIMEOUT_MS = 8_000;

let lastOkAt: number | null = null;
let consecutiveFailures = 0;
let lastLoggedKey: string | null = null;
let inFlight: Promise<HealthProbeState> | null = null;

function backoffMs(failures: number): number {
  if (failures <= 0) return BACKOFF_STEPS_MS[0];
  const idx = Math.min(failures - 1, BACKOFF_STEPS_MS.length - 1);
  return BACKOFF_STEPS_MS[idx]!;
}

function messagesFor(kind: HealthFailureKind): { title: string; detail: string } {
  switch (kind) {
    case "offline":
      return {
        title: "No Internet Connection",
        detail: "Reconnect to the internet to sync with the server.",
      };
    case "timeout":
      return {
        title: "Network timeout",
        detail: "The server is slow to respond. Retrying in the background…",
      };
    case "restarting":
      return {
        title: "Server restarting",
        detail: "The API is starting up or recovering. Your session is kept open.",
      };
    case "auth_expired":
      return {
        title: "Authentication expired",
        detail: "Please sign in again to continue.",
      };
    case "unavailable":
      return {
        title: "API unavailable",
        detail: `Cannot reach ${getApiOrigin()}. Retrying…`,
      };
    default:
      return {
        title: "Connection issue",
        detail: "Unexpected connectivity problem. Retrying…",
      };
  }
}

function classify(
  res: {
    ok: boolean;
    status?: number;
    error?: string;
    failureKind?: string;
    body?: unknown;
  },
  offline: boolean
): HealthFailureKind {
  if (offline) return "offline";
  if (res.failureKind === "timeout") return "timeout";
  if (res.failureKind === "restarting") return "restarting";
  if (res.failureKind === "offline") return "offline";
  if (res.failureKind === "unavailable") return "unavailable";

  const err = (res.error || "").toLowerCase();
  if (/abort|timed out|timeout/i.test(err)) return "timeout";
  if (res.status === 401 || /session|unauthorized|401/i.test(err)) return "auth_expired";
  if (res.status === 503 || /not ready|degraded|restart/i.test(err)) return "restarting";
  if (/failed to fetch|network|cannot reach|load failed/i.test(err) || !res.status) {
    return "unavailable";
  }
  return "unknown";
}

function toUiLevel(
  kind: HealthFailureKind,
  failures: number,
  hadSuccessBefore: boolean
): HealthUiLevel {
  if (kind === "offline") return "offline";
  if (kind === "auth_expired") return "hard";
  // Soft: first failures, timeouts, restarts — keep CRM usable
  if (kind === "timeout" || kind === "restarting") return "soft";
  if (failures < 3) return "soft";
  if (hadSuccessBefore && failures < 5) return "soft";
  return "hard";
}

function logFailureOnce(kind: HealthFailureKind, detail: string) {
  const key = `${kind}:${detail.slice(0, 100)}`;
  if (key === lastLoggedKey) return;
  lastLoggedKey = key;
  console.warn(`[health-probe] ${kind}: ${detail}`);
}

/**
 * Run one health probe (success cache + single-flight).
 */
export async function runHealthProbe(opts?: {
  force?: boolean;
  offline?: boolean;
}): Promise<HealthProbeState> {
  const offline =
    opts?.offline ??
    (typeof navigator !== "undefined" ? navigator.onLine === false : false);

  if (offline) {
    consecutiveFailures = Math.max(consecutiveFailures, 1);
    const kind: HealthFailureKind = "offline";
    const m = messagesFor(kind);
    logFailureOnce(kind, m.detail);
    return {
      level: "offline",
      kind,
      title: m.title,
      detail: m.detail,
      checking: false,
      consecutiveFailures,
      lastOkAt,
      nextRetryInMs: null,
    };
  }

  const now = Date.now();
  if (!opts?.force && lastOkAt != null && now - lastOkAt < SUCCESS_CACHE_MS) {
    return {
      level: "ok",
      kind: null,
      title: "Connected",
      detail: null,
      checking: false,
      consecutiveFailures: 0,
      lastOkAt,
      nextRetryInMs: SUCCESS_CACHE_MS - (now - lastOkAt),
    };
  }

  if (inFlight && !opts?.force) return inFlight;

  const work = (async (): Promise<HealthProbeState> => {
    const res = await api.checkHealth(PROBE_TIMEOUT_MS);
    if (res.ok) {
      lastOkAt = Date.now();
      consecutiveFailures = 0;
      lastLoggedKey = null;
      return {
        level: "ok",
        kind: null,
        title: "Connected",
        detail: null,
        checking: false,
        consecutiveFailures: 0,
        lastOkAt,
        nextRetryInMs: SUCCESS_CACHE_MS,
      };
    }

    consecutiveFailures += 1;
    const kind = classify(res, false);
    const m = messagesFor(kind);
    const detail = res.error || m.detail;
    logFailureOnce(kind, detail);
    const level = toUiLevel(kind, consecutiveFailures, lastOkAt != null);
    return {
      level,
      kind,
      title: m.title,
      detail,
      checking: false,
      consecutiveFailures,
      lastOkAt,
      nextRetryInMs: backoffMs(consecutiveFailures),
    };
  })();

  inFlight = work.finally(() => {
    if (inFlight === work) inFlight = null;
  }) as Promise<HealthProbeState>;

  // Attach result type
  return work;
}

export function getHealthBackoffMs(failures = consecutiveFailures): number {
  return backoffMs(failures);
}

export function resetHealthProbeForTests() {
  lastOkAt = null;
  consecutiveFailures = 0;
  lastLoggedKey = null;
  inFlight = null;
}
