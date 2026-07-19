const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const user = await p.user.findFirst({ where: { email: "ui_seed_148348558@test.local" } });
  const mem = await p.businessMember.findFirst({ where: { userId: user.id } });
  console.log("user", user.id, "role", user.role, "biz", mem?.businessId, "memRole", mem?.role);
  const totalAll = await p.contact.count();
  const totalLeads = await p.contact.count({ where: { type: "lead" } });
  const byUser = await p.contact.count({ where: { userId: user.id, type: "lead" } });
  const byBiz = mem ? await p.contact.count({ where: { businessId: mem.businessId, type: "lead" } }) : 0;
  const tenantOr = mem ? await p.contact.count({
    where: {
      AND: [
        { OR: [{ businessId: mem.businessId }, { userId: user.id, businessId: null }] },
        { type: "lead" },
      ],
    },
  }) : 0;
  const ownSe = mem ? await p.contact.count({
    where: {
      AND: [
        { OR: [{ businessId: mem.businessId }, { userId: user.id, businessId: null }] },
        { OR: [{ userId: user.id }, { assignedTo: user.id }] },
        { type: "lead" },
      ],
    },
  }) : 0;
  const aiRec = await p.aiRecommendation.count({ where: { userId: user.id } });
  const notif = await p.notification.count({ where: { userId: user.id } });
  const act = await p.activity.count({ where: { userId: user.id } });
  console.log(JSON.stringify({ totalAll, totalLeads, byUser, byBiz, tenantOr, ownSe, aiRec, notif, act }, null, 2));
  // status breakdown for tenant leads
  const statuses = await p.contact.groupBy({
    by: ["status"],
    where: { AND: [ { OR: [{ businessId: mem.businessId }, { userId: user.id, businessId: null }] }, { type: "lead" } ] },
    _count: true,
  });
  console.log("statuses", statuses);
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
