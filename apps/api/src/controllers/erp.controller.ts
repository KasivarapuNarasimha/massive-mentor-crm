import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.js";
import * as erp from "../services/erp.service.js";
import * as catalog from "../services/erp-catalog.service.js";
import * as purchase from "../services/erp-purchase.service.js";
import * as sales from "../services/erp-sales.service.js";
import { messageToHttpStatus, errorMessage } from "../utils/http-status.js";

function q(req: AuthenticatedRequest, key: string) {
  const v = req.query[key];
  if (v == null) return undefined;
  return Array.isArray(v) ? String(v[0]) : String(v);
}

function paramId(req: AuthenticatedRequest): string {
  const id = req.params.id;
  return Array.isArray(id) ? String(id[0]) : String(id);
}

function sendError(res: Response, e: unknown, fallback: string) {
  const message = errorMessage(e, fallback);
  const status = messageToHttpStatus(message, { defaultStatus: 500 });
  res.status(status).json({
    success: false,
    error: status === 500 ? fallback : message,
  });
}

export async function dashboard(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await erp.getErpDashboard(req.user.id);
    res.json({ success: true, data });
  } catch (e: unknown) {
    sendError(res, e, "Failed to load ERP dashboard");
  }
}

// —— Products / categories ——
export async function listProducts(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await catalog.listProducts(req.user.id, { search: q(req, "search") });
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to list products");
  }
}

export async function createProduct(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await catalog.createProduct(req.user.id, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to create product");
  }
}

export async function updateProduct(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await catalog.updateProduct(req.user.id, paramId(req), req.body || {});
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to update product");
  }
}

export async function deleteProduct(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await catalog.deleteProduct(req.user.id, paramId(req));
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to delete product");
  }
}

export async function listCategories(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await catalog.listCategories(req.user.id);
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to list categories");
  }
}

export async function createCategory(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await catalog.createCategory(req.user.id, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to create category");
  }
}

export async function updateCategory(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await catalog.updateCategory(req.user.id, paramId(req), req.body || {});
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to update category");
  }
}

export async function deleteCategory(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await catalog.deleteCategory(req.user.id, paramId(req));
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to delete category");
  }
}

// —— Warehouses / inventory ——
export async function listWarehouses(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await catalog.listWarehouses(req.user.id);
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to list warehouses");
  }
}

export async function createWarehouse(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await catalog.createWarehouse(req.user.id, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to create warehouse");
  }
}

export async function updateWarehouse(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await catalog.updateWarehouse(req.user.id, paramId(req), req.body || {});
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to update warehouse");
  }
}

export async function listInventory(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await purchase.listInventory(req.user.id, {
      warehouseId: q(req, "warehouseId"),
      search: q(req, "search"),
      lowStockOnly: q(req, "lowStockOnly") === "1" || q(req, "lowStockOnly") === "true",
    });
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to list inventory");
  }
}

export async function listStockMovements(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const { businessId } = await (await import("../services/erp-access.service.js")).assertErpAccess(
      req.user.id
    );
    const stock = await import("../services/erp-stock.service.js");
    const data = await stock.listStockMovements(businessId, {
      productId: q(req, "productId"),
      warehouseId: q(req, "warehouseId"),
      page: q(req, "page") ? parseInt(q(req, "page")!, 10) : 1,
      pageSize: q(req, "pageSize") ? parseInt(q(req, "pageSize")!, 10) : 25,
    });
    res.json({ success: true, data: { movements: data.items, ...data } });
  } catch (e) {
    sendError(res, e, "Failed to list stock movements");
  }
}

export async function createStockMovement(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await purchase.createManualStockMovement(req.user.id, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to record stock movement");
  }
}

// —— Vendors ——
export async function listVendors(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await catalog.listVendors(req.user.id, { search: q(req, "search") });
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to list vendors");
  }
}

export async function createVendor(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await catalog.createVendor(req.user.id, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to create vendor");
  }
}

export async function updateVendor(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await catalog.updateVendor(req.user.id, paramId(req), req.body || {});
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to update vendor");
  }
}

export async function deleteVendor(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await catalog.deleteVendor(req.user.id, paramId(req));
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to delete vendor");
  }
}

// —— Purchases ——
export async function listPurchaseOrders(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await purchase.listPurchaseOrders(req.user.id);
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to list purchase orders");
  }
}

export async function createPurchaseOrder(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await purchase.createPurchaseOrder(req.user.id, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to create purchase order");
  }
}

export async function sendPurchaseOrder(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await purchase.sendPurchaseOrder(req.user.id, paramId(req));
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to send purchase order");
  }
}

export async function cancelPurchaseOrder(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await purchase.cancelPurchaseOrder(req.user.id, paramId(req));
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to cancel purchase order");
  }
}

export async function listGoodsReceipts(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await purchase.listGoodsReceipts(req.user.id);
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to list goods receipts");
  }
}

export async function createGoodsReceipt(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await purchase.createGoodsReceipt(req.user.id, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to create goods receipt");
  }
}

export async function postGoodsReceipt(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await purchase.postGoodsReceipt(req.user.id, paramId(req));
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to post goods receipt");
  }
}

export async function listPurchaseReturns(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await purchase.listPurchaseReturns(req.user.id);
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to list purchase returns");
  }
}

export async function createPurchaseReturn(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await purchase.createPurchaseReturn(req.user.id, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to create purchase return");
  }
}

export async function postPurchaseReturn(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await purchase.postPurchaseReturn(req.user.id, paramId(req));
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to post purchase return");
  }
}

// —— Sales Orders (Phase 2.5) ——
export async function listSalesOrders(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await sales.listSalesOrders(req.user.id);
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to list sales orders");
  }
}

export async function getSalesOrder(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await sales.getSalesOrder(req.user.id, paramId(req));
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to get sales order");
  }
}

export async function createSalesOrder(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await sales.createSalesOrder(req.user.id, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to create sales order");
  }
}

export async function updateSalesOrder(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await sales.updateSalesOrder(req.user.id, paramId(req), req.body || {});
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to update sales order");
  }
}

export async function confirmSalesOrder(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await sales.confirmSalesOrder(req.user.id, paramId(req));
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to confirm sales order");
  }
}

export async function cancelSalesOrder(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await sales.cancelSalesOrder(req.user.id, paramId(req));
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to cancel sales order");
  }
}

export async function postSalesOrder(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await sales.postSalesOrder(req.user.id, paramId(req));
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to post sales order");
  }
}

export async function dealSalesOrderPrefill(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: "Not authenticated" });
    const data = await sales.getDealSalesOrderPrefill(req.user.id, paramId(req));
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e, "Failed to load deal prefill");
  }
}
