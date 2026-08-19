-- Phase 2.5 Sales Orders — additive only (local / future prod after approval)
-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "dealId" TEXT,
    "contactId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "invoiceId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT,
    "qtyOrdered" DECIMAL(18,4) NOT NULL,
    "qtyFulfilled" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "taxRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesOrder_businessId_status_idx" ON "SalesOrder"("businessId", "status");
CREATE INDEX "SalesOrder_businessId_dealId_idx" ON "SalesOrder"("businessId", "dealId");
CREATE INDEX "SalesOrder_businessId_contactId_idx" ON "SalesOrder"("businessId", "contactId");
CREATE INDEX "SalesOrder_warehouseId_idx" ON "SalesOrder"("warehouseId");
CREATE INDEX "SalesOrder_invoiceId_idx" ON "SalesOrder"("invoiceId");
CREATE UNIQUE INDEX "SalesOrder_businessId_number_key" ON "SalesOrder"("businessId", "number");
CREATE INDEX "SalesOrderItem_salesOrderId_idx" ON "SalesOrderItem"("salesOrderId");
CREATE INDEX "SalesOrderItem_businessId_productId_idx" ON "SalesOrderItem"("businessId", "productId");

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
