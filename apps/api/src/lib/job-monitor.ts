/**
 * Background job observability — in-memory ring buffer + structured logs.
 * No schema change; ops can scrape logs or /health.jobs
 */
import { log, logError } from "./logger.js";

export type JobStatus = "running" | "success" | "failure" | "skipped";

export type JobRunRecord = {
  name: string;
  status: JobStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  retryCount: number;
  error?: string;
  meta?: Record<string, unknown>;
};

const MAX_HISTORY = 100;
const history: JobRunRecord[] = [];
const lastByName = new Map<string, JobRunRecord>();
const running = new Map<string, JobRunRecord>();

function pushHistory(rec: JobRunRecord) {
  history.unshift(rec);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  lastByName.set(rec.name, rec);
}

/**
 * Run a named background job with timing + success/failure tracking.
 */
export async function runMonitoredJob<T>(
  name: string,
  fn: () => Promise<T>,
  opts?: { retryCount?: number; meta?: Record<string, unknown> }
): Promise<{ ok: boolean; result?: T; skipped?: boolean }> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const rec: JobRunRecord = {
    name,
    status: "running",
    startedAt,
    retryCount: opts?.retryCount ?? 0,
    meta: opts?.meta,
  };
  running.set(name, rec);
  log.info("job.start", { job: name, retryCount: rec.retryCount, ...opts?.meta });

  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    const done: JobRunRecord = {
      ...rec,
      status: "success",
      endedAt: new Date().toISOString(),
      durationMs,
    };
    running.delete(name);
    pushHistory(done);
    log.info("job.end", {
      job: name,
      status: "success",
      durationMs,
      retryCount: done.retryCount,
    });
    return { ok: true, result };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    const done: JobRunRecord = {
      ...rec,
      status: "failure",
      endedAt: new Date().toISOString(),
      durationMs,
      error: message.slice(0, 500),
    };
    running.delete(name);
    pushHistory(done);
    logError(err, {
      module: "job-monitor",
      function: "runMonitoredJob",
      durationMs,
      retryCount: done.retryCount,
      meta: { job: name },
    });
    return { ok: false };
  }
}

export function recordJobSkipped(name: string, reason: string) {
  const rec: JobRunRecord = {
    name,
    status: "skipped",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: 0,
    retryCount: 0,
    meta: { reason },
  };
  pushHistory(rec);
  log.info("job.skipped", { job: name, reason });
}

export function getJobMonitorSnapshot() {
  return {
    running: [...running.values()],
    lastByJob: Object.fromEntries(lastByName.entries()),
    recent: history.slice(0, 30),
  };
}
