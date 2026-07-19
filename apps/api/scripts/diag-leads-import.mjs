/**
 * Diagnose lead import / visibility counts.
 * node scripts/diag-leads-import.mjs
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const total = await p.contact.count();
  const leads = await p.contact.count({ where: { type: "lead" } });
  const clients = await p.contact.count({ where: { type: "client" } });
  const deleted = await p.contact.count({ where: { deletedAt: { not: null } } });
  const leadsActive = await p.contact.count({
    where: { type: "lead", deletedAt: null },
  });

  const byBiz = await p.$queryRawUnsafe(`
    SELECT COALESCE("businessId", '(null)') as biz, type, COUNT(*)::int as n
    FROM "Contact"
    WHERE "deletedAt" IS NULL
    GROUP BY 1, 2
    ORDER BY n DESC
    LIMIT 40
  `);

  const byUser = await p.$queryRawUnsafe(`
    SELECT c."userId", u.email, COUNT(*)::int as n
    FROM "Contact" c
    LEFT JOIN "User" u ON u.id = c."userId"
    WHERE c."deletedAt" IS NULL AND c.type = 'lead'
    GROUP BY 1, 2
    ORDER BY n DESC
    LIMIT 20
  `);

  const recent = await p.$queryRawUnsafe(`
    SELECT date_trunc('hour', "createdAt") as hr, COUNT(*)::int as n
    FROM "Contact"
    WHERE type = 'lead'
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 16
  `);

  // Sample null businessId leads
  const nullBizSample = await p.contact.findMany({
    where: { type: "lead", businessId: null, deletedAt: null },
    select: { id: true, name: true, userId: true, createdAt: true },
    take: 5,
    orderBy: { createdAt: "desc" },
  });

  const members = await p.$queryRawUnsafe(`
    SELECT bm."userId", u.email, bm."businessId", b.name as biz_name, bm.role
    FROM "BusinessMember" bm
    JOIN "User" u ON u.id = bm."userId"
    JOIN "Business" b ON b.id = bm."businessId"
    ORDER BY bm."createdAt" DESC
    LIMIT 30
  `);

  console.log(
    JSON.stringify(
      {
        total,
        leads,
        leadsActive,
        clients,
        deleted,
        byBiz,
        byUser,
        recent,
        nullBizSample,
        members,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
