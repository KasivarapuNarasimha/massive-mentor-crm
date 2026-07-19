/**
 * Smoke test for billing trial + plans after UI work.
 * node scripts/billing-ui-smoke.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/api");
try {
  require(path.join(apiRoot, "node_modules/dotenv")).config({
    path: path.join(apiRoot, ".env"),
  });
} catch {
  /* env may already be set */
}

const BASE = "http://127.0.0.1:4000";
const ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || "team@massivementor.in";
const ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || "Mentor@42";

async function req(method, p, { token, body } = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function tokenFrom(r) {
  return r.data?.data?.token || r.data?.token || null;
}

const results = [];
function rec(check, ok, detail = "") {
  results.push({ check, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${check}${detail ? " — " + detail : ""}`);
}

async function main() {
  const stamp = Date.now();
  const adminLogin = await req("POST", "/api/platform/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const adminToken = tokenFrom(adminLogin);
  rec("Admin login", !!adminToken, adminLogin.status);

  const email = `billing.ui.${stamp}@example.com`;
  const password = `Bill@${String(stamp).slice(-6)}!`;
  const prov = await req("POST", "/api/platform/businesses", {
    token: adminToken,
    body: {
      companyName: `Billing UI ${stamp}`,
      ownerEmail: email,
      ownerName: "Billing UI",
      ownerPassword: password,
      currency: "INR",
      trialDays: 3,
      templateSlug: "generic",
    },
  });
  rec("Provision with trialDays=3", prov.status === 201 || prov.status === 200, prov.status);

  const login = await req("POST", "/api/auth/login", {
    body: { email, password },
  });
  const token = tokenFrom(login);
  rec("Customer login", !!token, login.status);

  const access = await req("GET", "/api/billing/access", { token });
  const a = access.data?.data?.access || access.data?.access;
  const days = a?.trialDaysRemaining;
  rec(
    "Trial remaining ≤ 3",
    a?.isTrial && days != null && days >= 0 && days <= 3,
    `days=${days} isTrial=${a?.isTrial}`
  );

  const overview = await req("GET", "/api/billing/overview", { token });
  const plans = overview.data?.data?.plans || overview.data?.plans || [];
  const monthly = plans.filter((p) => p.billingCycle === "monthly");
  const annual = plans.filter((p) => p.billingCycle === "annual");
  rec("Has monthly plans", monthly.length >= 3, `n=${monthly.length}`);
  rec("Has annual plans", annual.length >= 3, `n=${annual.length}`);

  const names = monthly.map((p) => p.name + p.code).join(" ").toLowerCase();
  rec("Starter plan present", names.includes("starter"), names.slice(0, 80));
  rec("Professional plan present", names.includes("professional"), "");
  rec("Enterprise plan present", names.includes("enterprise"), "");

  const biz = overview.data?.data?.business || overview.data?.business;
  rec(
    "Business trialDays is 3",
    !biz?.trialDays || biz.trialDays <= 3,
    `trialDays=${biz?.trialDays}`
  );

  // Simulate inflated trial and ensure access normalizes
  const { PrismaClient } = require(path.join(apiRoot, "node_modules/@prisma/client"));
  const prisma = new PrismaClient();
  try {
    if (biz?.id) {
      const far = new Date();
      far.setDate(far.getDate() + 13);
      await prisma.business.update({
        where: { id: biz.id },
        data: { trialDays: 14, trialEndsAt: far },
      });
      const access2 = await req("GET", "/api/billing/access", { token });
      const a2 = access2.data?.data?.access || access2.data?.access;
      rec(
        "Inflated 13-day trial repaired to ≤3 remaining",
        a2?.trialDaysRemaining != null && a2.trialDaysRemaining <= 3,
        `days=${a2?.trialDaysRemaining}`
      );
      const row = await prisma.business.findUnique({
        where: { id: biz.id },
        select: { trialDays: true, trialEndsAt: true },
      });
      rec(
        "DB trialDays capped to 3",
        row?.trialDays === 3,
        `trialDays=${row?.trialDays}`
      );
    }
  } finally {
    await prisma.$disconnect();
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n=== RESULT pass=${pass} fail=${fail} ===`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
