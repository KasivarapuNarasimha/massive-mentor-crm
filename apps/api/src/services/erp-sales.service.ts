/**
 * Phase 2.5 — Sales Orders.
 * Post: stock sale_out + InventoryBalance + existing Invoice (sourceType=sales_order).
 * Does not duplicate Payment/P&L engines.
 */
import { prisma } from "../lib/prisma.js";
import { toDecimal, toMoneyNumber } from "../lib/money.js";
import { recordAudit } from "./audit.service.js";
import { assertErpAccess } from "./erp-access.service.js";
import { applyStockMovement } from "./erp-stock.service.js";
import { nextErpDocumentNumber } from "./erp-sequence.service.js";
import { nextFinanceInvoiceNumber } from "./invoice-sequence.service.js";
import { resolveBusinessCurrency } from "./finance.service.js";

type LineInput = {
  productId: string;
  qty?: number;
  qtyOrdered?: number;
  unitPrice?: number;
  taxRate?: number;
  description?: string;
};

function lineQty(l: LineInput): number {
  return Number(l.qtyOrdered ?? l.qty ?? 0);
}

function recalcTotals(
  items: Array<{ qtyOrdered: unknown; unitPrice: unknown; taxRate: unknown }>
) {
  let subtotal = toDecimal(0);
  let taxAmount = toDecimal(0);
  for (const it of items) {
    const qty = toDecimal(it.qtyOrdered, 4);
    const price = toDecimal(it.unitPrice);
    const rate = toDecimal(it.taxRate, 4);
    const line = qty.mul(price).toDecimalPlaces(2);
    const tax = line.mul(rate).div(100).toDecimalPlaces(2);
    subtotal = subtotal.add(line);
    taxAmount = taxAmount.add(tax);
  }
  return {
    subtotal,
    taxAmount,
    total: subtotal.add(taxAmount).toDecimalPlaces(2),
  };
}

/** True if deal has any SO that is not cancelled (blocks Deal auto-invoice). */
export async function dealHasActiveSalesOrder(
  businessId: string,
  dealId: string
): Promise<boolean> {
  if (!businessId || !dealId) return false;
  const n = await prisma.salesOrder.count({
    where: {
      businessId,
      dealId,
      status: { not: "cancelled" },
    },
  });
  return n > 0;
}

export async function listSalesOrders(userId: string) {
  const { businessId } = await assertErpAccess(userId);
  const salesOrders = await prisma.salesOrder.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    include: {
      deal: { select: { id: true, title: true, stage: true } },
      contact: { select: { id: true, name: true, company: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      invoice: { select: { id: true, number: true, status: true, total: true } },
      items: {
        include: { product: { select: { id: true, sku: true, name: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
    take: 200,
  });
  return { salesOrders };
}

export async function getSalesOrder(userId: string, id: string) {
  const { businessId } = await assertErpAccess(userId);
  const salesOrder = await prisma.salesOrder.findFirst({
    where: { id, businessId },
    include: {
      deal: { select: { id: true, title: true, stage: true, value: true } },
      contact: { select: { id: true, name: true, company: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      invoice: true,
      items: {
        include: { product: { select: { id: true, sku: true, name: true, unit: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!salesOrder) throw new Error("Sales order not found");
  return { salesOrder };
}

export async function createSalesOrder(
  userId: string,
  input: {
    warehouseId: string;
    dealId?: string;
    contactId?: string;
    notes?: string;
    items: LineInput[];
  }
) {
  const { businessId } = await assertErpAccess(userId);
  if (!businessId) throw new Error("Business workspace is required to create sales order");
  if (!input.warehouseId) throw new Error("Warehouse is required");

  const warehouse = await prisma.warehouse.findFirst({
    where: { id: input.warehouseId, businessId, isActive: true },
  });
  if (!warehouse) throw new Error("Warehouse not found or inactive");

  let contactId = input.contactId || null;
  let dealId = input.dealId || null;
  if (dealId) {
    const deal = await prisma.deal.findFirst({
      where: { id: dealId, businessId },
    });
    if (!deal) throw new Error("Deal not found in this workspace");
    if (!contactId && deal.contactId) contactId = deal.contactId;
  }
  if (contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, businessId, deletedAt: null },
    });
    if (!contact) throw new Error("Contact not found in this workspace");
  }

  const rawItems = (input.items || []).filter((l) => l.productId && lineQty(l) > 0);
  if (!rawItems.length) throw new Error("At least one line item is required");

  const productIds = [...new Set(rawItems.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { businessId, id: { in: productIds }, deletedAt: null },
  });
  if (products.length !== productIds.length) throw new Error("One or more products not found");
  const pmap = new Map(products.map((p) => [p.id, p]));

  const built = rawItems.map((l, idx) => {
    const p = pmap.get(l.productId)!;
    const qty = toDecimal(lineQty(l), 4);
    const unitPrice =
      l.unitPrice != null
        ? toDecimal(l.unitPrice)
        : p.sellingPrice != null
          ? toDecimal(p.sellingPrice)
          : toDecimal(0);
    const taxRate =
      l.taxRate != null
        ? toDecimal(l.taxRate, 4)
        : p.taxRate != null
          ? toDecimal(p.taxRate, 4)
          : toDecimal(0, 4);
    const lineNet = qty.mul(unitPrice).toDecimalPlaces(2);
    const lineTax = lineNet.mul(taxRate).div(100).toDecimalPlaces(2);
    return {
      businessId,
      productId: l.productId,
      description: l.description || p.name,
      qtyOrdered: qty,
      qtyFulfilled: toDecimal(0, 4),
      unitPrice,
      taxRate,
      lineTotal: lineNet.add(lineTax).toDecimalPlaces(2),
      sortOrder: idx,
    };
  });
  const totals = recalcTotals(built);
  const currency = await resolveBusinessCurrency(userId, businessId);
  const number = await nextErpDocumentNumber(businessId, "SO");

  const salesOrder = await prisma.salesOrder.create({
    data: {
      businessId,
      warehouseId: input.warehouseId,
      dealId,
      contactId,
      number,
      status: "draft",
      currency,
      notes: input.notes || null,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      total: totals.total,
      createdByUserId: userId,
      items: { create: built },
    },
    include: {
      items: { include: { product: { select: { id: true, sku: true, name: true } } } },
      warehouse: { select: { id: true, code: true, name: true } },
      deal: { select: { id: true, title: true } },
    },
  });

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "create",
    entityType: "sales_order",
    entityId: salesOrder.id,
    metadata: { number, dealId, total: toMoneyNumber(totals.total) },
  }).catch(() => {});

  // SO is finance source of truth for this deal — void any prior Deal auto-invoice
  if (dealId) {
    try {
      const { voidCrmRevenue } = await import("./finance-crm-sync.service.js");
      await voidCrmRevenue({
        actorUserId: userId,
        businessId,
        sourceType: "deal",
        sourceId: dealId,
      });
    } catch {
      /* non-fatal */
    }
  }

  return { salesOrder };
}

export async function updateSalesOrder(
  userId: string,
  id: string,
  input: {
    warehouseId?: string;
    notes?: string | null;
    items?: LineInput[];
  }
) {
  const { businessId } = await assertErpAccess(userId);
  const existing = await prisma.salesOrder.findFirst({
    where: { id, businessId },
    include: { items: true },
  });
  if (!existing) throw new Error("Sales order not found");
  if (existing.status !== "draft") {
    throw new Error("Only draft sales orders can be updated");
  }

  if (input.warehouseId) {
    const wh = await prisma.warehouse.findFirst({
      where: { id: input.warehouseId, businessId, isActive: true },
    });
    if (!wh) throw new Error("Warehouse not found or inactive");
  }

  let totals = {
    subtotal: existing.subtotal,
    taxAmount: existing.taxAmount,
    total: existing.total,
  };

  const salesOrder = await prisma.$transaction(async (tx) => {
    if (input.items) {
      const rawItems = input.items.filter((l) => l.productId && lineQty(l) > 0);
      if (!rawItems.length) throw new Error("At least one line item is required");
      const productIds = [...new Set(rawItems.map((i) => i.productId))];
      const products = await tx.product.findMany({
        where: { businessId, id: { in: productIds }, deletedAt: null },
      });
      if (products.length !== productIds.length) throw new Error("One or more products not found");
      const pmap = new Map(products.map((p) => [p.id, p]));
      const built = rawItems.map((l, idx) => {
        const p = pmap.get(l.productId)!;
        const qty = toDecimal(lineQty(l), 4);
        const unitPrice =
          l.unitPrice != null
            ? toDecimal(l.unitPrice)
            : p.sellingPrice != null
              ? toDecimal(p.sellingPrice)
              : toDecimal(0);
        const taxRate =
          l.taxRate != null
            ? toDecimal(l.taxRate, 4)
            : p.taxRate != null
              ? toDecimal(p.taxRate, 4)
              : toDecimal(0, 4);
        const lineNet = qty.mul(unitPrice).toDecimalPlaces(2);
        const lineTax = lineNet.mul(taxRate).div(100).toDecimalPlaces(2);
        return {
          businessId,
          salesOrderId: id,
          productId: l.productId,
          description: l.description || p.name,
          qtyOrdered: qty,
          qtyFulfilled: toDecimal(0, 4),
          unitPrice,
          taxRate,
          lineTotal: lineNet.add(lineTax).toDecimalPlaces(2),
          sortOrder: idx,
        };
      });
      totals = recalcTotals(built);
      await tx.salesOrderItem.deleteMany({ where: { salesOrderId: id, businessId } });
      await tx.salesOrderItem.createMany({ data: built });
    }

    return tx.salesOrder.update({
      where: { id },
      data: {
        ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
      },
      include: {
        items: { include: { product: { select: { id: true, sku: true, name: true } } } },
        warehouse: { select: { id: true, code: true, name: true } },
      },
    });
  });

  return { salesOrder };
}

export async function confirmSalesOrder(userId: string, id: string) {
  const { businessId } = await assertErpAccess(userId);
  const so = await prisma.salesOrder.findFirst({
    where: { id, businessId },
    include: { items: true },
  });
  if (!so) throw new Error("Sales order not found");
  if (so.status !== "draft") throw new Error("Only draft sales orders can be confirmed");
  if (!so.items.length) throw new Error("Sales order has no line items");
  const salesOrder = await prisma.salesOrder.update({
    where: { id },
    data: { status: "confirmed" },
    include: {
      items: { include: { product: { select: { id: true, sku: true, name: true } } } },
      warehouse: { select: { id: true, code: true, name: true } },
    },
  });
  return { salesOrder };
}

export async function cancelSalesOrder(userId: string, id: string) {
  const { businessId } = await assertErpAccess(userId);
  const so = await prisma.salesOrder.findFirst({ where: { id, businessId } });
  if (!so) throw new Error("Sales order not found");
  if (so.status === "posted" || so.status === "posting") {
    throw new Error("Posted sales orders cannot be cancelled");
  }
  if (so.status === "cancelled") throw new Error("Sales order already cancelled");
  const salesOrder = await prisma.salesOrder.update({
    where: { id },
    data: { status: "cancelled" },
  });
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "cancel",
    entityType: "sales_order",
    entityId: id,
    metadata: { number: so.number },
  }).catch(() => {});
  return { salesOrder };
}

/**
 * Post/fulfill: claim → stock out → invoice (sourceType=sales_order) in one flow.
 * Stock + SO status in one TX; invoice created after stock commit using existing Finance models.
 */
export async function postSalesOrder(userId: string, id: string) {
  const { businessId } = await assertErpAccess(userId);

  const posted = await prisma.$transaction(async (tx) => {
    const claimed = await tx.salesOrder.updateMany({
      where: {
        id,
        businessId,
        status: { in: ["draft", "confirmed"] },
      },
      data: { status: "posting" },
    });
    if (claimed.count === 0) {
      const existing = await tx.salesOrder.findFirst({ where: { id, businessId } });
      if (!existing) throw new Error("Sales order not found");
      if (existing.status === "posted") throw new Error("Sales order already posted");
      if (existing.status === "cancelled") throw new Error("Sales order is cancelled");
      throw new Error("Sales order is not in draft/confirmed status");
    }

    const so = await tx.salesOrder.findFirst({
      where: { id, businessId },
      include: { items: true, contact: { select: { name: true, company: true } } },
    });
    if (!so) throw new Error("Sales order not found");
    if (!so.items.length) throw new Error("Sales order has no line items");

    for (const line of so.items) {
      const product = await tx.product.findFirst({
        where: { id: line.productId, businessId, deletedAt: null },
      });
      if (!product) throw new Error("Product not found on sales order line");
      if (product.trackInventory && product.type !== "service") {
        const qtyOut = toDecimal(line.qtyOrdered, 4).neg();
        await applyStockMovement(
          {
            businessId,
            productId: line.productId,
            warehouseId: so.warehouseId,
            type: "sale_out",
            qty: qtyOut.toNumber(),
            unitCost: product.costPrice != null ? toDecimal(product.costPrice).toNumber() : null,
            referenceType: "sales_order",
            referenceId: so.id,
            notes: `SO ${so.number}`,
            createdByUserId: userId,
            allowNegative: false,
          },
          tx
        );
      }
      await tx.salesOrderItem.update({
        where: { id: line.id },
        data: { qtyFulfilled: line.qtyOrdered },
      });
    }

    return tx.salesOrder.update({
      where: { id: so.id },
      data: { status: "posted", postedAt: new Date() },
      include: {
        items: true,
        contact: { select: { id: true, name: true, company: true } },
        deal: { select: { id: true, title: true } },
        warehouse: { select: { id: true, code: true, name: true } },
      },
    });
  });

  // Create / reuse Finance Invoice via existing unique (businessId, sourceType, sourceId)
  const currency = await resolveBusinessCurrency(userId, businessId);
  const clientName =
    posted.contact?.company || posted.contact?.name || posted.deal?.title || null;
  const amount = toDecimal(posted.subtotal);
  const taxAmount = toDecimal(posted.taxAmount);
  const total = toDecimal(posted.total);
  const taxRate =
    amount.gt(0) && taxAmount.gt(0)
      ? taxAmount.mul(100).div(amount).toDecimalPlaces(4)
      : toDecimal(0, 4);

  let invoice = await prisma.invoice.findFirst({
    where: {
      businessId,
      sourceType: "sales_order",
      sourceId: posted.id,
    },
    include: { payments: true },
  });

  if (invoice) {
    if (invoice.status === "cancelled") {
      invoice = await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          amount,
          taxRate,
          taxAmount,
          total,
          currency,
          status: "paid",
          paidAt: new Date(),
          contactId: posted.contactId,
          clientName,
          description: `Sales order ${posted.number}`,
          notes: `Source: Sales Order ${posted.number}`,
        },
        include: { payments: true },
      });
    }
  } else {
    const number = await nextFinanceInvoiceNumber(businessId);
    invoice = await prisma.invoice.create({
      data: {
        businessId,
        userId,
        number,
        contactId: posted.contactId,
        clientName,
        description: `Sales order ${posted.number}`,
        amount,
        taxRate,
        taxAmount,
        total,
        currency,
        status: "paid",
        issueDate: new Date(),
        paidAt: new Date(),
        notes: `Source: Sales Order ${posted.number}`,
        sourceType: "sales_order",
        sourceId: posted.id,
      },
      include: { payments: true },
    });
  }

  if (!invoice.payments.length) {
    await prisma.payment.create({
      data: {
        businessId,
        userId,
        invoiceId: invoice.id,
        amount: total,
        method: "other",
        reference: `crm:sales_order:${posted.id}`,
        paidAt: new Date(),
        notes: `Sales order ${posted.number}`,
      },
    });
  }

  const salesOrder = await prisma.salesOrder.update({
    where: { id: posted.id },
    data: { invoiceId: invoice.id },
    include: {
      items: { include: { product: { select: { id: true, sku: true, name: true } } } },
      warehouse: { select: { id: true, code: true, name: true } },
      deal: { select: { id: true, title: true } },
      invoice: { select: { id: true, number: true, status: true, total: true } },
    },
  });

  // If deal was auto-invoiced earlier, void that deal invoice (SO is source of truth)
  if (posted.dealId) {
    try {
      const { voidCrmRevenue } = await import("./finance-crm-sync.service.js");
      await voidCrmRevenue({
        actorUserId: userId,
        businessId,
        sourceType: "deal",
        sourceId: posted.dealId,
      });
    } catch {
      /* non-fatal */
    }
  }

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "post",
    entityType: "sales_order",
    entityId: posted.id,
    metadata: {
      number: posted.number,
      invoiceId: invoice.id,
      total: toMoneyNumber(total),
    },
  }).catch(() => {});

  return { salesOrder, invoice };
}

/** Prefill metadata for Deal → Sales Order UI deep-link */
export async function getDealSalesOrderPrefill(userId: string, dealId: string) {
  const { businessId } = await assertErpAccess(userId);
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, businessId },
    include: { contact: { select: { id: true, name: true, company: true } } },
  });
  if (!deal) throw new Error("Deal not found in this workspace");
  if (!deal.businessId) {
    throw new Error("Business workspace is required on the Deal to create a sales order");
  }
  const defaultWh = await prisma.warehouse.findFirst({
    where: { businessId, isActive: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return {
    deal: {
      id: deal.id,
      title: deal.title,
      value: deal.value,
      contactId: deal.contactId,
      contact: deal.contact,
    },
    warehouseId: defaultWh?.id || null,
  };
}
