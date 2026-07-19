/**
 * Pre-launch E2E verification — no new features, evidence only.
 * node scripts/prelaunch-e2e.mjs --base http://127.0.0.1:4000
 */
import fs from "node:fs";

const BASE = (() => {
  const i = process.argv.indexOf("--base");
  return i >= 0 ? process.argv[i + 1] : "http://127.0.0.1:4000";
})();

const results = [];
function rec(module, check, status, detail = "") {
  results.push({ module, check, status, detail: String(detail).slice(0, 300) });
  const icon = status === "pass" ? "✓" : status === "fail" ? "✗" : "~";
  console.log(`${icon} [${module}] ${check}${detail ? " — " + String(detail).slice(0, 120) : ""}`);
}

async function req(method, path, { token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined && !h["Content-Type"]) h["Content-Type"] = "application/json";
  if (token) h.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { status: 0, ok: false, data: null, error: e.message, text: "" };
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, ok: res.ok, data, text, headers: res.headers };
}

function tokenFrom(loginRes) {
  return (
    loginRes.data?.data?.token ||
    loginRes.data?.token ||
    loginRes.data?.data?.accessToken ||
    null
  );
}

async function main() {
  console.log("=== Pre-launch E2E ===", BASE, "\n");

  // —— Health / DB ——
  const health = await req("GET", "/health");
  rec("Database", "API /health", health.ok && health.data?.status === "ok" ? "pass" : "fail", health.data?.status);
  rec("Database", "DB connectivity", health.data?.database === "up" ? "pass" : "fail", health.data?.database);
  rec("Email/SMTP", "SMTP configured", health.data?.smtp?.configured === true ? "pass" : "warn", JSON.stringify(health.data?.smtp || {}));
  const ready = await req("GET", "/ready");
  rec("APIs", "/ready", ready.ok && ready.data?.ready ? "pass" : "fail");

  // —— Auth: Customer ——
  const custLogin = await req("POST", "/api/auth/login", {
    body: { email: "demo@massivementor.in", password: "123456789" },
  });
  const demoToken = tokenFrom(custLogin);
  rec("Authentication", "Demo login", demoToken ? "pass" : "fail", custLogin.data?.error || custLogin.status);

  const badLogin = await req("POST", "/api/auth/login", {
    body: { email: "demo@massivementor.in", password: "wrong-password" },
  });
  rec(
    "Authentication",
    "Reject bad password",
    badLogin.status === 401 || badLogin.status === 400 ? "pass" : "fail",
    badLogin.status
  );

  // —— Auth: Super Admin ——
  const adminLogin = await req("POST", "/api/platform/auth/login", {
    body: { email: "team@massivementor.in", password: "Mentor@42" },
  });
  const adminToken = tokenFrom(adminLogin);
  rec("Super Admin Portal", "Platform login", adminToken ? "pass" : "fail", adminLogin.data?.error || adminLogin.status);

  // —— Multi-tenant / portal isolation ——
  if (adminToken) {
    const adminOnCrm = await req("GET", "/api/crm/contacts", { token: adminToken });
    rec(
      "Multi-tenant isolation",
      "Admin JWT blocked from CRM",
      adminOnCrm.status === 403 ? "pass" : "fail",
      adminOnCrm.status
    );
    const me = await req("GET", "/api/platform/auth/me", { token: adminToken });
    rec("Super Admin Portal", "/platform/auth/me", me.ok ? "pass" : "fail", me.status);
  }

  if (demoToken) {
    const demoOnPlatform = await req("GET", "/api/platform/businesses", { token: demoToken });
    rec(
      "Multi-tenant isolation",
      "Customer JWT blocked from platform",
      demoOnPlatform.status === 401 || demoOnPlatform.status === 403 ? "pass" : "fail",
      demoOnPlatform.status
    );
  }

  // —— Unauthenticated ——
  const unauth = await req("GET", "/api/crm/contacts");
  rec("Security", "CRM requires auth", unauth.status === 401 ? "pass" : "fail", unauth.status);

  // —— Demo / Customer CRM modules ——
  let contactId = null;
  let dealId = null;
  let taskId = null;
  let meetingId = null;

  if (demoToken) {
    const me = await req("GET", "/api/auth/me", { token: demoToken });
    rec("Customer Portal", "GET /auth/me", me.ok ? "pass" : "fail", me.status);

    const portal = await req("GET", "/api/portal/current", { token: demoToken });
    rec("Demo Portal", "GET /portal/current", portal.ok || portal.status === 200 ? "pass" : "warn", portal.status);

    // Leads
    const leads = await req("GET", "/api/crm/contacts?type=lead&page=1&pageSize=10", { token: demoToken });
    rec("Leads", "List leads", leads.ok ? "pass" : "fail", leads.status);
    const createLead = await req("POST", "/api/crm/contacts", {
      token: demoToken,
      body: {
        type: "lead",
        name: `E2E Lead ${Date.now()}`,
        email: `e2e.lead.${Date.now()}@example.com`,
        phone: "9999900001",
        status: "new",
        source: "e2e",
      },
    });
    contactId =
      createLead.data?.data?.contact?.id ||
      createLead.data?.data?.id ||
      createLead.data?.contact?.id ||
      null;
    rec("Leads", "Create lead", createLead.ok || createLead.status === 201 ? "pass" : "fail", createLead.status + " " + (createLead.data?.error || ""));

    if (contactId) {
      const getL = await req("GET", `/api/crm/contacts/${contactId}`, { token: demoToken });
      rec("Leads", "Get lead by id", getL.ok ? "pass" : "fail", getL.status);
      const upd = await req("PUT", `/api/crm/contacts/${contactId}`, {
        token: demoToken,
        body: { status: "contacted", name: `E2E Lead Updated ${Date.now()}` },
      });
      rec("Leads", "Update lead", upd.ok ? "pass" : "fail", upd.status);
    }

    // Clients list
    const clients = await req("GET", "/api/crm/contacts?type=client&page=1", { token: demoToken });
    rec("Clients", "List clients", clients.ok ? "pass" : "fail", clients.status);

    // Deals
    const deals = await req("GET", "/api/crm/deals?page=1", { token: demoToken });
    rec("Deals", "List deals", deals.ok ? "pass" : "fail", deals.status);
    const createDeal = await req("POST", "/api/crm/deals", {
      token: demoToken,
      body: {
        title: `E2E Deal ${Date.now()}`,
        value: 10000,
        stage: "qualified",
        contactId: contactId || undefined,
      },
    });
    dealId =
      createDeal.data?.data?.deal?.id ||
      createDeal.data?.data?.id ||
      createDeal.data?.deal?.id ||
      null;
    rec("Deals", "Create deal", createDeal.ok || createDeal.status === 201 ? "pass" : "warn", createDeal.status + " " + (createDeal.data?.error || ""));

    // Tasks
    const tasks = await req("GET", "/api/crm/tasks?page=1", { token: demoToken });
    rec("Tasks", "List tasks", tasks.ok ? "pass" : "fail", tasks.status);
    const createTask = await req("POST", "/api/crm/tasks", {
      token: demoToken,
      body: {
        title: `E2E Task ${Date.now()}`,
        status: "todo",
        priority: "medium",
        dueDate: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    taskId =
      createTask.data?.data?.task?.id ||
      createTask.data?.data?.id ||
      createTask.data?.task?.id ||
      null;
    rec("Tasks", "Create task", createTask.ok || createTask.status === 201 ? "pass" : "warn", createTask.status + " " + (createTask.data?.error || ""));

    // Meetings
    const meetings = await req("GET", "/api/crm/meetings?page=1", { token: demoToken });
    rec("Meetings", "List meetings", meetings.ok ? "pass" : "fail", meetings.status);
    const createMeeting = await req("POST", "/api/crm/meetings", {
      token: demoToken,
      body: {
        title: `E2E Meeting ${Date.now()}`,
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        durationMin: 30,
      },
    });
    meetingId =
      createMeeting.data?.data?.meeting?.id ||
      createMeeting.data?.data?.id ||
      createMeeting.data?.meeting?.id ||
      null;
    rec("Meetings", "Create meeting", createMeeting.ok || createMeeting.status === 201 ? "pass" : "warn", createMeeting.status + " " + (createMeeting.data?.error || ""));

    // Finance
    const finDash = await req("GET", "/api/finance/dashboard", { token: demoToken });
    rec("Finance", "Dashboard", finDash.ok ? "pass" : "fail", finDash.status);
    const inv = await req("GET", "/api/finance/invoices", { token: demoToken });
    rec("Finance", "List invoices", inv.ok ? "pass" : "fail", inv.status);
    const exp = await req("GET", "/api/finance/expenses", { token: demoToken });
    rec("Finance", "List expenses", exp.ok ? "pass" : "fail", exp.status);

    // Reports (canonical path used by UI)
    const repDash = await req("GET", "/api/reports/dashboard", { token: demoToken });
    rec("Reports", "Dashboard", repDash.ok ? "pass" : "fail", repDash.status);

    // Notifications
    const notif = await req("GET", "/api/automations/notifications", { token: demoToken });
    rec("Notifications", "List notifications", notif.ok ? "pass" : "fail", notif.status);

    // Activity
    const act = await req("GET", "/api/automations/activity", { token: demoToken });
    rec("Notifications", "Activity feed", act.ok ? "pass" : "warn", act.status);

    // AI modules (may be rate limited / costly — soft)
    const aiTest = await req("POST", "/api/ai/test", { token: demoToken, body: {} });
    rec("AI Modules", "AI test endpoint", aiTest.ok || aiTest.status === 429 ? "pass" : "warn", aiTest.status);

    const mentor = await req("POST", "/api/mentor/chat", {
      token: demoToken,
      body: { message: "Reply with exactly: OK" },
    });
    rec("AI Modules", "Mentor chat", mentor.ok || mentor.status === 429 ? "pass" : "warn", mentor.status);

    // AI sales / follow-up paths
    const nextAction = await req("POST", "/api/crm/ai/next-action", {
      token: demoToken,
      body: { contactId },
    });
    rec(
      "AI Sales Intelligence",
      "Next action",
      nextAction.ok || nextAction.status === 400 || nextAction.status === 429 ? "pass" : "warn",
      nextAction.status
    );

    const followup = await req("POST", "/api/crm/ai/follow-up", {
      token: demoToken,
      body: { contactId, language: "en" },
    });
    rec(
      "AI Follow-up",
      "Generate follow-up",
      followup.ok || followup.status === 400 || followup.status === 429 ? "pass" : "warn",
      followup.status
    );

    // Field sales / GPS
    const locMe = await req("GET", "/api/location/me", { token: demoToken });
    rec("Field Sales Tracking", "GET /location/me", locMe.ok ? "pass" : "warn", locMe.status);
    const locEvent = await req("POST", "/api/location/events", {
      token: demoToken,
      body: {
        lat: 17.385,
        lng: 78.4867,
        accuracy: 20,
        eventType: "heartbeat",
      },
    });
    rec(
      "GPS",
      "Post location event",
      locEvent.ok || locEvent.status === 201 ? "pass" : "fail",
      locEvent.status + " " + (locEvent.data?.error || "")
    );
    const live = await req("GET", "/api/location/live", { token: demoToken });
    rec("Field Sales Tracking", "Live locations", live.ok ? "pass" : "warn", live.status);

    // Team / roles
    const teams = await req("GET", "/api/teams/teams", { token: demoToken });
    // route might be /api/teams
    const teams2 = teams.ok ? teams : await req("GET", "/api/teams", { token: demoToken });
    rec("Role Permissions", "List teams", teams2.ok ? "pass" : "warn", teams2.status);
    const role = await req("GET", "/api/teams/role", { token: demoToken });
    rec("Role Permissions", "Get role", role.ok ? "pass" : "warn", role.status);

    // Business / white label config surface
    const biz = await req("GET", "/api/businesses/current", { token: demoToken });
    rec("White Label", "Business current", biz.ok || biz.status === 200 ? "pass" : "warn", biz.status);

    // Tenant backups
    const bakList = await req("GET", "/api/backups", { token: demoToken });
    rec(
      "Backup & Restore",
      "Tenant list backups",
      bakList.ok || bakList.status === 403 ? "pass" : "fail",
      bakList.status + (bakList.data?.error ? " " + bakList.data.error : "")
    );

    // Search / filters
    const search = await req("GET", "/api/crm/contacts?search=E2E&page=1", { token: demoToken });
    rec("APIs", "Contact search", search.ok ? "pass" : "fail", search.status);

    // IDOR: try access fake contact
    const idor = await req("GET", "/api/crm/contacts/cmfakeidor000000000000001", { token: demoToken });
    rec(
      "Security",
      "Contact IDOR (missing id)",
      idor.status === 404 || idor.status === 403 ? "pass" : "warn",
      idor.status
    );

    // Team IDOR
    const teamIdor = await req("GET", "/api/teams/teams/not-a-real-team/members", { token: demoToken });
    const teamIdor2 = teamIdor.status !== 404 && teamIdor.status !== 0
      ? teamIdor
      : await req("GET", "/api/teams/not-a-real-team/members", { token: demoToken });
    rec(
      "Security",
      "Team IDOR blocked",
      teamIdor2.status === 403 || teamIdor2.status === 400 || teamIdor2.status === 404 ? "pass" : "fail",
      teamIdor2.status
    );
  }

  // —— Super Admin modules ——
  if (adminToken) {
    const businesses = await req("GET", "/api/platform/businesses", { token: adminToken });
    rec("Super Admin Portal", "List businesses", businesses.ok ? "pass" : "fail", businesses.status);
    const analytics = await req("GET", "/api/platform/analytics", { token: adminToken });
    rec("Billing", "Analytics/usage surface", analytics.ok ? "pass" : "warn", analytics.status);
    const invoices = await req("GET", "/api/platform/invoices", { token: adminToken });
    rec("Billing", "Platform invoices", invoices.ok ? "pass" : "fail", invoices.status);
    const licenses = await req("GET", "/api/platform/licenses", { token: adminToken });
    rec("Billing", "Licenses", licenses.ok ? "pass" : "fail", licenses.status);
    const mon = await req("GET", "/api/platform/health", { token: adminToken });
    rec("Super Admin Portal", "Platform health", mon.ok ? "pass" : "fail", mon.status);
    const audit = await req("GET", "/api/platform/audit", { token: adminToken });
    rec("Security", "Audit log", audit.ok ? "pass" : "fail", audit.status);

    const backups = await req("GET", "/api/platform/backups", { token: adminToken });
    rec("Backup & Restore", "List platform backups", backups.ok ? "pass" : "fail", backups.status);
    const schedules = await req("GET", "/api/platform/backup-schedules", { token: adminToken });
    rec(
      "Backup & Restore",
      "Backup schedules",
      schedules.ok && (schedules.data?.data?.schedules?.length || schedules.data?.schedules?.length) >= 0
        ? "pass"
        : "fail",
      schedules.status
    );

    // White-label endpoint exists (PUT requires id)
    const bizList = businesses.data?.data?.businesses || businesses.data?.businesses || [];
    if (Array.isArray(bizList) && bizList[0]?.id) {
      const wl = await req("PUT", `/api/platform/businesses/${bizList[0].id}/white-label`, {
        token: adminToken,
        body: { whiteLabel: { companyName: "E2E WL Check" } },
      });
      rec("White Label", "Update white-label", wl.ok ? "pass" : "warn", wl.status);
    } else {
      rec("White Label", "Update white-label", "warn", "no business id");
    }
  }

  // —— Security headers ——
  const xfo = health.headers?.get?.("x-frame-options");
  const xcto = health.headers?.get?.("x-content-type-options");
  rec("Security", "X-Frame-Options", xfo ? "pass" : "fail", xfo);
  rec("Security", "X-Content-Type-Options", xcto ? "pass" : "fail", xcto);

  // —— JWT garbage ——
  const badJwt = await req("GET", "/api/auth/me", { token: "not.a.jwt" });
  rec("Security", "Invalid JWT", badJwt.status === 401 ? "pass" : "fail", badJwt.status);

  // —— Forgot password anti-enum ——
  const fp = await req("POST", "/api/auth/forgot-password", {
    body: { email: "nonexistent-e2e@example.com" },
  });
  rec(
    "Authentication",
    "Forgot password anti-enumeration",
    fp.ok || fp.status === 200 ? "pass" : "warn",
    fp.status
  );

  // —— CORS ——
  const corsRes = await fetch(`${BASE}/health`, {
    headers: { Origin: "https://evil.example" },
  });
  const acao = corsRes.headers.get("access-control-allow-origin");
  rec("Security", "CORS rejects evil origin", !acao || !String(acao).includes("evil") ? "pass" : "fail", acao);

  // Summary
  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.filter((r) => r.status === "fail").length;
  const warn = results.filter((r) => r.status === "warn").length;

  const report = {
    at: new Date().toISOString(),
    base: BASE,
    summary: { pass, fail, warn, total: results.length },
    results,
  };
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/PRELAUNCH_E2E_RESULTS.json", JSON.stringify(report, null, 2));

  console.log("\n=== SUMMARY ===");
  console.log(`pass=${pass} fail=${fail} warn=${warn} total=${results.length}`);
  if (fail) {
    console.log("\nFAILURES:");
    for (const r of results.filter((x) => x.status === "fail")) {
      console.log(` - [${r.module}] ${r.check}: ${r.detail}`);
    }
  }
  process.exitCode = fail > 0 ? 2 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
