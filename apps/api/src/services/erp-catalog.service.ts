/**
 * ERP Products, Categories, Warehouses, Vendors.
 */
import { prisma } from "../lib/prisma.js";
import { toDecimal } from "../lib/money.js";
import { recordAudit } from "./audit.service.js";
import { assertErpAccess } from "./erp-access.service.js";

export async function listCategories(userId: string) {
  const { businessId } = await assertErpAccess(userId);
  const categories = await prisma.productCategory.findMany({
    where: { businessId, isActive: true },
    orderBy: { name: "asc" },
  });
  return { categories };
}

export async function createCategory(userId: string, input: { name: string; parentId?: string }) {
  const { businessId } = await assertErpAccess(userId);
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Category name is required");
  const category = await prisma.productCategory.create({
    data: {
      businessId,
      name,
      parentId: input.parentId || null,
    },
  });
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "create",
    entityType: "product_category",
    entityId: category.id,
    metadata: { name },
  }).catch(() => {});
  return { category };
}

export async function updateCategory(
  userId: string,
  id: string,
  input: { name?: string; isActive?: boolean; parentId?: string | null }
) {
  const { businessId } = await assertErpAccess(userId);
  const existing = await prisma.productCategory.findFirst({ where: { id, businessId } });
  if (!existing) throw new Error("Category not found");
  const category = await prisma.productCategory.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: String(input.name).trim() } : {}),
      ...(input.isActive !== undefined ? { isActive: !!input.isActive } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId || null } : {}),
    },
  });
  return { category };
}

export async function deleteCategory(userId: string, id: string) {
  const { businessId } = await assertErpAccess(userId);
  const existing = await prisma.productCategory.findFirst({ where: { id, businessId } });
  if (!existing) throw new Error("Category not found");
  await prisma.productCategory.update({
    where: { id },
    data: { isActive: false },
  });
  return { ok: true };
}

export async function listProducts(userId: string, opts?: { search?: string }) {
  const { businessId } = await assertErpAccess(userId);
  const where: Record<string, unknown> = { businessId, deletedAt: null };
  if (opts?.search) {
    where.OR = [
      { name: { contains: opts.search, mode: "insensitive" } },
      { sku: { contains: opts.search, mode: "insensitive" } },
    ];
  }
  const products = await prisma.product.findMany({
    where: where as never,
    orderBy: { name: "asc" },
    include: {
      category: { select: { id: true, name: true } },
      _count: { select: { movements: true } },
    },
    take: 500,
  });
  return { products };
}

export async function createProduct(
  userId: string,
  input: {
    sku: string;
    name: string;
    unit?: string;
    type?: string;
    trackInventory?: boolean;
    sellingPrice?: number;
    costPrice?: number;
    taxRate?: number;
    reorderLevel?: number;
    categoryId?: string;
    description?: string;
  }
) {
  const { businessId } = await assertErpAccess(userId);
  const sku = String(input.sku || "").trim();
  const name = String(input.name || "").trim();
  if (!sku) throw new Error("SKU is required");
  if (!name) throw new Error("Product name is required");
  const type = input.type === "service" ? "service" : "goods";
  const trackInventory = type === "service" ? false : input.trackInventory !== false;

  if (input.categoryId) {
    const cat = await prisma.productCategory.findFirst({
      where: { id: input.categoryId, businessId },
    });
    if (!cat) throw new Error("Category not found");
  }

  try {
    const product = await prisma.product.create({
      data: {
        businessId,
        sku,
        name,
        unit: String(input.unit || "pcs").trim() || "pcs",
        type,
        trackInventory,
        sellingPrice: input.sellingPrice != null ? toDecimal(input.sellingPrice) : null,
        costPrice: input.costPrice != null ? toDecimal(input.costPrice) : null,
        taxRate: input.taxRate != null ? toDecimal(input.taxRate, 4) : null,
        reorderLevel: input.reorderLevel != null ? toDecimal(input.reorderLevel, 4) : null,
        categoryId: input.categoryId || null,
        description: input.description || null,
        createdByUserId: userId,
      },
      include: { category: { select: { id: true, name: true } } },
    });
    await recordAudit({
      businessId,
      actorUserId: userId,
      action: "create",
      entityType: "product",
      entityId: product.id,
      metadata: { sku, name },
    }).catch(() => {});
    return { product };
  } catch (e: unknown) {
    if (String(e).includes("Unique constraint") || String((e as { code?: string })?.code) === "P2002") {
      throw new Error("SKU already exists for this business");
    }
    throw e;
  }
}

export async function updateProduct(
  userId: string,
  id: string,
  input: Record<string, unknown>
) {
  const { businessId } = await assertErpAccess(userId);
  const existing = await prisma.product.findFirst({
    where: { id, businessId, deletedAt: null },
  });
  if (!existing) throw new Error("Product not found");

  if (input.sku !== undefined) {
    const sku = String(input.sku).trim();
    if (!sku) throw new Error("SKU is required");
  }
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new Error("Product name is required");
  }

  if (input.categoryId) {
    const cat = await prisma.productCategory.findFirst({
      where: { id: String(input.categoryId), businessId },
    });
    if (!cat) throw new Error("Category not found");
  }

  const type =
    input.type !== undefined
      ? input.type === "service"
        ? "service"
        : "goods"
      : existing.type;
  const trackInventory =
    type === "service"
      ? false
      : input.trackInventory !== undefined
        ? !!input.trackInventory
        : existing.trackInventory;

  const typeChanging = type !== existing.type;
  const trackChanging = trackInventory !== existing.trackInventory;
  if (typeChanging || trackChanging) {
    const movementCount = await prisma.stockMovement.count({
      where: { productId: id, businessId },
    });
    if (movementCount > 0) {
      if (typeChanging) {
        throw new Error(
          "Invalid product update: type cannot be changed after stock movements have been recorded"
        );
      }
      throw new Error(
        "Invalid product update: Track Inventory cannot be changed after stock movements have been recorded"
      );
    }
  }

  try {
    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(input.sku !== undefined ? { sku: String(input.sku).trim() } : {}),
        ...(input.name !== undefined ? { name: String(input.name).trim() } : {}),
        ...(input.unit !== undefined ? { unit: String(input.unit).trim() || "pcs" } : {}),
        type,
        trackInventory,
        ...(input.sellingPrice !== undefined
          ? {
              sellingPrice:
                input.sellingPrice == null || input.sellingPrice === ""
                  ? null
                  : toDecimal(input.sellingPrice as number),
            }
          : {}),
        ...(input.costPrice !== undefined
          ? {
              costPrice:
                input.costPrice == null || input.costPrice === ""
                  ? null
                  : toDecimal(input.costPrice as number),
            }
          : {}),
        ...(input.categoryId !== undefined
          ? { categoryId: (input.categoryId as string) || null }
          : {}),
        ...(input.isActive !== undefined ? { isActive: !!input.isActive } : {}),
        ...(input.description !== undefined
          ? { description: (input.description as string) || null }
          : {}),
        ...(input.reorderLevel !== undefined
          ? {
              reorderLevel:
                input.reorderLevel == null || input.reorderLevel === ""
                  ? null
                  : toDecimal(input.reorderLevel as number, 4),
            }
          : {}),
      },
      include: {
        category: { select: { id: true, name: true } },
        _count: { select: { movements: true } },
      },
    });
    await recordAudit({
      businessId,
      actorUserId: userId,
      action: "update",
      entityType: "product",
      entityId: product.id,
      metadata: { sku: product.sku, name: product.name },
    }).catch(() => {});
    return { product };
  } catch (e: unknown) {
    if (String(e).includes("Unique constraint") || String((e as { code?: string })?.code) === "P2002") {
      throw new Error("SKU already exists for this business");
    }
    throw e;
  }
}

export async function deleteProduct(userId: string, id: string) {
  const { businessId } = await assertErpAccess(userId);
  const existing = await prisma.product.findFirst({
    where: { id, businessId, deletedAt: null },
  });
  if (!existing) throw new Error("Product not found");
  await prisma.product.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "delete",
    entityType: "product",
    entityId: id,
    metadata: { sku: existing.sku },
  }).catch(() => {});
  return { ok: true };
}

export async function listWarehouses(userId: string) {
  const { businessId } = await assertErpAccess(userId);
  const warehouses = await prisma.warehouse.findMany({
    where: { businessId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return { warehouses };
}

export async function createWarehouse(
  userId: string,
  input: { code: string; name: string; address?: string; isDefault?: boolean }
) {
  const { businessId } = await assertErpAccess(userId);
  const code = String(input.code || "").trim().toUpperCase();
  const name = String(input.name || "").trim();
  if (!code) throw new Error("Warehouse code is required");
  if (!name) throw new Error("Warehouse name is required");

  const warehouse = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.warehouse.updateMany({
        where: { businessId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const count = await tx.warehouse.count({ where: { businessId } });
    return tx.warehouse.create({
      data: {
        businessId,
        code,
        name,
        address: input.address || null,
        isDefault: input.isDefault || count === 0,
      },
    });
  });

  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "create",
    entityType: "warehouse",
    entityId: warehouse.id,
    metadata: { code, name },
  }).catch(() => {});
  return { warehouse };
}

export async function updateWarehouse(
  userId: string,
  id: string,
  input: { name?: string; address?: string; isDefault?: boolean; isActive?: boolean; code?: string }
) {
  const { businessId } = await assertErpAccess(userId);
  const existing = await prisma.warehouse.findFirst({ where: { id, businessId } });
  if (!existing) throw new Error("Warehouse not found");

  const warehouse = await prisma.$transaction(async (tx) => {
    if (input.isDefault === true) {
      await tx.warehouse.updateMany({
        where: { businessId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    return tx.warehouse.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: String(input.name).trim() } : {}),
        ...(input.code !== undefined ? { code: String(input.code).trim().toUpperCase() } : {}),
        ...(input.address !== undefined ? { address: input.address || null } : {}),
        ...(input.isDefault !== undefined ? { isDefault: !!input.isDefault } : {}),
        ...(input.isActive !== undefined ? { isActive: !!input.isActive } : {}),
      },
    });
  });
  return { warehouse };
}

export async function listVendors(userId: string, opts?: { search?: string }) {
  const { businessId } = await assertErpAccess(userId);
  const where: Record<string, unknown> = { businessId, deletedAt: null };
  if (opts?.search) {
    where.OR = [
      { name: { contains: opts.search, mode: "insensitive" } },
      { company: { contains: opts.search, mode: "insensitive" } },
      { email: { contains: opts.search, mode: "insensitive" } },
    ];
  }
  const vendors = await prisma.vendor.findMany({
    where: where as never,
    orderBy: { name: "asc" },
    take: 500,
  });
  return { vendors };
}

export async function createVendor(
  userId: string,
  input: {
    name: string;
    email?: string;
    phone?: string;
    company?: string;
    gstNumber?: string;
    address?: string;
    paymentTerms?: string;
    notes?: string;
  }
) {
  const { businessId } = await assertErpAccess(userId);
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Vendor name is required");
  const vendor = await prisma.vendor.create({
    data: {
      businessId,
      name,
      email: input.email || null,
      phone: input.phone || null,
      company: input.company || null,
      gstNumber: input.gstNumber || null,
      address: input.address || null,
      paymentTerms: input.paymentTerms || null,
      notes: input.notes || null,
      createdByUserId: userId,
    },
  });
  await recordAudit({
    businessId,
    actorUserId: userId,
    action: "create",
    entityType: "vendor",
    entityId: vendor.id,
    metadata: { name },
  }).catch(() => {});
  return { vendor };
}

export async function updateVendor(userId: string, id: string, input: Record<string, unknown>) {
  const { businessId } = await assertErpAccess(userId);
  const existing = await prisma.vendor.findFirst({
    where: { id, businessId, deletedAt: null },
  });
  if (!existing) throw new Error("Vendor not found");
  const vendor = await prisma.vendor.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: String(input.name).trim() } : {}),
      ...(input.email !== undefined ? { email: (input.email as string) || null } : {}),
      ...(input.phone !== undefined ? { phone: (input.phone as string) || null } : {}),
      ...(input.company !== undefined ? { company: (input.company as string) || null } : {}),
      ...(input.gstNumber !== undefined ? { gstNumber: (input.gstNumber as string) || null } : {}),
      ...(input.address !== undefined ? { address: (input.address as string) || null } : {}),
      ...(input.paymentTerms !== undefined
        ? { paymentTerms: (input.paymentTerms as string) || null }
        : {}),
      ...(input.notes !== undefined ? { notes: (input.notes as string) || null } : {}),
      ...(input.isActive !== undefined ? { isActive: !!input.isActive } : {}),
    },
  });
  return { vendor };
}

export async function deleteVendor(userId: string, id: string) {
  const { businessId } = await assertErpAccess(userId);
  const existing = await prisma.vendor.findFirst({
    where: { id, businessId, deletedAt: null },
  });
  if (!existing) throw new Error("Vendor not found");
  await prisma.vendor.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
  return { ok: true };
}
