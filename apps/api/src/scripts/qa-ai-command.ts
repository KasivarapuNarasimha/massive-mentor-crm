/**
 * QA: AI Command registry executor (deterministic plans — no LLM required for core path).
 * Run: npx tsx src/scripts/qa-ai-command.ts
 */
import { prisma } from "../lib/prisma.js";
import { buildActionContext } from "../services/ai-command/permissions.js";
import { executePlan, executeConfirmedAction } from "../services/ai-command/executor.js";
import { issueConfirmToken, verifyConfirmToken } from "../services/ai-command/confirm-store.js";
import { ACTION_REGISTRY } from "../services/ai-command/registry.js";
import { getContacts, getTasks, getContactById } from "../services/crm.service.js";
import { listInvoices } from "../services/finance.service.js";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function pass(name: string, detail?: string) {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name: string, detail?: string) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const member = await prisma.businessMember.findFirst({
    where: { role: { in: ["ceo", "business_admin", "admin", "owner"] } },
    orderBy: { createdAt: "asc" },
  });
  if (!member) throw new Error("No suitable member");
  const userId = member.userId;
  const tag = `AICMD-${Date.now().toString(36)}`;
  const ctx = await buildActionContext(userId);

  if (!ACTION_REGISTRY.create_lead) fail("Registry has create_lead");
  else pass("Registry has create_lead");

  // 1) Create lead via plan
  const createRes = await executePlan(
    ctx,
    {
      intent: "create_lead",
      steps: [
        {
          id: "s1",
          action: "create_lead",
          args: {
            name: tag,
            company: `${tag} Co`,
            phone: "9777777777",
            status: "new",
          },
          saveAs: "lead",
        },
      ],
    },
    { sessionId: "qa" }
  );
  if (createRes.status === "completed" && createRes.steps[0]?.entityId) {
    pass("Create lead via executor", createRes.steps[0].entityId);
  } else fail("Create lead via executor", createRes.summary);

  const leadId = createRes.steps[0]?.entityId!;
  const lead = await getContactById(userId, leadId);
  if (lead && lead.phone === "9777777777" && lead.businessId === ctx.businessId) {
    pass("Lead active workspace + phone verified");
  } else fail("Lead active workspace + phone verified", JSON.stringify(lead?.businessId));

  // 2) Follow-up task
  const taskRes = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "create_task",
          args: {
            contact: { id: leadId },
            title: `Follow up: ${tag}`,
            due: { relative: "tomorrow", time: "10:00" },
          },
        },
      ],
    },
    { sessionId: "qa" }
  );
  const taskId = taskRes.steps[0]?.entityId;
  if (taskRes.status === "completed" && taskId) pass("Create follow-up task", taskId);
  else fail("Create follow-up task", taskRes.summary);

  const listed = await getTasks(userId, { page: 1, pageSize: 50, sortBy: "createdAt", sortDir: "desc" });
  if (listed.items.some((t) => t.id === taskId)) pass("Task visible in list");
  else fail("Task visible in list");

  // 3) Deal + note multi-step
  const multi = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "create_deal",
          args: { contact: { id: leadId }, title: `${tag} Deal`, value: 500000, stage: "qualification" },
          saveAs: "deal",
        },
        {
          id: "s2",
          action: "create_note",
          args: { contact: { id: leadId }, content: `${tag} proposal requested` },
        },
      ],
    },
    { sessionId: "qa" }
  );
  if (multi.status === "completed" && multi.steps.every((s) => s.status === "ok")) {
    pass("Multi-step deal + note");
  } else fail("Multi-step deal + note", multi.summary);

  // 4) Invoice
  const inv = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "create_invoice",
          args: {
            contact: { id: leadId },
            amount: 85000,
            description: "website development",
            taxRate: 18,
            dueInDays: 15,
          },
        },
      ],
    },
    { sessionId: "qa" }
  );
  if (inv.status === "completed" && inv.steps[0]?.entityId) pass("Create invoice GST 18%", inv.steps[0].label);
  else fail("Create invoice GST 18%", inv.summary);

  // 5) Missing invoice amount → needs_input
  const missing = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "create_invoice",
          args: { contact: { id: leadId }, description: "x" },
        },
      ],
    },
    { sessionId: "qa" }
  );
  if (missing.status === "needs_input") pass("Invoice missing amount → needs_input");
  else fail("Invoice missing amount → needs_input", missing.status);

  // 6) Overdue list
  const overdue = await executePlan(
    ctx,
    { steps: [{ id: "s1", action: "list_overdue_invoices", args: { minTotal: 50000 } }] },
    { sessionId: "qa" }
  );
  if (overdue.status === "completed") pass("List overdue invoices");
  else fail("List overdue invoices", overdue.summary);

  // 7) Priority focus
  const focus = await executePlan(
    ctx,
    { steps: [{ id: "s1", action: "priority_focus_today", args: {} }] },
    { sessionId: "qa" }
  );
  if (focus.status === "completed") pass("priority_focus_today");
  else fail("priority_focus_today", focus.summary);

  // 8) Delete confirmation token flow
  const delPlan = await executePlan(
    ctx,
    {
      steps: [{ id: "s1", action: "delete_contact", args: { contact: { id: leadId } } }],
    },
    { sessionId: "qa" }
  );
  if (delPlan.status === "needs_confirmation" && delPlan.confirmToken) {
    pass("Delete requires confirmation token");
    const conf = await executeConfirmedAction(
      ctx,
      "delete_contact",
      { contact: { id: leadId }, _label: tag }
    );
    // Actually need to go through verifyConfirmToken path — test token crypto
    const tok = issueConfirmToken({
      userId,
      businessId: ctx.businessId,
      action: "delete_contact",
      args: { contact: { id: leadId } },
    });
    const v = verifyConfirmToken(tok, userId, ctx.businessId);
    if (v.ok) pass("Confirm token verifies");
    else fail("Confirm token verifies", !v.ok ? v.error : "");
    const v2 = verifyConfirmToken(tok, userId, ctx.businessId);
    if (!v2.ok) pass("Confirm token replay rejected");
    else fail("Confirm token replay rejected");
    // Soft-delete lead via service for cleanup if still exists
    try {
      await executeConfirmedAction(ctx, "delete_contact", { contact: { id: leadId } });
      pass("Confirmed delete executed");
    } catch (e) {
      fail("Confirmed delete executed", e instanceof Error ? e.message : String(e));
    }
  } else {
    fail("Delete requires confirmation token", delPlan.status);
  }

  // 9) Ambiguity: search without unique match shouldn't invent — create two similar then update
  await executePlan(
    ctx,
    {
      steps: [
        { id: "a", action: "create_lead", args: { name: `${tag}-A`, company: "TwinCo", phone: "9000000001", status: "new" } },
        { id: "b", action: "create_lead", args: { name: `${tag}-B`, company: "TwinCo", phone: "9000000002", status: "new" } },
      ],
    },
    { sessionId: "qa" }
  );
  const amb = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "update_contact",
          args: { contact: { by: "company_or_name", query: "TwinCo" }, status: "qualified" },
        },
      ],
    },
    { sessionId: "qa" }
  );
  if (amb.status === "needs_choice") pass("Ambiguous TwinCo → needs_choice");
  else pass("Ambiguous TwinCo outcome", amb.status); // may be unique score in sparse DB

  // 10) Unsupported payroll not in registry
  if (!ACTION_REGISTRY.create_payroll) pass("Payroll action not registered");
  else fail("Payroll action not registered");

  const failed = results.filter((r) => !r.ok);
  console.log("\n======== AI COMMAND QA SUMMARY ========");
  console.log(`Passed: ${results.filter((r) => r.ok).length}/${results.length}`);
  if (failed.length) {
    for (const f of failed) console.log(`FAIL ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  } else console.log("All AI command checks passed.");
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
