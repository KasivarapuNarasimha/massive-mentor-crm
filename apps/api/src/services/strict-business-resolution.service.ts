import { prisma } from "../lib/prisma.js";

/**
 * Read-only selection for strict contexts: existing memberships only.
 * Keep legacy selection priorities; the context rejects disabled actors and
 * inactive businesses. Never repair membership, ownership or contact data.
 */
export async function resolveStrictBusinessId(userId: string): Promise<string | null> {
  const members = await prisma.businessMember.findMany({
    where: { userId },
    select: {
      businessId: true, createdAt: true,
      business: { select: {
        status: true, isDemo: true, portalKind: true,
        plan: true, planStatus: true, isTrial: true,
      } },
    },
  });
  const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const demos = members.filter(m => m.business.isDemo &&
    m.business.portalKind === "demo" && m.business.status === "active");
  demos.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() ||
    compareId(a.businessId, b.businessId));
  const demo = demos[0];
  const customers = members.filter(m => !m.business.isDemo && m.business.portalKind !== "demo");
  const candidates = customers.filter(m => m.business.status !== "deleted");
  if (candidates.length) {
    const scored = await Promise.all(candidates.map(async m => {
      const n = await prisma.contact.count({ where: { businessId: m.businessId, deletedAt: null } });
      const plan = String(m.business.plan || "").toLowerCase();
      const paid = plan && plan !== "trial" &&
        (m.business.planStatus === "active" || m.business.planStatus === "past_due" ||
          m.business.isTrial === false) ? 1 : 0;
      return { businessId: m.businessId, n, paid, createdAt: m.createdAt.getTime() };
    }));
    scored.sort((a, b) => b.n - a.n || b.paid - a.paid || a.createdAt - b.createdAt ||
      compareId(a.businessId, b.businessId));
    const best = scored[0];
    if (demo) {
      const [demoCount, customerCount] = await Promise.all([
        prisma.contact.count({ where: { businessId: demo.businessId } }),
        prisma.contact.count({ where: { businessId: best.businessId } }),
      ]);
      if (demoCount > 0 && customerCount === 0) return demo.businessId;
    }
    return best.businessId;
  }
  if (demo) return demo.businessId;
  // A deleted-workspace candidate must be rejected by strict context validation.
  if (!customers.length) return null;
  const scored = await Promise.all(customers.map(async m => ({
    businessId: m.businessId,
    n: await prisma.contact.count({ where: { businessId: m.businessId, deletedAt: null } }),
    createdAt: m.createdAt.getTime(),
  })));
  scored.sort((a, b) => b.n - a.n || b.createdAt - a.createdAt || compareId(a.businessId, b.businessId));
  return scored[0].businessId;
}
