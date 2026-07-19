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
import { env } from "./config/env";

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
 * FRONTEND_URL / CORS_ORIGINS / APP_URL must include the UI origin (e.g. http://200.141.0.25:3000).
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

  // Deployed CRM UI (this VPS) — required when FRONTEND_URL was only localhost
  add("http://200.141.0.25:3000");
  add("http://200.141.0.25:3001");

  return set;
}

const allowedOrigins = collectAllowedOrigins();

function isOriginAllowed(origin: string | undefined): boolean {
  // Non-browser clients (curl, server-to-server, same-origin proxy) send no Origin
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;

  // Allow any port on the known public host when UI is re-bound (3000/3001/etc.)
  try {
    const u = new URL(origin);
    if (u.hostname === "200.141.0.25" && u.protocol === "http:") return true;
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

if (!isProd) {
  console.log(
    `[cors] allowed origins (${allowedOrigins.size}): ${[...allowedOrigins].join(", ")}`
  );
} else {
  console.log(`[cors] allowlist size=${allowedOrigins.size} (includes FRONTEND_URL + 200.141.0.25:3000)`);
}

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
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Disposition"],
    optionsSuccessStatus: 204,
    preflightContinue: false,
    maxAge: 86400,
  })
);

// NOTE: Custom gzip-on-res.json was removed — it left connections in CLOSE_WAIT on
// Windows and caused intermittent browser "Failed to fetch". Prefer reverse-proxy
// compression (Nginx) or the `compression` package if needed.

// Request logging (production-safe — no bodies)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    if (isProd || ms > 500 || res.statusCode >= 400) {
      console.log(
        `[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms` +
          (req.ip ? ` ip=${req.ip}` : "")
      );
    }
  });
  next();
});

// Razorpay webhook needs raw body for HMAC verification (must be before json parser)
app.post(
  "/api/payments/razorpay/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const { razorpayWebhook } = await import("@/controllers/billing.controller");
    return razorpayWebhook(req, res);
  }
);

// 10mb for pasted CSV text; large Excel files use multipart /import/file instead
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Health check (+ safe SMTP readiness; never exposes secrets)
app.get("/health", async (_req, res) => {
  const smtpHost = (env.SMTP_HOST || "").trim();
  const smtpUser = (env.SMTP_USER || "").trim();
  const smtpPass = (env.SMTP_PASS || "").trim();
  const smtpConfigured = !!(smtpHost && smtpUser && smtpPass);

  let dbOk = false;
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const status = dbOk ? "ok" : "degraded";
  res.status(dbOk ? 200 : 503).json({
    status,
    service: "massive-mentor-api",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: env.NODE_ENV,
    database: dbOk ? "up" : "down",
    smtp: {
      configured: smtpConfigured,
      host: smtpHost || null,
      port: env.SMTP_PORT ?? null,
      secure: env.SMTP_SECURE === true || Number(env.SMTP_PORT) === 465,
      user: smtpUser ? `${smtpUser.slice(0, 2)}***@${smtpUser.split("@")[1] || ""}` : null,
      from: (env.SMTP_FROM || "").trim() || null,
    },
  });
});

app.get("/ready", async (_req, res) => {
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ready: true });
  } catch {
    res.status(503).json({ ready: false });
  }
});

// Import routes
import authRoutes from "@/routes/auth.routes";
import profileRoutes from "@/routes/profile.routes";
import healthRoutes from "@/routes/health.routes";
import aiRoutes from "@/routes/ai.routes";
import swotRoutes from "@/routes/swot.routes";
import mentorRoutes from "@/routes/mentor.routes";
import roadmapRoutes from "@/routes/roadmap.routes";
import marketingRoutes from "@/routes/marketing.routes";
import crmRoutes from "@/routes/crm.routes";
import automationRoutes from "@/routes/automation.routes";
import integrationRoutes from "@/routes/integration.routes";
import teamRoutes from "@/routes/team.routes";
import reportRoutes from "@/routes/report.routes";
import businessRoutes from "@/routes/business.routes";
import templateRoutes from "@/routes/template.routes";
import dashboardRoutes from "@/routes/dashboard.routes";
import portalRoutes from "@/routes/portal.routes";
import userAdminRoutes from "@/routes/user-admin.routes";
import financeRoutes from "@/routes/finance.routes";
import locationRoutes from "@/routes/location.routes";
import platformRoutes from "@/routes/platform.routes";
import demoRoutes from "@/routes/demo.routes";
import leadsRoutes from "@/routes/leads.routes";
import backupRoutes from "@/routes/backup.routes";
import approvalRoutes from "@/routes/approval.routes";
import billingRoutes from "@/routes/billing.routes";
import securityRoutes from "@/routes/security.routes";
import { seedIndustryTemplates } from "@/services/template.service";
import { startBackupScheduler, stopBackupScheduler } from "@/services/backup.service";
import { apiGeneralLimiter } from "@/middleware/rateLimiter";
import { requireBillingAccess } from "@/middleware/requireBillingAccess";
import { ensureSubscriptionPlans } from "@/services/subscription-plan.service";
import { runDailyBillingJobs } from "@/services/saas-billing.service";

// General API abuse protection
app.use("/api", apiGeneralLimiter);

// SaaS trial/subscription gate (allows /api/billing/* and auth; webhook is public)
app.use("/api", requireBillingAccess);

// —— Three-portal API surfaces (production SaaS isolation) ——
app.use("/api/platform", platformRoutes);
app.use("/api/demo", demoRoutes);

// Mount API routes
app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/health-score", healthRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/swot", swotRoutes);
app.use("/api/mentor", mentorRoutes);
app.use("/api/roadmap", roadmapRoutes);
app.use("/api/marketing", marketingRoutes);
app.use("/api/crm", crmRoutes);
app.use("/api/leads", leadsRoutes);
app.use("/api/automations", automationRoutes);
app.use("/api/integrations", integrationRoutes);
app.use("/api/teams", teamRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/businesses", businessRoutes);
app.use("/api/templates", templateRoutes);
app.use("/api/dashboards", dashboardRoutes);
app.use("/api/portal", portalRoutes);
app.use("/api/business-users", userAdminRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/location", locationRoutes);
app.use("/api/backups", backupRoutes);
app.use("/api/approvals", approvalRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/security", securityRoutes);

app.get("/api", (_req, res) => {
  res.json({
    message: "Massive Mentor API",
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth",
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

// Error handler — never leak stack in production
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[API Error]", err.message);
  if (!isProd) console.error(err.stack);
  res.status(500).json({
    success: false,
    error: isProd ? "Internal server error" : err.message || "Internal server error",
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
  import("@/scripts/seed-portals")
    .then((m) => m.seedPortals())
    .catch((err) => {
      console.error("[portals] boot seed failed:", err instanceof Error ? err.message : err);
    });
  ensureSubscriptionPlans().catch((err) => {
    console.error("[plans] seed failed:", err instanceof Error ? err.message : err);
  });

  startBackupScheduler();

  // Daily SaaS billing job — multi-instance safe via Postgres advisory lock
  const runBilling = async () => {
    try {
      const { withDistributedLock } = await import("@/lib/distributed-lock");
      const { ran, result } = await withDistributedLock("saas-billing-daily", () =>
        runDailyBillingJobs()
      );
      if (!ran) {
        console.log("[billing-job] skipped (another instance holds the lock)");
        return;
      }
      console.log(
        `[billing-job] lockedTrials=${result?.lockedTrials} lockedSubs=${result?.lockedSubs} reminders=${result?.reminders} renewals=${result?.renewalReminders}`
      );
    } catch (err) {
      console.error("[billing-job]", err);
    }
  };
  setTimeout(runBilling, 60_000);
  setInterval(runBilling, 6 * 60 * 60 * 1000);
});

// Graceful shutdown (PM2 / zero-downtime reload)
async function shutdown(signal: string) {
  console.log(`[shutdown] ${signal} received — draining…`);
  stopBackupScheduler();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    setTimeout(resolve, 10000);
  });
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException", err);
  void shutdown("uncaughtException");
});
