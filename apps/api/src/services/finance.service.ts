import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";
import { resolveActorRole } from "./tenant-scope.service.js";
import { paginated, skipTake } from "./pagination.js";
import { recordAudit } from "./audit.service.js";
import { notifyUser } from "./notification.service.js";
import {
  detectDefaultCurrency,
  formatCurrency,
  isCurrencyCode,
  type CurrencyCode,
} from "../lib/currency.js";
import { toDecimal, toMoneyNumber, moneyGte } from "../lib/money.js";
import { nextFinanceInvoiceNumber } from "./invoice-sequence.service.js";

const FINANCE_ROLES = new Set([
  "ceo",
  "owner",
  "business_admin",
  "admin",
  "finance",
  "super_admin",
]);

export async function assertFinanceAccess(userId: string) {
  const role = await resolveActorRole(userId);
  if (!FINANCE_ROLES.has(role)) {
    throw new Error("Finance module is restricted to Finance, CEO, and Admin roles");
  }
  const businessId = await getUserBusinessId(userId);
  if (!businessId) throw new Error("Business context required");
  return { businessId, role };
}

/** Alias for CRM → Finance explicit actions */
export const assertFinanceAccessForCrm = assertFinanceAccess;

/**
 * Business display currency from Business Profile (user), then business owner profile.
 * Never hardcodes USD — defaults to INR when unset.
 */
export async function resolveBusinessCurrency(
  userId: string,
  businessId?: string
): Promise<CurrencyCode> {
  const profile = await prisma.businessProfile.findUnique({
    where: { userId },
    select: { currency: true, location: true },
  });
  if (profile?.currency && isCurrencyCode(profile.currency)) {
    return profile.currency;
  }

  const bid = businessId || (await getUserBusinessId(userId));
  if (bid) {
    const biz = await prisma.business.findUnique({
      where: { id: bid },
      select: { ownerUserId: true },
    });
    if (biz?.ownerUserId && biz.ownerUserId !== userId) {
      const ownerProfile = await prisma.businessProfile.findUnique({
        where: { userId: biz.ownerUserId },
        select: { currency: true, location: true },
      });
      if (ownerProfile?.currency && isCurrencyCode(ownerProfile.currency)) {
        return ownerProfile.currency;
      }
      if (ownerProfile?.location) {
        return detectDefaultCurrency(ownerProfile.location);
      }
    }
  }

  if (profile?.location) return detectDefaultCurrency(profile.location);
  return "INR";
}

async function nextInvoiceNumber(businessId: string): Promise<string> {
  return nextFinanceInvoiceNumber(businessId);
}

export async function getFinanceDashboard(userId: string) {
  const { businessId } = await assertFinanceAccess(userId);
  const currency = await resolveBusinessCurrency(userId, businessId);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  // SQL aggregates only — never load entire finance tables into memory
  const [
    invoiceAgg,
    paidAgg,
    openAgg,
    expenseAgg,
    paymentAgg,
    overdue,
    monthPayAgg,
    yearPayAgg,
    monthExpAgg,
  ] = await Promise.all([
    prisma.invoice.aggregate({
      where: { businessId },
      _sum: { total: true, taxAmount: true },
      _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: { businessId, status: "paid" },
      _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: {
        businessId,
        status: { in: ["sent", "overdue", "draft"] },
      },
      _sum: { total: true },
    }),
    prisma.expense.aggregate({
      where: { businessId },
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.payment.aggregate({
      where: { businessId },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.invoice.count({
      where: {
        businessId,
        status: { in: ["sent", "overdue"] },
        dueDate: { lt: now },
      },
    }),
    prisma.payment.aggregate({
      where: { businessId, paidAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { businessId, paidAt: { gte: yearStart } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { businessId, expenseDate: { gte: monthStart } },
      _sum: { total: true },
    }),
  ]);

  // Best-effort currency normalization without full table scan of values
  await Promise.all([
    prisma.invoice.updateMany({
      where: { businessId, currency: { not: currency } },
      data: { currency },
    }),
    prisma.expense.updateMany({
      where: { businessId, currency: { not: currency } },
      data: { currency },
    }),
  ]).catch(() => undefined);

  const totalInvoiced = toMoneyNumber(invoiceAgg._sum.total);
  const totalPaid = toMoneyNumber(paymentAgg._sum.amount);
  const totalExpenses = toMoneyNumber(expenseAgg._sum.total);
  const totalTax = toMoneyNumber(invoiceAgg._sum.taxAmount);
  const openTotal = toMoneyNumber(openAgg._sum.total);
  const monthRevenue = toMoneyNumber(monthPayAgg._sum.amount);
  const yearRevenue = toMoneyNumber(yearPayAgg._sum.amount);
  const monthExpenses = toMoneyNumber(monthExpAgg._sum.total);
  const profit = totalPaid - totalExpenses;

  // Monthly cash flow (last 12 months) via 12×2 aggregate queries (bounded)
  const cashFlow: Array<{ month: string; inflow: number; outflow: number; net: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const [inflowAgg, outflowAgg] = await Promise.all([
      prisma.payment.aggregate({
        where: { businessId, paidAt: { gte: d, lte: end } },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: { businessId, expenseDate: { gte: d, lte: end } },
        _sum: { total: true },
      }),
    ]);
    const inflow = toMoneyNumber(inflowAgg._sum.amount);
    const outflow = toMoneyNumber(outflowAgg._sum.total);
    cashFlow.push({ month: label, inflow, outflow, net: inflow - outflow });
  }

  return {
    currency,
    kpis: {
      totalInvoiced,
      totalPaid,
      totalExpenses,
      totalTax,
      outstanding: Math.max(0, openTotal - totalPaid),
      profit,
      monthRevenue,
      yearRevenue,
      monthExpenses,
      overdueCount: overdue,
      invoiceCount: invoiceAgg._count._all,
      paidInvoiceCount: paidAgg._count._all,
    },
    cashFlow,
    profitAndLoss: {
      revenue: totalPaid,
      expenses: totalExpenses,
      grossProfit: profit,
      taxCollected: totalTax,
    },
  };
}

export async function listInvoices(
  userId: string,
  opts?: { page?: number; pageSize?: number; search?: string; status?: string }
) {
  const { businessId } = await assertFinanceAccess(userId);
  const page = opts?.page && opts.page > 0 ? opts.page : 1;
  const pageSize = opts?.pageSize ? Math.min(200, opts.pageSize) : 25;
  const where: Record<string, unknown> = { businessId };
  if (opts?.status) where.status = opts.status;
  if (opts?.search) {
    where.OR = [
      { number: { contains: opts.search, mode: "insensitive" } },
      { clientName: { contains: opts.search, mode: "insensitive" } },
    ];
  }
  const { skip, take } = skipTake(page, pageSize);
  const [total, items] = await Promise.all([
    prisma.invoice.count({ where: where as never }),
    prisma.invoice.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { payments: true },
    }),
  ]);
  return paginated(items, total, page, pageSize);
}

export async function createInvoice(
  userId: string,
  input: {
    clientName?: string;
    contactId?: string;
    description?: string;
    amount: number;
    taxRate?: number;
    dueDate?: string;
    status?: string;
    notes?: string;
    number?: string;
  }
) {
  const { businessId } = await assertFinanceAccess(userId);
  const currency = await resolveBusinessCurrency(userId, businessId);
  const amount = toDecimal(input.amount);
  if (amount.lt(0)) throw new Error("Invalid amount");
  const taxRate = toDecimal(input.taxRate || 0, 4);
  const taxAmount = amount.mul(taxRate).div(100).toDecimalPlaces(2);
  const total = amount.add(taxAmount).toDecimalPlaces(2);
  const number = input.number?.trim() || (await nextInvoiceNumber(businessId));

  const invoice = await prisma.invoice.create({
    data: {
      businessId,
      userId,
      number,
      contactId: input.contactId || null,
      clientName: input.clientName || null,
      description: input.description || null,
      amount,
      taxRate,
      taxAmount,
      total,
      currency,
      status: input.status || "draft",
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      notes: input.notes || null,
      sourceType: null,
      sourceId: null,
    },
  });

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "create",
    entityType: "invoice",
    entityId: invoice.id,
    metadata: { number, total: toMoneyNumber(total) },
  });

  // Optional multi-level approval when amount exceeds workflow threshold
  try {
    const { maybeSubmitInvoiceApproval } = await import("./approval.service.js");
    await maybeSubmitInvoiceApproval(userId, {
      id: invoice.id,
      number: invoice.number,
      total: toMoneyNumber(invoice.total),
      currency: invoice.currency,
    });
  } catch {
    /* non-fatal */
  }

  return {
    ...invoice,
    amount: toMoneyNumber(invoice.amount),
    taxRate: toMoneyNumber(invoice.taxRate),
    taxAmount: toMoneyNumber(invoice.taxAmount),
    total: toMoneyNumber(invoice.total),
  };
}

export async function updateInvoice(
  userId: string,
  id: string,
  input: Partial<{
    clientName: string;
    description: string;
    amount: number;
    taxRate: number;
    status: string;
    dueDate: string | null;
    notes: string;
  }>
) {
  const { businessId } = await assertFinanceAccess(userId);
  const existing = await prisma.invoice.findFirst({ where: { id, businessId } });
  if (!existing) throw new Error("Invoice not found");

  const amount =
    input.amount !== undefined ? toDecimal(input.amount) : toDecimal(existing.amount);
  const taxRate =
    input.taxRate !== undefined ? toDecimal(input.taxRate, 4) : toDecimal(existing.taxRate, 4);
  const taxAmount = amount.mul(taxRate).div(100).toDecimalPlaces(2);
  const total = amount.add(taxAmount).toDecimalPlaces(2);
  const status = input.status ?? existing.status;

  const invoice = await prisma.invoice.update({
    where: { id },
    data: {
      clientName: input.clientName !== undefined ? input.clientName : existing.clientName,
      description: input.description !== undefined ? input.description : existing.description,
      amount,
      taxRate,
      taxAmount,
      total,
      status,
      dueDate:
        input.dueDate !== undefined
          ? input.dueDate
            ? new Date(input.dueDate)
            : null
          : existing.dueDate,
      notes: input.notes !== undefined ? input.notes : existing.notes,
      paidAt: status === "paid" && !existing.paidAt ? new Date() : existing.paidAt,
    },
  });

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "update",
    entityType: "invoice",
    entityId: id,
    metadata: { oldStatus: existing.status, newStatus: status, total },
  });

  if (status === "paid" && existing.status !== "paid") {
    const cur = invoice.currency || (await resolveBusinessCurrency(userId, businessId));
    await notifyUser(userId, {
      type: "finance",
      title: "Invoice Paid",
      message: `Invoice ${invoice.number} marked as paid (${formatCurrency(
        Number(invoice.total),
        cur
      )})`,
      entityType: "invoice",
      entityId: invoice.id,
    });
  }

  return invoice;
}

export async function deleteInvoice(userId: string, id: string) {
  const { businessId } = await assertFinanceAccess(userId);
  const existing = await prisma.invoice.findFirst({ where: { id, businessId } });
  if (!existing) throw new Error("Invoice not found");
  await prisma.payment.deleteMany({ where: { invoiceId: id } });
  await prisma.invoice.delete({ where: { id } });
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "delete",
    entityType: "invoice",
    entityId: id,
    metadata: { number: existing.number },
  });
  return { ok: true };
}

export async function listExpenses(
  userId: string,
  opts?: { page?: number; pageSize?: number; search?: string; category?: string }
) {
  const { businessId } = await assertFinanceAccess(userId);
  const page = opts?.page && opts.page > 0 ? opts.page : 1;
  const pageSize = opts?.pageSize ? Math.min(200, opts.pageSize) : 25;
  const where: Record<string, unknown> = { businessId };
  if (opts?.category) where.category = opts.category;
  if (opts?.search) {
    where.OR = [
      { title: { contains: opts.search, mode: "insensitive" } },
      { vendor: { contains: opts.search, mode: "insensitive" } },
    ];
  }
  const { skip, take } = skipTake(page, pageSize);
  const [total, items] = await Promise.all([
    prisma.expense.count({ where: where as never }),
    prisma.expense.findMany({
      where: where as never,
      orderBy: { expenseDate: "desc" },
      skip,
      take,
    }),
  ]);
  return paginated(items, total, page, pageSize);
}

export async function createExpense(
  userId: string,
  input: {
    title: string;
    amount: number;
    category?: string;
    taxAmount?: number;
    expenseDate?: string;
    vendor?: string;
    notes?: string;
  }
) {
  const { businessId } = await assertFinanceAccess(userId);
  const currency = await resolveBusinessCurrency(userId, businessId);
  const amount = toDecimal(input.amount);
  if (!input.title?.trim()) throw new Error("Title is required");
  if (amount.lt(0)) throw new Error("Invalid amount");
  const taxAmount = toDecimal(input.taxAmount || 0);
  const total = amount.add(taxAmount).toDecimalPlaces(2);
  const expense = await prisma.expense.create({
    data: {
      businessId,
      userId,
      title: input.title.trim(),
      category: input.category || "general",
      amount,
      taxAmount,
      total,
      currency,
      expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
      vendor: input.vendor || null,
      notes: input.notes || null,
    },
  });
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "create",
    entityType: "expense",
    entityId: expense.id,
    metadata: { title: expense.title, total: toMoneyNumber(total) },
  });

  try {
    const { maybeSubmitExpenseApproval } = await import("./approval.service.js");
    await maybeSubmitExpenseApproval(userId, {
      id: expense.id,
      title: expense.title,
      total: toMoneyNumber(expense.total),
      currency: expense.currency,
    });
  } catch {
    /* non-fatal */
  }

  return {
    ...expense,
    amount: toMoneyNumber(expense.amount),
    taxAmount: toMoneyNumber(expense.taxAmount),
    total: toMoneyNumber(expense.total),
  };
}

export async function updateExpense(
  userId: string,
  id: string,
  input: Partial<{
    title: string;
    amount: number;
    category: string;
    taxAmount: number;
    expenseDate: string;
    vendor: string;
    notes: string;
  }>
) {
  const { businessId } = await assertFinanceAccess(userId);
  const existing = await prisma.expense.findFirst({ where: { id, businessId } });
  if (!existing) throw new Error("Expense not found");
  const amount =
    input.amount !== undefined ? toDecimal(input.amount) : toDecimal(existing.amount);
  const taxAmount =
    input.taxAmount !== undefined ? toDecimal(input.taxAmount) : toDecimal(existing.taxAmount);
  const total = amount.add(taxAmount).toDecimalPlaces(2);
  const expense = await prisma.expense.update({
    where: { id },
    data: {
      title: input.title ?? existing.title,
      amount,
      taxAmount,
      total,
      category: input.category ?? existing.category,
      expenseDate: input.expenseDate ? new Date(input.expenseDate) : existing.expenseDate,
      vendor: input.vendor !== undefined ? input.vendor : existing.vendor,
      notes: input.notes !== undefined ? input.notes : existing.notes,
    },
  });
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "update",
    entityType: "expense",
    entityId: id,
  });
  return {
    ...expense,
    amount: toMoneyNumber(expense.amount),
    taxAmount: toMoneyNumber(expense.taxAmount),
    total: toMoneyNumber(expense.total),
  };
}

export async function deleteExpense(userId: string, id: string) {
  const { businessId } = await assertFinanceAccess(userId);
  const existing = await prisma.expense.findFirst({ where: { id, businessId } });
  if (!existing) throw new Error("Expense not found");
  await prisma.expense.delete({ where: { id } });
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "delete",
    entityType: "expense",
    entityId: id,
  });
  return { ok: true };
}

export async function listPayments(
  userId: string,
  opts?: { page?: number; pageSize?: number; invoiceId?: string }
) {
  const { businessId } = await assertFinanceAccess(userId);
  const page = opts?.page && opts.page > 0 ? opts.page : 1;
  const pageSize = opts?.pageSize ? Math.min(200, opts.pageSize) : 25;
  const where: Record<string, unknown> = { businessId };
  if (opts?.invoiceId) where.invoiceId = opts.invoiceId;
  const { skip, take } = skipTake(page, pageSize);
  const [total, items] = await Promise.all([
    prisma.payment.count({ where: where as never }),
    prisma.payment.findMany({
      where: where as never,
      orderBy: { paidAt: "desc" },
      skip,
      take,
      include: { invoice: { select: { id: true, number: true, clientName: true } } },
    }),
  ]);
  return paginated(items, total, page, pageSize);
}

export async function createPayment(
  userId: string,
  input: {
    amount: number;
    invoiceId?: string;
    method?: string;
    reference?: string;
    paidAt?: string;
    notes?: string;
  }
) {
  const { businessId } = await assertFinanceAccess(userId);
  const amount = toDecimal(input.amount);
  if (amount.lte(0)) throw new Error("Invalid payment amount");

  if (input.invoiceId) {
    const inv = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, businessId },
    });
    if (!inv) throw new Error("Invoice not found");
  }

  const payment = await prisma.payment.create({
    data: {
      businessId,
      userId,
      amount,
      invoiceId: input.invoiceId || null,
      method: input.method || "bank",
      reference: input.reference || null,
      paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
      notes: input.notes || null,
    },
  });

  if (input.invoiceId) {
    const inv = await prisma.invoice.findUnique({ where: { id: input.invoiceId } });
    if (inv) {
      const paidSum = await prisma.payment.aggregate({
        where: { invoiceId: inv.id },
        _sum: { amount: true },
      });
      const totalPaid = toDecimal(paidSum._sum.amount || 0);
      if (moneyGte(totalPaid, inv.total)) {
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { status: "paid", paidAt: new Date() },
        });
      } else if (inv.status === "draft") {
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { status: "sent" },
        });
      }
    }
  }

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "create",
    entityType: "payment",
    entityId: payment.id,
    metadata: { amount: toMoneyNumber(amount), invoiceId: input.invoiceId },
  });

  const currency = await resolveBusinessCurrency(userId, businessId);
  await notifyUser(userId, {
    type: "payment_reminder",
    title: "Payment Recorded",
    message: `Payment of ${formatCurrency(toMoneyNumber(amount), currency)} recorded`,
    entityType: "payment",
    entityId: payment.id,
  });

  return { ...payment, amount: toMoneyNumber(payment.amount) };
}

export async function deletePayment(userId: string, id: string) {
  const { businessId } = await assertFinanceAccess(userId);
  const existing = await prisma.payment.findFirst({ where: { id, businessId } });
  if (!existing) throw new Error("Payment not found");
  await prisma.payment.delete({ where: { id } });
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "delete",
    entityType: "payment",
    entityId: id,
  });
  return { ok: true };
}
