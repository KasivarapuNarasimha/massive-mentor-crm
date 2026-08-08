/**
 * CRM → Finance revenue bridge.
 * Source of truth for recognized revenue remains Payment (+ paid Invoice).
 * Idempotent: one Invoice per (businessId, sourceType, sourceId).
 */
import { prisma } from "../lib/prisma.js";
import { getUserBusinessId } from "./field-engine.service.js";
import { toDecimal, toMoneyNumber } from "../lib/money.js";
import { recordAudit } from "./audit.service.js";
import { nextFinanceInvoiceNumber } from "./invoice-sequence.service.js";
import { resolveBusinessCurrency } from "./finance.service.js";

export type CrmRevenueSource = "deal" | "client";

export type UpsertCrmRevenueInput = {
  actorUserId: string;
  businessId?: string | null;
  /** Primary source. If dealId is also set for a client record, deal wins. */
  sourceType: CrmRevenueSource;
  sourceId: string;
  amount: number;
  contactId?: string | null;
  clientName?: string | null;
  description?: string | null;
  revenueDate?: Date | string | null;
  /** When recording from Client with a linked Deal, prefer deal source (anti double-count). */
  dealId?: string | null;
};

function asDate(v?: Date | string | null): Date {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function findBySource(
  businessId: string,
  sourceType: string,
  sourceId: string
) {
  return prisma.invoice.findFirst({
    where: {
      businessId,
      sourceType,
      sourceId,
    },
    include: { payments: true },
  });
}

/**
 * Create or update paid invoice + single matching payment for CRM-recognized revenue.
 * Does not enforce Finance role — callers must be trusted CRM/admin paths.
 */
export async function upsertCrmRevenue(input: UpsertCrmRevenueInput) {
  const businessId =
    input.businessId || (await getUserBusinessId(input.actorUserId));
  if (!businessId) throw new Error("Business context required");

  let sourceType: CrmRevenueSource = input.sourceType;
  let sourceId = String(input.sourceId || "").trim();
  if (!sourceId) throw new Error("sourceId is required");

  // Prefer Deal source when a deal is linked (never create client + deal rows for same money)
  const linkedDealId = input.dealId ? String(input.dealId).trim() : "";
  if (linkedDealId) {
    sourceType = "deal";
    sourceId = linkedDealId;
  }

  // Client path without explicit deal: if contact has a closed-won deal with CRM revenue already, reuse it
  if (sourceType === "client" && input.contactId) {
    const deals = await prisma.deal.findMany({
      where: {
        businessId,
        contactId: input.contactId,
        stage: { in: ["closed_won", "won"] },
      },
      select: { id: true },
      take: 20,
    });
    for (const d of deals) {
      const existingDealInv = await findBySource(businessId, "deal", d.id);
      if (existingDealInv && existingDealInv.status !== "cancelled") {
        sourceType = "deal";
        sourceId = d.id;
        break;
      }
    }
  }

  const amountNum = Number(input.amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new Error("Amount must be greater than zero");
  }
  const amount = toDecimal(amountNum);
  const taxRate = toDecimal(0, 4);
  const taxAmount = toDecimal(0);
  const total = amount.toDecimalPlaces(2);
  const currency = await resolveBusinessCurrency(input.actorUserId, businessId);
  const paidAt = asDate(input.revenueDate);

  const sourceLabel = sourceType === "deal" ? "Deal" : "Client";
  const description =
    (input.description || "").trim() ||
    `CRM revenue (${sourceLabel})`;

  let invoice = await findBySource(businessId, sourceType, sourceId);

  if (invoice) {
    invoice = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        amount,
        taxRate,
        taxAmount,
        total,
        currency,
        status: "paid",
        paidAt,
        issueDate: paidAt,
        contactId: input.contactId ?? invoice.contactId,
        clientName: input.clientName ?? invoice.clientName,
        description,
        notes: `Source: ${sourceLabel}`,
        sourceType,
        sourceId,
      },
      include: { payments: true },
    });
  } else {
    const number = await nextFinanceInvoiceNumber(businessId);
    invoice = await prisma.invoice.create({
      data: {
        businessId,
        userId: input.actorUserId,
        number,
        contactId: input.contactId || null,
        clientName: input.clientName || null,
        description,
        amount,
        taxRate,
        taxAmount,
        total,
        currency,
        status: "paid",
        issueDate: paidAt,
        paidAt,
        notes: `Source: ${sourceLabel}`,
        sourceType,
        sourceId,
      },
      include: { payments: true },
    });
  }

  // Exactly one payment for CRM-linked revenue (idempotent)
  const existingPay = invoice.payments[0];
  if (existingPay) {
    await prisma.payment.update({
      where: { id: existingPay.id },
      data: {
        amount: total,
        paidAt,
        reference: `crm:${sourceType}:${sourceId}`,
        notes: `CRM ${sourceLabel} revenue`,
      },
    });
    // Remove extras if any
    if (invoice.payments.length > 1) {
      await prisma.payment.deleteMany({
        where: {
          invoiceId: invoice.id,
          id: { not: existingPay.id },
        },
      });
    }
  } else {
    await prisma.payment.create({
      data: {
        businessId,
        userId: input.actorUserId,
        invoiceId: invoice.id,
        amount: total,
        method: "other",
        reference: `crm:${sourceType}:${sourceId}`,
        paidAt,
        notes: `CRM ${sourceLabel} revenue`,
      },
    });
  }

  await recordAudit({
    businessId,
    actorUserId: input.actorUserId,
    action: "crm_finance_upsert",
    entityType: "invoice",
    entityId: invoice.id,
    metadata: {
      sourceType,
      sourceId,
      amount: toMoneyNumber(total),
      contactId: input.contactId || null,
    },
  });

  const refreshed = await prisma.invoice.findUnique({
    where: { id: invoice.id },
    include: { payments: true },
  });

  return {
    invoice: refreshed,
    sourceType,
    sourceId,
    amount: toMoneyNumber(total),
  };
}

/**
 * Void CRM-linked revenue when Deal leaves Won (or user cancels client revenue).
 */
export async function voidCrmRevenue(opts: {
  actorUserId: string;
  businessId?: string | null;
  sourceType: CrmRevenueSource;
  sourceId: string;
}) {
  const businessId =
    opts.businessId || (await getUserBusinessId(opts.actorUserId));
  if (!businessId) return { voided: false };

  const invoice = await findBySource(businessId, opts.sourceType, opts.sourceId);
  if (!invoice) return { voided: false };

  await prisma.payment.deleteMany({ where: { invoiceId: invoice.id } });
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: "cancelled",
      paidAt: null,
      notes: `Voided CRM ${opts.sourceType} revenue`,
    },
  });

  await recordAudit({
    businessId,
    actorUserId: opts.actorUserId,
    action: "crm_finance_void",
    entityType: "invoice",
    entityId: invoice.id,
    metadata: {
      sourceType: opts.sourceType,
      sourceId: opts.sourceId,
    },
  });

  return { voided: true, invoiceId: invoice.id };
}

/** Sync Finance when a Deal enters/leaves closed_won or value changes while won. */
export async function syncDealWonFinance(
  userId: string,
  deal: {
    id: string;
    title: string;
    value: unknown;
    stage: string;
    contactId: string | null;
    businessId: string | null;
  },
  prevStage: string,
  opts?: { contactName?: string | null }
) {
  const isWon = /^(closed_)?won$/i.test(String(deal.stage || "").replace(/[\s-]+/g, "_"));
  const wasWon = /^(closed_)?won$/i.test(String(prevStage || "").replace(/[\s-]+/g, "_"));
  const valueNum =
    deal.value == null ? 0 : toMoneyNumber(deal.value as never);

  if (isWon && valueNum > 0) {
    let clientName = opts?.contactName || null;
    if (!clientName && deal.contactId) {
      const c = await prisma.contact.findFirst({
        where: { id: deal.contactId },
        select: { name: true, company: true },
      });
      clientName = c?.company || c?.name || null;
    }
    return upsertCrmRevenue({
      actorUserId: userId,
      businessId: deal.businessId,
      sourceType: "deal",
      sourceId: deal.id,
      amount: valueNum,
      contactId: deal.contactId,
      clientName,
      description: `Deal won: ${deal.title}`,
      revenueDate: new Date(),
    });
  }

  if (wasWon && !isWon) {
    return voidCrmRevenue({
      actorUserId: userId,
      businessId: deal.businessId,
      sourceType: "deal",
      sourceId: deal.id,
    });
  }

  // Still won but value cleared → void
  if (isWon && valueNum <= 0 && wasWon) {
    return voidCrmRevenue({
      actorUserId: userId,
      businessId: deal.businessId,
      sourceType: "deal",
      sourceId: deal.id,
    });
  }

  return null;
}

/** Look up CRM-linked invoice for UI (client finance panel). */
export async function getCrmRevenueLink(
  businessId: string,
  sourceType: CrmRevenueSource,
  sourceId: string
) {
  return findBySource(businessId, sourceType, sourceId);
}
