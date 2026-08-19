/**
 * Purchase Orders, Goods Receipts, Purchase Returns.
 * GRN/Return post updates StockMovement + InventoryBalance in one transaction.
 * Does not duplicate Finance Invoice/Payment/Expense.
 */
import { prisma } from "../lib/prisma.js";
import { toDecimal } from "../lib/money.js";
import { recordAudit } from "./audit.service.js";
import { assertErpAccess } from "./erp-access.service.js";
import { applyStockMovement } from "./erp-stock.service.js";
import { nextErpDocumentNumber } from "./erp-sequence.service.js";

type LineInput = { productId: string; qty?: number; qtyOrdered?: number; unitCost?: number; description?: string };

function lineQty(l: LineInput): number {
  const q = l.qtyOrdered ?? l.qty ?? 0;
  return Number(q);
}

function recalcTotals(items: Array<{ qtyOrdered: unknown; unitCost: unknown; taxRate: unknown }>) {
  let subtotal = toDecimal(0);
  let taxAmount = toDecimal(0);
  for (const it of items) {
    const qty = toDecimal(it.qtyOrdered, 4);
    const cost = toDecimal(it.unitCost);
    const rate = toDecimal(it.taxRate, 4);
    const line = qty.mul(cost).toDecimalPlaces(2);
    const tax = line.mul(rate).div(100).toDecimalPlaces(2);
    subtotal = subtotal.add(line);
    taxAmount = taxAmount.add(tax);
  }
  const total = subtotal.add(taxAmount).toDecimalPlaces(2);
  return { subtotal, taxAmount, total };
}

export async function listPurchaseOrders(userId: string) {
  const { businessId } = await assertErpAccess(userId);
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    include: {
      vendor: { select: { id: true, name: true } },
      items: {
        include: { product: { select: { id: true, sku: true, name: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
    take: 200,
  });
  return { purchaseOrders };
}

export async function createPurchaseOrder(
  userId: string,
  input: { vendorId: string; notes?: string; expectedDate?: string; items: LineInput[] }
) {
  const { businessId } = await assertErpAccess(userId);
  if (!input.vendorId) throw new Error("Vendor is required");
  const vendor = await prisma.vendor.findFirst({
    where: { id: input.vendorId, businessId, deletedAt: null },
  });
  if (!vendor) throw new Error("Vendor not found");
  const rawItems = (input.items || []).filter((l) => l.productId && lineQty(l) > 0);
  if (!rawItems.length) throw new Error("At least one line item is required");

  const productIds = [...new Set(rawItems.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { businessId, id: { in: productIds }, deletedAt: null },
  });
  if (products.length !== productIds.length) throw new Error("One or more products not found");

  const number = await nextErpDocumentNumber(businessId, "PO");
  const built = rawItems.map((l, idx) => {
    const qty = toDecimal(lineQty(l), 4);
    const unitCost = toDecimal(l.unitCost || 0);
    const taxRate = toDecimal(0, 4);
    const lineTotal = qty.mul(unitCost).toDecimalPlaces(2);
    return {
      businessId,
      productId: l.productId,
      description: l.description || null,
      qtyOrdered: qty,
      qtyReceived: toDecimal(0, 4),
      unitCost,
      taxRate,
      lineTotal,
      sortOrder: idx,
    };
  });
  const totals = recalcTotals(built);

  const purchaseOrder = await prisma.purchaseOrder.create({
    data: {
      businessId,
      vendorId: input.vendorId,
      number,
      status: "draft",
      notes: input.notes || null,
      expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      total: totals.total,
      createdByUserId: userId,
      items: { create: built },
    },
    include: {
      vendor: { select: { id: true, name: true } },
      items: { include: { product: { select: { id: true, sku: true, name: true } } } },
    },
  });

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "create",
    entityType: "purchase_order",
    entityId: purchaseOrder.id,
    metadata: { number },
  }).catch(() => {});

  return { purchaseOrder };
}

export async function sendPurchaseOrder(userId: string, id: string) {
  const { businessId } = await assertErpAccess(userId);
  const po = await prisma.purchaseOrder.findFirst({ where: { id, businessId } });
  if (!po) throw new Error("Purchase order not found");
  if (po.status !== "draft") throw new Error("Only draft purchase orders can be sent");
  const purchaseOrder = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "sent" },
    include: { vendor: { select: { id: true, name: true } }, items: true },
  });
  return { purchaseOrder };
}

export async function cancelPurchaseOrder(userId: string, id: string) {
  const { businessId } = await assertErpAccess(userId);
  const po = await prisma.purchaseOrder.findFirst({ where: { id, businessId } });
  if (!po) throw new Error("Purchase order not found");
  if (["received", "cancelled", "closed"].includes(po.status)) {
    throw new Error("Purchase order cannot be cancelled in its current status");
  }
  const purchaseOrder = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "cancelled" },
  });
  return { purchaseOrder };
}

export async function listGoodsReceipts(userId: string) {
  const { businessId } = await assertErpAccess(userId);
  const goodsReceipts = await prisma.goodsReceipt.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    include: {
      warehouse: { select: { id: true, code: true, name: true } },
      purchaseOrder: { select: { id: true, number: true, status: true } },
      items: { include: { product: { select: { id: true, sku: true, name: true } } } },
    },
    take: 200,
  });
  return { goodsReceipts };
}

/** Create GRN draft from remaining PO quantities */
export async function createGoodsReceipt(
  userId: string,
  input: { purchaseOrderId: string; warehouseId: string; notes?: string }
) {
  const { businessId } = await assertErpAccess(userId);
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: input.purchaseOrderId, businessId },
    include: { items: true },
  });
  if (!po) throw new Error("Purchase order not found");
  if (["cancelled", "closed"].includes(po.status)) {
    throw new Error("Cannot receive against a cancelled/closed PO");
  }
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: input.warehouseId, businessId, isActive: true },
  });
  if (!warehouse) throw new Error("Warehouse not found");

  const remaining = po.items
    .map((it) => {
      const left = toDecimal(it.qtyOrdered, 4).sub(toDecimal(it.qtyReceived, 4));
      return { item: it, left };
    })
    .filter((x) => x.left.gt(0));
  if (!remaining.length) throw new Error("Nothing left to receive on this PO");

  const number = await nextErpDocumentNumber(businessId, "GRN");
  const goodsReceipt = await prisma.goodsReceipt.create({
    data: {
      businessId,
      purchaseOrderId: po.id,
      warehouseId: warehouse.id,
      number,
      status: "draft",
      notes: input.notes || null,
      createdByUserId: userId,
      items: {
        create: remaining.map((r) => ({
          businessId,
          purchaseOrderItemId: r.item.id,
          productId: r.item.productId,
          qtyReceived: r.left,
          unitCost: r.item.unitCost,
        })),
      },
    },
    include: {
      warehouse: { select: { id: true, code: true, name: true } },
      purchaseOrder: { select: { id: true, number: true } },
      items: true,
    },
  });
  return { goodsReceipt };
}

export async function postGoodsReceipt(userId: string, id: string) {
  const { businessId } = await assertErpAccess(userId);

  const result = await prisma.$transaction(async (tx) => {
    // Atomic claim — prevents concurrent double-post increasing stock twice
    const claimed = await tx.goodsReceipt.updateMany({
      where: { id, businessId, status: "draft" },
      data: { status: "posting" },
    });
    if (claimed.count === 0) {
      const existing = await tx.goodsReceipt.findFirst({ where: { id, businessId } });
      if (!existing) throw new Error("Goods receipt not found");
      if (existing.status === "posted") throw new Error("Goods receipt already posted");
      if (existing.status === "cancelled") throw new Error("Goods receipt is cancelled");
      throw new Error("Goods receipt is not in draft status");
    }

    const grn = await tx.goodsReceipt.findFirst({
      where: { id, businessId },
      include: { items: true, purchaseOrder: { include: { items: true } } },
    });
    if (!grn) throw new Error("Goods receipt not found");

    for (const line of grn.items) {
      const product = await tx.product.findFirst({
        where: { id: line.productId, businessId, deletedAt: null },
      });
      if (!product) throw new Error("Product not found on receipt line");
      if (product.trackInventory && product.type !== "service") {
        await applyStockMovement(
          {
            businessId,
            productId: line.productId,
            warehouseId: grn.warehouseId,
            type: "purchase_in",
            qty: toDecimal(line.qtyReceived, 4).toNumber(),
            unitCost: toDecimal(line.unitCost).toNumber(),
            referenceType: "goods_receipt",
            referenceId: grn.id,
            notes: `GRN ${grn.number}`,
            createdByUserId: userId,
          },
          tx
        );
      }

      const poItem = await tx.purchaseOrderItem.findFirst({
        where: { id: line.purchaseOrderItemId, businessId },
      });
      if (poItem) {
        const nextRecv = toDecimal(poItem.qtyReceived, 4).add(toDecimal(line.qtyReceived, 4));
        if (nextRecv.gt(toDecimal(poItem.qtyOrdered, 4).add(toDecimal("0.0001", 4)))) {
          throw new Error("Received quantity exceeds ordered quantity");
        }
        await tx.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: { qtyReceived: nextRecv },
        });
      }
    }

    const poItems = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId: grn.purchaseOrderId, businessId },
    });
    const allReceived = poItems.every((it) =>
      toDecimal(it.qtyReceived, 4).gte(toDecimal(it.qtyOrdered, 4))
    );
    const anyReceived = poItems.some((it) => toDecimal(it.qtyReceived, 4).gt(0));
    const poStatus = allReceived ? "received" : anyReceived ? "partial" : grn.purchaseOrder.status;

    await tx.purchaseOrder.update({
      where: { id: grn.purchaseOrderId },
      data: { status: poStatus },
    });

    return tx.goodsReceipt.update({
      where: { id: grn.id },
      data: { status: "posted", postedAt: new Date() },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        purchaseOrder: { select: { id: true, number: true, status: true } },
        items: true,
      },
    });
  });

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "post",
    entityType: "goods_receipt",
    entityId: id,
    metadata: { number: result.number },
  }).catch(() => {});

  return { goodsReceipt: result };
}

export async function listPurchaseReturns(userId: string) {
  const { businessId } = await assertErpAccess(userId);
  const purchaseReturns = await prisma.purchaseReturn.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    include: {
      vendor: { select: { id: true, name: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      items: { include: { product: { select: { id: true, sku: true, name: true } } } },
    },
    take: 200,
  });
  return { purchaseReturns };
}

export async function createPurchaseReturn(
  userId: string,
  input: {
    vendorId: string;
    warehouseId: string;
    reason?: string;
    purchaseOrderId?: string;
    goodsReceiptId?: string;
    items: LineInput[];
  }
) {
  const { businessId } = await assertErpAccess(userId);
  const vendor = await prisma.vendor.findFirst({
    where: { id: input.vendorId, businessId, deletedAt: null },
  });
  if (!vendor) throw new Error("Vendor not found");
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: input.warehouseId, businessId, isActive: true },
  });
  if (!warehouse) throw new Error("Warehouse not found");
  const rawItems = (input.items || []).filter((l) => l.productId && lineQty(l) > 0);
  if (!rawItems.length) throw new Error("At least one line item is required");

  const number = await nextErpDocumentNumber(businessId, "PR");
  const purchaseReturn = await prisma.purchaseReturn.create({
    data: {
      businessId,
      vendorId: input.vendorId,
      warehouseId: input.warehouseId,
      purchaseOrderId: input.purchaseOrderId || null,
      goodsReceiptId: input.goodsReceiptId || null,
      number,
      status: "draft",
      reason: input.reason || null,
      createdByUserId: userId,
      items: {
        create: rawItems.map((l) => ({
          businessId,
          productId: l.productId,
          qty: toDecimal(lineQty(l), 4),
          unitCost: toDecimal(l.unitCost || 0),
        })),
      },
    },
    include: {
      vendor: { select: { id: true, name: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      items: true,
    },
  });
  return { purchaseReturn };
}

export async function postPurchaseReturn(userId: string, id: string) {
  const { businessId } = await assertErpAccess(userId);

  const result = await prisma.$transaction(async (tx) => {
    // Atomic claim — prevents concurrent double-post decreasing stock twice
    const claimed = await tx.purchaseReturn.updateMany({
      where: { id, businessId, status: "draft" },
      data: { status: "posting" },
    });
    if (claimed.count === 0) {
      const existing = await tx.purchaseReturn.findFirst({ where: { id, businessId } });
      if (!existing) throw new Error("Purchase return not found");
      if (existing.status === "posted") throw new Error("Purchase return already posted");
      if (existing.status === "cancelled") throw new Error("Purchase return is cancelled");
      throw new Error("Purchase return is not in draft status");
    }

    const ret = await tx.purchaseReturn.findFirst({
      where: { id, businessId },
      include: { items: true },
    });
    if (!ret) throw new Error("Purchase return not found");

    for (const line of ret.items) {
      const product = await tx.product.findFirst({
        where: { id: line.productId, businessId, deletedAt: null },
      });
      if (!product) throw new Error("Product not found on return line");
      if (product.trackInventory && product.type !== "service") {
        const qtyOut = toDecimal(line.qty, 4).neg();
        await applyStockMovement(
          {
            businessId,
            productId: line.productId,
            warehouseId: ret.warehouseId,
            type: "return_out",
            qty: qtyOut.toNumber(),
            unitCost: toDecimal(line.unitCost).toNumber(),
            referenceType: "purchase_return",
            referenceId: ret.id,
            notes: `PR ${ret.number}`,
            createdByUserId: userId,
            allowNegative: false,
          },
          tx
        );
      }
    }

    return tx.purchaseReturn.update({
      where: { id: ret.id },
      data: { status: "posted", postedAt: new Date() },
      include: {
        vendor: { select: { id: true, name: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        items: true,
      },
    });
  });

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "post",
    entityType: "purchase_return",
    entityId: id,
    metadata: { number: result.number },
  }).catch(() => {});

  return { purchaseReturn: result };
}

export async function createManualStockMovement(
  userId: string,
  input: {
    productId: string;
    warehouseId: string;
    qty: number;
    type?: string;
    notes?: string;
    unitCost?: number;
  }
) {
  const { businessId } = await assertErpAccess(userId);
  const type = input.type === "opening" ? "opening" : "adjustment";
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty === 0) throw new Error("Quantity must be a non-zero number");

  const { movement, balance } = await applyStockMovement({
    businessId,
    productId: input.productId,
    warehouseId: input.warehouseId,
    type,
    qty,
    unitCost: input.unitCost,
    referenceType: "manual",
    notes: input.notes || null,
    createdByUserId: userId,
    // QA: never allow negative on-hand via manual movements
    allowNegative: false,
  });

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "stock_movement",
    entityType: "stock_movement",
    entityId: movement.id,
    metadata: { type, qty, productId: input.productId },
  }).catch(() => {});

  return { movement, balance };
}

export async function listInventory(userId: string, opts?: { warehouseId?: string; lowStockOnly?: boolean; search?: string }) {
  const { businessId } = await assertErpAccess(userId);
  const { listInventoryBalances, listStockMovements } = await import("./erp-stock.service.js");
  const [balances, movements] = await Promise.all([
    listInventoryBalances(businessId, opts),
    listStockMovements(businessId, { warehouseId: opts?.warehouseId, pageSize: 50 }),
  ]);
  return { balances, movements: movements.items, movementMeta: movements };
}
