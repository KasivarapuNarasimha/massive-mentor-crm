/**
 * Verify full-tenant dashboard analytics for a user email.
 * node scripts/verify-analytics.mjs te@gmail.com
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const email = process.argv[2] || "te@gmail.com";

const u = await p.user.findFirst({
  where: { email: { equals: email, mode: "insensitive" } },
});
if (!u) {
  console.error("User not found");
  process.exit(1);
}

// Mirror getUserBusinessId pick (active + most contacts)
const members = await p.businessMember.findMany({
  where: { userId: u.id, business: { isDemo: false, portalKind: "customer" } },
  select: { businessId: true, business: { select: { status: true } }, createdAt: true },
  orderBy: { createdAt: "desc" },
});
const active = members.filter((m) => m.business.status !== "deleted");
const pool = active.length ? active : members;
const scored = await Promise.all(
  pool.map(async (m) => ({
    businessId: m.businessId,
    n: await p.contact.count({ where: { businessId: m.businessId, deletedAt: null } }),
  }))
);
scored.sort((a, b) => b.n - a.n);
const bizId = scored[0]?.businessId;

const totalLeads = await p.contact.count({
  where: { businessId: bizId, type: "lead", deletedAt: null },
});

const groups = await p.contact.groupBy({
  by: ["source"],
  where: { businessId: bizId, type: "lead", deletedAt: null },
  _count: { _all: true },
});
const leadSourcesTotal = groups.reduce((s, g) => s + g._count._all, 0);

const deals = await p.deal.aggregate({
  where: { businessId: bizId },
  _sum: { value: true },
  _count: true,
});

console.log(
  JSON.stringify(
    {
      email,
      businessId: bizId,
      totalLeads,
      leadSourcesTotal,
      sourcesMatch: totalLeads === leadSourcesTotal,
      sourceBuckets: groups.length,
      topSources: groups
        .map((g) => ({
          source: g.source || "Unknown",
          n: g._count._all,
        }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 8),
      dealCount: deals._count,
      dealValue: deals._sum.value,
    },
    null,
    2
  )
);

await p.$disconnect();
