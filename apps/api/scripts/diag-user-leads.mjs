import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function inspect(email) {
  const u = await p.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, role: true },
  });
  if (!u) {
    console.log("NOT FOUND", email);
    return;
  }
  const mems = await p.businessMember.findMany({
    where: { userId: u.id },
    include: {
      business: {
        select: {
          id: true,
          name: true,
          isDemo: true,
          portalKind: true,
          status: true,
  
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const firstActive = mems.find(
    (m) =>
      !m.business.isDemo &&
      m.business.portalKind === "customer" &&
      m.business.status !== "deleted"
  );

  const rows = [];
  for (const m of mems) {
    const leadCount = await p.contact.count({
      where: { businessId: m.businessId, type: "lead", deletedAt: null },
    });
    const userLeadCount = await p.contact.count({
      where: {
        userId: u.id,
        businessId: m.businessId,
        type: "lead",
        deletedAt: null,
      },
    });
    rows.push({
      businessId: m.businessId,
      name: m.business.name,
      role: m.role,
      memCreated: m.createdAt,
      isDemo: m.business.isDemo,
      portalKind: m.business.portalKind,
      status: m.business.status,
      leadCount,
      userLeadCount,
      isGetUserBusinessIdPick: firstActive?.businessId === m.businessId,
    });
  }

  const totalUserLeads = await p.contact.count({
    where: { userId: u.id, type: "lead", deletedAt: null },
  });

  console.log(
    JSON.stringify(
      {
        email,
        userId: u.id,
        role: u.role,
        totalUserLeads,
        getUserBusinessIdWouldPick: firstActive?.businessId || null,
        memberships: rows,
      },
      null,
      2
    )
  );
}

const emails = process.argv.slice(2);
const list =
  emails.length > 0
    ? emails
    : [
        "te@gmail.com",
        "demo@massivementor.in",
        "massivementor1@gmail.com",
        "demo1@gmail.com",
        "team@massivementor.in",
      ];

for (const e of list) {
  console.log("\n========", e, "========");
  await inspect(e);
}
await p.$disconnect();
