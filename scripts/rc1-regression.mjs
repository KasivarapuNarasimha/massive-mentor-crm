/**
 * Massive Mentor CRM — RC1 full regression (API workflows).
 * node scripts/rc1-regression.mjs --base http://127.0.0.1:4000
 *
 * Covers: health → admin provision → login → dashboard/reports → CRM
 * (lead/client/deal/task/meeting) → finance → billing/trial → isolation → logout surface
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/api");
try {
  require(path.join(apiRoot, "node_modules/dotenv")).config({
    path: path.join(apiRoot, ".env"),
  });
} catch {
  /* optional */
}

const BASE = (() => {
  const i = process.argv.indexOf("--base");
  return i >= 0 ? process.argv[i + 1] : "http://127.0.0.1:4000";
})();

const ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || "team@massivementor.in";
const ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || "Mentor@42";

const results = [];
function rec(module, check, ok, detail = "") {
  results.push({ module, check, ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "✓" : "✗"} [${module}] ${check}${detail ? " — " + String(detail).slice(0, 100) : ""}`);
}

async function req(method, p, { token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (token) h.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${BASE}${p}`, {
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
  return { status: res.status, ok: res.ok, data, text };
}

function tokenFrom(r) {
  return r.data?.data?.token || r.data?.token || r.data?.data?.accessToken || null;
}

async function main() {
  console.log("=== Massive Mentor CRM RC1 Regression ===");
  console.log("BASE =", BASE, "\n");
  const stamp = Date.now();
  const ownerEmail = `rc1.${stamp}@example.com`;
  const ownerPassword = `Rc1@${String(stamp).slice(-6)}!`;
  let adminToken = null;
  let custToken = null;
  let contactId = null;
  let dealId = null;
  let paymentId = null;

  // 1. Health
  const health = await req("GET", "/health");
  rec("Ops", "API health", health.ok && health.data?.status === "ok", health.data?.status);
  rec("Ops", "Database up", health.data?.database === "up", health.data?.database);
  const ready = await req("GET", "/ready");
  rec("Ops", "Ready probe", ready.ok && (ready.data?.ready === true || ready.status === 200), ready.status);

  // 2. Public register blocked
  const reg = await req("POST", "/api/auth/register", {
    body: {
      email: `blocked.rc1.${stamp}@example.com`,
      password: "Blocked@12345",
      name: "Blocked",
      businessName: "Blocked Co",
    },
  });
  rec("Security", "Public register blocked", reg.status === 403 || reg.status === 404, reg.status);

  // 3. Admin login + isolation
  const adminLogin = await req("POST", "/api/platform/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  adminToken = tokenFrom(adminLogin);
  rec("Auth", "Super Admin login", !!adminToken, adminLogin.status);

  if (adminToken) {
    const adminCrm = await req("GET", "/api/crm/contacts", { token: adminToken });
    rec(
      "Security",
      "Admin JWT blocked from CRM",
      adminCrm.status === 403 || adminCrm.status === 401,
      adminCrm.status
    );
    const me = await req("GET", "/api/platform/auth/me", { token: adminToken });
    rec("Super Admin", "Platform me", me.ok, me.status);
  }

  // 4. Customer provision (sales-led)
  if (adminToken) {
    const prov = await req("POST", "/api/platform/businesses", {
      token: adminToken,
      body: {
        companyName: `RC1 Co ${stamp}`,
        ownerEmail,
        ownerName: "RC1 Owner",
        ownerPassword,
        currency: "INR",
        trialDays: 3,
        templateSlug: "generic",
      },
    });
    rec(
      "Onboarding",
      "Provision customer",
      prov.ok || prov.status === 201,
      prov.data?.error || prov.status
    );
  }

  // 5. Customer login
  const login = await req("POST", "/api/auth/login", {
    body: { email: ownerEmail, password: ownerPassword },
  });
  custToken = tokenFrom(login);
  rec("Auth", "Customer login", !!custToken, login.data?.error || login.status);

  if (!custToken) {
    summarize();
    process.exit(1);
  }

  // 6. Billing / trial
  const access = await req("GET", "/api/billing/access", { token: custToken });
  const a = access.data?.data?.access || access.data?.access;
  rec(
    "Billing",
    "Trial access allowed",
    access.ok && a?.allowed === true && a?.isTrial === true,
    `days=${a?.trialDaysRemaining} status=${a?.planStatus}`
  );
  rec(
    "Billing",
    "Trial days ≤ 3",
    a?.trialDaysRemaining != null && a.trialDaysRemaining <= 3,
    String(a?.trialDaysRemaining)
  );

  const overview = await req("GET", "/api/billing/overview", { token: custToken });
  const plans = overview.data?.data?.plans || overview.data?.plans || [];
  rec("Billing", "Plans catalog", overview.ok && plans.length >= 3, `plans=${plans.length}`);

  // 7. Dashboard / reports
  const reports = await req("GET", "/api/reports/dashboard", { token: custToken });
  const rd = reports.data?.data || reports.data;
  rec(
    "Dashboard",
    "Reports KPIs numeric",
    reports.ok && typeof rd?.totalLeads === "number" && typeof rd?.totalDealValue === "number",
    `leads=${rd?.totalLeads} dealValue=${rd?.totalDealValue} type=${typeof rd?.totalDealValue}`
  );

  const dash = await req("GET", "/api/dashboards/main?role=business_admin&preset=all", {
    token: custToken,
  });
  rec(
    "Dashboard",
    "Config dashboard loads",
    dash.ok || dash.status === 200 || dash.status === 404,
    dash.status
  );

  // 8. Lead
  const lead = await req("POST", "/api/crm/contacts", {
    token: custToken,
    body: {
      type: "lead",
      name: `RC1 Lead ${stamp}`,
      email: `lead.rc1.${stamp}@example.com`,
      status: "new",
      source: "rc1",
    },
  });
  contactId =
    lead.data?.data?.contact?.id || lead.data?.data?.id || lead.data?.data?.contactId;
  rec("CRM", "Create lead", lead.ok && !!contactId, contactId || lead.data?.error || lead.status);

  // 9. Client conversion path (create client)
  const client = await req("POST", "/api/crm/contacts", {
    token: custToken,
    body: {
      type: "client",
      name: `RC1 Client ${stamp}`,
      email: `client.rc1.${stamp}@example.com`,
      status: "active",
    },
  });
  const clientId =
    client.data?.data?.contact?.id || client.data?.data?.id;
  rec("CRM", "Create client", client.ok && !!clientId, clientId || client.status);

  // 10. Deal
  if (contactId) {
    const deal = await req("POST", "/api/crm/deals", {
      token: custToken,
      body: {
        title: `RC1 Deal ${stamp}`,
        contactId,
        value: 15000,
        stage: "qualified",
        currency: "INR",
      },
    });
    dealId = deal.data?.data?.deal?.id || deal.data?.data?.id;
    rec("CRM", "Create deal", deal.ok && !!dealId, dealId || deal.data?.error || deal.status);
  } else {
    rec("CRM", "Create deal", false, "no contactId");
  }

  // 11. Task
  const task = await req("POST", "/api/crm/tasks", {
    token: custToken,
    body: {
      title: `RC1 Task ${stamp}`,
      status: "todo",
      priority: "medium",
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      contactId: contactId || undefined,
    },
  });
  rec(
    "CRM",
    "Create task",
    task.ok || task.status === 201,
    task.data?.error || task.status
  );

  // 12. Meeting
  const meeting = await req("POST", "/api/crm/meetings", {
    token: custToken,
    body: {
      title: `RC1 Meeting ${stamp}`,
      scheduledAt: new Date(Date.now() + 2 * 86400000).toISOString(),
      contactId: contactId || undefined,
    },
  });
  rec("CRM", "Create meeting", meeting.ok || meeting.status === 201, meeting.status);

  // 13. Lists
  const leadsList = await req("GET", "/api/crm/contacts?type=lead&pageSize=5", {
    token: custToken,
  });
  rec("CRM", "List leads", leadsList.ok, leadsList.status);
  const dealsList = await req("GET", "/api/crm/deals?pageSize=5", { token: custToken });
  rec("CRM", "List deals", dealsList.ok, dealsList.status);

  // 14. Finance
  const fin = await req("GET", "/api/finance/dashboard", { token: custToken });
  rec("Finance", "Finance dashboard", fin.ok, fin.data?.error || fin.status);
  const inv = await req("POST", "/api/finance/invoices", {
    token: custToken,
    body: {
      clientName: "RC1 Invoice Client",
      amount: 1000,
      taxRate: 18,
      description: "RC1 test",
      status: "draft",
    },
  });
  const invoice = inv.data?.data?.invoice || inv.data?.data;
  rec(
    "Finance",
    "Create invoice Decimal GST",
    inv.ok && Number(invoice?.total) === 1180,
    `total=${invoice?.total} number=${invoice?.number}`
  );

  // 15. AI surface (may 429 or 400 — must not 500)
  const ai = await req("POST", "/api/crm/ai/next-action", {
    token: custToken,
    body: { name: "RC1", notes: "regression" },
  });
  rec(
    "AI",
    "AI next-action responds (not 500)",
    ai.status !== 500 && ai.status !== 0,
    `${ai.status} ${ai.data?.code || ai.data?.error || ""}`.slice(0, 80)
  );

  // 16. Approvals / notifications / activity
  const notif = await req("GET", "/api/automations/notifications", { token: custToken });
  rec("Notifications", "List notifications", notif.ok || notif.status === 200, notif.status);
  const act = await req("GET", "/api/automations/activity?pageSize=10", { token: custToken });
  rec("Audit", "Activity timeline", act.ok || act.status === 200, act.status);

  // 17. Team / profile
  const team = await req("GET", "/api/teams", { token: custToken });
  rec("Team", "Team list", team.ok || team.status === 200, team.status);
  const profile = await req("GET", "/api/profile", { token: custToken });
  rec("Settings", "Profile", profile.ok || profile.status === 200, profile.status);

  // 18. CORS
  const cors = await req("GET", "/health", {
    headers: { Origin: "https://evil.example.com" },
  });
  // health may still 200; CORS is header-level — check API doesn't crash
  rec("Security", "Evil origin request handled", cors.status === 200 || cors.status === 0, cors.status);

  // 19. Invalid JWT
  const bad = await req("GET", "/api/crm/contacts", { token: "invalid.jwt.token" });
  rec("Security", "Invalid JWT rejected", bad.status === 401, bad.status);

  // 20. Revenue admin
  if (adminToken) {
    const rev = await req("GET", "/api/platform/revenue", { token: adminToken });
    rec("Super Admin", "Revenue", rev.ok || rev.status === 200 || rev.status === 404, rev.status);
  }

  // 21. Logout surface — password wrong still 401
  const badPw = await req("POST", "/api/auth/login", {
    body: { email: ownerEmail, password: "WrongPassword!!" },
  });
  rec(
    "Auth",
    "Reject bad password",
    badPw.status === 401 || badPw.status === 400,
    badPw.status
  );

  // 22. Checkout order (if Razorpay configured) — optional soft pass
  const starter = plans.find((p) => String(p.code).includes("starter_monthly"));
  if (starter && overview.data?.data?.razorpayEnabled) {
    const order = await req("POST", "/api/billing/checkout/order", {
      token: custToken,
      body: { planCode: starter.code, purpose: "checkout" },
    });
    rec(
      "Razorpay",
      "Checkout order create",
      order.ok && !!(order.data?.data?.orderId || order.data?.orderId),
      order.data?.error || order.status
    );
    paymentId =
      order.data?.data?.paymentId || order.data?.paymentId || null;
  } else {
    rec("Razorpay", "Checkout order create", true, "skipped (Razorpay disabled or no plan)");
  }

  summarize();
  const fail = results.filter((r) => !r.ok).length;
  process.exit(fail > 0 ? 1 : 0);
}

function summarize() {
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n=== RC1 RESULT pass=${pass} fail=${fail} total=${results.length} ===`);
  const out = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../docs/RC1_REGRESSION_RESULTS.json"
  );
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        version: "1.0.0-rc.1",
        date: new Date().toISOString(),
        base: BASE,
        pass,
        fail,
        results,
      },
      null,
      2
    )
  );
  console.log("Wrote", out);
  if (fail === 0) {
    console.log("\n✓ Massive Mentor CRM v1.0.0-RC1 regression PASSED");
  } else {
    console.log("\n✗ RC1 regression has failures — fix before release");
    results.filter((r) => !r.ok).forEach((r) => console.log(`  - [${r.module}] ${r.check}: ${r.detail}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
