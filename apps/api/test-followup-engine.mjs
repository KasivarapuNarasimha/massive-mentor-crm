import { PrismaClient } from "@prisma/client";

const API = "http://127.0.0.1:4000/api";
const prisma = new PrismaClient();

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "ui_seed_148348558@test.local",
      password: "SecurePass1!",
    }),
  });
  const j = await res.json();
  if (!j.success) throw new Error("login failed: " + JSON.stringify(j));
  return j.data.token;
}

async function main() {
  const token = await login();
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Ensure some stale leads for overdue rules
  const me = await fetch(`${API}/auth/me`, { headers: h }).then((r) => r.json());
  const userId = me.data?.user?.id || me.data?.id;
  console.log("userId", userId);

  // Create a high-value silent lead if needed
  const create = await fetch(`${API}/crm/contacts`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      type: "lead",
      name: "ABC Builders Followup Test",
      company: "ABC Builders",
      phone: "9888877701",
      email: "abc.followup@test.io",
      status: "proposal",
      value: 150000,
      aiScore: 82,
      description: "Engine test lead",
    }),
  }).then((r) => r.json());
  console.log("create contact", create.success ? create.data?.id || create.data?.contact?.id : create.error);

  const contactId = create.data?.id || create.data?.contact?.id;
  if (contactId) {
    // Backdate lastContactedAt via prisma for silentDays rule
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        lastContactedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      },
    });
  }

  const t0 = Date.now();
  const refresh = await fetch(`${API}/crm/ai/followup-engine/refresh`, {
    method: "POST",
    headers: h,
    body: "{}",
  }).then((r) => r.json());
  console.log("refresh", Date.now() - t0, "ms", JSON.stringify(refresh));

  const list = await fetch(`${API}/crm/ai/followup-engine?force=1&limit=15`, { headers: h }).then(
    (r) => r.json()
  );
  console.log("list count", list.data?.count);
  for (const i of (list.data?.items || []).slice(0, 8)) {
    console.log("-", i.urgency, i.actionType, "|", i.title);
    console.log("  reason:", i.reason);
  }

  const summary = await fetch(`${API}/crm/ai/followup-engine/summary`, { headers: h }).then((r) =>
    r.json()
  );
  console.log("summary counts", summary.data?.counts);

  if (contactId) {
    const one = await fetch(`${API}/crm/ai/followup-engine/contact/${contactId}`, {
      headers: h,
    }).then((r) => r.json());
    console.log("contact primary", one.data?.primary?.title, one.data?.primary?.reason);
  }

  // Act on first rec
  const first = list.data?.items?.[0];
  if (first) {
    const act = await fetch(`${API}/crm/ai/followup-engine/${first.id}/act`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ actionTaken: "call", notes: "test complete" }),
    }).then((r) => r.json());
    console.log("act", act);

    const actions = await prisma.aiRecommendationAction.count({
      where: { recommendationId: first.id },
    });
    console.log("action history rows for rec", actions);

    const list2 = await fetch(`${API}/crm/ai/followup-engine?force=1&limit=15`, {
      headers: h,
    }).then((r) => r.json());
    const stillThere = (list2.data?.items || []).some((x) => x.id === first.id);
    console.log("completed rec still active?", stillThere);
  }

  const db = {
    total: await prisma.aiRecommendation.count(),
    active: await prisma.aiRecommendation.count({ where: { status: "active" } }),
    completed: await prisma.aiRecommendation.count({ where: { status: "completed" } }),
    actions: await prisma.aiRecommendationAction.count(),
    notifs: await prisma.notification.count({ where: { type: "ai_recommendation" } }),
  };
  console.log("DB", db);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
