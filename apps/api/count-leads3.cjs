const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const bizId = "cmrg8ukka009dtyswenx8w6z0";
  const mems = await p.businessMember.findMany({ where: { businessId: bizId }, include: { user: { select: { email: true, role: true } } } });
  console.log(mems.map(m => ({ email: m.user.email, role: m.role, userId: m.userId })));
  const sample = await p.contact.findMany({ where: { businessId: bizId, type: "lead" }, take: 5, select: { name: true, source: true, status: true, createdAt: true } });
  console.log(sample);
  const bySource = await p.$queryRaw`
    SELECT source, COUNT(*)::int as c FROM "Contact"
    WHERE "businessId" = ${bizId} AND type = 'lead'
    GROUP BY source ORDER BY c DESC LIMIT 10`;
  console.log(bySource);
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
