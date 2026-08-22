"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { useBusinessCurrency } from "@/lib/use-business-currency";
import { PageShell, PageHeader, ResponsiveModal } from "@/components/ui/PageShell";
import { ERP_BTN, ERP_BTN_GHOST, ERP_INPUT, listFrom, num } from "@/lib/erp";

type Category = {
  id: string;
  name: string;
  isActive?: boolean;
};

type Product = {
  id: string;
  sku: string;
  name: string;
  unit?: string | null;
  type?: string | null;
  trackInventory?: boolean;
  sellingPrice?: number | string | null;
  costPrice?: number | string | null;
  categoryId?: string | null;
  category?: { id: string; name: string } | null;
  isActive?: boolean;
  _count?: { movements?: number } | null;
};

type ProductForm = {
  sku: string;
  name: string;
  unit: string;
  type: string;
  sellingPrice: string;
  costPrice: string;
  categoryId: string;
  trackInventory: boolean;
};

const emptyForm: ProductForm = {
  sku: "",
  name: "",
  unit: "pcs",
  type: "goods",
  sellingPrice: "",
  costPrice: "",
  categoryId: "",
  trackInventory: true,
};

function productToForm(p: Product): ProductForm {
  return {
    sku: p.sku || "",
    name: p.name || "",
    unit: p.unit || "pcs",
    type: p.type === "service" ? "service" : "goods",
    sellingPrice: p.sellingPrice != null && p.sellingPrice !== "" ? String(p.sellingPrice) : "",
    costPrice: p.costPrice != null && p.costPrice !== "" ? String(p.costPrice) : "",
    categoryId: p.categoryId || p.category?.id || "",
    trackInventory: p.type === "service" ? false : p.trackInventory !== false,
  };
}

function hasStockMovements(p: Product | null): boolean {
  return (p?._count?.movements ?? 0) > 0;
}

function payloadFromForm(form: ProductForm) {
  return {
    sku: form.sku.trim(),
    name: form.name.trim(),
    unit: form.unit.trim() || "pcs",
    type: form.type,
    sellingPrice: form.sellingPrice === "" ? null : Number(form.sellingPrice),
    costPrice: form.costPrice === "" ? null : Number(form.costPrice),
    categoryId: form.categoryId || null,
    trackInventory: form.type === "service" ? false : form.trackInventory,
  };
}

export default function ErpProductsPage() {
  const { token } = useAuth();
  const { money } = useBusinessCurrency();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [catName, setCatName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState<ProductForm>(emptyForm);

  const inventoryFieldsLocked = hasStockMovements(editing);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [pRes, cRes] = await Promise.all([
        api.get<unknown>("/erp/products", token),
        api.get<unknown>("/erp/categories", token),
      ]);
      if (pRes.success) {
        setProducts(listFrom<Product>(pRes.data, "products", "items"));
      } else {
        toast.error(pRes.error || "Unable to load products");
        setProducts([]);
      }
      if (cRes.success) {
        setCategories(listFrom<Category>(cRes.data, "categories", "items"));
      } else {
        setCategories([]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const createCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !catName.trim()) return;
    setSaving(true);
    const res = await api.post("/erp/categories", { name: catName.trim() }, token);
    setSaving(false);
    if (res.success) {
      toast.success("Category created");
      setCatName("");
      void load();
    } else toast.error(res.error || "Failed to create category");
  };

  const createProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    const res = await api.post("/erp/products", payloadFromForm(form), token);
    setSaving(false);
    if (res.success) {
      toast.success("Product created");
      setForm(emptyForm);
      void load();
    } else toast.error(res.error || "Failed to create product");
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setEditForm(productToForm(p));
  };

  const closeEdit = () => {
    if (saving) return;
    setEditing(null);
    setEditForm(emptyForm);
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !editing) return;

    if (inventoryFieldsLocked) {
      const originalType = editing.type === "service" ? "service" : "goods";
      const originalTrack =
        editing.type === "service" ? false : editing.trackInventory !== false;
      const nextType = editForm.type === "service" ? "service" : "goods";
      const nextTrack = nextType === "service" ? false : editForm.trackInventory;
      if (nextType !== originalType) {
        toast.error(
          "Type cannot be changed after stock movements have been recorded"
        );
        return;
      }
      if (nextTrack !== originalTrack) {
        toast.error(
          "Track Inventory cannot be changed after stock movements have been recorded"
        );
        return;
      }
    }

    setSaving(true);
    const res = await api.put(`/erp/products/${editing.id}`, payloadFromForm(editForm), token);
    setSaving(false);
    if (res.success) {
      toast.success("Product updated");
      setEditing(null);
      setEditForm(emptyForm);
      void load();
    } else toast.error(res.error || "Failed to update product");
  };

  const renderFields = (
    values: ProductForm,
    setValues: (next: ProductForm) => void,
    opts?: { lockInventoryFields?: boolean }
  ) => {
    const lockInv = !!opts?.lockInventoryFields;
    return (
      <>
        <input
          className={ERP_INPUT}
          placeholder="SKU"
          required
          value={values.sku}
          onChange={(e) => setValues({ ...values, sku: e.target.value })}
        />
        <input
          className={ERP_INPUT}
          placeholder="Name"
          required
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
        />
        <input
          className={ERP_INPUT}
          placeholder="Unit (pcs, kg, hrs)"
          value={values.unit}
          onChange={(e) => setValues({ ...values, unit: e.target.value })}
        />
        <select
          className={ERP_INPUT}
          value={values.type}
          disabled={lockInv}
          onChange={(e) =>
            setValues({
              ...values,
              type: e.target.value,
              trackInventory: e.target.value === "service" ? false : values.trackInventory,
            })
          }
        >
          <option value="goods">Goods</option>
          <option value="service">Service</option>
        </select>
        <input
          className={ERP_INPUT}
          type="number"
          step="0.01"
          min="0"
          placeholder="Selling price"
          value={values.sellingPrice}
          onChange={(e) => setValues({ ...values, sellingPrice: e.target.value })}
        />
        <input
          className={ERP_INPUT}
          type="number"
          step="0.01"
          min="0"
          placeholder="Cost price"
          value={values.costPrice}
          onChange={(e) => setValues({ ...values, costPrice: e.target.value })}
        />
        <select
          className={ERP_INPUT}
          value={values.categoryId}
          onChange={(e) => setValues({ ...values, categoryId: e.target.value })}
        >
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={values.trackInventory && values.type !== "service"}
            disabled={values.type === "service" || lockInv}
            onChange={(e) => setValues({ ...values, trackInventory: e.target.checked })}
          />
          Track inventory
        </label>
      </>
    );
  };

  return (
    <PageShell wide>
      <PageHeader
        eyebrow="ERP"
        title="Products"
        description="Catalog items and categories. Services skip inventory tracking."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <form
          onSubmit={createProduct}
          className="rounded-2xl border border-border/80 bg-card/60 p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          <h2 className="sm:col-span-2 text-sm font-semibold">New product</h2>
          {renderFields(form, setForm)}
          <button type="submit" disabled={saving} className={`${ERP_BTN} sm:col-span-2`}>
            {saving && !editing ? "Saving…" : "Create product"}
          </button>
        </form>

        <form
          onSubmit={createCategory}
          className="rounded-2xl border border-border/80 bg-card/60 p-4 shadow-sm space-y-3"
        >
          <h2 className="text-sm font-semibold">Categories</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className={ERP_INPUT}
              placeholder="New category name"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
            />
            <button type="submit" disabled={saving || !catName.trim()} className={ERP_BTN}>
              Add
            </button>
          </div>
          <ul className="space-y-1.5 max-h-56 overflow-y-auto">
            {categories.length === 0 ? (
              <li className="text-sm text-muted-foreground">No categories yet.</li>
            ) : (
              categories.map((c) => (
                <li
                  key={c.id}
                  className="rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-sm"
                >
                  {c.name}
                </li>
              ))
            )}
          </ul>
        </form>
      </div>

      <div className="mt-6 rounded-2xl border border-border/80 bg-card/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/70">
          <h2 className="text-sm font-semibold">Product list</h2>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading products…</div>
        ) : products.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No products yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Unit</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium text-right">Sell</th>
                  <th className="px-4 py-2 font-medium text-right">Cost</th>
                  <th className="px-4 py-2 font-medium">Stock</th>
                  <th className="px-4 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-t border-border/60">
                    <td className="px-4 py-2 font-medium tabular-nums">{p.sku}</td>
                    <td className="px-4 py-2">{p.name}</td>
                    <td className="px-4 py-2 capitalize">{p.type || "goods"}</td>
                    <td className="px-4 py-2">{p.unit || "pcs"}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {p.category?.name || "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {p.sellingPrice != null ? money(num(p.sellingPrice)) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {p.costPrice != null ? money(num(p.costPrice)) : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {p.trackInventory === false || p.type === "service" ? "No" : "Yes"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        className={ERP_BTN_GHOST}
                        onClick={() => openEdit(p)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ResponsiveModal
        open={!!editing}
        onClose={closeEdit}
        title={editing ? `Edit product · ${editing.sku}` : "Edit product"}
        footer={
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <button type="button" className={ERP_BTN_GHOST} onClick={closeEdit} disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              form="erp-edit-product-form"
              disabled={saving}
              className={ERP_BTN}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        }
      >
        <form
          id="erp-edit-product-form"
          onSubmit={saveEdit}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {inventoryFieldsLocked ? (
            <p className="sm:col-span-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Type and Track Inventory are locked because this product already has stock
              movements.
            </p>
          ) : null}
          {renderFields(editForm, setEditForm, { lockInventoryFields: inventoryFieldsLocked })}
        </form>
      </ResponsiveModal>
    </PageShell>
  );
}
