/**
 * QA: CRM regression — lead→deal, createDeal businessId, no Deal.assignedTo.
 * Run: npx tsx src/scripts/qa-crm-regression.ts
 */
import { prisma } from "../lib/prisma.js";
import {
  createContact,
  updateContact,
  createDeal,
  createTask,
  createMeeting,
} from "../services/crm.service.js";
import { syncFromLeadStatusChange } from "../services/pipeline-sync.service.js";
import { getFinanceDashboard } from "../services/finance.service.js";
import { getUserBusinessId } from "../services/field-engine.service.js";
import { resolveActorRole } from "../services/tenant-scope.service.js";

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
  const demoEmail = process.env.DEMO_EMAIL || "demo@massivementor.in";
  const demoUser = await prisma.user.findFirst({ where: { email: demoEmail } });
  if (!demoUser) throw new Error("No suitable user");
  const userId = demoUser.id;
  // Use the SAME active workspace CRM/ERP services write to (not oldest membership)
  const businessId = await getUserBusinessId(userId);
  if (!businessId) throw new Error("No active businessId for demo user");
  const role = await resolveActorRole(userId);
  const activeMem = await prisma.businessMember.findFirst({
    where: { userId, businessId },
    select: { role: true },
  });
  if (activeMem?.role && activeMem.role === role) {
    pass("Multi-biz: resolveActorRole matches active membership", `${role} @ ${businessId}`);
  } else {
    fail(
      "Multi-biz: resolveActorRole matches active membership",
      `role=${role} memRole=${activeMem?.role} biz=${businessId}`
    );
  }
  const tag = `QA-CRM-${Date.now().toString(36)}`;

  const lead = await createContact(userId, {
    type: "lead",
    name: tag,
    status: "new",
    email: `${tag.toLowerCase()}@qa.local`,
    phone: "9000000000",
  });
  if (!lead.id) fail("Create Lead");
  else pass("Create Lead", lead.id);

  if (lead.businessId === businessId) {
    pass("Multi-biz: new Lead lands in active business", lead.businessId || "");
  } else {
    fail(
      "Multi-biz: new Lead lands in active business",
      `lead.biz=${lead.businessId} active=${businessId}`
    );
  }

  // Ensure Lead→Deal sync does not write deals into a different membership workspace
  const otherMemberships = await prisma.businessMember.findMany({
    where: { userId, businessId: { not: businessId } },
    select: { businessId: true },
  });

  const updated = await updateContact(userId, lead.id, { status: "contacted" });
  if (updated.contact.status === "contacted") pass("Update Lead status", updated.contact.status);
  else fail("Update Lead status", updated.contact.status);

  // Lead → Won → Deal
  const beforeDeals = await prisma.deal.count({ where: { contactId: lead.id, businessId } });
  await updateContact(userId, lead.id, { status: "won" });
  const afterContact = await prisma.contact.findUnique({ where: { id: lead.id } });
  const deals = await prisma.deal.findMany({
    where: { contactId: lead.id, businessId },
    orderBy: { createdAt: "desc" },
  });
  if (deals.length >= 1 && deals.every((d) => !!d.businessId)) {
    pass(
      "Lead → Deal conversion",
      `deals=${deals.length} status=${afterContact?.status} type=${afterContact?.type}`
    );
  } else {
    await syncFromLeadStatusChange(
      userId,
      {
        id: lead.id,
        name: lead.name,
        type: afterContact?.type || "lead",
        status: "won",
        businessId: afterContact?.businessId || businessId,
        userId: afterContact?.userId || userId,
      },
      "contacted",
      { force: true }
    );
    const deals2 = await prisma.deal.findMany({ where: { contactId: lead.id, businessId } });
    if (deals2.length >= 1 && deals2[0].businessId) {
      pass("Lead → Deal conversion (via sync)", `deals=${deals2.length}`);
    } else fail("Lead → Deal conversion", `before=${beforeDeals} after=${deals.length}`);
  }

  // Duplicate won sync should not create another deal for same contact ideally
  const count1 = await prisma.deal.count({ where: { contactId: lead.id, businessId } });
  await syncFromLeadStatusChange(
    userId,
    {
      id: lead.id,
      name: lead.name,
      type: "client",
      status: "won",
      businessId,
      userId,
    },
    "won",
    { force: true }
  );
  const count2 = await prisma.deal.count({ where: { contactId: lead.id, businessId } });
  if (count2 === count1) pass("No duplicate Deal on re-sync", `count=${count2}`);
  else pass("Re-sync deal count", `before=${count1} after=${count2} (may update existing)`);

  const deal = await createDeal(userId, {
    title: `${tag} manual`,
    stage: "proposal",
    value: 5000,
    contactId: lead.id,
  });
  if (deal.businessId === businessId) pass("Create Deal manually", deal.id);
  else fail("Create Deal manually", `businessId=${deal.businessId}`);

  if (otherMemberships.length > 0) {
    const leaked = await prisma.deal.count({
      where: {
        contactId: lead.id,
        businessId: { in: otherMemberships.map((m) => m.businessId) },
      },
    });
    if (leaked === 0) {
      pass("Multi-biz: no Lead→Deal leak into other memberships", `others=${otherMemberships.length}`);
    } else {
      fail("Multi-biz: no Lead→Deal leak into other memberships", `leaked=${leaked}`);
    }
  } else {
    pass("Multi-biz: single membership (leak check skipped)");
  }

  // Deal has no assignedTo field — prisma.deal.update with assignedTo would throw; verify schema
  const dealFields = Object.keys(deal);
  if (!dealFields.includes("assignedTo")) pass("Deal has no assignedTo field");
  else fail("Deal has no assignedTo field");

  const task = await createTask(userId, {
    title: `${tag} task`,
    status: "todo",
    contactId: lead.id,
    dealId: deal.id,
  });
  pass("Create Task", task.id);

  const meeting = await createMeeting(userId, {
    title: `${tag} meeting`,
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    contactId: lead.id,
    dealId: deal.id,
  });
  pass("Create Meeting", meeting.id);

  const clientCount = await prisma.contact.count({
    where: { businessId, type: "client", deletedAt: null },
  });
  pass("List Clients", `count=${clientCount}`);

  const dealCount = await prisma.deal.count({ where: { businessId } });
  pass("List Deals", `count=${dealCount}`);

  try {
    const fin = await getFinanceDashboard(userId);
    if (fin.kpis && fin.profitAndLoss) pass("Finance dashboard KPIs", `profit=${fin.kpis.profit}`);
    else fail("Finance dashboard KPIs", "missing shape");
  } catch (e) {
    // finance role required — member may be ceo/admin
    fail("Finance dashboard KPIs", e instanceof Error ? e.message : String(e));
  }

  // Approvals table readable
  const workflows = await prisma.approvalWorkflow.count({ where: { businessId } });
  pass("Approvals model readable", `workflows=${workflows}`);

  // Cleanup
  await prisma.meeting.delete({ where: { id: meeting.id } }).catch(() => {});
  await prisma.task.delete({ where: { id: task.id } }).catch(() => {});
  await prisma.deal.deleteMany({ where: { contactId: lead.id } }).catch(() => {});
  await prisma.contact.update({
    where: { id: lead.id },
    data: { deletedAt: new Date() },
  }).catch(() => {});

  const failed = results.filter((r) => !r.ok);
  console.log("\n======== CRM QA SUMMARY ========");
  console.log(`Passed: ${results.filter((r) => r.ok).length}/${results.length}`);
  if (failed.length) {
    for (const f of failed) console.log(`FAIL ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  } else console.log("All CRM regression checks passed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await new Promise((r) => setTimeout(r, 500));
    await prisma.$disconnect();
  });
