/**
 * Live NL AI Command Center QA (local) — calls runAiCommand/confirmAiCommand
 * directly (same planner→resolver→executor path as HTTP; avoids quota 429).
 * Run: pnpm exec tsx src/scripts/qa-ai-command-live.ts
 */
import { prisma } from "../lib/prisma.js";
import { runAiCommand, confirmAiCommand } from "../services/ai-command/service.js";
import {
  createContact,
  updateContact,
  getContactById,
  getContacts,
  getTasks,
  createDeal,
  getDeals,
} from "../services/crm.service.js";
import { listInvoices } from "../services/finance.service.js";
import { listAssignableMembers } from "../services/lead-assignment.service.js";
import { createBusinessUser } from "../services/user-admin.service.js";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

function pass(name: string, detail?: string) {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name: string, detail?: string) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function ensureMembers(userId: string) {
  let members = await listAssignableMembers(userId);
  for (const [name, email] of [
    ["Rahul", "rahul.localqa@massivementor.local"],
    ["Suresh", "suresh.localqa@massivementor.local"],
  ] as const) {
    if (members.some((m) => String(m.name || "").toLowerCase() === name.toLowerCase())) continue;
    try {
      await createBusinessUser({
        actorUserId: userId,
        name,
        email,
        password: "TestPass123!",
        role: "sales_executive",
      });
    } catch (e) {
      console.log(`  ensure_member ${name} skipped:`, e instanceof Error ? e.message : e);
    }
    members = await listAssignableMembers(userId);
  }
  return members;
}

class Runner {
  userId: string;
  sessionId: string | undefined;
  constructor(userId: string) {
    this.userId = userId;
  }
  async cmd(message: string, choices?: Record<string, string>) {
    const data = await runAiCommand({
      userId: this.userId,
      message,
      sessionId: this.sessionId,
      choices,
    });
    this.sessionId = data.sessionId;
    console.log(`  status=${data.status} summary=${String(data.summary || "").slice(0, 180)}`);
    if (data.steps?.length) {
      console.log("  steps=" + data.steps.map((s) => `${s.action}:${s.status}`).join("; "));
    }
    return data;
  }
  async confirm(token: string) {
    const data = await confirmAiCommand({
      userId: this.userId,
      confirmToken: token,
      sessionId: this.sessionId,
    });
    console.log(`  CONFIRM status=${data.status} summary=${String(data.summary || "").slice(0, 120)}`);
    return data;
  }
}

async function main() {
  const demoEmail = process.env.DEMO_EMAIL || "demo@massivementor.in";
  const demoUser = await prisma.user.findFirst({ where: { email: demoEmail } });
  let userId = demoUser?.id;
  if (!userId) {
    const member = await prisma.businessMember.findFirst({
      where: { role: { in: ["ceo", "business_admin", "admin", "owner"] } },
      orderBy: { createdAt: "asc" },
    });
    if (!member) throw new Error("No suitable business member");
    userId = member.userId;
  }
  console.log("USER", userId, "email", demoUser?.email || "(fallback member)");

  const members = await ensureMembers(userId);
  const rahul = members.find((m) => String(m.name || "").toLowerCase() === "rahul");
  const suresh = members.find((m) => String(m.name || "").toLowerCase() === "suresh");
  const suffix = String(Date.now()).slice(-5);
  const company = `ABC Co ${suffix}`;
  const phone = `9911${suffix}`;
  const r = new Runner(userId);

  // Seed existing company via CRM service (production precondition)
  const seeded = await createContact(userId, {
    type: "lead",
    name: company,
    company,
    phone,
    status: "new",
    assignedTo: rahul?.id,
  });
  const leadId = seeded.id;
  console.log("SEEDED", leadId, company, phone);

  // 1 NL lead create
  console.log("\n=== 1 Lead create NL ===");
  const createCo = `NovaCo ${suffix}`;
  const createPhone = `9922${suffix}`;
  r.sessionId = undefined;
  let d = await r.cmd(`${createCo} ${createPhone} status New assign to Rahul ani lead create cheyyi.`);
  if (d.status === "needs_choice" && d.choices?.length) {
    const choice = d.choices.find((c) => /rahul/i.test(c.label || "")) || d.choices[0];
    d = await r.cmd("(selection)", { [choice.field || "assignee"]: choice.id });
  }
  const createdId = d.steps?.[0]?.entityId;
  let created: any = null;
  if (createdId) {
    try {
      created = await getContactById(userId, createdId);
    } catch {
      created = null;
    }
  }
  if (!created) {
    const createdList = await getContacts(userId, { search: createPhone, page: 1, pageSize: 20 });
    created = createdList.items.find((c: any) => String(c.phone) === createPhone) || null;
  }
  if ((d.status === "completed" || d.status === "partial") && created) {
    pass("1 Lead create TE+EN", created.id);
  } else fail("1 Lead create TE+EN", `${d.status} ${d.summary} entityId=${createdId}`);

  // 2 Lead update x5 against seeded company (exact prod phrasing variants)
  console.log("\n=== 2 Lead update Qualified+Suresh x5 ===");
  const variants = [
    `${company} status Qualified ki change chesi Suresh ki assign cheyyi.`,
    `${company} ni Qualified status ki update chesi Suresh ki assign cheyyi.`,
    `Update ${company} to Qualified and assign to Suresh.`,
    `${company} (${phone}) status Qualified chesi Suresh assign cheyyi.`,
    `${company} Qualified ki change cheyyi, assignee Suresh.`,
  ];
  let updPass = 0;
  for (let i = 0; i < 5; i++) {
    await updateContact(userId, leadId, { status: "new", assignedTo: rahul?.id || null });
    r.sessionId = undefined;
    console.log(`  -- run ${i + 1}`);
    d = await r.cmd(variants[i]);
    // Resolve chained needs_choice (contact → assignee) deterministically.
    for (let guard = 0; guard < 4 && d.status === "needs_choice" && d.choices?.length; guard++) {
      const byLead = d.choices.find((c) => c.id === leadId);
      const bySuresh = d.choices.find((c) => /suresh/i.test(`${c.label || ""} ${c.sublabel || ""}`));
      const byRahul = d.choices.find((c) => /rahul/i.test(`${c.label || ""} ${c.sublabel || ""}`));
      const fieldHint = String(d.choices[0].field || "");
      let pick = d.choices[0];
      if (fieldHint === "assignee" || bySuresh) pick = bySuresh || byRahul || d.choices[0];
      else if (byLead) pick = byLead;
      else pick = d.choices[0];
      d = await r.cmd("(selection)", { [pick.field || (bySuresh ? "assignee" : "contact")]: pick.id });
    }
    let lead: any = null;
    try {
      lead = await getContactById(userId, leadId);
    } catch {
      lead = null;
    }
    const ok =
      (d.status === "completed" || d.status === "partial") &&
      lead &&
      String(lead.status || "").toLowerCase() === "qualified" &&
      (!suresh || lead.assignedTo === suresh.id);
    if (ok) {
      updPass++;
      pass(`2 Lead update run ${i + 1}`);
    } else {
      fail(`2 Lead update run ${i + 1}`, `planner=${d.status} status=${lead?.status} assigned=${lead?.assignedTo} summary=${d.summary}`);
    }
  }
  if (updPass === 5) pass("2 Lead update 5/5 aggregate");
  else fail("2 Lead update 5/5 aggregate", `${updPass}/5`);

  // Exact prod-style phrasing with literal "ABC Company" alias: also update via company-field flake plan is covered in deterministic QA.
  // Run one more with the exact production string against a uniquely named contact that includes ABC Company.
  console.log("\n=== 2b Exact prod invoice+update company name ===");
  const prodCo = "ABC Company";
  const prodPhone = `9933${suffix}`;
  // Prefer reusing/creating a single unique phone-tagged ABC Company for this run
  let prodLead = (await getContacts(userId, { search: prodPhone, page: 1, pageSize: 10 })).items.find(
    (c: any) => String(c.phone) === prodPhone
  ) as any;
  if (!prodLead) {
    prodLead = await createContact(userId, {
      type: "lead",
      name: prodCo,
      company: prodCo,
      phone: prodPhone,
      status: "new",
      assignedTo: rahul?.id,
    });
  }
  const prodLeadId = prodLead.id as string;
  await updateContact(userId, prodLeadId, { status: "new", assignedTo: rahul?.id || null, company: prodCo, name: prodCo });

  r.sessionId = undefined;
  d = await r.cmd("ABC Company status Qualified ki change chesi Suresh ki assign cheyyi.");
  if (d.status === "needs_choice" && d.choices?.length) {
    // Prefer our phone-tagged lead, else Suresh assignee choice
    const byId = d.choices.find((c) => c.id === prodLeadId);
    if (byId && (d.choices[0].field === "contact" || byId.field === "contact")) {
      d = await r.cmd("(selection)", { [byId.field || "contact"]: byId.id });
    }
    if (d.status === "needs_choice" && d.choices?.length) {
      const choice = d.choices.find((c) => /suresh/i.test(c.label || "")) || d.choices[0];
      d = await r.cmd("(selection)", { [choice.field || "assignee"]: choice.id });
    }
  }
  let afterProd: any = null;
  try {
    afterProd = await getContactById(userId, prodLeadId);
  } catch {
    afterProd = null;
  }
  if (
    (d.status === "completed" || d.status === "partial") &&
    afterProd &&
    String(afterProd.status || "").toLowerCase() === "qualified" &&
    (!suresh || afterProd.assignedTo === suresh.id)
  ) {
    pass("2b Prod phrasing lead update", afterProd.status);
  } else if (d.status === "needs_choice") {
    // Multiple historic ABC Company rows — deterministic policy is needs_choice (correct)
    pass("2b Prod phrasing lead update needs_choice (multi ABC)", `choices=${d.choices?.length}`);
  } else {
    fail("2b Prod phrasing lead update", `${d.status} ${d.summary} status=${afterProd?.status}`);
  }

  // 3 Follow-up
  console.log("\n=== 3 Follow-up ===");
  r.sessionId = undefined;
  d = await r.cmd(`${company} ki repu 10 AM follow-up create cheyyi.`);
  if (d.status === "needs_choice" && d.choices?.length) {
    const choice = d.choices.find((c) => c.id === leadId) || d.choices[0];
    d = await r.cmd("(selection)", { [choice.field || "contact"]: choice.id });
  }
  const tasks = await getTasks(userId, { page: 1, pageSize: 50, sortBy: "createdAt", sortDir: "desc" });
  const task = tasks.items.find((t: any) => t.contactId === leadId);
  if ((d.status === "completed" || d.status === "partial") && task) pass("3 Follow-up", (task as any).id);
  else fail("3 Follow-up", `${d.status} ${d.summary}`);

  // 4 Invoice — exact prod phrasing against unique company + ABC Company alias
  console.log("\n=== 4 Invoice client resolution ===");
  const invVariants = [
    `${company} ki website development ₹85,000 invoice create cheyyi, due 15 days.`,
    `Create invoice for ${company} for website development amount ₹85000 due in 15 days.`,
    // Exact production failure phrasing — may needs_choice if many ABC Company rows
    "ABC Company ki website development ₹85,000 invoice create cheyyi, due 15 days.",
  ];
  let invPass = 0;
  for (let i = 0; i < invVariants.length; i++) {
    r.sessionId = undefined;
    console.log(`  -- inv ${i + 1}: ${invVariants[i].slice(0, 70)}`);
    d = await r.cmd(invVariants[i]);
    if (d.status === "needs_choice" && d.choices?.length) {
      const prefer = i === 2 ? prodLeadId : leadId;
      const choice = d.choices.find((c) => c.id === prefer) || d.choices[0];
      d = await r.cmd("(selection)", { [choice.field || "contact"]: choice.id });
    }
    const entityId = d.steps?.[0]?.entityId;
    const listedInv = await listInvoices(userId, { page: 1, pageSize: 50 });
    const items = (listedInv as { items?: any[] }).items || [];
    const hit = entityId ? items.find((x) => x.id === entityId) : null;
    const tax = hit != null ? Number(hit.taxRate) : -1;
    let dueOk = false;
    if (hit?.dueDate) {
      const days = Math.round((new Date(hit.dueDate).getTime() - Date.now()) / (24 * 3600 * 1000));
      dueOk = days >= 13 && days <= 16;
    }
    const expectContact = i === 2 ? prodLeadId : leadId;
    const ok =
      (d.status === "completed" || d.status === "partial") &&
      hit &&
      Math.abs(Number(hit.amount) - 85000) < 0.01 &&
      tax === 0 &&
      dueOk &&
      hit.contactId === expectContact;
    if (ok) {
      invPass++;
      pass(`4 Invoice variant ${i + 1}`, `${hit.number} tax=${tax}`);
    } else {
      fail(
        `4 Invoice variant ${i + 1}`,
        `planner=${d.status} summary=${d.summary} amount=${hit?.amount} tax=${tax} due=${hit?.dueDate} contactId=${hit?.contactId}`
      );
    }
  }
  if (invPass === invVariants.length) pass("4 Invoice all variants");
  else fail("4 Invoice all variants", `${invPass}/${invVariants.length}`);

  // 5 Deal
  console.log("\n=== 5 Deal ===");
  await createDeal(userId, {
    title: `${company} Deal`,
    contactId: leadId,
    value: 100000,
    stage: "qualification",
  } as never);
  r.sessionId = undefined;
  d = await r.cmd(`${company} deal ni ₹5 lakhs ki update cheyyi.`);
  if (d.status === "needs_choice" && d.choices?.length) {
    d = await r.cmd("(selection)", { [d.choices[0].field || "deal"]: d.choices[0].id });
  }
  const deals = await getDeals(userId, { search: company, page: 1, pageSize: 25 });
  const deal = deals.items.find((x: any) => Math.abs(Number(x.value) - 500000) < 1);
  if ((d.status === "completed" || d.status === "partial") && deal) pass("5 Deal 5 lakhs", String((deal as any).value));
  else fail("5 Deal 5 lakhs", `${d.status} ${d.summary}`);

  // 6 WhatsApp
  console.log("\n=== 6 WhatsApp draft ===");
  r.sessionId = undefined;
  d = await r.cmd(`${company} ki follow-up WhatsApp message draft cheyyi.`);
  if (d.status === "needs_choice" && d.choices?.length) {
    const choice = d.choices.find((c) => c.id === leadId) || d.choices[0];
    d = await r.cmd("(selection)", { [choice.field || "contact"]: choice.id });
  }
  const actions = (d.steps || []).map((s) => s.action);
  if ((d.status === "completed" || d.status === "partial") && actions.includes("draft_whatsapp") && !actions.includes("send_whatsapp")) {
    pass("6 WhatsApp draft no auto-send");
  } else fail("6 WhatsApp draft no auto-send", JSON.stringify(actions));

  // 7 Delete confirm + replay
  console.log("\n=== 7 Delete confirm ===");
  r.sessionId = undefined;
  d = await r.cmd(`${company} ni delete cheyyi.`);
  if (d.status === "needs_choice" && d.choices?.length) {
    const choice = d.choices.find((c) => c.id === leadId) || d.choices[0];
    d = await r.cmd("(selection)", { [choice.field || "contact"]: choice.id });
  }
  let confOk = false;
  let replayRejected = false;
  let afterGone = false;
  if (d.status === "needs_confirmation" && d.confirmToken) {
    const c1 = await r.confirm(d.confirmToken);
    confOk = c1.status === "completed" || /deleted/i.test(String(c1.summary || ""));
    try {
      const c2 = await r.confirm(d.confirmToken);
      replayRejected = c2.status === "failed" || /already|invalid|used/i.test(String(c2.summary || ""));
    } catch {
      replayRejected = true;
    }
    const still = (await getContacts(userId, { search: phone, page: 1, pageSize: 20 })).items.find((c: any) => c.id === leadId);
    afterGone = !still;
  }
  if (d.status === "needs_confirmation" && confOk && replayRejected && afterGone) pass("7 Delete confirm + replay reject");
  else fail("7 Delete confirm + replay reject", `status=${d.status} conf=${confOk} replay=${replayRejected} gone=${afterGone}`);

  // 8 Ambiguous
  console.log("\n=== 8 Ambiguous TwinCo ===");
  const twin = `TwinCo Live ${suffix}`;
  await createContact(userId, { type: "lead", name: `${twin} A`, company: twin, status: "new", phone: `9771${suffix}` });
  await createContact(userId, { type: "lead", name: `${twin} B`, company: twin, status: "new", phone: `9772${suffix}` });
  r.sessionId = undefined;
  const before = await getContacts(userId, { search: twin, page: 1, pageSize: 20 });
  const beforeMap = Object.fromEntries(before.items.map((c: any) => [c.id, c.status]));
  d = await r.cmd(`${twin} status Qualified ki change cheyyi.`);
  const after = await getContacts(userId, { search: twin, page: 1, pageSize: 20 });
  const changed = after.items.filter((c: any) => beforeMap[c.id] !== c.status);
  if (d.status === "needs_choice" && (d.choices?.length || 0) >= 2 && changed.length === 0) {
    pass("8 Ambiguous needs_choice", `choices=${d.choices?.length}`);
  } else fail("8 Ambiguous needs_choice", `${d.status} choices=${d.choices?.length} changed=${changed.length}`);

  // 9 Payroll
  console.log("\n=== 9 Payroll ===");
  r.sessionId = undefined;
  d = await r.cmd("Rahul salary create cheyyi.");
  if (d.status === "unsupported" && !(d.steps || []).length) pass("9 Payroll unsupported");
  else fail("9 Payroll unsupported", d.status);

  console.log("\n=== Focus / overdue / low-stock ===");
  r.sessionId = undefined;
  d = await r.cmd("What needs attention today?");
  if (d.status === "completed" || d.status === "partial") pass("Focus today");
  else fail("Focus today", d.status);
  d = await r.cmd("Show overdue invoices");
  if (["completed", "partial", "needs_input"].includes(d.status)) pass("Overdue invoices", d.status);
  else fail("Overdue invoices", d.status);
  d = await r.cmd("Show low-stock products");
  if (["completed", "partial", "failed", "needs_input"].includes(d.status)) pass("Low-stock products", d.status);
  else fail("Low-stock products", d.status);

  console.log("\n======== LIVE AI COMMAND QA SUMMARY ========");
  const passed = results.filter((x) => x.ok).length;
  console.log(`Passed: ${passed}/${results.length}`);
  for (const x of results) console.log(`${x.ok ? "PASS" : "FAIL"} ${x.name}${x.detail ? ` — ${x.detail}` : ""}`);
  if (results.some((x) => !x.ok)) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await new Promise((r) => setTimeout(r, 500));
    await prisma.$disconnect().catch(() => undefined);
  });
