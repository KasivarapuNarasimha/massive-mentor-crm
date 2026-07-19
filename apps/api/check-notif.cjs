const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const n = await p.notification.findMany({ where: { type: "ai_recommendation" }, orderBy: { createdAt: "desc" }, take: 3 });
  console.log(JSON.stringify(n, null, 2));
  await p.$disconnect();
})();
