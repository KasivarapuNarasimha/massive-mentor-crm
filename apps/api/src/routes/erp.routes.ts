import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import * as ctrl from "../controllers/erp.controller.js";

const router: Router = Router();

const erpDash = requireModule("erp", "finance", "approvals");
const erpOps = requireModule(
  "erp",
  "finance",
  "erp_products",
  "erp_inventory",
  "erp_vendors",
  "erp_purchases",
  "erp_sales"
);

router.get("/dashboard", requireAuth, erpDash, ctrl.dashboard);

router.get("/products", requireAuth, erpOps, ctrl.listProducts);
router.post("/products", requireAuth, erpOps, ctrl.createProduct);
router.put("/products/:id", requireAuth, erpOps, ctrl.updateProduct);
router.delete("/products/:id", requireAuth, erpOps, ctrl.deleteProduct);

router.get("/categories", requireAuth, erpOps, ctrl.listCategories);
router.post("/categories", requireAuth, erpOps, ctrl.createCategory);
router.put("/categories/:id", requireAuth, erpOps, ctrl.updateCategory);
router.delete("/categories/:id", requireAuth, erpOps, ctrl.deleteCategory);

router.get("/warehouses", requireAuth, erpOps, ctrl.listWarehouses);
router.post("/warehouses", requireAuth, erpOps, ctrl.createWarehouse);
router.put("/warehouses/:id", requireAuth, erpOps, ctrl.updateWarehouse);

router.get("/inventory", requireAuth, erpOps, ctrl.listInventory);
router.get("/stock-movements", requireAuth, erpOps, ctrl.listStockMovements);
router.post("/stock-movements", requireAuth, erpOps, ctrl.createStockMovement);

router.get("/vendors", requireAuth, erpOps, ctrl.listVendors);
router.post("/vendors", requireAuth, erpOps, ctrl.createVendor);
router.put("/vendors/:id", requireAuth, erpOps, ctrl.updateVendor);
router.delete("/vendors/:id", requireAuth, erpOps, ctrl.deleteVendor);

router.get("/purchase-orders", requireAuth, erpOps, ctrl.listPurchaseOrders);
router.post("/purchase-orders", requireAuth, erpOps, ctrl.createPurchaseOrder);
router.post("/purchase-orders/:id/send", requireAuth, erpOps, ctrl.sendPurchaseOrder);
router.post("/purchase-orders/:id/cancel", requireAuth, erpOps, ctrl.cancelPurchaseOrder);

router.get("/goods-receipts", requireAuth, erpOps, ctrl.listGoodsReceipts);
router.post("/goods-receipts", requireAuth, erpOps, ctrl.createGoodsReceipt);
router.post("/goods-receipts/:id/post", requireAuth, erpOps, ctrl.postGoodsReceipt);

router.get("/purchase-returns", requireAuth, erpOps, ctrl.listPurchaseReturns);
router.post("/purchase-returns", requireAuth, erpOps, ctrl.createPurchaseReturn);
router.post("/purchase-returns/:id/post", requireAuth, erpOps, ctrl.postPurchaseReturn);

router.get("/sales-orders", requireAuth, erpOps, ctrl.listSalesOrders);
router.post("/sales-orders", requireAuth, erpOps, ctrl.createSalesOrder);
router.get("/sales-orders/from-deal/:id", requireAuth, erpOps, ctrl.dealSalesOrderPrefill);
router.get("/sales-orders/:id", requireAuth, erpOps, ctrl.getSalesOrder);
router.put("/sales-orders/:id", requireAuth, erpOps, ctrl.updateSalesOrder);
router.post("/sales-orders/:id/confirm", requireAuth, erpOps, ctrl.confirmSalesOrder);
router.post("/sales-orders/:id/cancel", requireAuth, erpOps, ctrl.cancelSalesOrder);
router.post("/sales-orders/:id/post", requireAuth, erpOps, ctrl.postSalesOrder);

export default router;
