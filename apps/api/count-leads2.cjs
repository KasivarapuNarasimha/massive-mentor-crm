const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  // top businesses by lead count
  const top = await p.contact.groupBy({
    by: ["businessId"],
    where: { type: "lead" },
    _count: true,
    orderBy: { _count: { businessId: "desc" } },
    take: 15,
  });
  console.log("top biz", top);
  const nullBiz = await p.contact.count({ where: { type: "lead", businessId: null } });
  console.log("null businessId leads", nullBiz);
  // any close to 38432?
  const users = await p.user.findMany({ take: 20, select: { id: true, email: true, role: true } });
  for (const u of users) {
    const mem = await p.businessMember.findFirst({ where: { userId: u.id } });
    const c = await p.contact.count({
      where: mem
        ? { AND: [{ OR: [{ businessId: mem.businessId }, { userId: u.id, businessId: null }] }, { type: "lead" }] }
        : { userId: u.id, type: "lead" },
    });
    if (c > 100) console.log(u.email, u.role, "biz", mem?.businessId, "leads", c);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
