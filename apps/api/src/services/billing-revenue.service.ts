/**
 * Super Admin SaaS revenue analytics (MRR/ARR, trials, renewals).
 */
import { prisma } from "@/lib/prisma";
import { toMoneyNumber } from "@/lib/money";

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfYear(d = new Date()) {
  return new Date(d.getFullYear(), 0, 1);
}

export async function getSaaSRevenueDashboard() {
  const now = new Date();
  const day0 = startOfDay(now);
  const month0 = startOfMonth(now);
  const year0 = startOfYear(now);

  const paidWhere = { status: "paid" as const, isDemo: undefined };

  const [
    todayAgg,
    monthAgg,
    yearAgg,
    recentPayments,
    activeBiz,
    trialBiz,
    expiredBiz,
    pendingRenewals,
    activeSubs,
    chartRaw,
  ] = await Promise.all([
    prisma.billingPayment.aggregate({
      where: { status: "paid", paidAt: { gte: day0 } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.billingPayment.aggregate({
      where: { status: "paid", paidAt: { gte: month0 } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.billingPayment.aggregate({
      where: { status: "paid", paidAt: { gte: year0 } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.billingPayment.findMany({
      where: { status: "paid" },
      orderBy: { paidAt: "desc" },
      take: 20,
      include: {
        business: { select: { id: true, name: true } },
        plan: { select: { name: true, code: true, billingCycle: true } },
      },
    }),
    prisma.business.count({
      where: {
        isDemo: false,
        portalKind: "customer",
        status: { not: "deleted" },
        isLocked: false,
        isTrial: false,
        planStatus: "active",
      },
    }),
    prisma.business.count({
      where: {
        isDemo: false,
        isTrial: true,
        status: { not: "deleted" },
        isLocked: false,
      },
    }),
    prisma.business.count({
      where: {
        isDemo: false,
        portalKind: "customer",
        OR: [{ isLocked: true }, { planStatus: "expired" }],
        status: { not: "deleted" },
      },
    }),
    prisma.business.count({
      where: {
        isDemo: false,
        isTrial: false,
        isLocked: false,
        subscriptionEndsAt: {
          gte: now,
          lte: new Date(now.getTime() + 7 * 86400000),
        },
      },
    }),
    prisma.subscription.findMany({
      where: { status: "active" },
      include: { plan: true },
      take: 2000,
    }),
    prisma.billingPayment.findMany({
      where: {
        status: "paid",
        paidAt: { gte: new Date(now.getTime() - 30 * 86400000) },
      },
      select: { amount: true, paidAt: true },
    }),
  ]);

  // MRR: sum monthly-equivalent of active paid plans
  let mrr = 0;
  for (const s of activeSubs) {
    if (!s.plan) continue;
    const price = toMoneyNumber(s.plan.price);
    mrr += s.plan.billingCycle === "annual" ? price / 12 : price;
  }
  mrr = Math.round(mrr * 100) / 100;
  const arr = Math.round(mrr * 12 * 100) / 100;

  // 30-day revenue chart by day
  const byDay: Record<string, number> = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    byDay[key] = 0;
  }
  for (const p of chartRaw) {
    if (!p.paidAt) continue;
    const key = new Date(p.paidAt).toISOString().slice(0, 10);
    if (key in byDay) byDay[key] += toMoneyNumber(p.amount);
  }
  const revenueChart = Object.entries(byDay).map(([date, amount]) => ({
    date,
    amount: Math.round(amount * 100) / 100,
  }));

  void paidWhere;

  return {
    todayRevenue: toMoneyNumber(todayAgg._sum.amount || 0),
    todayPayments: todayAgg._count,
    monthlyRevenue: toMoneyNumber(monthAgg._sum.amount || 0),
    monthlyPayments: monthAgg._count,
    annualRevenue: toMoneyNumber(yearAgg._sum.amount || 0),
    annualPayments: yearAgg._count,
    mrr,
    arr,
    activeCustomers: activeBiz,
    trialCustomers: trialBiz,
    expiredCustomers: expiredBiz,
    pendingRenewals,
    recentPayments: recentPayments.map((p) => ({
      id: p.id,
      amount: toMoneyNumber(p.amount),
      currency: p.currency,
      invoiceNumber: p.invoiceNumber,
      paidAt: p.paidAt,
      business: p.business,
      plan: p.plan
        ? { ...p.plan, price: p.plan ? undefined : undefined, name: p.plan.name, code: p.plan.code, billingCycle: p.plan.billingCycle }
        : null,
    })),
    revenueChart,
  };
}
