/**
 * Aggregated readiness/liveness checks for /health and /ready.
 * Never exposes secrets. Never hangs: DB checks are hard-timed out.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { getJobMonitorSnapshot } from "./job-monitor.js";
import { getMetricsSnapshot, recordDbLatency } from "./metrics.js";

export type CheckStatus = "up" | "down" | "degraded" | "not_configured" | "timeout";

const DB_CHECK_TIMEOUT_MS = 2_000;

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}_timeout_${ms}ms`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkDatabase(): Promise<{
  status: CheckStatus;
  latencyMs: number | null;
}> {
  const t0 = Date.now();
  try {
    await withTimeout(
      (async () => {
        const { prisma } = await import("./prisma.js");
        await prisma.$queryRaw`SELECT 1`;
      })(),
      DB_CHECK_TIMEOUT_MS,
      "db"
    );
    const latencyMs = Date.now() - t0;
    recordDbLatency(latencyMs);
    return { status: "up", latencyMs };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const latencyMs = Date.now() - t0;
    return {
      status: /timeout/i.test(msg) ? "timeout" : "down",
      latencyMs,
    };
  }
}

function checkStorage(): { status: CheckStatus; path: string; writable: boolean } {
  // Prefer app-local storage — do not fail readiness on misconfigured BACKUP_DIR
  const root =
    process.env.MEDIA_STORAGE_DIR ||
    path.resolve(process.cwd(), "storage");
  let writable = false;
  try {
    fs.mkdirSync(root, { recursive: true });
    const probe = path.join(root, `.health-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    writable = true;
  } catch {
    writable = false;
  }
  return {
    status: writable ? "up" : "down",
    path: root,
    writable,
  };
}

function checkAi(): { status: CheckStatus; provider: string } {
  const provider = env.AI_PROVIDER || "groq";
  const key = provider === "openai" ? env.OPENAI_API_KEY : env.GROQ_API_KEY;
  if (key && key.length > 20 && !/placeholder|your-key/i.test(key)) {
    return { status: "up", provider };
  }
  return { status: "not_configured", provider };
}

function checkSmtp(): {
  status: CheckStatus;
  host: string | null;
  user: string | null;
} {
  const host = (env.SMTP_HOST || "").trim();
  const user = (env.SMTP_USER || "").trim();
  const pass = (env.SMTP_PASS || "").trim();
  const ok = !!(host && user && pass);
  return {
    status: ok ? "up" : "not_configured",
    host: host || null,
    user: user ? `${user.slice(0, 2)}***@${user.split("@")[1] || ""}` : null,
  };
}

function checkRedis(): { status: CheckStatus } {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return { status: "not_configured" };
  return { status: "up" };
}

function checkWhatsApp(): { status: CheckStatus } {
  return { status: "up" };
}

export async function buildHealthReport() {
  const database = await checkDatabase();
  const storage = checkStorage();
  const ai = checkAi();
  const smtp = checkSmtp();
  const redis = checkRedis();
  const whatsapp = checkWhatsApp();
  const jobs = getJobMonitorSnapshot();
  const metrics = getMetricsSnapshot();

  // Degraded if DB bad; storage is informational only (not critical for liveness)
  const criticalDown =
    database.status === "down" || database.status === "timeout";
  const status = criticalDown ? "degraded" : "ok";

  return {
    status,
    service: "massive-mentor-api",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: env.NODE_ENV,
    checks: {
      database: {
        status: database.status,
        latencyMs: database.latencyMs,
      },
      storage,
      ai,
      smtp: {
        status: smtp.status,
        host: smtp.host,
        user: smtp.user,
        port: env.SMTP_PORT ?? null,
        secure: env.SMTP_SECURE === true || Number(env.SMTP_PORT) === 465,
        from: (env.SMTP_FROM || "").trim() || null,
        configured: smtp.status === "up",
      },
      redis,
      whatsapp,
    },
    database: database.status === "up" ? "up" : "down",
    smtp: {
      configured: smtp.status === "up",
      host: smtp.host,
      port: env.SMTP_PORT ?? null,
      secure: env.SMTP_SECURE === true || Number(env.SMTP_PORT) === 465,
      user: smtp.user,
      from: (env.SMTP_FROM || "").trim() || null,
    },
    jobs: {
      running: jobs.running.map((j) => j.name),
      last: Object.fromEntries(
        Object.entries(jobs.lastByJob).map(([k, v]) => [
          k,
          {
            status: v.status,
            durationMs: v.durationMs,
            endedAt: v.endedAt,
            error: v.error ? "[see logs]" : undefined,
          },
        ])
      ),
    },
    metrics: {
      http: metrics.http,
      database: metrics.database,
      process: metrics.process,
    },
  };
}

export async function buildReadyReport() {
  const database = await checkDatabase();
  // Readiness = DB only. Storage failure must not take the site offline.
  const ready = database.status === "up";
  return {
    ready,
    database: database.status,
    databaseLatencyMs: database.latencyMs,
    storage: checkStorage().status,
    timestamp: new Date().toISOString(),
  };
}
