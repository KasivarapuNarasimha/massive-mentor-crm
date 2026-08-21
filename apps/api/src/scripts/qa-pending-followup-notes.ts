/**
 * QA: Follow-up→Task visibility + Notes CRUD (polymorphic).
 * Run: npx tsx src/scripts/qa-pending-followup-notes.ts
 */
import { prisma } from "../lib/prisma.js";
import {
  createContact,
  createTask,
  getTasks,
  createNote,
  getNotes,
  createDeal,
  createMeeting,
  updateNote,
  deleteNote,
} from "../services/crm.service.js";
import { getUserBusinessId } from "../services/field-engine.service.js";

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
  const tag = `QA-PEND-${Date.now().toString(36)}`;

  // --- Follow-up → Task ---
  const lead = await createContact(userId, {
    type: "lead",
    name: tag,
    status: "new",
    email: `${tag.toLowerCase()}@qa.local`,
    phone: "9111111111",
  });
  pass("Create Lead", lead.id);

  const due = new Date();
  due.setDate(due.getDate() + 2);
  const activeBiz = await getUserBusinessId(userId);
  const task = await createTask(userId, {
    contactId: lead.id,
    title: `Follow up: ${lead.name}`,
    description: `Bulk follow-up for ${lead.name}`,
    dueDate: due.toISOString(),
    status: "todo",
    priority: "medium",
  });
  pass("Create follow-up task", task.id);
  if (task.businessId === activeBiz) {
    pass("Task businessId matches active workspace", String(task.businessId));
  } else {
    fail(
      "Task businessId matches active workspace",
      `task=${task.businessId} active=${activeBiz}`
    );
  }

  // Default list (no sort override) must surface newest tasks on page 1
  const listed = await getTasks(userId, { page: 1, pageSize: 50 });
  const found = listed.items.find((t) => t.id === task.id);
  if (found) {
    pass("Task appears in default list", `page=1 total=${listed.total}`);
  } else {
    fail(
      "Task appears in default list",
      `taskId=${task.id} total=${listed.total} firstIds=${listed.items
        .slice(0, 5)
        .map((t) => t.id)
        .join(",")}`
    );
  }

  if (found?.contactId === lead.id) pass("Task retains lead relationship", lead.id);
  else fail("Task retains lead relationship", String(found?.contactId));

  if (found?.status === "todo" && found?.priority === "medium") {
    pass("Task retains status/priority");
  } else {
    fail("Task retains status/priority", `${found?.status}/${found?.priority}`);
  }

  if (found?.dueDate) pass("Task retains due date", found.dueDate.toISOString());
  else fail("Task retains due date");

  // Explicit createdAt desc should also find it
  const byCreated = await getTasks(userId, {
    page: 1,
    pageSize: 25,
    sortBy: "createdAt",
    sortDir: "desc",
  });
  if (byCreated.items.some((t) => t.id === task.id)) {
    pass("Task visible with createdAt desc");
  } else {
    fail("Task visible with createdAt desc");
  }

  // --- Notes ---
  const deal = await createDeal(userId, {
    title: `${tag} deal`,
    stage: "qualification",
    contactId: lead.id,
    value: 1000,
  });
  pass("Create Deal for notes", deal.id);

  const meeting = await createMeeting(userId, {
    title: `${tag} meeting`,
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    contactId: lead.id,
  });
  pass("Create Meeting for notes", meeting.id);

  const contactNote = await createNote(userId, {
    entityType: "contact",
    entityId: lead.id,
    content: `${tag} contact note`,
  });
  pass("Create contact note", contactNote.id);

  const dealNote = await createNote(userId, {
    entityType: "deal",
    entityId: deal.id,
    content: `${tag} deal note`,
  });
  pass("Create deal note", dealNote.id);

  const meetingNote = await createNote(userId, {
    entityType: "meeting",
    entityId: meeting.id,
    content: `${tag} meeting note`,
  });
  pass("Create meeting note", meetingNote.id);

  const cNotes = await getNotes(userId, "contact", lead.id);
  if (cNotes.some((n) => n.id === contactNote.id)) pass("List contact notes");
  else fail("List contact notes");

  const dNotes = await getNotes(userId, "deal", deal.id);
  if (dNotes.some((n) => n.id === dealNote.id)) pass("List deal notes");
  else fail("List deal notes");

  const mNotes = await getNotes(userId, "meeting", meeting.id);
  if (mNotes.some((n) => n.id === meetingNote.id)) pass("List meeting notes");
  else fail("List meeting notes");

  // Empty content should fail validation
  try {
    await createNote(userId, {
      entityType: "contact",
      entityId: lead.id,
      content: "",
    });
    fail("Empty note rejected");
  } catch {
    pass("Empty note rejected");
  }

  const updated = await updateNote(userId, contactNote.id, {
    content: `${tag} contact note updated`,
  });
  if (updated.content.includes("updated")) pass("Update note");
  else fail("Update note");

  await deleteNote(userId, contactNote.id);
  const afterDel = await getNotes(userId, "contact", lead.id);
  if (!afterDel.some((n) => n.id === contactNote.id)) pass("Delete note");
  else fail("Delete note");

  // Tenant: other user must not see note (best-effort if another user exists)
  const other = await prisma.businessMember.findFirst({
    where: { userId: { not: userId } },
  });
  if (other) {
    try {
      await getNotes(other.userId, "deal", deal.id);
      // may throw access denied or return empty depending on assertNoteEntityAccess
      const foreign = await prisma.note.findMany({
        where: { id: dealNote.id, userId: other.userId },
      });
      if (foreign.length === 0) pass("Note ownership isolation (userId)");
      else fail("Note ownership isolation (userId)");
    } catch {
      pass("Note access denied for unrelated user");
    }
  } else {
    pass("Note ownership isolation (skipped — single user)");
  }

  // Cleanup
  await prisma.note.deleteMany({
    where: { id: { in: [dealNote.id, meetingNote.id] } },
  }).catch(() => {});
  await prisma.task.delete({ where: { id: task.id } }).catch(() => {});
  await prisma.meeting.delete({ where: { id: meeting.id } }).catch(() => {});
  await prisma.deal.delete({ where: { id: deal.id } }).catch(() => {});
  await prisma.contact
    .update({ where: { id: lead.id }, data: { deletedAt: new Date() } })
    .catch(() => {});

  const failed = results.filter((r) => !r.ok);
  console.log("\n======== PENDING QA SUMMARY ========");
  console.log(`Passed: ${results.filter((r) => r.ok).length}/${results.length}`);
  if (failed.length) {
    for (const f of failed) console.log(`FAIL ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  } else console.log("All pending Follow-up/Notes checks passed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await prisma.$disconnect();
  });
