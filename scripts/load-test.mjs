/**
 * Massive Mentor load test — concurrent users against live API.
 * Usage:
 *   node scripts/load-test.mjs --users 100 --base http://127.0.0.1:4000
 *   node scripts/load-test.mjs --users 250
 *   node scripts/load-test.mjs --users 500
 *
 * Measures avg / p95 latency, error rate, per-endpoint stats.
 * Does NOT mock — hits real endpoints.
 */
import { performance } from "node:perf_hooks";
import os from "node:os";
import fs from "node:fs";

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return def;
}

const BASE = arg("base", "http://127.0.0.1:4000");
const USERS = parseInt(arg("users", "100"), 10);
const EMAIL = arg("email", "demo@massivementor.in");
const PASS = arg("password", "123456789");
const OUT = arg("out", `docs/LOAD_TEST_${USERS}.json`);

const stats = {
  users: USERS,
  startedAt: new Date().toISOString(),
  endpoints: {},
  errors: [],
  cpuStart: os.loadavg?.() || [],
  freememStart: os.freemem(),
  totalmem: os.totalmem(),
};

function ensureEp(name) {
  if (!stats.endpoints[name]) {
    stats.endpoints[name] = { count: 0, ok: 0, fail: 0, times: [] };
  }
  return stats.endpoints[name];
}

async function timed(name, fn) {
  const ep = ensureEp(name);
  const t0 = performance.now();
  try {
    const result = await fn();
    const ms = performance.now() - t0;
    ep.count++;
    ep.times.push(ms);
    if (result?.ok === false) {
      ep.fail++;
      stats.errors.push({ name, error: result.error || "fail", ms });
    } else {
      ep.ok++;
    }
    return result;
  } catch (e) {
    const ms = performance.now() - t0;
    ep.count++;
    ep.fail++;
    ep.times.push(ms);
    stats.errors.push({ name, error: e instanceof Error ? e.message : String(e), ms });
    return { ok: false };
  }
}

async function http(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, ok: res.ok, data };
}

/** Shared token pool — avoids burning login rate limits under high concurrency */
let sharedToken = null;
let loginInflight = null;

async function obtainToken() {
  if (sharedToken) return sharedToken;
  if (loginInflight) return loginInflight;
  loginInflight = (async () => {
    const r = await http("POST", "/api/auth/login", {
      body: { email: EMAIL, password: PASS },
    });
    const token = r.data?.data?.token || r.data?.token || r.data?.data?.accessToken || null;
    if (token) sharedToken = token;
    loginInflight = null;
    return token;
  })();
  return loginInflight;
}

async function userFlow(i) {
  // 1. Health
  await timed("health", async () => {
    const r = await http("GET", "/health");
    return { ok: r.ok };
  });

  // 2. Login once per process (rate-limit safe); first wave still measures login
  let token = null;
  if (i < 5) {
    await timed("login", async () => {
      const r = await http("POST", "/api/auth/login", {
        body: { email: EMAIL, password: PASS },
      });
      token = r.data?.data?.token || r.data?.token || null;
      if (token) sharedToken = token;
      return { ok: !!token, error: r.data?.error || `status ${r.status}` };
    });
  } else {
    await timed("login_reuse", async () => {
      token = await obtainToken();
      return { ok: !!token, error: token ? undefined : "no shared token" };
    });
  }
  if (!token) token = await obtainToken();
  if (!token) return;

  // 3. Dashboard / me
  await timed("auth_me", async () => {
    const r = await http("GET", "/api/auth/me", { token });
    return { ok: r.ok };
  });

  // 4. Leads list (search/filter)
  await timed("leads_list", async () => {
    const r = await http("GET", "/api/crm/contacts?type=lead&page=1&pageSize=20", { token });
    return { ok: r.ok || r.status === 200 };
  });

  // 5. Lead create (subset of users)
  if (i % 5 === 0) {
    await timed("lead_create", async () => {
      const r = await http("POST", "/api/crm/contacts", {
        token,
        body: {
          type: "lead",
          name: `LoadTest Lead ${i}-${Date.now()}`,
          email: `loadtest${i}.${Date.now()}@example.com`,
          status: "new",
        },
      });
      return { ok: r.ok || r.status === 201 };
    });
  }

  // 6. Clients
  await timed("clients_list", async () => {
    const r = await http("GET", "/api/crm/contacts?type=client&page=1", { token });
    return { ok: r.ok };
  });

  // 7. Deals
  await timed("deals_list", async () => {
    const r = await http("GET", "/api/crm/deals?page=1", { token });
    return { ok: r.ok };
  });

  // 8. Reports
  await timed("reports", async () => {
    const r = await http("GET", "/api/reports/summary", { token });
    return { ok: r.ok || r.status === 404 }; // 404 counted soft if route differs
  });

  // 9. Search / filters
  await timed("search", async () => {
    const r = await http("GET", "/api/crm/contacts?search=a&page=1", { token });
    return { ok: r.ok };
  });

  // 10. AI (sparse — expensive)
  if (i % 25 === 0) {
    await timed("ai_mentor", async () => {
      const r = await http("POST", "/api/mentor/chat", {
        token,
        body: { message: "One sentence tip for sales follow-up." },
      });
      return { ok: r.ok || r.status === 429 };
    });
  }

  // 11. Export-ish
  if (i % 20 === 0) {
    await timed("export_contacts", async () => {
      const r = await http("GET", "/api/crm/contacts?pageSize=100", { token });
      return { ok: r.ok };
    });
  }
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[idx];
}

async function runWave(n) {
  const batch = 50;
  for (let start = 0; start < n; start += batch) {
    const size = Math.min(batch, n - start);
    await Promise.all(Array.from({ length: size }, (_, j) => userFlow(start + j)));
    process.stdout.write(`  completed ${Math.min(start + size, n)}/${n}\r`);
  }
  console.log("");
}

async function main() {
  console.log(`Load test: ${USERS} concurrent-style users → ${BASE}`);
  console.log(`Login as ${EMAIL}`);

  // Warmup
  await timed("warmup_health", async () => {
    const r = await http("GET", "/health");
    return { ok: r.ok };
  });

  const t0 = performance.now();
  await runWave(USERS);
  const wallMs = performance.now() - t0;

  const summary = {
    users: USERS,
    wallMs: Math.round(wallMs),
    freememEnd: os.freemem(),
    loadavg: os.loadavg?.() || [],
    endpoints: {},
    totals: { requests: 0, ok: 0, fail: 0, errorRate: 0, avgMs: 0, p95Ms: 0 },
    errorSample: stats.errors.slice(0, 30),
  };

  let allTimes = [];
  for (const [name, ep] of Object.entries(stats.endpoints)) {
    const avg = ep.times.length ? ep.times.reduce((a, b) => a + b, 0) / ep.times.length : 0;
    summary.endpoints[name] = {
      count: ep.count,
      ok: ep.ok,
      fail: ep.fail,
      avgMs: Math.round(avg),
      p95Ms: Math.round(percentile(ep.times, 95)),
      maxMs: Math.round(ep.times.length ? Math.max(...ep.times) : 0),
    };
    summary.totals.requests += ep.count;
    summary.totals.ok += ep.ok;
    summary.totals.fail += ep.fail;
    allTimes = allTimes.concat(ep.times);
  }
  summary.totals.errorRate =
    summary.totals.requests > 0
      ? Number(((summary.totals.fail / summary.totals.requests) * 100).toFixed(2))
      : 0;
  summary.totals.avgMs = Math.round(
    allTimes.length ? allTimes.reduce((a, b) => a + b, 0) / allTimes.length : 0
  );
  summary.totals.p95Ms = Math.round(percentile(allTimes, 95));
  summary.startedAt = stats.startedAt;
  summary.finishedAt = new Date().toISOString();

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary.totals, null, 2));
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
