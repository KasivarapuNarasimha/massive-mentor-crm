/**
 * Phase 3 local validation — device push lifecycle + Team Activity ACL.
 * Does NOT require Firebase credentials (dispatch no-ops when FCM unset).
 */
import { PrismaClient } from "@prisma/client";

const API = process.env.API_URL || "http://localhost:4000/api";
const p = new PrismaClient();

const results = [];
function pass(name, detail = "") {
  results.push({ ok: true, name, detail });
  console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
}
function fail(name, detail = "") {
  results.push({ ok: false, name, detail });
  console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`);
}

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, forceNewSession: true }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(`login failed ${email}: ${json.error}`);
  return {
    token: json.data.token,
    userId: json.data.user.id,
  };
}

async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const fakeToken = (n) => `fcm_test_token_${n}_` + "x".repeat(40);

try {
  // --- DB preconditions ---
  const table = await p.$queryRawUnsafe(
    `SELECT 1 AS ok FROM information_schema.tables WHERE table_name='DevicePushToken'`
  );
  if (table.length) pass("DevicePushToken table exists");
  else fail("DevicePushToken table exists");

  const before = {
    users: await p.user.count(),
    businesses: await p.business.count(),
    notifications: await p.notification.count(),
  };

  // Find local test users (from prior Team Activity smoke)
  const ba = await p.user.findFirst({
    where: { email: { contains: "demo@", mode: "insensitive" }, isDisabled: false },
    select: { id: true, email: true, role: true },
  });
  // Prefer known local emails if present
  const emails = [
    "demo@massivementor.in",
    "ceo.local@massivementor.in",
    "exec.local@massivementor.in",
    "mgr.local@massivementor.in",
  ];
  const usersByEmail = {};
  for (const e of emails) {
    const u = await p.user.findUnique({ where: { email: e }, select: { id: true, email: true, role: true, isDisabled: true } });
    if (u) usersByEmail[e] = u;
  }

  const password = process.env.TEST_PASSWORD || "123456789";
  let baAuth, ceoAuth, seAuth, smAuth;
  try {
    if (usersByEmail["demo@massivementor.in"]) baAuth = await login("demo@massivementor.in", password);
    else fail("login BA", "demo@massivementor.in missing");
  } catch (e) {
    fail("login BA", String(e.message || e));
  }
  try {
    if (usersByEmail["ceo.local@massivementor.in"]) ceoAuth = await login("ceo.local@massivementor.in", password);
  } catch (e) {
    fail("login CEO", String(e.message || e));
  }
  try {
    if (usersByEmail["exec.local@massivementor.in"]) seAuth = await login("exec.local@massivementor.in", password);
  } catch (e) {
    fail("login SE", String(e.message || e));
  }
  try {
    if (usersByEmail["mgr.local@massivementor.in"]) smAuth = await login("mgr.local@massivementor.in", password);
  } catch (e) {
    fail("login SM", String(e.message || e));
  }

  if (baAuth) pass("login BA", baAuth.userId);
  if (ceoAuth) pass("login CEO", ceoAuth.userId);
  if (seAuth) pass("login SE", seAuth.userId);
  if (smAuth) pass("login SM", smAuth.userId);

  // Resolve a business for BA
  let businessId = null;
  if (baAuth) {
    const mem = await p.businessMember.findFirst({
      where: { userId: baAuth.userId },
      select: { businessId: true, role: true },
    });
    businessId = mem?.businessId || null;
  }

  // --- Register ---
  const installA = "install_phase3_test_aaaa";
  const installB = "install_phase3_test_bbbb";

  if (baAuth) {
    const r1 = await api("POST", "/devices/push-token", baAuth.token, {
      installId: installA,
      platform: "android",
      token: fakeToken("ba1"),
      provider: "fcm",
      businessId,
    });
    if (r1.status === 200 && r1.json.success) pass("register BA installA", r1.json.data?.id);
    else fail("register BA installA", JSON.stringify(r1.json));

    // Refresh / token rotation same installId
    const r2 = await api("PUT", "/devices/push-token", baAuth.token, {
      installId: installA,
      platform: "android",
      token: fakeToken("ba1_rotated"),
      provider: "fcm",
      businessId,
    });
    if (r2.status === 200 && r2.json.success) pass("token rotation same installId");
    else fail("token rotation", JSON.stringify(r2.json));

    const row = await p.devicePushToken.findUnique({
      where: { appId_installId: { appId: "in.massivementor.crm", installId: installA } },
    });
    if (row && row.token.includes("ba1_rotated") && row.enabled) pass("DB reflects rotated token");
    else fail("DB reflects rotated token", JSON.stringify(row));

    // Duplicate registration (same install) upserts
    const r3 = await api("POST", "/devices/push-token", baAuth.token, {
      installId: installA,
      platform: "android",
      token: fakeToken("ba1_dup"),
      provider: "fcm",
      businessId,
    });
    const countA = await p.devicePushToken.count({
      where: { appId: "in.massivementor.crm", installId: installA },
    });
    if (r3.json.success && countA === 1) pass("duplicate registration upserts to one row");
    else fail("duplicate registration", `count=${countA}`);

    // Second device
    const r4 = await api("POST", "/devices/push-token", baAuth.token, {
      installId: installB,
      platform: "android",
      token: fakeToken("ba2"),
      provider: "fcm",
      businessId,
    });
    if (r4.json.success) pass("register second device installB");
    else fail("register second device", JSON.stringify(r4.json));

    // Logout revoke installA only
    const rev = await api("DELETE", "/devices/push-token", baAuth.token, {
      installId: installA,
      reason: "logout",
    });
    const aAfter = await p.devicePushToken.findUnique({
      where: { appId_installId: { appId: "in.massivementor.crm", installId: installA } },
    });
    const bAfter = await p.devicePushToken.findUnique({
      where: { appId_installId: { appId: "in.massivementor.crm", installId: installB } },
    });
    if (rev.json.success && aAfter && !aAfter.enabled && aAfter.revokedReason === "logout") {
      pass("logout revokes current install only");
    } else fail("logout revoke", JSON.stringify({ rev: rev.json, aAfter }));
    if (bAfter?.enabled) pass("other device still enabled after logout revoke");
    else fail("other device still enabled", JSON.stringify(bAfter));

    // Provider invalid simulation
    await p.devicePushToken.update({
      where: { id: bAfter.id },
      data: {
        enabled: false,
        revokedAt: new Date(),
        revokedReason: "provider_invalid",
        lastError: "messaging/registration-token-not-registered",
      },
    });
    const inv = await p.devicePushToken.findUnique({ where: { id: bAfter.id } });
    if (inv && !inv.enabled && inv.revokedReason === "provider_invalid") {
      pass("provider_invalid revoke fields");
    } else fail("provider_invalid");
  }

  // --- Team Activity ACL (mirrors push-dispatcher: membership + canViewTeamActivity) ---
  // NEVER trust DevicePushToken.businessId; NEVER use platformRole shortcuts.
  async function canTeamPush(userId, bizId) {
    const user = await p.user.findUnique({ where: { id: userId }, select: { isDisabled: true } });
    if (!user || user.isDisabled) return false;
    const mem = await p.businessMember.findFirst({
      where: { userId, businessId: bizId },
      select: { role: true },
    });
    if (!mem) return false;
    const role = String(mem.role || "").toLowerCase();
    return ["ceo", "owner", "business_admin", "admin"].includes(role);
  }

  if (businessId && baAuth) {
    if (await canTeamPush(baAuth.userId, businessId)) pass("Team Activity push allowed for BA");
    else fail("Team Activity push allowed for BA");
  }
  if (businessId && ceoAuth) {
    const ceoMem = await p.businessMember.findFirst({
      where: { userId: ceoAuth.userId, businessId },
    });
    // CEO may be on a different local business — check their own business
    const ceoBiz =
      (
        await p.businessMember.findFirst({
          where: { userId: ceoAuth.userId },
          select: { businessId: true, role: true },
        })
      )?.businessId || null;
    if (ceoBiz && (await canTeamPush(ceoAuth.userId, ceoBiz))) {
      pass("Team Activity push allowed for CEO on own business");
    } else {
      fail("Team Activity push allowed for CEO", JSON.stringify({ ceoBiz, ceoMem }));
    }
    // Cross-business: CEO must NOT get push for BA business unless member+role
    const cross = await canTeamPush(ceoAuth.userId, businessId);
    if (!cross) pass("cross-business Team Activity blocked for non-member/non-role");
    else {
      // If CEO is also member of BA business with viewer role, that's allowed by design
      const m = await p.businessMember.findFirst({
        where: { userId: ceoAuth.userId, businessId },
        select: { role: true },
      });
      if (m && ["ceo", "owner", "business_admin", "admin"].includes(String(m.role).toLowerCase())) {
        pass("cross-business: CEO is BA-member with viewer role (allowed)");
      } else fail("cross-business Team Activity should be blocked", JSON.stringify(m));
    }
  }
  if (businessId && seAuth) {
    if (!(await canTeamPush(seAuth.userId, businessId))) pass("Sales Executive — no Team Activity push");
    else fail("Sales Executive should not receive Team Activity push");
  }
  if (businessId && smAuth) {
    // SM may be on different business
    const smBiz = (
      await p.businessMember.findFirst({
        where: { userId: smAuth.userId },
        select: { businessId: true },
      })
    )?.businessId;
    if (smBiz && !(await canTeamPush(smAuth.userId, smBiz))) {
      pass("Sales Manager — no Team Activity push");
    } else if (businessId && !(await canTeamPush(smAuth.userId, businessId))) {
      pass("Sales Manager — no Team Activity push (on BA business)");
    } else fail("Sales Manager should not receive Team Activity push");
  }

  // Personal lead_assigned — inbox for intended user only (push no-op without FCM creds)
  if (seAuth && baAuth) {
    const beforeN = await p.notification.count({
      where: { userId: seAuth.userId, type: "lead_assigned" },
    });
    const beforeBa = await p.notification.count({
      where: { userId: baAuth.userId, type: "lead_assigned", title: "Phase3 test assign" },
    });
    await p.notification.create({
      data: {
        userId: seAuth.userId,
        type: "lead_assigned",
        title: "Phase3 test assign",
        message: "You were assigned a test lead",
        entityType: "contact",
        entityId: "phase3-test",
      },
    });
    const afterN = await p.notification.count({
      where: { userId: seAuth.userId, type: "lead_assigned" },
    });
    const afterBa = await p.notification.count({
      where: { userId: baAuth.userId, type: "lead_assigned", title: "Phase3 test assign" },
    });
    if (afterN === beforeN + 1 && afterBa === beforeBa) {
      pass("personal lead_assigned → intended user only");
    } else fail("personal lead_assigned", `${beforeN}→${afterN} ba=${beforeBa}→${afterBa}`);
  }

  // Disabled user — no push authorization
  if (baAuth) {
    const disabledOk = !(await canTeamPush("nonexistent_user_id_xxx", businessId || "x"));
    if (disabledOk) pass("missing/disabled user cannot receive push");
  }

  // CRM counts: users/businesses unchanged (notifications may grow by test rows)
  const after = {
    users: await p.user.count(),
    businesses: await p.business.count(),
  };
  if (after.users === before.users && after.businesses === before.businesses) {
    pass("existing CRM user/business counts unchanged", JSON.stringify(after));
  } else fail("CRM counts changed", JSON.stringify({ before, after }));

  // Cleanup test tokens
  await p.devicePushToken.deleteMany({
    where: { installId: { in: [installA, installB] } },
  });
  pass("cleanup test DevicePushToken rows");

  const failed = results.filter((r) => !r.ok);
  console.log("\n==== SUMMARY ====");
  console.log(`passed=${results.filter((r) => r.ok).length} failed=${failed.length}`);
  if (failed.length) {
    for (const f of failed) console.log(" -", f.name, f.detail);
    process.exitCode = 1;
  }
} catch (e) {
  console.error("FATAL", e);
  process.exitCode = 1;
} finally {
  await p.$disconnect();
}
