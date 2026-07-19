/**
 * Verify reclaim + getUserBusinessId for te@gmail.com style accounts.
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function getUserBusinessId(userId) {
  const members = await p.businessMember.findMany({
    where: {
      userId,
      business: { isDemo: false, portalKind: "customer" },
    },
    select: {
      businessId: true,
      createdAt: true,
      business: { select: { status: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!members.length) return null;
  const active = members.filter((m) => m.business.status !== "deleted");
  const pool = active.length ? active : members;
  if (pool.length === 1) return pool[0].businessId;
  const scored = await Promise.all(
    pool.map(async (m) => {
      const n = await p.contact.count({
        where: { businessId: m.businessId, deletedAt: null },
      });
      return { businessId: m.businessId, n, createdAt: m.createdAt };
    })
  );
  scored.sort((a, b) => b.n - a.n || b.createdAt - a.createdAt);
  return scored[0].businessId;
}

async function reclaim(userId, activeBusinessId) {
  const deletedBizIds = (
    await p.businessMember.findMany({
      where: {
        userId,
        businessId: { not: activeBusinessId },
        business: { status: "deleted", isDemo: false },
      },
      select: { businessId: true },
    })
  ).map((m) => m.businessId);
  if (!deletedBizIds.length) return 0;
  const result = await p.contact.updateMany({
    where: {
      userId,
      businessId: { in: deletedBizIds },
      deletedAt: null,
    },
    data: { businessId: activeBusinessId },
  });
  return result.count;
}

const email = process.argv[2] || "te@gmail.com";
const u = await p.user.findFirst({
  where: { email: { equals: email, mode: "insensitive" } },
});
if (!u) {
  console.log("user not found");
  process.exit(1);
}
const beforeBiz = await getUserBusinessId(u.id);
const beforeCount = beforeBiz
  ? await p.contact.count({
      where: { businessId: beforeBiz, type: "lead", deletedAt: null },
    })
  : 0;
console.log({ email, userId: u.id, beforeBiz, beforeCount });

const reclaimed = await reclaim(u.id, beforeBiz);
const afterCount = await p.contact.count({
  where: { businessId: beforeBiz, type: "lead", deletedAt: null },
});
console.log({ reclaimed, afterCount });
await p.$disconnect();
