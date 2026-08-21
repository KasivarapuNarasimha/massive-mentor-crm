/**
 * Focused acceptance: invoice client resolution + lead update reliability (5x).
 * pnpm exec tsx src/scripts/qa-ai-command-accept.ts
 */
import { prisma } from "../lib/prisma.js";
import { runAiCommand } from "../services/ai-command/service.js";
import {
  createContact,
  updateContact,
  getContactById,
  deleteContact,
} from "../services/crm.service.js";
import { listInvoices } from "../services/finance.service.js";
import { listAssignableMembers } from "../services/lead-assignment.service.js";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function pass(name: string, detail?: string) {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name: string, detail?: string) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function cmd(userId: string, message: string, sessionId?: string, choices?: Record<string, string>) {
  const data = await runAiCommand({ userId, message, sessionId, choices });
  console.log(`  status=${data.status} summary=${String(data.summary || "").slice(0, 160)}`);
  if (data.steps?.length) console.log("  steps=" + data.steps.map((s) => `${s.action}:${s.status}`).join("; "));
  return data;
}

async function resolveChoices(
  userId: string,
  d: Awaited<ReturnType<typeof runAiCommand>>,
  preferContactId: string,
  sureshId?: string
) {
  let cur = d;
  for (let i = 0; i < 5 && cur.status === "needs_choice" && cur.choices?.length; i++) {
    const byLead = cur.choices.find((c) => c.id === preferContactId);
    const bySuresh = cur.choices.find((c) => /suresh/i.test(`${c.label || ""} ${c.sublabel || ""}`));
    const field = String(cur.choices[0].field || "");
    const pick =
      field === "assignee" ? bySuresh || cur.choices[0] : byLead || bySuresh || cur.choices[0];
    cur = await cmd(userId, "(selection)", cur.sessionId, {
      [pick.field || (field === "assignee" ? "assignee" : "contact")]: pick.id,
    });
  }
  return cur;
}

async function main() {
  const demoEmail = process.env.DEMO_EMAIL || "demo@massivementor.in";
  const user = await prisma.user.findFirst({ where: { email: demoEmail } });
  if (!user) throw new Error("demo user missing");
  const userId = user.id;
  const members = await listAssignableMembers(userId);
  const rahul = members.find((m) => /rahul/i.test(m.name || ""));
  const suresh = members.find((m) => /suresh/i.test(m.name || ""));
  const tag = `Accept${Date.now().toString(36).slice(-6)}`;
  const company = tag; // unique exact company — no historic collisions
  const phone = `98${String(Date.now()).slice(-8)}`;

  const lead = await createContact(userId, {
    type: "lead",
    name: company,
    company,
    phone,
    status: "new",
    assignedTo: rahul?.id,
  });
  console.log("SEEDED", lead.id, company);

  // --- Invoice acceptance (unique company, TE+EN exact shape) ---
  console.log("\n=== Invoice client resolution ===");
  let d = await cmd(
    userId,
    `${company} ki website development ₹85,000 invoice create cheyyi, due 15 days.`
  );
  d = await resolveChoices(userId, d, lead.id, suresh?.id);
  const invId = d.steps?.[0]?.entityId;
  const listed = await listInvoices(userId, { page: 1, pageSize: 30 });
  const hit = ((listed as { items?: any[] }).items || []).find((x) => x.id === invId);
  const tax = hit != null ? Number(hit.taxRate) : -1;
  const days = hit?.dueDate
    ? Math.round((new Date(hit.dueDate).getTime() - Date.now()) / (24 * 3600 * 1000))
    : -1;
  if (
    (d.status === "completed" || d.status === "partial") &&
    hit &&
    Math.abs(Number(hit.amount) - 85000) < 0.01 &&
    tax === 0 &&
    days >= 13 &&
    days <= 16 &&
    hit.contactId === lead.id
  ) {
    pass("Invoice TE+EN resolves client + no GST", `${hit.number} due~${days}d`);
  } else {
    fail(
      "Invoice TE+EN resolves client + no GST",
      `status=${d.status} summary=${d.summary} amount=${hit?.amount} tax=${tax} days=${days} contactId=${hit?.contactId}`
    );
  }

  // --- Lead update 5x ---
  console.log("\n=== Lead update 5x ===");
  const variants = [
    `${company} status Qualified ki change chesi Suresh ki assign cheyyi.`,
    `${company} ni Qualified status ki update chesi Suresh ki assign cheyyi.`,
    `Update ${company} to Qualified and assign to Suresh.`,
    `${company} status Qualified chesi Suresh assign cheyyi.`,
    `${company} Qualified ki change cheyyi, assignee Suresh.`,
  ];
  let okCount = 0;
  for (let i = 0; i < 5; i++) {
    await updateContact(userId, lead.id, { status: "new", assignedTo: rahul?.id || null });
    console.log(`  -- run ${i + 1}`);
    d = await cmd(userId, variants[i]);
    d = await resolveChoices(userId, d, lead.id, suresh?.id);
    const after = await getContactById(userId, lead.id);
    const ok =
      (d.status === "completed" || d.status === "partial") &&
      !!after &&
      String(after.status || "").toLowerCase() === "qualified" &&
      (!suresh || after.assignedTo === suresh.id);
    if (ok) {
      okCount++;
      pass(`Lead update run ${i + 1}`);
    } else {
      fail(
        `Lead update run ${i + 1}`,
        `planner=${d.status} status=${after?.status} assigned=${after?.assignedTo}`
      );
    }
  }
  if (okCount === 5) pass("Lead update 5/5");
  else fail("Lead update 5/5", `${okCount}/5`);

  // Cleanup
  try {
    await deleteContact(userId, lead.id);
  } catch {
    /* ignore */
  }

  console.log("\n======== ACCEPTANCE SUMMARY ========");
  console.log(`Passed: ${results.filter((r) => r.ok).length}/${results.length}`);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await new Promise((r) => setTimeout(r, 400));
    await prisma.$disconnect();
  });
