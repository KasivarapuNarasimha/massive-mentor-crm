/**
 * ERP dashboard — Finance KPIs + Phase 2 ops widgets.
 * Does not duplicate Invoice/Expense/Payment CRUD.
 */
import { prisma } from "../lib/prisma.js";
import { getFinanceDashboard } from "./finance.service.js";
import { getUserBusinessId } from "./field-engine.service.js";
import { toDecimal } from "../lib/money.js";

export async function getErpDashboard(userId: string) {
  const finance = await getFinanceDashboard(userId);
  const businessId = await getUserBusinessId(userId);

  let productCount = 0;
  let vendorCount = 0;
  let openPurchaseOrders = 0;
  let lowStockCount = 0;
  let warehouseCount = 0;

  if (businessId) {
    try {
      const [products, vendors, openPos, warehouses, balances] = await Promise.all([
        prisma.product.count({ where: { businessId, deletedAt: null, isActive: true } }),
        prisma.vendor.count({ where: { businessId, deletedAt: null, isActive: true } }),
        prisma.purchaseOrder.count({
          where: { businessId, status: { in: ["draft", "sent", "partial"] } },
        }),
        prisma.warehouse.count({ where: { businessId, isActive: true } }),
        prisma.inventoryBalance.findMany({
          where: {
            businessId,
            product: { deletedAt: null, reorderLevel: { not: null } },
          },
          include: { product: { select: { reorderLevel: true } } },
          take: 500,
        }),
      ]);
      productCount = products;
      vendorCount = vendors;
      openPurchaseOrders = openPos;
      warehouseCount = warehouses;
      lowStockCount = balances.filter((b) => {
        const reorder = b.product.reorderLevel;
        if (reorder == null) return false;
        return toDecimal(b.qtyOnHand, 4).lte(toDecimal(reorder, 4));
      }).length;
    } catch (e) {
      console.warn("[erp.dashboard] widget counts failed", e);
    }
  }

  return {
    module: "erp",
    ...finance,
    productCount,
    vendorCount,
    openPurchaseOrders,
    lowStockCount,
    warehouseCount,
  };
}
