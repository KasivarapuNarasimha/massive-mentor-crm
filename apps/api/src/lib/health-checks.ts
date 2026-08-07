/**
 * Aggregated readiness/liveness checks for /health and /ready.
 * Never exposes secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { getJobMonitorSnapshot } from "./job-monitor.js";
import { getMetricsSnapshot, recordDbLatency } from "./metrics.js";

export type CheckStatus = "up" | "down" | "degraded" | "not_configured";

async function checkDatabase(): Promise<{ status: CheckStatus; latencyMs: number | null }> {
  const t0 = Date.now();
  try {
    const { prisma } = await import("./prisma.js");
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - t0;
    recordDbLatency(latencyMs);
    return { status: "up", latencyMs };
  } catch {
    return { status: "down", latencyMs: Date.now() - t0 };
  }
}

function checkStorage(): { status: CheckStatus; path: string; writable: boolean } {
  const root =
    process.env.MEDIA_STORAGE_DIR ||
    process.env.BACKUP_DIR ||
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
  const key =
    provider === "openai" ? env.OPENAI_API_KEY : env.GROQ_API_KEY;
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
  // Presence only — connection is optional for rate limits (PG fallback)
  return { status: "up" };
}

function checkWhatsApp(): { status: CheckStatus } {
  // Integration is per-tenant; platform-level = routes mounted
  return { status: "up" };
}

export async function buildHealthReport() {
  const [database] = await Promise.all([checkDatabase()]);
  const storage = checkStorage();
  const ai = checkAi();
  const smtp = checkSmtp();
  const redis = checkRedis();
  const whatsapp = checkWhatsApp();
  const jobs = getJobMonitorSnapshot();
  const metrics = getMetricsSnapshot();

  const criticalDown = database.status === "down" || storage.status === "down";
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
        // Back-compat with prior /health shape
        configured: smtp.status === "up",
      },
      redis,
      whatsapp,
    },
    // Legacy top-level fields (keep for existing monitors)
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
  const storage = checkStorage();
  const ready = database.status === "up" && storage.status === "up";
  return {
    ready,
    database: database.status,
    databaseLatencyMs: database.latencyMs,
    storage: storage.status,
    timestamp: new Date().toISOString(),
  };
}
