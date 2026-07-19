import { prisma } from "@/lib/prisma";
import { generateMeetingSummary } from "@/services/crm.service";

async function main() {
  const m = await prisma.meeting.findFirst({
    orderBy: { createdAt: "desc" },
    include: { contact: true },
  });
  console.log(
    "meeting",
    m
      ? {
          id: m.id,
          title: m.title,
          userId: m.userId,
          businessId: m.businessId,
          notes: m.notes?.slice(0, 100),
          outcome: m.outcome,
        }
      : null
  );
  if (!m) {
    console.log("No meetings in DB");
    return;
  }
  try {
    const r = await generateMeetingSummary(m.userId, m.id);
    console.log("SUCCESS", Object.keys(r));
    console.log(JSON.stringify(r, null, 2).slice(0, 1200));
  } catch (e) {
    console.error("FAIL type", e?.constructor?.name);
    console.error("FAIL msg", e instanceof Error ? e.message : e);
    console.error("FAIL stack", e instanceof Error ? e.stack : "");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
