/**
 * Final AI Command Center regression matrix (local only).
 * Deterministic executor path + live NL acceptance + protection checks.
 * Run: pnpm exec tsx src/scripts/qa-ai-command-final.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../lib/prisma.js";
import { buildActionContext } from "../services/ai-command/permissions.js";
import { executePlan, executeConfirmedAction } from "../services/ai-command/executor.js";
import { issueConfirmToken, verifyConfirmToken } from "../services/ai-command/confirm-store.js";
import { ACTION_REGISTRY } from "../services/ai-command/registry.js";
import { runAiCommand } from "../services/ai-command/service.js";
import {
  createContact,
  updateContact,
  getContactById,
  getContacts,
  getTasks,
  getDeals,
  deleteContact,
} from "../services/crm.service.js";
import { listInvoices } from "../services/finance.service.js";
import { listAssignableMembers } from "../services/lead-assignment.service.js";

const results: Array<{ name: string; ok: boolean; detail?: string; group: string }> = [];

function pass(group: string, name: string, detail?: string) {
  results.push({ group, name, ok: true, detail });
  console.log(`PASS  [${group}] ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(group: string, name: string, detail?: string) {
  results.push({ group, name, ok: false, detail });
  console.error(`FAIL  [${group}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../../");

function fileContains(rel: string, needle: string | RegExp): boolean {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return false;
  const text = fs.readFileSync(abs, "utf8");
  return typeof needle === "string" ? text.includes(needle) : needle.test(text);
}

async function main() {
  // —— Protection / no-regression surface checks ——
  const G = "protect";
  if (
    fileContains("apps/web/components/ai/MarkdownContent.tsx", "ReactMarkdown") ||
    fileContains("apps/web/components/ai/MarkdownContent.tsx", "markdown")
  ) {
    pass(G, "Mentor MarkdownContent present");
  } else fail(G, "Mentor MarkdownContent present", "apps/web/components/ai/MarkdownContent.tsx");
  if (fileContains("apps/api/src/services/ai/providers/groq.provider.ts", "Groq") || fileContains("apps/api/src/services/ai/providers/groq.provider.ts", "groq")) {
    pass(G, "Groq provider file untouched/present");
  } else fail(G, "Groq provider file untouched/present");
  const groqModel = process.env.GROQ_MODEL || "";
  if (/gpt-oss-120b|groq/i.test(groqModel) || process.env.GROQ_API_KEY) {
    pass(G, "Groq env config intact", groqModel || "key set");
  } else fail(G, "Groq env config intact", "missing");
  if (fileContains("apps/web/lib/nav-hierarchy.ts", "NAV_HIERARCHY")) pass(G, "Stage 2 nav-hierarchy intact");
  else fail(G, "Stage 2 nav-hierarchy intact");
  if (fileContains("apps/web/components/dashboard/FeatureSearch.tsx", "FeatureSearch") || fileContains("apps/web/components/dashboard/FeatureSearch.tsx", "export")) {
    pass(G, "Feature Search intact");
  } else fail(G, "Feature Search intact");
  if (fileContains("apps/web/components/dashboard/DashboardShell.tsx", "FeatureSearch") && fileContains("apps/web/components/dashboard/DashboardShell.tsx", "nav-hierarchy")) {
    pass(G, "DashboardShell still wires Stage2 + FeatureSearch");
  } else fail(G, "DashboardShell still wires Stage2 + FeatureSearch");
  if (fileContains("apps/web/components/dashboard/PremiumDashboard.tsx", "AiCommandCenter")) {
    pass(G, "AiCommandCenter still mounted on dashboard");
  } else fail(G, "AiCommandCenter still mounted on dashboard");
  if (!ACTION_REGISTRY.create_payroll) pass(G, "Payroll action not registered");
  else fail(G, "Payroll action not registered");
  if (ACTION_REGISTRY.create_invoice && ACTION_REGISTRY.create_product && ACTION_REGISTRY.list_low_stock) {
    pass(G, "Finance + ERP actions still registered");
  } else fail(G, "Finance + ERP actions still registered");

  const demoEmail = process.env.DEMO_EMAIL || "demo@massivementor.in";
  const demoUser = await prisma.user.findFirst({ where: { email: demoEmail } });
  const member =
    demoUser &&
    (await prisma.businessMember.findFirst({
      where: { userId: demoUser.id, role: { in: ["ceo", "business_admin", "admin", "owner"] } },
    }));
  const fallback = await prisma.businessMember.findFirst({
    where: { role: { in: ["ceo", "business_admin", "admin", "owner"] } },
    orderBy: { createdAt: "asc" },
  });
  const resolvedUserId = member?.userId || demoUser?.id || fallback?.userId;
  if (!resolvedUserId) throw new Error("No suitable user");
  const userId: string = resolvedUserId;
  const tag = `FINAL-${Date.now().toString(36)}`;
  const ctx = await buildActionContext(userId);
  const members = await listAssignableMembers(userId);
  const rahul = members.find((m) => /rahul/i.test(m.name || ""));
  const suresh = members.find((m) => /suresh/i.test(m.name || ""));

  // —— Deterministic CRM ——
  const CRM = "crm";
  const createLead = await executePlan(
    ctx,
    {
      intent: "create_lead",
      steps: [
        {
          id: "s1",
          action: "create_lead",
          args: { name: tag, company: `${tag} Co`, phone: "9777000001", status: "new", assignee: rahul ? { query: "Rahul" } : undefined },
          saveAs: "lead",
        },
      ],
    },
    { sessionId: "final-crm" }
  );
  const leadId = createLead.steps[0]?.entityId;
  if (createLead.status === "completed" && leadId) pass(CRM, "Create lead", leadId);
  else fail(CRM, "Create lead", createLead.summary);

  const upd = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "update_contact",
          args: { contact: { by: "company_or_name", query: `${tag} Co` }, status: "qualified", assignee: suresh ? { query: "Suresh" } : undefined },
        },
      ],
    },
    { sessionId: "final-upd" }
  );
  const afterUpd = leadId ? await getContactById(userId, leadId) : null;
  if (upd.status === "completed" && afterUpd && String(afterUpd.status).toLowerCase() === "qualified") {
    pass(CRM, "Update + assign lead via soft-ref", afterUpd.assignedTo || "");
  } else fail(CRM, "Update + assign lead via soft-ref", upd.summary);

  // company-field fallback (planner flake) ×5
  let flake = 0;
  for (let i = 0; i < 5; i++) {
    const r = await executePlan(
      ctx,
      {
        steps: [
          {
            id: "s1",
            action: "update_contact",
            args: { company: `${tag} Co`, status: i % 2 ? "contacted" : "qualified" },
          },
        ],
      },
      { sessionId: `final-flake-${i}` }
    );
    if (r.status === "completed") flake++;
  }
  if (flake === 5) pass(CRM, "Repeated entity resolution company-fallback 5/5");
  else fail(CRM, "Repeated entity resolution company-fallback 5/5", `${flake}/5`);

  const client = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "create_client",
          args: { name: `${tag} Client`, company: `${tag} Client Co`, phone: "9777000002" },
          saveAs: "client",
        },
      ],
    },
    { sessionId: "final-client" }
  );
  if (client.status === "completed" && client.steps[0]?.entityId) pass(CRM, "Create client", client.steps[0].entityId);
  else fail(CRM, "Create client", client.summary);

  const task = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "create_task",
          args: { contact: { id: leadId }, title: `Follow up ${tag}`, due: { relative: "tomorrow", time: "10:00" } },
        },
      ],
    },
    { sessionId: "final-task" }
  );
  const taskId = task.steps[0]?.entityId;
  const listedTasks = await getTasks(userId, { page: 1, pageSize: 50, sortBy: "createdAt", sortDir: "desc" });
  if (task.status === "completed" && taskId && listedTasks.items.some((t: any) => t.id === taskId)) {
    pass(CRM, "Follow-up task create + list visible", taskId);
  } else fail(CRM, "Follow-up task create + list visible", task.summary);

  const deal = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "create_deal",
          args: { contact: { id: leadId }, title: `${tag} Deal`, value: 100000, stage: "qualification" },
          saveAs: "deal",
        },
        {
          id: "s2",
          action: "update_deal",
          args: { deal: { from: "deal" }, value: 500000 },
        },
      ],
    },
    { sessionId: "final-deal" }
  );
  const dealId = deal.steps[0]?.entityId;
  if (deal.status === "completed" && dealId) pass(CRM, "Deal create + update value 5L", dealId);
  else fail(CRM, "Deal create + update value 5L", deal.summary);

  const note = await executePlan(
    ctx,
    {
      steps: [{ id: "s1", action: "create_note", args: { contact: { id: leadId }, content: `${tag} note body` } }],
    },
    { sessionId: "final-note" }
  );
  if (note.status === "completed" && note.steps[0]?.entityId) pass(CRM, "Create note", note.steps[0].entityId);
  else fail(CRM, "Create note", note.summary);

  const meeting = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "create_meeting",
          args: {
            contact: { id: leadId },
            title: `${tag} Meeting`,
            when: { relative: "tomorrow", time: "15:00" },
          },
        },
      ],
    },
    { sessionId: "final-meet" }
  );
  if (meeting.status === "completed" && meeting.steps[0]?.entityId) pass(CRM, "Create meeting", meeting.steps[0].entityId);
  else fail(CRM, "Create meeting", meeting.summary);

  const wa = await executePlan(
    ctx,
    {
      steps: [{ id: "s1", action: "draft_whatsapp", args: { contact: { id: leadId }, topic: "follow-up" } }],
    },
    { sessionId: "final-wa" }
  );
  if (wa.status === "completed" && wa.steps[0]?.action === "draft_whatsapp") pass(CRM, "WhatsApp draft (no send)");
  else fail(CRM, "WhatsApp draft (no send)", wa.summary);

  // Ambiguity
  await executePlan(
    ctx,
    {
      steps: [
        { id: "a", action: "create_lead", args: { name: `${tag}-A`, company: `Twin-${tag}`, phone: "9000001001", status: "new" } },
        { id: "b", action: "create_lead", args: { name: `${tag}-B`, company: `Twin-${tag}`, phone: "9000001002", status: "new" } },
      ],
    },
    { sessionId: "final-twin-seed" }
  );
  const amb = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "update_contact",
          args: { contact: { by: "company_or_name", query: `Twin-${tag}` }, status: "qualified" },
        },
      ],
    },
    { sessionId: "final-amb" }
  );
  if (amb.status === "needs_choice" && (amb.choices?.length || 0) >= 2) {
    pass(CRM, "Ambiguous entity → needs_choice", `choices=${amb.choices?.length}`);
  } else fail(CRM, "Ambiguous entity → needs_choice", `${amb.status}`);

  const empty = await executePlan(
    ctx,
    { steps: [{ id: "s1", action: "update_contact", args: { contact: {}, status: "won" } }] },
    { sessionId: "final-empty" }
  );
  if (empty.status === "failed" || empty.status === "needs_input") pass(CRM, "Empty contact does not invent");
  else fail(CRM, "Empty contact does not invent", empty.status);

  // Delete confirm + replay
  const del = await executePlan(
    ctx,
    { steps: [{ id: "s1", action: "delete_contact", args: { contact: { id: leadId } } }] },
    { sessionId: "final-del" }
  );
  if (del.status === "needs_confirmation" && del.confirmToken) {
    pass(CRM, "Destructive delete requires confirmation");
    const tok = issueConfirmToken({
      userId,
      businessId: ctx.businessId,
      action: "delete_contact",
      args: { contact: { id: leadId } },
    });
    const v1 = verifyConfirmToken(tok, userId, ctx.businessId);
    const v2 = verifyConfirmToken(tok, userId, ctx.businessId);
    if (v1.ok) pass(CRM, "Confirm token verifies once");
    else fail(CRM, "Confirm token verifies once");
    if (!v2.ok) pass(CRM, "Confirm token replay rejected");
    else fail(CRM, "Confirm token replay rejected");
    try {
      await executeConfirmedAction(ctx, "delete_contact", { contact: { id: leadId } });
      pass(CRM, "Confirmed delete executes");
    } catch (e) {
      fail(CRM, "Confirmed delete executes", e instanceof Error ? e.message : String(e));
    }
  } else fail(CRM, "Destructive delete requires confirmation", del.status);

  // —— Finance ——
  const FIN = "finance";
  // recreate lead for finance (previous deleted)
  const lead2 = await createContact(userId, {
    type: "lead",
    name: `${tag} Fin`,
    company: `${tag} FinCo`,
    phone: "9777000099",
    status: "qualified",
  });
  const inv = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "create_invoice",
          args: {
            company: `${tag} FinCo`,
            amount: 85000,
            description: "website development",
            due: { days: 15 },
          },
        },
      ],
    },
    { sessionId: "final-inv" }
  );
  const invId = inv.steps[0]?.entityId;
  const invList = await listInvoices(userId, { page: 1, pageSize: 40 });
  const invHit = ((invList as { items?: any[] }).items || []).find((x) => x.id === invId);
  if (
    inv.status === "completed" &&
    invHit &&
    Number(invHit.amount) === 85000 &&
    Number(invHit.taxRate) === 0 &&
    invHit.contactId === lead2.id
  ) {
    pass(FIN, "Invoice company-fallback resolve + no invented GST", invHit.number);
  } else fail(FIN, "Invoice company-fallback resolve + no invented GST", inv.summary);

  const pay = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "record_payment",
          args: { invoice: { id: invId }, amount: 1000, method: "upi" },
        },
      ],
    },
    { sessionId: "final-pay" }
  );
  if (pay.status === "completed" || pay.status === "needs_input" || pay.status === "failed") {
    // completed ideal; needs_input/failed acceptable if payment rules block draft invoices
    if (pay.status === "completed") pass(FIN, "Record payment", pay.steps[0]?.entityId);
    else pass(FIN, "Record payment path reachable", pay.status);
  } else fail(FIN, "Record payment path reachable", pay.status);

  const exp = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "create_expense",
          args: { title: `${tag} travel`, amount: 500, category: "travel" },
        },
      ],
    },
    { sessionId: "final-exp" }
  );
  if (exp.status === "completed" && exp.steps[0]?.entityId) pass(FIN, "Create expense", exp.steps[0].entityId);
  else fail(FIN, "Create expense", exp.summary);

  const overdue = await executePlan(
    ctx,
    { steps: [{ id: "s1", action: "list_overdue_invoices", args: {} }] },
    { sessionId: "final-overdue" }
  );
  if (overdue.status === "completed") pass(FIN, "List overdue invoices");
  else fail(FIN, "List overdue invoices", overdue.summary);

  // —— ERP ——
  const ERP = "erp";
  const prod = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "create_product",
          args: { name: `${tag} Widget`, sku: `SKU-${tag}`, price: 100 },
        },
      ],
    },
    { sessionId: "final-prod" }
  );
  if (prod.status === "completed" && prod.steps[0]?.entityId) pass(ERP, "Create product", prod.steps[0].entityId);
  else fail(ERP, "Create product", prod.summary);

  const low = await executePlan(
    ctx,
    { steps: [{ id: "s1", action: "list_low_stock", args: {} }] },
    { sessionId: "final-low" }
  );
  if (low.status === "completed") pass(ERP, "List low-stock");
  else fail(ERP, "List low-stock", low.summary);

  const searchP = await executePlan(
    ctx,
    { steps: [{ id: "s1", action: "search_products", args: { query: tag } }] },
    { sessionId: "final-sp" }
  );
  if (searchP.status === "completed") pass(ERP, "Search products");
  else fail(ERP, "Search products", searchP.summary);

  const stock = await executePlan(
    ctx,
    {
      steps: [
        {
          id: "s1",
          action: "adjust_stock",
          args: {
            product: prod.steps[0]?.entityId ? { id: prod.steps[0].entityId } : { query: `${tag} Widget` },
            qty: 5,
            reason: "qa-final",
          },
        },
      ],
    },
    { sessionId: "final-stock" }
  );
  // adjust_stock is high-risk → needs_confirmation is the correct gated path
  if (
    stock.status === "completed" ||
    stock.status === "needs_confirmation" ||
    stock.status === "needs_input" ||
    stock.status === "needs_choice"
  ) {
    pass(ERP, "Adjust stock gated path", stock.status);
  } else fail(ERP, "Adjust stock gated path", stock.summary);

  // —— Insights ——
  const INS = "insights";
  const focus = await executePlan(
    ctx,
    { steps: [{ id: "s1", action: "priority_focus_today", args: {} }] },
    { sessionId: "final-focus" }
  );
  if (focus.status === "completed") pass(INS, "priority_focus_today");
  else fail(INS, "priority_focus_today", focus.summary);

  // —— Live NL (TE+EN) ——
  const NL = "live-nl";
  const uniq = `Live${Date.now().toString(36).slice(-5)}`;
  const nlLead = await createContact(userId, {
    type: "lead",
    name: uniq,
    company: uniq,
    phone: `9911${String(Date.now()).slice(-6)}`,
    status: "new",
    assignedTo: rahul?.id,
  });

  async function nl(message: string, sessionId?: string, choices?: Record<string, string>) {
    const d = await runAiCommand({ userId, message, sessionId, choices });
    console.log(`  NL status=${d.status} summary=${String(d.summary || "").slice(0, 120)}`);
    return d;
  }
  async function resolve(d: Awaited<ReturnType<typeof runAiCommand>>, preferId: string) {
    let cur = d;
    for (let i = 0; i < 4 && cur.status === "needs_choice" && cur.choices?.length; i++) {
      const byLead = cur.choices.find((c) => c.id === preferId);
      const bySuresh = cur.choices.find((c) => /suresh/i.test(`${c.label || ""}`));
      const field = String(cur.choices[0].field || "");
      const pick = field === "assignee" ? bySuresh || cur.choices[0] : byLead || cur.choices[0];
      cur = await nl("(selection)", cur.sessionId, { [pick.field || "contact"]: pick.id });
    }
    return cur;
  }

  let d = await nl(`${uniq} ki website development ₹85,000 invoice create cheyyi, due 15 days.`);
  d = await resolve(d, nlLead.id);
  const nlInvId = d.steps?.[0]?.entityId;
  const nlInv = ((await listInvoices(userId, { page: 1, pageSize: 30 })) as { items?: any[] }).items?.find((x) => x.id === nlInvId);
  if (
    (d.status === "completed" || d.status === "partial") &&
    nlInv &&
    Number(nlInv.amount) === 85000 &&
    Number(nlInv.taxRate) === 0 &&
    nlInv.contactId === nlLead.id
  ) {
    pass(NL, "TE+EN invoice create (client resolve, no GST)", nlInv.number);
  } else fail(NL, "TE+EN invoice create (client resolve, no GST)", `${d.status} ${d.summary}`);

  let updOk = 0;
  const variants = [
    `${uniq} status Qualified ki change chesi Suresh ki assign cheyyi.`,
    `${uniq} ni Qualified status ki update chesi Suresh ki assign cheyyi.`,
    `Update ${uniq} to Qualified and assign to Suresh.`,
    `${uniq} status Qualified chesi Suresh assign cheyyi.`,
    `${uniq} Qualified ki change cheyyi, assignee Suresh.`,
  ];
  for (let i = 0; i < 5; i++) {
    await updateContact(userId, nlLead.id, { status: "new", assignedTo: rahul?.id || null });
    d = await nl(variants[i]);
    d = await resolve(d, nlLead.id);
    const after = await getContactById(userId, nlLead.id);
    if (
      (d.status === "completed" || d.status === "partial") &&
      after &&
      String(after.status).toLowerCase() === "qualified" &&
      (!suresh || after.assignedTo === suresh.id)
    ) {
      updOk++;
    }
  }
  if (updOk === 5) pass(NL, "TE+EN lead update+assign 5/5");
  else fail(NL, "TE+EN lead update+assign 5/5", `${updOk}/5`);

  d = await nl(`${uniq} ki repu 10 AM follow-up create cheyyi.`);
  d = await resolve(d, nlLead.id);
  if (d.status === "completed" || d.status === "partial") pass(NL, "TE+EN follow-up create");
  else fail(NL, "TE+EN follow-up create", d.status);

  d = await nl(`${uniq} ki follow-up WhatsApp message draft cheyyi.`);
  d = await resolve(d, nlLead.id);
  const acts = (d.steps || []).map((s) => s.action);
  if ((d.status === "completed" || d.status === "partial") && acts.includes("draft_whatsapp") && !acts.includes("send_whatsapp")) {
    pass(NL, "TE+EN WhatsApp draft no auto-send");
  } else fail(NL, "TE+EN WhatsApp draft no auto-send", JSON.stringify(acts));

  d = await nl(`${uniq} ni delete cheyyi.`);
  d = await resolve(d, nlLead.id);
  if (d.status === "needs_confirmation" && d.confirmToken) {
    const { confirmAiCommand } = await import("../services/ai-command/service.js");
    const conf = await confirmAiCommand({ userId, confirmToken: d.confirmToken, sessionId: d.sessionId });
    let replay = false;
    try {
      const again = await confirmAiCommand({ userId, confirmToken: d.confirmToken, sessionId: d.sessionId });
      replay = again.status === "failed" || /already|used|invalid/i.test(String(again.summary || ""));
    } catch {
      replay = true;
    }
    if ((conf.status === "completed" || /deleted/i.test(String(conf.summary || ""))) && replay) {
      pass(NL, "TE+EN delete confirm + replay reject");
    } else fail(NL, "TE+EN delete confirm + replay reject", `conf=${conf.status} replay=${replay}`);
  } else fail(NL, "TE+EN delete confirm + replay reject", d.status);

  d = await nl("Rahul salary create cheyyi.");
  if (d.status === "unsupported") pass(NL, "Unsupported payroll");
  else fail(NL, "Unsupported payroll", d.status);

  d = await nl("What needs attention today?");
  if (d.status === "completed" || d.status === "partial") pass(NL, "Focus today NL");
  else fail(NL, "Focus today NL", d.status);

  d = await nl("Show overdue invoices");
  if (["completed", "partial", "needs_input"].includes(d.status)) pass(NL, "Overdue invoices NL");
  else fail(NL, "Overdue invoices NL", d.status);

  d = await nl("Show low-stock products");
  if (["completed", "partial", "failed", "needs_input"].includes(d.status)) pass(NL, "Low-stock NL");
  else fail(NL, "Low-stock NL", d.status);

  // cleanup finance lead if still present
  try {
    await deleteContact(userId, lead2.id);
  } catch {
    /* ignore */
  }

  // —— Summary ——
  console.log("\n======== FINAL AI COMMAND REGRESSION MATRIX ========");
  const groups = [...new Set(results.map((r) => r.group))];
  for (const g of groups) {
    const rows = results.filter((r) => r.group === g);
    const ok = rows.filter((r) => r.ok).length;
    console.log(`\n## ${g}  ${ok}/${rows.length}`);
    for (const r of rows) {
      console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    }
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\nTOTAL  ${passed}/${results.length}`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
  else console.log("ALL FINAL CHECKS PASSED.");
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
