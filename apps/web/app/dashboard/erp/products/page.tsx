"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { useBusinessCurrency } from "@/lib/use-business-currency";
import { PageShell, PageHeader } from "@/components/ui/PageShell";
import { ERP_BTN, ERP_INPUT, listFrom, num } from "@/lib/erp";

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
};

const emptyForm = {
  sku: "",
  name: "",
  unit: "pcs",
  type: "goods",
  sellingPrice: "",
  costPrice: "",
  categoryId: "",
  trackInventory: true,
};

export default function ErpProductsPage() {
  const { token } = useAuth();
  const { money } = useBusinessCurrency();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [catName, setCatName] = useState("");
  const [saving, setSaving] = useState(false);

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
    const res = await api.post(
      "/erp/products",
      {
        sku: form.sku.trim(),
        name: form.name.trim(),
        unit: form.unit.trim() || "pcs",
        type: form.type,
        sellingPrice: form.sellingPrice === "" ? undefined : Number(form.sellingPrice),
        costPrice: form.costPrice === "" ? undefined : Number(form.costPrice),
        categoryId: form.categoryId || undefined,
        trackInventory: form.type === "service" ? false : form.trackInventory,
      },
      token
    );
    setSaving(false);
    if (res.success) {
      toast.success("Product created");
      setForm(emptyForm);
      void load();
    } else toast.error(res.error || "Failed to create product");
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
          <input
            className={ERP_INPUT}
            placeholder="SKU"
            required
            value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
          />
          <input
            className={ERP_INPUT}
            placeholder="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className={ERP_INPUT}
            placeholder="Unit (pcs, kg, hrs)"
            value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}
          />
          <select
            className={ERP_INPUT}
            value={form.type}
            onChange={(e) =>
              setForm({
                ...form,
                type: e.target.value,
                trackInventory: e.target.value === "service" ? false : form.trackInventory,
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
            value={form.sellingPrice}
            onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
          />
          <input
            className={ERP_INPUT}
            type="number"
            step="0.01"
            min="0"
            placeholder="Cost price"
            value={form.costPrice}
            onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
          />
          <select
            className={ERP_INPUT}
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
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
              checked={form.trackInventory && form.type !== "service"}
              disabled={form.type === "service"}
              onChange={(e) => setForm({ ...form, trackInventory: e.target.checked })}
            />
            Track inventory
          </label>
          <button type="submit" disabled={saving} className={`${ERP_BTN} sm:col-span-2`}>
            {saving ? "Saving…" : "Create product"}
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  );
}
