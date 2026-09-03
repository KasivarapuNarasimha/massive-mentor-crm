// IMPORTANT: Must be the very first import.
// In ESM, all static imports are hoisted and evaluated before any other code.
// Using the side-effect import form guarantees dotenv runs before any module
// that reads process.env (including config/env.ts) is evaluated.
import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import type { Server } from "node:http";

// Validate all environment variables using Zod (fail fast)
import { env } from "./config/env.js";
import { requestContext } from "./middleware/requestContext.js";
import { log, logError } from "./lib/logger.js";
import type { AuthenticatedRequest } from "./middleware/auth.js";

const app = express();
const PORT = env.PORT;
const isProd = env.NODE_ENV === "production";

// Behind Nginx / load balancer
if (env.TRUST_PROXY || isProd) {
  app.set("trust proxy", 1);
}

// Security headers (helmet) — API must allow cross-origin browser clients.
// Default CORP "same-origin" can interfere with credentialed cross-origin fetches.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    frameguard: { action: "deny" },
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: "no-referrer" },
  })
);
app.disable("x-powered-by");

/**
 * CORS allowlist for browser SPA clients.
 * credentials:true requires reflecting the request Origin (never "*").
 *
 * Production portals (must be allowed or browser blocks POST after OPTIONS):
 *   https://crm.massivementor.in  (primary customer CRM)
 *   https://app.massivementor.in  (legacy alias)
 *   https://admin.massivementor.in
 *   https://demo.massivementor.in
 */
function collectAllowedOrigins(): Set<string> {
  const set = new Set<string>();
  const add = (raw?: string | null) => {
    if (!raw) return;
    for (const part of String(raw).split(",")) {
      const o = part.trim().replace(/\/$/, "");
      if (o) set.add(o);
    }
  };

  // Explicit env lists
  add(env.FRONTEND_URL);
  add(env.CORS_ORIGINS);
  add(process.env.CORS_ORIGINS);
  // App public URLs (often the same host the SPA is served from)
  add(env.APP_URL);
  add(env.CUSTOMER_APP_URL);
  add(env.ADMIN_APP_URL);

  // Local defaults
  add("http://localhost:3000");
  add("http://localhost:3001");
  add("http://127.0.0.1:3000");
  add("http://127.0.0.1:3001");

  // Production SaaS portals (HTTPS) — never rely on stale FRONTEND_URL alone
  add("https://crm.massivementor.in");
  add("https://app.massivementor.in");
  add("https://admin.massivementor.in");
  add("https://demo.massivementor.in");
  add("https://api.massivementor.in");
  add("https://massivementor.in");

  // Legacy direct-IP UI — development / migration only (never in production allowlist)
  if (!isProd) {
    add("http://200.141.0.25:3000");
    add("http://200.141.0.25:3001");
  }

  return set;
}

const allowedOrigins = collectAllowedOrigins();

function isOriginAllowed(origin: string | undefined): boolean {
  // Non-browser clients (curl, server-to-server, same-origin proxy) send no Origin
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;

  try {
    const u = new URL(origin);
    // Legacy raw-IP UI — block in production (force HTTPS domain)
    if (u.hostname === "200.141.0.25" && u.protocol === "http:") {
      return !isProd;
    }

    // All first-party HTTPS portals: https://*.massivementor.in
    if (
      u.protocol === "https:" &&
      (u.hostname === "massivementor.in" || u.hostname.endsWith(".massivementor.in"))
    ) {
      return true;
    }

    if (!isProd) {
      const isLocal =
        u.hostname === "localhost" ||
        u.hostname === "127.0.0.1" ||
        u.hostname === "::1";
      if (isLocal) return true;
    }
  } catch {
    /* invalid origin */
  }
  return false;
}

console.log(
  `[cors] allowlist size=${allowedOrigins.size} sample=${[...allowedOrigins]
    .filter((o) => o.includes("massivementor") || o.includes("localhost"))
    .slice(0, 12)
    .join(", ")}`
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        // Reflect the request Origin so Access-Control-Allow-Origin is set
        // on both preflight (OPTIONS) and the actual POST/GET response.
        return callback(null, origin || true);
      }
      console.warn(`[cors] blocked origin=${origin || "(none)"}`);
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "Origin",
      "X-Requested-With",
    ],
    exposedHeaders: ["Content-Disposition"],
    optionsSuccessStatus: 204,
    preflightContinue: false,
    maxAge: 86400,
  })
);

// NOTE: Custom gzip-on-res.json was removed — it left connections in CLOSE_WAIT on
// Windows and caused intermittent browser "Failed to fetch". Prefer reverse-proxy
// compression (Nginx) or the `compression` package if needed.

// Structured request context + access logs (no bodies / secrets)
app.use(requestContext);

// Razorpay webhook needs raw body for HMAC verification (must be before json parser)
app.post(
  "/api/payments/razorpay/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const { razorpayWebhook } = await import("./controllers/billing.controller.js");
    return razorpayWebhook(req, res);
  }
);

// Meta WhatsApp Cloud API webhook — PUBLIC (before billing/auth).
// GET: hub verification. POST: raw body for X-Hub-Signature-256.
app.get("/api/integrations/whatsapp/webhook", async (req, res) => {
  const { whatsAppWebhookVerify } = await import(
    "./controllers/whatsapp-webhook.controller.js"
  );
  return whatsAppWebhookVerify(req, res);
});
app.post(
  "/api/integrations/whatsapp/webhook",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    const { whatsAppWebhookReceive } = await import(
      "./controllers/whatsapp-webhook.controller.js"
    );
    return whatsAppWebhookReceive(req, res);
  }
);

// 10mb for pasted CSV text; large Excel files use multipart /import/file instead
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Liveness: always 200 if the process can respond (status field may be "degraded").
// Never hang: DB check is hard-timed-out inside buildHealthReport.
// Connectivity banners should treat any HTTP response as "API process up".
app.get("/health", async (_req, res) => {
  try {
    const { buildHealthReport } = await import("./lib/health-checks.js");
    const report = await buildHealthReport();
    // HTTP 200 = process alive (PM2/nginx liveness). Use report.status for dependency health.
    res.status(200).json(report);
  } catch (err) {
    logError(err, { module: "health", function: "GET /health" });
    res.status(200).json({
      status: "degraded",
      service: "massive-mentor-api",
      database: "down",
      error: "health_check_failed",
      timestamp: new Date().toISOString(),
    });
  }
});

// Readiness: 503 only when DB cannot serve traffic (orchestrators / deploy gates)
app.get("/ready", async (_req, res) => {
  try {
    const { buildReadyReport } = await import("./lib/health-checks.js");
    const report = await buildReadyReport();
    res.status(report.ready ? 200 : 503).json(report);
  } catch {
    res.status(503).json({ ready: false, timestamp: new Date().toISOString() });
  }
});

// Import routes
import authRoutes from "./routes/auth.routes.js";
import profileRoutes from "./routes/profile.routes.js";
import healthRoutes from "./routes/health.routes.js";
import aiRoutes from "./routes/ai.routes.js";
import swotRoutes from "./routes/swot.routes.js";
import mentorRoutes from "./routes/mentor.routes.js";
import aiCommandRoutes from "./routes/ai-command.routes.js";
import roadmapRoutes from "./routes/roadmap.routes.js";
import marketingRoutes from "./routes/marketing.routes.js";
import crmRoutes from "./routes/crm.routes.js";
import automationRoutes from "./routes/automation.routes.js";
import integrationRoutes from "./routes/integration.routes.js";
import teamRoutes from "./routes/team.routes.js";
import reportRoutes from "./routes/report.routes.js";
import businessRoutes from "./routes/business.routes.js";
import templateRoutes from "./routes/template.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import portalRoutes from "./routes/portal.routes.js";
import userAdminRoutes from "./routes/user-admin.routes.js";
import financeRoutes from "./routes/finance.routes.js";
import erpRoutes from "./routes/erp.routes.js";
import locationRoutes from "./routes/location.routes.js";
import platformRoutes from "./routes/platform.routes.js";
import demoRoutes from "./routes/demo.routes.js";
import leadsRoutes from "./routes/leads.routes.js";
import backupRoutes from "./routes/backup.routes.js";
import approvalRoutes from "./routes/approval.routes.js";
import billingRoutes from "./routes/billing.routes.js";
import securityRoutes from "./routes/security.routes.js";
import mediaRoutes from "./routes/media.routes.js";
import whatsappInboxRoutes from "./routes/whatsapp-inbox.routes.js";
import customFieldsRoutes from "./routes/custom-fields.routes.js";
import { seedIndustryTemplates } from "./services/template.service.js";
import { startBackupScheduler, stopBackupScheduler } from "./services/backup.service.js";
import { apiGeneralLimiter } from "./middleware/rateLimiter.js";
import { requireBillingAccess } from "./middleware/requireBillingAccess.js";
import { ensureSubscriptionPlans } from "./services/subscription-plan.service.js";
import { runDailyBillingJobs } from "./services/saas-billing.service.js";

// General API abuse protection: verified Bearer tokens receive a user-scoped
// bucket; unauthenticated or invalid-token traffic remains IP-scoped.
app.use("/api", apiGeneralLimiter);

// SaaS trial/subscription gate (allows /api/billing/* and auth; webhook is public)
app.use("/api", requireBillingAccess);

// —— Three-portal API surfaces (production SaaS isolation) ——
app.use("/api/platform", platformRoutes);
app.use("/api/demo", demoRoutes);

// Module permission gate — path → CrmModule; Super Admin catalog is DB-seeded
import { requireModuleFromPath } from "./middleware/requireModule.js";
import { requireAuth as requireAuthMw } from "./middleware/auth.js";

// Mount API routes (auth + module gate on tenant CRM surfaces)
app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
// AI test endpoint — require auth + any AI-related module
app.use("/api/ai", requireAuthMw, requireModuleFromPath, aiRoutes);
app.use("/api/health-score", requireAuthMw, requireModuleFromPath, healthRoutes);
app.use("/api/swot", requireAuthMw, requireModuleFromPath, swotRoutes);
app.use("/api/mentor", requireAuthMw, requireModuleFromPath, mentorRoutes);
app.use("/api/ai-command", requireAuthMw, requireModuleFromPath, aiCommandRoutes);
app.use("/api/roadmap", requireAuthMw, requireModuleFromPath, roadmapRoutes);
app.use("/api/marketing", requireAuthMw, requireModuleFromPath, marketingRoutes);
app.use("/api/crm", requireAuthMw, requireModuleFromPath, crmRoutes);
app.use("/api/leads", requireAuthMw, requireModuleFromPath, leadsRoutes);
app.use("/api/automations", requireAuthMw, requireModuleFromPath, automationRoutes);
// Public WhatsApp webhook is registered earlier; authenticated integration routes below
app.use("/api/integrations", requireAuthMw, requireModuleFromPath, integrationRoutes);
app.use("/api/teams", requireAuthMw, requireModuleFromPath, teamRoutes);
app.use("/api/reports", requireAuthMw, requireModuleFromPath, reportRoutes);
app.use("/api/businesses", businessRoutes);
app.use("/api/templates", templateRoutes);
/** Custom Fields engine — definitions in BusinessConfig; auth on router */
app.use("/api/custom-fields", customFieldsRoutes);
app.use("/api/dashboards", requireAuthMw, requireModuleFromPath, dashboardRoutes);
app.use("/api/portal", portalRoutes);
app.use("/api/business-users", requireAuthMw, requireModuleFromPath, userAdminRoutes);
app.use("/api/finance", requireAuthMw, requireModuleFromPath, financeRoutes);
/** ERP Phase 1 — route-level requireModule(erp|finance|approvals); path gate also maps /api/erp → erp */
app.use("/api/erp", requireAuthMw, requireModuleFromPath, erpRoutes);
app.use("/api/location", requireAuthMw, requireModuleFromPath, locationRoutes);
app.use("/api/backups", requireAuthMw, requireModuleFromPath, backupRoutes);
app.use("/api/approvals", requireAuthMw, requireModuleFromPath, approvalRoutes);
// billing/access + stream exempt inside requireModuleFromPath
app.use("/api/billing", requireAuthMw, requireModuleFromPath, billingRoutes);
app.use("/api/security", requireAuthMw, requireModuleFromPath, securityRoutes);
// Public media share links (token-gated, no session) — must mount before auth-wrapped /api/media
import {
  publicShareFile as mediaPublicShareFile,
  publicShareMeta as mediaPublicShareMeta,
} from "./controllers/media.controller.js";
app.get("/api/media/public/:token/meta", mediaPublicShareMeta);
app.get("/api/media/public/:token", mediaPublicShareFile);
app.post("/api/media/public/:token", mediaPublicShareFile);
app.use("/api/media", requireAuthMw, requireModuleFromPath, mediaRoutes);
app.use("/api/whatsapp", requireAuthMw, requireModuleFromPath, whatsappInboxRoutes);

app.get("/api", (_req, res) => {
  res.json({
    message: "Massive Mentor API",
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth",
      billing: "/api/billing (access, stream SSE, overview, checkout)",
      billingStream: "GET /api/billing/stream (SSE, requires Bearer token)",
      platform: "/api/platform",
      backups: "/api/backups (tenant) | /api/platform/backups (super admin)",
      crm: "/api/crm",
      health: "/health",
      ready: "/ready",
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
    path: req.originalUrl,
  });
});

// Error handler — structured log + request correlation; never leak stack in production
app.use((
  err: Error,
  req: express.Request,
  res: express.Response,
  _next: express.NextFunction
) => {
  const areq = req as AuthenticatedRequest;
  logError(err, {
    module: "express",
    function: "errorHandler",
    requestId: areq.requestId,
    userId: areq.user?.id,
    businessId: areq.tenant?.businessId ?? null,
    endpoint: req.originalUrl,
    method: req.method,
  });
  res.status(500).json({
    success: false,
    error: isProd ? "Internal server error" : err.message || "Internal server error",
    requestId: areq.requestId,
  });
});

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role?: string;
        platformRole?: string;
      };
    }
  }
}

let server: Server;

server = app.listen(PORT, () => {
  console.log(`🚀 Massive Mentor API running on port ${PORT}`);
  console.log(`   Environment: ${env.NODE_ENV}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Ready:  http://localhost:${PORT}/ready`);

  seedIndustryTemplates().catch((err) => {
    console.error("[templates] boot seed failed:", err instanceof Error ? err.message : err);
  });
  import("./scripts/seed-portals.js")
    .then((m) => m.seedPortals())
    .catch((err) => {
      console.error("[portals] boot seed failed:", err instanceof Error ? err.message : err);
    });
  ensureSubscriptionPlans().catch((err) => {
    console.error("[plans] seed failed:", err instanceof Error ? err.message : err);
  });
  import("./services/permissions.service.js")
    .then((m) => m.ensurePermissionCatalogSeeded())
    .catch((err) => {
      console.error("[permissions] seed failed:", err instanceof Error ? err.message : err);
    });

  startBackupScheduler();

  // Daily SaaS billing job — multi-instance safe via Postgres advisory lock
  const runBilling = async () => {
    const { runMonitoredJob, recordJobSkipped } = await import("./lib/job-monitor.js");
    await runMonitoredJob("saas-billing-daily", async () => {
      const { withDistributedLock } = await import("./lib/distributed-lock.js");
      const { ran, result } = await withDistributedLock("saas-billing-daily", () =>
        runDailyBillingJobs()
      );
      if (!ran) {
        recordJobSkipped("saas-billing-daily", "lock_held_by_other_instance");
        return { skipped: true };
      }
      log.info("billing-job.complete", {
        job: "saas-billing-daily",
        lockedTrials: result?.lockedTrials,
        lockedSubs: result?.lockedSubs,
        reminders: result?.reminders,
        renewals: result?.renewalReminders,
      });
      return result;
    });
  };
  setTimeout(runBilling, 60_000);
  setInterval(runBilling, 6 * 60 * 60 * 1000);

  // Daily Admin team activity email — hourly check; per-business skip if already sent (UTC day)
  const runTeamDailyReport = async () => {
    const { runMonitoredJob, recordJobSkipped } = await import("./lib/job-monitor.js");
    await runMonitoredJob("team-activity-daily-report", async () => {
      const { withDistributedLock } = await import("./lib/distributed-lock.js");
      const { sendTeamDailyReportsForAllBusinesses } = await import(
        "./services/team-daily-report.service.js"
      );
      const { ran, result } = await withDistributedLock("team-activity-daily-report", () =>
        sendTeamDailyReportsForAllBusinesses()
      );
      if (!ran) {
        recordJobSkipped("team-activity-daily-report", "lock_held_by_other_instance");
        return { skipped: true };
      }
      log.info("team-daily-report.complete", {
        job: "team-activity-daily-report",
        businesses: result?.businesses,
        emailsSent: result?.emailsSent,
        skipped: result?.skipped,
      });
      return result;
    });
  };
  // First run ~5 min after boot; then hourly (idempotent per business/day)
  setTimeout(runTeamDailyReport, 5 * 60_000);
  setInterval(runTeamDailyReport, 60 * 60 * 1000);

  // WhatsApp enterprise: expired snoozes + SLA escalations (multi-instance safe)
  const runWaEnterprise = async () => {
    const { runMonitoredJob, recordJobSkipped } = await import("./lib/job-monitor.js");
    await runMonitoredJob("whatsapp-enterprise-jobs", async () => {
      const { withDistributedLock } = await import("./lib/distributed-lock.js");
      const ent = await import("./services/whatsapp-enterprise.service.js");
      const { ran, result } = await withDistributedLock("whatsapp-enterprise-jobs", () =>
        ent.processWhatsAppEnterpriseJobs()
      );
      if (!ran) {
        recordJobSkipped("whatsapp-enterprise-jobs", "lock_held_by_other_instance");
        return { skipped: true };
      }
      return result;
    });
  };
  setTimeout(runWaEnterprise, 90_000);
  setInterval(runWaEnterprise, 2 * 60 * 1000);

  log.info("scheduler.started", {
    jobs: [
      "saas-billing-daily",
      "team-activity-daily-report",
      "whatsapp-enterprise-jobs",
      "backup-scheduler",
    ],
  });
});

// Graceful shutdown (PM2 / zero-downtime reload)
async function shutdown(signal: string) {
  log.info("shutdown.start", { signal });
  stopBackupScheduler();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    setTimeout(resolve, 10000);
  });
  try {
    const { prisma } = await import("./lib/prisma.js");
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logError(reason, {
    module: "process",
    function: "unhandledRejection",
  });
});
process.on("uncaughtException", (err) => {
  logError(err, {
    module: "process",
    function: "uncaughtException",
  });
  void shutdown("uncaughtException");
});
