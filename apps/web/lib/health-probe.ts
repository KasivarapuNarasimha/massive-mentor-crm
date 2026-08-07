/**
 * Resilient API connectivity probing for the CRM shell.
 * - Exponential backoff: 5s → 10s → 20s → max 60s
 * - Success cache ~45s
 * - Differentiated failure kinds
 * - Shared cached snapshot for System Status UI (no extra requests)
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

export type ServiceStatus = "up" | "down" | "degraded" | "not_configured" | "unknown";

export type HealthProbeState = {
  level: HealthUiLevel;
  kind: HealthFailureKind | null;
  title: string;
  detail: string | null;
  checking: boolean;
  consecutiveFailures: number;
  lastOkAt: number | null;
  nextRetryInMs: number | null;
  /** Last measured RTT (ms) from probe */
  latencyMs: number | null;
  /** Last successful check timestamp (ms epoch) */
  lastSuccessAt: number | null;
  /** Parsed service statuses from last response body (cached) */
  services: {
    api: ServiceStatus;
    database: ServiceStatus;
    ai: ServiceStatus;
    whatsapp: ServiceStatus;
    email: ServiceStatus;
  };
};

export type HealthListener = (state: HealthProbeState) => void;

const SUCCESS_CACHE_MS = 45_000;
const BACKOFF_STEPS_MS = [5_000, 10_000, 20_000, 60_000] as const;
const PROBE_TIMEOUT_MS = 8_000;

let lastOkAt: number | null = null;
let consecutiveFailures = 0;
let lastLoggedKey: string | null = null;
let inFlight: Promise<HealthProbeState> | null = null;
let lastLatencyMs: number | null = null;
let lastSuccessAt: number | null = null;
let lastServices: HealthProbeState["services"] = {
  api: "unknown",
  database: "unknown",
  ai: "unknown",
  whatsapp: "unknown",
  email: "unknown",
};
let lastPublished: HealthProbeState | null = null;
const listeners = new Set<HealthListener>();

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

function mapCheckStatus(raw: unknown): ServiceStatus {
  const s = String(raw || "").toLowerCase();
  if (s === "up" || s === "ok" || s === "true") return "up";
  if (s === "down" || s === "false") return "down";
  if (s === "degraded" || s === "timeout") return "degraded";
  if (s === "not_configured" || s === "not-configured") return "not_configured";
  return "unknown";
}

/** Merge service map from /ready or /health body without inventing data. */
function parseServicesFromBody(
  body: unknown,
  opts: { apiUp: boolean; ready?: boolean }
): HealthProbeState["services"] {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const checks = (b.checks && typeof b.checks === "object"
    ? b.checks
    : {}) as Record<string, unknown>;

  const dbFromChecks = checks.database as { status?: string } | string | undefined;
  const dbStatus =
    typeof dbFromChecks === "object" && dbFromChecks
      ? mapCheckStatus(dbFromChecks.status)
      : typeof dbFromChecks === "string"
        ? mapCheckStatus(dbFromChecks)
        : mapCheckStatus(b.database);

  const ai = checks.ai as { status?: string } | undefined;
  const smtp = checks.smtp as { status?: string; configured?: boolean } | undefined;
  const wa = checks.whatsapp as { status?: string } | undefined;
  const legacySmtp = b.smtp as { configured?: boolean } | undefined;

  let email: ServiceStatus = "unknown";
  if (smtp?.status) email = mapCheckStatus(smtp.status);
  else if (typeof smtp?.configured === "boolean")
    email = smtp.configured ? "up" : "not_configured";
  else if (typeof legacySmtp?.configured === "boolean")
    email = legacySmtp.configured ? "up" : "not_configured";

  // Preserve previously known optional services when this response is /ready-only
  const prev = lastServices;
  return {
    api: opts.apiUp ? (opts.ready === false ? "degraded" : "up") : "down",
    database:
      dbStatus !== "unknown"
        ? dbStatus
        : opts.ready === true
          ? "up"
          : opts.ready === false
            ? "down"
            : prev.database,
    ai: ai?.status ? mapCheckStatus(ai.status) : prev.ai,
    whatsapp: wa?.status ? mapCheckStatus(wa.status) : prev.whatsapp,
    email: email !== "unknown" ? email : prev.email,
  };
}

function publish(state: HealthProbeState): HealthProbeState {
  lastPublished = state;
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      /* ignore subscriber errors */
    }
  });
  return state;
}

function buildState(partial: Omit<HealthProbeState, "latencyMs" | "lastSuccessAt" | "services"> & {
  latencyMs?: number | null;
  lastSuccessAt?: number | null;
  services?: HealthProbeState["services"];
}): HealthProbeState {
  return {
    ...partial,
    latencyMs: partial.latencyMs ?? lastLatencyMs,
    lastSuccessAt: partial.lastSuccessAt ?? lastSuccessAt,
    services: partial.services ?? lastServices,
  };
}

/** Subscribe to probe updates (System Status indicator). */
export function subscribeHealthProbe(listener: HealthListener): () => void {
  listeners.add(listener);
  if (lastPublished) listener(lastPublished);
  return () => {
    listeners.delete(listener);
  };
}

/** Sync read of last published state (no network). */
export function getHealthSnapshot(): HealthProbeState | null {
  return lastPublished;
}

/**
 * Run one health probe (success cache + single-flight).
 * Does not perform extra requests beyond the shared probe used by the banner.
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
    lastServices = {
      ...lastServices,
      api: "down",
    };
    return publish(
      buildState({
        level: "offline",
        kind,
        title: m.title,
        detail: m.detail,
        checking: false,
        consecutiveFailures,
        lastOkAt,
        nextRetryInMs: null,
        services: lastServices,
      })
    );
  }

  const now = Date.now();
  if (!opts?.force && lastOkAt != null && now - lastOkAt < SUCCESS_CACHE_MS) {
    return publish(
      buildState({
        level: "ok",
        kind: null,
        title: "Connected",
        detail: null,
        checking: false,
        consecutiveFailures: 0,
        lastOkAt,
        nextRetryInMs: SUCCESS_CACHE_MS - (now - lastOkAt),
      })
    );
  }

  if (inFlight && !opts?.force) return inFlight;

  const work = (async (): Promise<HealthProbeState> => {
    const res = await api.checkHealth(PROBE_TIMEOUT_MS);
    if (typeof res.latencyMs === "number") lastLatencyMs = res.latencyMs;

    if (res.ok) {
      lastOkAt = Date.now();
      lastSuccessAt = lastOkAt;
      consecutiveFailures = 0;
      lastLoggedKey = null;
      lastServices = parseServicesFromBody(res.body, {
        apiUp: true,
        ready: res.ready !== false,
      });
      return publish(
        buildState({
          level: "ok",
          kind: null,
          title: "Connected",
          detail: null,
          checking: false,
          consecutiveFailures: 0,
          lastOkAt,
          nextRetryInMs: SUCCESS_CACHE_MS,
          latencyMs: lastLatencyMs,
          lastSuccessAt,
          services: lastServices,
        })
      );
    }

    consecutiveFailures += 1;
    const kind = classify(res, false);
    const m = messagesFor(kind);
    const detail = res.error || m.detail;
    logFailureOnce(kind, detail);
    const level = toUiLevel(kind, consecutiveFailures, lastOkAt != null);

    // Update API/DB from failure when body present; keep last-known optional services
    lastServices = parseServicesFromBody(res.body, {
      apiUp: kind === "restarting" || (res.status != null && res.status > 0),
      ready: res.ready,
    });
    if (kind === "unavailable" || kind === "timeout" || kind === "offline") {
      lastServices = { ...lastServices, api: "down" };
    }

    return publish(
      buildState({
        level,
        kind,
        title: m.title,
        detail,
        checking: false,
        consecutiveFailures,
        lastOkAt,
        nextRetryInMs: backoffMs(consecutiveFailures),
        latencyMs: lastLatencyMs,
        services: lastServices,
      })
    );
  })();

  inFlight = work.finally(() => {
    if (inFlight === work) inFlight = null;
  }) as Promise<HealthProbeState>;

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
  lastLatencyMs = null;
  lastSuccessAt = null;
  lastServices = {
    api: "unknown",
    database: "unknown",
    ai: "unknown",
    whatsapp: "unknown",
    email: "unknown",
  };
  lastPublished = null;
  listeners.clear();
}
