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

  // 4) Invoice with id + GST 18%
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

  // 4b) Invoice resolve by soft-ref query (no id) — no invented GST
  const invSoft = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "create_invoice",
          args: {
            contact: { by: "company_or_name", query: `${tag} Co` },
            amount: 85000,
            description: "website development soft",
            due: { days: 15 },
          },
        },
      ],
    },
    { sessionId: "qa-soft-inv" }
  );
  const softInvId = invSoft.steps[0]?.entityId;
  if (invSoft.status === "completed" && softInvId) {
    const listedInv = await listInvoices(userId, { page: 1, pageSize: 50 });
    const items =
      (listedInv as { items?: Array<{ id: string; amount?: unknown; taxRate?: unknown; contactId?: string | null; dueDate?: Date | string | null; description?: string | null }> }).items ||
      [];
    const hit = items.find((i) => i.id === softInvId);
    const tax = hit ? Number(hit.taxRate) : -1;
    const days =
      hit?.dueDate != null
        ? Math.round((new Date(hit.dueDate).getTime() - Date.now()) / (24 * 3600 * 1000))
        : -1;
    if (hit && Number(hit.amount) === 85000 && tax === 0 && days >= 13 && days <= 16 && hit.contactId === leadId) {
      pass("Invoice soft-ref query no GST", `${hit.id} due~${days}d tax=${tax}`);
    } else {
      fail(
        "Invoice soft-ref query no GST",
        JSON.stringify({
          status: invSoft.status,
          softInvId,
          amount: hit?.amount,
          tax,
          days,
          contactId: hit?.contactId,
          desc: hit?.description,
        })
      );
    }
  } else fail("Invoice soft-ref query no GST", invSoft.summary);

  // 4c) Invoice identity only in company field (planner flake) — must resolve ABC-like company
  const invCompanyOnly = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "create_invoice",
          args: {
            company: `${tag} Co`,
            amount: 42000,
            description: "company-field-only invoice",
            dueInDays: 15,
          },
        },
      ],
    },
    { sessionId: "qa-co-inv" }
  );
  if (invCompanyOnly.status === "completed" && invCompanyOnly.steps[0]?.entityId) {
    pass("Invoice company-field fallback resolves client", invCompanyOnly.steps[0].entityId);
  } else fail("Invoice company-field fallback resolves client", invCompanyOnly.summary);

  // 4d) Lead update via company field only (no contact soft-ref) — 5 deterministic repeats
  let updateFlakePass = 0;
  for (let i = 0; i < 5; i++) {
    const upd = await executePlan(
      ctx,
      {
        steps: [
          {
            id: "s1",
            action: "update_contact",
            args: {
              company: `${tag} Co`,
              status: i % 2 === 0 ? "qualified" : "contacted",
            },
          },
        ],
      },
      { sessionId: `qa-upd-${i}` }
    );
    const after = await getContactById(userId, leadId);
    const want = i % 2 === 0 ? "qualified" : "contacted";
    if (upd.status === "completed" && after && String(after.status).toLowerCase() === want) updateFlakePass++;
    else fail(`Lead update company-fallback run ${i + 1}`, `${upd.status} status=${after?.status}`);
  }
  if (updateFlakePass === 5) pass("Lead update company-fallback 5/5 deterministic");
  else fail("Lead update company-fallback 5/5 deterministic", `${updateFlakePass}/5`);

  // 4e) Lead update via soft-ref query 5/5
  let softUpd = 0;
  for (let i = 0; i < 5; i++) {
    const upd = await executePlan(
      ctx,
      {
        steps: [
          {
            id: "s1",
            action: "update_contact",
            args: {
              contact: { by: "company_or_name", query: `${tag} Co` },
              status: "qualified",
            },
          },
        ],
      },
      { sessionId: `qa-soft-upd-${i}` }
    );
    if (upd.status === "completed") softUpd++;
    else fail(`Lead update soft-ref run ${i + 1}`, upd.summary);
  }
  if (softUpd === 5) pass("Lead update soft-ref query 5/5");
  else fail("Lead update soft-ref query 5/5", `${softUpd}/5`);

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

  // Exact unique match must auto-resolve (before delete)
  const exact = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "update_contact",
          args: { contact: { by: "company_or_name", query: `${tag} Co` }, status: "negotiation" },
        },
      ],
    },
    { sessionId: "qa-exact" }
  );
  const exactAfter = await getContactById(userId, leadId);
  if (exact.status === "completed" && exactAfter && String(exactAfter.status).toLowerCase() === "negotiation") {
    pass("Exact unique company match auto-resolves");
  } else fail("Exact unique company match auto-resolves", exact.summary);

  // Empty contact must not invent — needs_input/failed with specify message
  const empty = await executePlan(
    ctx,
    { steps: [{ id: "s1", action: "update_contact", args: { contact: {}, status: "won" } }] },
    { sessionId: "qa-empty" }
  );
  if (empty.status === "failed" || empty.status === "needs_input") {
    pass("Empty contact ref does not invent entity", empty.status);
  } else fail("Empty contact ref does not invent entity", empty.status);

  // Deal value update
  const dealUpd = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "update_deal",
          args: { deal: { by: "query", query: `${tag} Deal` }, value: 500000 },
        },
      ],
    },
    { sessionId: "qa-deal" }
  );
  if (dealUpd.status === "completed" || dealUpd.status === "needs_choice") {
    pass("Deal update path", dealUpd.status);
  } else fail("Deal update path", dealUpd.summary);

  // WhatsApp draft (no send)
  const wa = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "draft_whatsapp",
          args: { company: `${tag} Co`, topic: "follow-up" },
        },
      ],
    },
    { sessionId: "qa-wa" }
  );
  if (wa.status === "completed" && wa.steps[0]?.action === "draft_whatsapp") {
    pass("WhatsApp draft via company fallback");
  } else fail("WhatsApp draft via company fallback", wa.summary);

  // Low stock list
  const low = await executePlan(
    ctx,
    { steps: [{ id: "s1", action: "list_low_stock", args: {} }] },
    { sessionId: "qa-low" }
  );
  if (low.status === "completed" || low.status === "failed" || low.status === "needs_input") {
    pass("Low-stock action reachable", low.status);
  } else fail("Low-stock action reachable", low.status);

  // Ambiguity: multiple exact company matches → needs_choice (no silent write)
  const twinTag = `TwinCo-${tag}`;
  await executePlan(
    ctx,
    {
      steps: [
        { id: "a", action: "create_lead", args: { name: `${tag}-A`, company: twinTag, phone: "9000000001", status: "new" } },
        { id: "b", action: "create_lead", args: { name: `${tag}-B`, company: twinTag, phone: "9000000002", status: "new" } },
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
          args: { contact: { by: "company_or_name", query: twinTag }, status: "qualified" },
        },
      ],
    },
    { sessionId: "qa" }
  );
  if (amb.status === "needs_choice" && (amb.choices?.length || 0) >= 2) {
    pass("Ambiguous TwinCo → needs_choice", `choices=${amb.choices?.length}`);
  } else {
    fail("Ambiguous TwinCo → needs_choice", `${amb.status} choices=${amb.choices?.length || 0}`);
  }

  // Delete confirmation token flow (after resolution tests that need the lead)
  const delPlan = await executePlan(
    ctx,
    {
      steps: [{ id: "s1", action: "delete_contact", args: { contact: { id: leadId } } }],
    },
    { sessionId: "qa" }
  );
  if (delPlan.status === "needs_confirmation" && delPlan.confirmToken) {
    pass("Delete requires confirmation token");
    // Token crypto + replay protection
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
    try {
      await executeConfirmedAction(ctx, "delete_contact", { contact: { id: leadId } });
      pass("Confirmed delete executed");
    } catch (e) {
      fail("Confirmed delete executed", e instanceof Error ? e.message : String(e));
    }
  } else {
    fail("Delete requires confirmation token", delPlan.status);
  }

  // Unsupported payroll not in registry
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
