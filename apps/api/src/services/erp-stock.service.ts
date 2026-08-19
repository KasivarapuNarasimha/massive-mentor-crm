/**
 * StockMovement = source of truth.
 * InventoryBalance updated in the same transaction.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { toDecimal, toMoneyNumber } from "../lib/money.js";

export type StockMovementType =
  | "purchase_in"
  | "sale_out"
  | "adjustment"
  | "transfer_in"
  | "transfer_out"
  | "return_in"
  | "return_out"
  | "opening";

export type ApplyStockMovementInput = {
  businessId: string;
  productId: string;
  warehouseId: string;
  type: StockMovementType;
  /** Signed qty: + in, − out */
  qty: number | string;
  unitCost?: number | string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  createdByUserId: string;
  /** If false (default), outbound cannot drive qtyOnHand below 0 */
  allowNegative?: boolean;
};

function asQty(v: number | string): Prisma.Decimal {
  const d = toDecimal(v, 4);
  if (d.isZero()) throw new Error("Stock movement quantity cannot be zero");
  return d;
}

export async function applyStockMovement(
  input: ApplyStockMovementInput,
  tx?: Prisma.TransactionClient
) {
  const run = async (client: Prisma.TransactionClient) => {
    const businessId = input.businessId;
    if (!businessId) {
      throw new Error("Business workspace is required for stock movements");
    }

    const product = await client.product.findFirst({
      where: { id: input.productId, businessId, deletedAt: null },
    });
    if (!product) throw new Error("Product not found");
    if (!product.trackInventory || product.type === "service") {
      throw new Error("This product does not track inventory");
    }

    const warehouse = await client.warehouse.findFirst({
      where: { id: input.warehouseId, businessId, isActive: true },
    });
    if (!warehouse) throw new Error("Warehouse not found or inactive");

    const qty = asQty(input.qty);
    const unitCost =
      input.unitCost != null && input.unitCost !== ""
        ? toDecimal(input.unitCost, 4)
        : null;

    let balance = await client.inventoryBalance.findUnique({
      where: {
        businessId_productId_warehouseId: {
          businessId,
          productId: input.productId,
          warehouseId: input.warehouseId,
        },
      },
    });

    const current = balance ? toDecimal(balance.qtyOnHand, 4) : toDecimal(0, 4);
    const next = current.add(qty);
    if (!input.allowNegative && next.lt(0)) {
      throw new Error(
        `Insufficient stock for ${product.sku} in warehouse ${warehouse.code} (on hand ${toMoneyNumber(current)}, movement ${toMoneyNumber(qty)})`
      );
    }

    const movement = await client.stockMovement.create({
      data: {
        businessId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        type: input.type,
        qty,
        unitCost,
        referenceType: input.referenceType || null,
        referenceId: input.referenceId || null,
        notes: input.notes || null,
        createdByUserId: input.createdByUserId,
      },
    });

    if (balance) {
      balance = await client.inventoryBalance.update({
        where: { id: balance.id },
        data: {
          qtyOnHand: next,
          ...(unitCost && qty.gt(0)
            ? {
                avgCost: (() => {
                  const prevAvg = balance!.avgCost
                    ? toDecimal(balance!.avgCost, 4)
                    : unitCost;
                  const prevQty = current;
                  if (prevQty.lte(0)) return unitCost;
                  const totalCost = prevQty.mul(prevAvg).add(qty.mul(unitCost));
                  return totalCost.div(next).toDecimalPlaces(4);
                })(),
              }
            : {}),
        },
      });
    } else {
      balance = await client.inventoryBalance.create({
        data: {
          businessId,
          productId: input.productId,
          warehouseId: input.warehouseId,
          qtyOnHand: next,
          qtyReserved: toDecimal(0, 4),
          avgCost: unitCost,
        },
      });
    }

    return { movement, balance };
  };

  if (tx) return run(tx);
  return prisma.$transaction(run, { maxWait: 10_000, timeout: 30_000 });
}

export async function listStockMovements(
  businessId: string,
  opts?: {
    productId?: string;
    warehouseId?: string;
    page?: number;
    pageSize?: number;
  }
) {
  const page = opts?.page && opts.page > 0 ? opts.page : 1;
  const pageSize = Math.min(100, opts?.pageSize || 25);
  const where: Prisma.StockMovementWhereInput = { businessId };
  if (opts?.productId) where.productId = opts.productId;
  if (opts?.warehouseId) where.warehouseId = opts.warehouseId;

  const [total, items] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true } },
        warehouse: { select: { id: true, code: true, name: true } },
      },
    }),
  ]);
  return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) || 1 };
}

export async function listInventoryBalances(
  businessId: string,
  opts?: { warehouseId?: string; lowStockOnly?: boolean; search?: string }
) {
  const where: Prisma.InventoryBalanceWhereInput = { businessId };
  if (opts?.warehouseId) where.warehouseId = opts.warehouseId;
  if (opts?.search) {
    where.product = {
      OR: [
        { name: { contains: opts.search, mode: "insensitive" } },
        { sku: { contains: opts.search, mode: "insensitive" } },
      ],
      deletedAt: null,
    };
  } else {
    where.product = { deletedAt: null };
  }

  const items = await prisma.inventoryBalance.findMany({
    where,
    orderBy: [{ product: { name: "asc" } }],
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          reorderLevel: true,
          trackInventory: true,
        },
      },
      warehouse: { select: { id: true, code: true, name: true } },
    },
    take: 500,
  });

  if (opts?.lowStockOnly) {
    return items.filter((b) => {
      const reorder = b.product.reorderLevel;
      if (reorder == null) return false;
      return toDecimal(b.qtyOnHand, 4).lte(toDecimal(reorder, 4));
    });
  }
  return items;
}
