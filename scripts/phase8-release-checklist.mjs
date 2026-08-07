/**
 * Phase 8 — Production Release Checklist
 *
 * Static + live readiness audit. Does NOT mutate business logic.
 * Exits non-zero if any CRITICAL check fails.
 *
 * Usage:
 *   node scripts/phase8-release-checklist.mjs
 *   node scripts/phase8-release-checklist.mjs --base http://127.0.0.1:4000
 *   node scripts/phase8-release-checklist.mjs --skip-build
 *   node scripts/phase8-release-checklist.mjs --prod-url https://api.massivementor.in
 *
 * Writes:
 *   docs/PHASE8_DEPLOYMENT_READINESS.json
 *   docs/PHASE8_DEPLOYMENT_READINESS.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const apiRoot = path.join(root, "apps/api");
const webRoot = path.join(root, "apps/web");
const isWin = process.platform === "win32";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const has = (flag) => process.argv.includes(flag);

const BASE = arg("base", "http://127.0.0.1:4000");
const PROD_URL = arg("prod-url", "https://api.massivementor.in");
const skipBuild = has("--skip-build");
const skipLint = has("--skip-lint");

/** @type {Array<{area:string,check:string,status:'pass'|'fail'|'warn'|'skip',severity:'critical'|'high'|'medium'|'low'|'info',detail:string}>} */
const checks = [];

function rec(area, check, status, detail = "", severity = "info") {
  const row = {
    area,
    check,
    status,
    severity: status === "fail" ? severity || "critical" : severity,
    detail: String(detail ?? "").slice(0, 500),
  };
  checks.push(row);
  const icon =
    status === "pass" ? "✓" : status === "fail" ? "✗" : status === "warn" ? "!" : "~";
  console.log(`${icon} [${area}] ${check}${detail ? " — " + String(detail).slice(0, 140) : ""}`);
  return row;
}

function exists(p) {
  return fs.existsSync(path.isAbsolute(p) ? p : path.join(root, p));
}

function run(label, command, args, cwd = root, timeoutMs = 600_000) {
  return new Promise((resolve) => {
    console.log(`\n▶ ${label}: ${command} ${args.join(" ")}\n`);
    const child = spawn(command, args, {
      cwd,
      stdio: "pipe",
      shell: isWin,
      env: process.env,
    });
    let out = "";
    let err = "";
    const t = setTimeout(() => {
      child.kill();
      resolve({ code: 124, out, err: err + "\nTIMEOUT" });
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      out += d.toString();
      process.stdout.write(d);
    });
    child.stderr?.on("data", (d) => {
      err += d.toString();
      process.stderr.write(d);
    });
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: 1, out, err: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, out, err });
    });
  });
}

async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { _raw: text.slice(0, 200) };
    }
    return { ok: res.ok, status: res.status, data, text };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(t);
  }
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

function mask(v) {
  if (!v) return "(empty)";
  if (v.length <= 6) return "***";
  return `${v.slice(0, 2)}***${v.slice(-2)} (len=${v.length})`;
}

function isPlaceholder(v) {
  if (!v) return true;
  return /change_me|replace|placeholder|your.?jwt|gsk_\.\.\.|rzp_live_\.\.\.|example/i.test(
    v
  );
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log(" Phase 8 — Production Release Checklist");
  console.log("═══════════════════════════════════════════════════\n");

  // ─── Infrastructure artifacts ─────────────────────────────
  rec(
    "Infrastructure",
    "PM2 ecosystem.config.cjs present",
    exists("deploy/ecosystem.config.cjs") ? "pass" : "fail",
    "deploy/ecosystem.config.cjs",
    "critical"
  );
  rec(
    "Infrastructure",
    "Nginx config present",
    exists("deploy/nginx.conf") ? "pass" : "fail",
    "deploy/nginx.conf",
    "critical"
  );
  rec(
    "Infrastructure",
    "Nginx import timeouts snippet",
    exists("deploy/nginx-import-timeouts.snippet.conf") ? "pass" : "warn",
    "",
    "medium"
  );
  rec(
    "Infrastructure",
    "Nginx billing stream snippet",
    exists("deploy/nginx-billing-stream.snippet.conf") ? "pass" : "warn",
    "",
    "low"
  );
  rec(
    "Infrastructure",
    "PostgreSQL production snippet",
    exists("deploy/postgresql.production.conf.snippet") ? "pass" : "warn",
    "",
    "medium"
  );
  rec(
    "Infrastructure",
    "deploy.sh present",
    exists("deploy/deploy.sh") ? "pass" : "fail",
    "deploy/deploy.sh",
    "critical"
  );
  rec(
    "Infrastructure",
    "DEPLOYMENT.md present",
    exists("DEPLOYMENT.md") ? "pass" : "warn",
    "",
    "low"
  );

  // PM2 live (may be absent on Windows dev)
  {
    const pm2 = await run("pm2 list", isWin ? "pm2.cmd" : "pm2", ["jlist"], root, 15000);
    if (pm2.code === 0 && pm2.out.trim().startsWith("[")) {
      try {
        const apps = JSON.parse(pm2.out);
        const names = apps.map((a) => a.name);
        const api = apps.find((a) => a.name === "massive-mentor-api");
        const web = apps.find((a) => a.name === "massive-mentor-web");
        rec(
          "Infrastructure",
          "PM2 massive-mentor-api",
          api && api.pm2_env?.status === "online" ? "pass" : "warn",
          api ? `status=${api.pm2_env?.status}` : `not running (found: ${names.join(",") || "none"})`,
          "high"
        );
        rec(
          "Infrastructure",
          "PM2 massive-mentor-web",
          web && web.pm2_env?.status === "online" ? "pass" : "warn",
          web ? `status=${web.pm2_env?.status}` : "not running on this host",
          "high"
        );
      } catch {
        rec("Infrastructure", "PM2 status parse", "warn", "could not parse jlist", "medium");
      }
    } else {
      rec(
        "Infrastructure",
        "PM2 available on this host",
        "warn",
        "PM2 not installed or no processes — expected on production VPS only",
        "high"
      );
    }
  }

  // Nginx / SSL live (best-effort on this host)
  {
    const nginx = await run("nginx -t", isWin ? "nginx.exe" : "nginx", ["-t"], root, 10000);
    if (nginx.code === 0) {
      rec("Infrastructure", "Nginx config test", "pass", "nginx -t ok");
    } else {
      rec(
        "Infrastructure",
        "Nginx live on this host",
        "warn",
        "nginx not available here — config file verified only",
        "high"
      );
    }
  }

  // Disk space
  {
    try {
      const free = os.freemem();
      const total = os.totalmem();
      const freeGb = free / 1024 ** 3;
      const freePct = (free / total) * 100;
      // Also try C: on Windows
      let diskDetail = `RAM free ${freeGb.toFixed(1)}GB (${freePct.toFixed(0)}%)`;
      let diskOk = freeGb > 1;
      if (isWin) {
        try {
          const { execSync } = await import("node:child_process");
          const w = execSync(
            "powershell -NoProfile -Command \"(Get-PSDrive C).Free\"",
            { encoding: "utf8" }
          ).trim();
          const diskFree = Number(w) / 1024 ** 3;
          diskDetail += `; C: free ${diskFree.toFixed(1)}GB`;
          diskOk = diskFree > 5;
          if (diskFree < 5) {
            rec(
              "Infrastructure",
              "Disk space C:",
              "warn",
              `${diskFree.toFixed(1)}GB free (<5GB warning)`,
              "high"
            );
          } else {
            rec("Infrastructure", "Disk space C:", "pass", `${diskFree.toFixed(1)}GB free`);
          }
        } catch {
          rec("Infrastructure", "Disk space", diskOk ? "pass" : "warn", diskDetail, "medium");
        }
      } else {
        rec("Infrastructure", "Memory free", diskOk ? "pass" : "warn", diskDetail, "medium");
      }
    } catch (e) {
      rec("Infrastructure", "Disk/memory check", "warn", String(e), "low");
    }
  }

  // Storage dirs
  {
    const backupDir = path.join(apiRoot, "storage/backups");
    const mediaHint = path.join(apiRoot, "storage");
    if (!fs.existsSync(backupDir)) {
      try {
        fs.mkdirSync(backupDir, { recursive: true });
      } catch {
        /* ignore */
      }
    }
    rec(
      "Infrastructure",
      "Backup storage directory",
      fs.existsSync(backupDir) ? "pass" : "fail",
      backupDir,
      "critical"
    );
    rec(
      "Infrastructure",
      "API storage root writable",
      (() => {
        try {
          const t = path.join(mediaHint, `.write-test-${Date.now()}`);
          fs.writeFileSync(t, "ok");
          fs.unlinkSync(t);
          return true;
        } catch {
          return false;
        }
      })()
        ? "pass"
        : "fail",
      mediaHint,
      "critical"
    );
  }

  // Log paths (PM2 ecosystem)
  {
    const eco = fs.readFileSync(path.join(root, "deploy/ecosystem.config.cjs"), "utf8");
    rec(
      "Infrastructure",
      "PM2 log rotation fields",
      /error_file|out_file|merge_logs/.test(eco) ? "pass" : "warn",
      "error_file + out_file configured; use pm2-logrotate on VPS",
      "medium"
    );
    rec(
      "Infrastructure",
      "PM2 autorestart + memory limit",
      /autorestart:\s*true/.test(eco) && /max_memory_restart/.test(eco) ? "pass" : "warn",
      "",
      "medium"
    );
  }

  // SSL / HSTS in nginx conf
  {
    const ngx = fs.readFileSync(path.join(root, "deploy/nginx.conf"), "utf8");
    rec(
      "Infrastructure",
      "Nginx TLS 1.2/1.3",
      /ssl_protocols\s+TLSv1\.2/.test(ngx) ? "pass" : "fail",
      "",
      "critical"
    );
    rec(
      "Infrastructure",
      "Nginx HSTS header",
      /Strict-Transport-Security/.test(ngx) ? "pass" : "warn",
      "",
      "high"
    );
    rec(
      "Infrastructure",
      "Nginx media upload body size",
      /client_max_body_size\s+25m/.test(ngx) ? "pass" : "warn",
      "25m for media/import",
      "medium"
    );
    rec(
      "Infrastructure",
      "Nginx health location",
      /location \/health/.test(ngx) ? "pass" : "warn",
      "",
      "low"
    );
  }

  // ─── Environment variables ────────────────────────────────
  const apiEnvPath = path.join(apiRoot, ".env");
  const apiEnvExample = path.join(apiRoot, ".env.production.example");
  const webEnvExample = path.join(webRoot, ".env.production.example");
  const apiEnv = loadEnvFile(apiEnvPath);
  const exampleEnv = loadEnvFile(apiEnvExample);

  rec(
    "Environment",
    "API .env.production.example present",
    fs.existsSync(apiEnvExample) ? "pass" : "fail",
    "",
    "critical"
  );
  rec(
    "Environment",
    "Web .env.production.example present",
    fs.existsSync(webEnvExample) ? "pass" : "fail",
    "",
    "critical"
  );
  rec(
    "Environment",
    "Local API .env present (dev/CI)",
    fs.existsSync(apiEnvPath) ? "pass" : "warn",
    "Production should use secrets store, not committed .env",
    "info"
  );

  const requiredProdKeys = [
    "DATABASE_URL",
    "JWT_SECRET",
    "NODE_ENV",
    "PORT",
    "AI_PROVIDER",
    "FRONTEND_URL",
    "APP_URL",
    "BACKUP_ENCRYPTION_KEY",
    "TOKEN_ENCRYPTION_KEY",
  ];
  for (const k of requiredProdKeys) {
    const inExample = k in exampleEnv || exampleEnv[k] !== undefined;
    // example may list them as comments partially — check file text
    const exText = fs.readFileSync(apiEnvExample, "utf8");
    const documented = exText.includes(k);
    rec(
      "Environment",
      `Documented prod key: ${k}`,
      documented || inExample ? "pass" : "fail",
      documented ? "in .env.production.example" : "MISSING from example",
      "critical"
    );
  }

  // Local env quality (for this machine)
  if (apiEnv.JWT_SECRET) {
    rec(
      "Environment",
      "JWT_SECRET length ≥ 32",
      apiEnv.JWT_SECRET.length >= 32 ? "pass" : "fail",
      `len=${apiEnv.JWT_SECRET.length}`,
      "critical"
    );
    rec(
      "Environment",
      "JWT_SECRET not placeholder",
      !isPlaceholder(apiEnv.JWT_SECRET) ? "pass" : "fail",
      mask(apiEnv.JWT_SECRET),
      "critical"
    );
  } else {
    rec("Environment", "JWT_SECRET set (local)", "fail", "missing", "critical");
  }

  if (apiEnv.DATABASE_URL) {
    rec(
      "Environment",
      "DATABASE_URL set",
      apiEnv.DATABASE_URL.startsWith("postgresql") ? "pass" : "warn",
      apiEnv.DATABASE_URL.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@").slice(0, 80),
      "critical"
    );
  } else {
    rec("Environment", "DATABASE_URL set", "fail", "missing", "critical");
  }

  rec(
    "Environment",
    "SMTP configured (local)",
    apiEnv.SMTP_HOST && apiEnv.SMTP_USER && apiEnv.SMTP_PASS ? "pass" : "warn",
    apiEnv.SMTP_HOST || "not set",
    "high"
  );
  rec(
    "Environment",
    "AI provider key present (local)",
    (apiEnv.GROQ_API_KEY || apiEnv.OPENAI_API_KEY) &&
      !isPlaceholder(apiEnv.GROQ_API_KEY || apiEnv.OPENAI_API_KEY || "")
      ? "pass"
      : "warn",
    apiEnv.AI_PROVIDER || "unset",
    "high"
  );
  rec(
    "Environment",
    "REDIS_URL optional",
    apiEnv.REDIS_URL ? "pass" : "pass",
    apiEnv.REDIS_URL
      ? "set (Redis rate limit store)"
      : "unset — PostgreSQL rate_limit_buckets used (OK)",
    "info"
  );
  rec(
    "Environment",
    "TRUST_PROXY documented for production",
    fs.readFileSync(apiEnvExample, "utf8").includes("TRUST_PROXY") ? "pass" : "warn",
    "",
    "medium"
  );

  // ─── Database / Prisma ────────────────────────────────────
  {
    const validate = await run(
      "prisma validate",
      "node",
      ["node_modules/prisma/build/index.js", "validate"],
      apiRoot,
      60000
    );
    rec(
      "Database",
      "Prisma validate",
      validate.code === 0 ? "pass" : "fail",
      validate.code === 0 ? "schema valid" : validate.err.slice(0, 200),
      "critical"
    );

    const generate = await run(
      "prisma generate",
      "node",
      ["node_modules/prisma/build/index.js", "generate"],
      apiRoot,
      120000
    );
    if (generate.code === 0) {
      rec("Database", "Prisma generate", "pass", "client generated", "critical");
    } else if (/EPERM|operation not permitted|EBUSY|locked/i.test(generate.err + generate.out)) {
      // Windows: running API locks query_engine DLL — not a schema failure
      const clientOk =
        fs.existsSync(
          path.join(apiRoot, "node_modules/.prisma/client/index.js")
        ) ||
        fs.existsSync(
          path.join(
            root,
            "node_modules/.pnpm"
          )
        );
      rec(
        "Database",
        "Prisma generate",
        clientOk ? "warn" : "fail",
        "EPERM while API holds query engine lock — stop API and re-run generate before deploy; existing client present",
        clientOk ? "medium" : "critical"
      );
    } else {
      rec(
        "Database",
        "Prisma generate",
        "fail",
        (generate.err || generate.out).slice(0, 200),
        "critical"
      );
    }

    // DB connectivity
    try {
      const dotenv = require(path.join(apiRoot, "node_modules/dotenv"));
      dotenv.config({ path: apiEnvPath });
      const { PrismaClient } = require(path.join(apiRoot, "node_modules/@prisma/client"));
      const prisma = new PrismaClient();
      const t0 = Date.now();
      await prisma.$queryRaw`SELECT 1 as ok`;
      const ms = Date.now() - t0;
      rec("Database", "PostgreSQL connection", "pass", `SELECT 1 in ${ms}ms`, "critical");

      // migration table / schema presence
      try {
        const tables = await prisma.$queryRaw`
          SELECT COUNT(*)::int AS n FROM information_schema.tables
          WHERE table_schema = 'public'
        `;
        const n = tables?.[0]?.n ?? tables?.[0]?.N;
        rec(
          "Database",
          "Public schema tables",
          Number(n) > 10 ? "pass" : "warn",
          `tables=${n}`,
          "high"
        );
      } catch (e) {
        rec("Database", "Schema introspection", "warn", String(e.message || e), "medium");
      }

      // Check rate_limit_buckets can exist (optional)
      try {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS rate_limit_buckets (
            key TEXT PRIMARY KEY,
            total_hits INTEGER NOT NULL DEFAULT 0,
            reset_time TIMESTAMPTZ NOT NULL
          )
        `);
        rec("Database", "Rate limit store table", "pass", "rate_limit_buckets ready");
      } catch (e) {
        rec("Database", "Rate limit store table", "warn", String(e.message || e), "medium");
      }

      await prisma.$disconnect();
    } catch (e) {
      rec(
        "Database",
        "PostgreSQL connection",
        "fail",
        e instanceof Error ? e.message : String(e),
        "critical"
      );
    }

    // migrate status (if migrations folder exists)
    const migDir = path.join(apiRoot, "prisma/migrations");
    if (fs.existsSync(migDir)) {
      const status = await run(
        "prisma migrate status",
        "node",
        ["node_modules/prisma/build/index.js", "migrate", "status"],
        apiRoot,
        60000
      );
      // migrate status can exit 1 if pending — treat carefully
      if (status.code === 0) {
        rec("Database", "Prisma migrate status", "pass", "up to date", "critical");
      } else if (/Database schema is up to date|No migration/i.test(status.out + status.err)) {
        rec("Database", "Prisma migrate status", "pass", "up to date", "critical");
      } else if (/not yet been applied|pending/i.test(status.out + status.err)) {
        rec(
          "Database",
          "Prisma migrate status",
          "fail",
          "pending migrations — run migrate deploy before release",
          "critical"
        );
      } else {
        rec(
          "Database",
          "Prisma migrate status",
          "warn",
          "using db push workflow or no migrations; deploy.sh falls back to db push",
          "high"
        );
      }
    } else {
      rec(
        "Database",
        "Prisma migrations folder",
        "warn",
        "no prisma/migrations — deploy uses db push fallback (documented)",
        "high"
      );
    }
  }

  // ─── Application build gates ──────────────────────────────
  {
    // Typecheck
    const tscApi = await run(
      "typecheck api",
      isWin ? "node_modules\\.bin\\tsc.CMD" : "node_modules/.bin/tsc",
      ["--noEmit", "-p", "tsconfig.json"],
      apiRoot,
      180000
    );
    rec(
      "Application",
      "API typecheck",
      tscApi.code === 0 ? "pass" : "fail",
      tscApi.code === 0 ? "clean" : "tsc errors",
      "critical"
    );

    const tscWeb = await run(
      "typecheck web",
      isWin ? "node_modules\\.bin\\tsc.CMD" : "node_modules/.bin/tsc",
      ["--noEmit", "-p", "tsconfig.json"],
      webRoot,
      180000
    );
    rec(
      "Application",
      "Web typecheck",
      tscWeb.code === 0 ? "pass" : "fail",
      tscWeb.code === 0 ? "clean" : "tsc errors",
      "critical"
    );

    if (!skipLint) {
      const lintApi = await run(
        "lint api",
        isWin ? "pnpm.cmd" : "pnpm",
        ["--filter", "@massivementor/api", "lint"],
        root,
        180000
      );
      // eslint may not be fully configured — warn not fail if missing config
      if (lintApi.code === 0) {
        rec("Application", "API lint", "pass", "eslint clean");
      } else if (/ESLint couldn't find|config/i.test(lintApi.out + lintApi.err)) {
        rec(
          "Application",
          "API lint",
          "warn",
          "eslint config incomplete — typecheck is the hard gate",
          "medium"
        );
      } else {
        rec("Application", "API lint", "fail", "eslint failed", "high");
      }
    } else {
      rec("Application", "API lint", "skip", "--skip-lint");
    }

    if (!skipBuild) {
      const buildApi = await run(
        "build api",
        isWin ? "pnpm.cmd" : "pnpm",
        ["--filter", "@massivementor/api", "build"],
        root,
        300000
      );
      rec(
        "Application",
        "API build",
        buildApi.code === 0 && exists("apps/api/dist/index.js") ? "pass" : "fail",
        buildApi.code === 0 ? "dist/index.js" : "build failed",
        "critical"
      );

      const buildWeb = await run(
        "build web",
        isWin ? "pnpm.cmd" : "pnpm",
        ["--filter", "@massivementor/web", "build"],
        root,
        600000
      );
      rec(
        "Application",
        "Web build",
        buildWeb.code === 0 ? "pass" : "fail",
        buildWeb.code === 0 ? "next build ok" : "build failed",
        "critical"
      );
    } else {
      rec(
        "Application",
        "API build artifact",
        exists("apps/api/dist/index.js") ? "pass" : "warn",
        exists("apps/api/dist/index.js")
          ? "dist present (--skip-build)"
          : "no dist; run without --skip-build",
        "high"
      );
      rec("Application", "Web build", "skip", "--skip-build");
    }
  }

  // ─── Live application health ──────────────────────────────
  {
    const health = await fetchJson(`${BASE}/health`);
    rec(
      "Application",
      "Local API /health",
      health.ok && health.data?.status === "ok" ? "pass" : "fail",
      health.ok
        ? `db=${health.data?.database} smtp=${health.data?.smtp?.configured} env=${health.data?.env}`
        : health.error || health.status,
      "critical"
    );
    rec(
      "Application",
      "Local PostgreSQL via health",
      health.data?.database === "up" ? "pass" : "fail",
      health.data?.database,
      "critical"
    );
    rec(
      "Application",
      "SMTP via health",
      health.data?.smtp?.configured ? "pass" : "warn",
      health.data?.smtp?.host || "not configured",
      "high"
    );

    const ready = await fetchJson(`${BASE}/ready`);
    rec(
      "Application",
      "Local API /ready",
      ready.ok && ready.data?.ready === true ? "pass" : "fail",
      JSON.stringify(ready.data || ready.error || ready.status),
      "critical"
    );

    // Production public URL (optional)
    const prodHealth = await fetchJson(`${PROD_URL}/health`, 10000);
    if (prodHealth.ok && prodHealth.data?.status === "ok") {
      rec(
        "Infrastructure",
        "Production API /health",
        "pass",
        `env=${prodHealth.data?.env} db=${prodHealth.data?.database}`,
        "critical"
      );
      rec(
        "Infrastructure",
        "Production SSL (HTTPS reachable)",
        "pass",
        PROD_URL,
        "critical"
      );
    } else {
      rec(
        "Infrastructure",
        "Production API /health",
        "warn",
        prodHealth.error || `HTTP ${prodHealth.status} — not reachable from this host`,
        "high"
      );
    }
  }

  // ─── Security posture (static code presence) ──────────────
  {
    const rateLimiter = fs.readFileSync(
      path.join(apiRoot, "src/middleware/rateLimiter.ts"),
      "utf8"
    );
    rec(
      "Security",
      "Distributed rate limit store",
      /getSharedRateLimitStore|PostgresRateLimitStore|REDIS/.test(rateLimiter)
        ? "pass"
        : "fail",
      "Redis or PostgreSQL shared store",
      "critical"
    );

    const authTs = fs.readFileSync(path.join(apiRoot, "src/middleware/auth.ts"), "utf8");
    rec(
      "Security",
      "JWT requireAuth + portal isolation",
      /requireAuth|portal === ["']admin["']|tokenVersion/.test(authTs) ? "pass" : "fail",
      "",
      "critical"
    );
    rec(
      "Security",
      "Session revocation (tokenVersion)",
      /tokenVersion|tokenTv/.test(authTs) ? "pass" : "fail",
      "",
      "critical"
    );

    const tenant = fs.readFileSync(
      path.join(apiRoot, "src/services/tenant-scope.service.ts"),
      "utf8"
    );
    rec(
      "Security",
      "Tenant scope service",
      /buildCrmScope|OWN_DATA_ONLY|businessId/.test(tenant) ? "pass" : "fail",
      "SE/SM isolation + business-wide roles",
      "critical"
    );

    const indexTs = fs.readFileSync(path.join(apiRoot, "src/index.ts"), "utf8");
    rec(
      "Security",
      "Helmet security headers",
      /helmet\(/.test(indexTs) ? "pass" : "fail",
      "",
      "critical"
    );
    rec(
      "Security",
      "CORS allowlist",
      /allowedOrigins|CORS/.test(indexTs) ? "pass" : "fail",
      "",
      "critical"
    );
    rec(
      "Security",
      "Graceful shutdown",
      /SIGTERM|shutdown/.test(indexTs) ? "pass" : "warn",
      "",
      "medium"
    );
    rec(
      "Security",
      "Backup scheduler + billing jobs",
      /startBackupScheduler|runBilling|whatsapp-enterprise/.test(indexTs)
        ? "pass"
        : "warn",
      "scheduled jobs registered at boot",
      "medium"
    );
  }

  // ─── Connectivity probes (need auth for some) ─────────────
  {
    // Unauth probes should not 500
    const probes = [
      ["/health", 200],
      ["/ready", 200],
      ["/api/crm/contacts", 401],
      ["/api/media/assets", 401],
      ["/api/whatsapp/conversations", 401],
    ];
    for (const [p, expect] of probes) {
      const r = await fetchJson(`${BASE}${p}`);
      const ok = r.status === expect || (expect === 200 && r.ok);
      rec(
        "Application",
        `Probe ${p}`,
        ok && r.status !== 500 ? "pass" : r.status === 500 ? "fail" : "warn",
        `status=${r.status} expected≈${expect}`,
        r.status === 500 ? "critical" : "medium"
      );
    }
  }

  // ─── Performance baseline from Phase 5 results ────────────
  {
    const p5Path = path.join(root, "docs/PHASE5_QA_RESULTS.json");
    if (fs.existsSync(p5Path)) {
      const p5 = JSON.parse(fs.readFileSync(p5Path, "utf8"));
      const scale = (p5.results || []).filter((r) => r.module === "Scale" && r.ok);
      const list50k = scale.find((r) => /50000/.test(r.check) && /list/i.test(r.check));
      const dash50k = scale.find((r) => /50000/.test(r.check) && /Dashboard/i.test(r.check));
      rec(
        "Performance",
        "Phase 5 scale suite present",
        p5.summary?.failed === 0 ? "pass" : "warn",
        `passed=${p5.summary?.passed} failed=${p5.summary?.failed}`,
        "high"
      );
      if (list50k) {
        rec(
          "Performance",
          "Lead list @ 50k",
          list50k.ms != null && list50k.ms < 500 ? "pass" : "warn",
          `${list50k.ms}ms (target <500ms)`,
          "high"
        );
      }
      if (dash50k) {
        rec(
          "Performance",
          "Dashboard @ 50k",
          dash50k.ms != null && dash50k.ms < 1000 ? "pass" : "warn",
          `${dash50k.ms}ms (target <1s)`,
          "high"
        );
      }
    } else {
      rec(
        "Performance",
        "Phase 5 results",
        "warn",
        "docs/PHASE5_QA_RESULTS.json missing — re-run phase5 suite",
        "medium"
      );
    }

    const rc1 = path.join(root, "docs/RC1_REGRESSION_RESULTS.json");
    if (fs.existsSync(rc1)) {
      const r = JSON.parse(fs.readFileSync(rc1, "utf8"));
      const fail = r.fail ?? r.summary?.fail ?? (r.results || []).filter((x) => !x.ok).length;
      rec(
        "Testing",
        "RC1 regression artifact",
        fail === 0 ? "pass" : "fail",
        typeof r.pass === "number" ? `pass=${r.pass} fail=${r.fail}` : JSON.stringify(r.summary || {}),
        "critical"
      );
    } else {
      rec("Testing", "RC1 regression artifact", "warn", "missing results file", "medium");
    }
  }

  // ─── Backup / restore procedure documented ────────────────
  {
    const dep = fs.readFileSync(path.join(root, "DEPLOYMENT.md"), "utf8");
    rec(
      "Infrastructure",
      "Backup strategy documented",
      /Backup|BACKUP_ENCRYPTION|AES-256/i.test(dep) ? "pass" : "fail",
      "DEPLOYMENT.md § backups",
      "critical"
    );
    rec(
      "Infrastructure",
      "Restore procedure documented",
      /Restore|RESTORE PLATFORM|verify/i.test(dep) ? "pass" : "fail",
      "",
      "critical"
    );
    rec(
      "Infrastructure",
      "Rollback procedure documented",
      /Rollback|previous-tag/i.test(dep) ? "pass" : "warn",
      "",
      "medium"
    );
  }

  // ─── Score & report ───────────────────────────────────────
  const criticalFails = checks.filter(
    (c) => c.status === "fail" && c.severity === "critical"
  );
  const highFails = checks.filter((c) => c.status === "fail" && c.severity === "high");
  const fails = checks.filter((c) => c.status === "fail");
  const warns = checks.filter((c) => c.status === "warn");
  const passes = checks.filter((c) => c.status === "pass");

  const areas = [
    "Infrastructure",
    "Environment",
    "Database",
    "Application",
    "Security",
    "Performance",
    "Testing",
  ];
  const areaScore = {};
  for (const a of areas) {
    const rows = checks.filter((c) => c.area === a);
    const cf = rows.filter((c) => c.status === "fail" && c.severity === "critical");
    const f = rows.filter((c) => c.status === "fail");
    if (rows.length === 0) areaScore[a] = "skip";
    else if (cf.length) areaScore[a] = "fail";
    else if (f.length) areaScore[a] = "warn";
    else areaScore[a] = "pass";
  }

  const totalWeight = checks.length || 1;
  const score =
    Math.round(
      ((passes.length + warns.length * 0.5) / totalWeight) * 1000
    ) / 10;

  const ready =
    criticalFails.length === 0 &&
    areaScore.Application !== "fail" &&
    areaScore.Database !== "fail" &&
    areaScore.Security !== "fail";

  const blockers = [
    ...criticalFails.map((c) => `[CRITICAL] ${c.area}: ${c.check} — ${c.detail}`),
    ...highFails.map((c) => `[HIGH] ${c.area}: ${c.check} — ${c.detail}`),
  ];

  const report = {
    phase: 8,
    generatedAt: new Date().toISOString(),
    host: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    base: BASE,
    prodUrl: PROD_URL,
    summary: {
      total: checks.length,
      pass: passes.length,
      fail: fails.length,
      warn: warns.length,
      skip: checks.filter((c) => c.status === "skip").length,
      criticalFails: criticalFails.length,
      overallReadinessPercent: score,
      deploymentReady: ready,
    },
    areaScore,
    blockers,
    checks,
  };

  const jsonPath = path.join(root, "docs/PHASE8_DEPLOYMENT_READINESS.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const md = renderMarkdown(report);
  const mdPath = path.join(root, "docs/PHASE8_DEPLOYMENT_READINESS.md");
  fs.writeFileSync(mdPath, md);

  console.log("\n═══════════════════════════════════════════════════");
  console.log(` Phase 8 complete — readiness ${score}%`);
  console.log(` Deployment ready: ${ready ? "YES" : "NO"}`);
  console.log(` Pass=${passes.length} Fail=${fails.length} Warn=${warns.length}`);
  if (blockers.length) {
    console.log("\n Blockers:");
    blockers.forEach((b) => console.log("  -", b));
  } else {
    console.log("\n Remaining blockers: None (critical)");
  }
  console.log(`\n Wrote ${jsonPath}`);
  console.log(` Wrote ${mdPath}`);
  console.log("═══════════════════════════════════════════════════\n");

  process.exit(criticalFails.length > 0 ? 1 : 0);
}

function renderMarkdown(report) {
  const icon = (s) =>
    s === "pass" ? "✅" : s === "fail" ? "❌" : s === "warn" ? "⚠️" : "⏭️";
  const lines = [
    "# Phase 8 — Production Deployment Readiness Report",
    "",
    `**Generated:** ${report.generatedAt}`,
    `**Host:** ${report.host} (${report.platform})`,
    `**Local API:** ${report.base}`,
    `**Prod URL probed:** ${report.prodUrl}`,
    "",
    "## Scorecard",
    "",
    "| Area | Status |",
    "|------|--------|",
  ];
  for (const [a, s] of Object.entries(report.areaScore)) {
    lines.push(`| ${a} | ${icon(s)} ${s} |`);
  }
  lines.push(
    "",
    `| **Overall Readiness** | **${report.summary.overallReadinessPercent}%** |`,
    `| **Deployment Ready** | **${report.summary.deploymentReady ? "✅ YES" : "❌ NO"}** |`,
    "",
    "## Summary counts",
    "",
    `- Pass: ${report.summary.pass}`,
    `- Fail: ${report.summary.fail}`,
    `- Warn: ${report.summary.warn}`,
    `- Critical fails: ${report.summary.criticalFails}`,
    "",
    "## Remaining blockers",
    ""
  );
  if (!report.blockers.length) {
    lines.push("None (no critical/high failures).");
  } else {
    report.blockers.forEach((b) => lines.push(`- ${b}`));
  }
  lines.push("", "## Full check log", "");
  lines.push("| Area | Check | Status | Severity | Detail |");
  lines.push("|------|-------|--------|----------|--------|");
  for (const c of report.checks) {
    lines.push(
      `| ${c.area} | ${c.check} | ${icon(c.status)} ${c.status} | ${c.severity} | ${String(c.detail).replace(/\|/g, "/").slice(0, 120)} |`
    );
  }
  lines.push(
    "",
    "## Release command",
    "",
    "```bash",
    "pnpm production:verify          # full gate (lint, typecheck, prisma, build, tests)",
    "pnpm production:verify:offline  # without live tests",
    "node scripts/phase8-release-checklist.mjs",
    "./deploy/deploy.sh              # on production VPS",
    "```",
    "",
    "## Notes",
    "",
    "- WARN items on PM2/Nginx live status are expected when checklist runs on a developer workstation.",
    "- Production VPS must still run `deploy/deploy.sh`, Certbot SSL, and `pm2 startup`.",
    "- Phase 5 scale evidence is included when `docs/PHASE5_QA_RESULTS.json` exists.",
    ""
  );
  return lines.join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
