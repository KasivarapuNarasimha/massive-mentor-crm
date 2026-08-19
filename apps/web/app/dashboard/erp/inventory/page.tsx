"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { useBusinessCurrency } from "@/lib/use-business-currency";
import { PageShell, PageHeader } from "@/components/ui/PageShell";
import { ERP_BTN, ERP_INPUT, listFrom, num } from "@/lib/erp";

type Product = { id: string; sku: string; name: string; unit?: string | null };
type Warehouse = { id: string; code: string; name: string };

type Balance = {
  id?: string;
  qtyOnHand: number | string;
  qtyReserved?: number | string;
  avgCost?: number | string | null;
  product?: Product & { reorderLevel?: number | string | null };
  warehouse?: Warehouse;
};

type Movement = {
  id: string;
  type: string;
  qty: number | string;
  notes?: string | null;
  createdAt?: string;
  product?: Product;
  warehouse?: Warehouse;
};

export default function ErpInventoryPage() {
  const { token } = useAuth();
  const { money } = useBusinessCurrency();
  const [balances, setBalances] = useState<Balance[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    productId: "",
    warehouseId: "",
    qty: "",
    type: "adjustment",
    notes: "",
  });

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const [bRes, mRes, pRes, wRes] = await Promise.all([
      api.get<unknown>("/erp/inventory", token),
      api.get<unknown>("/erp/stock-movements", token),
      api.get<unknown>("/erp/products", token),
      api.get<unknown>("/erp/warehouses", token),
    ]);
    if (bRes.success) {
      setBalances(listFrom<Balance>(bRes.data, "balances", "inventory", "items"));
    } else {
      toast.error(bRes.error || "Unable to load inventory");
      setBalances([]);
    }
    if (mRes.success) {
      setMovements(listFrom<Movement>(mRes.data, "movements", "stockMovements", "items"));
    } else {
      setMovements([]);
    }
    if (pRes.success) setProducts(listFrom<Product>(pRes.data, "products", "items"));
    if (wRes.success) setWarehouses(listFrom<Warehouse>(wRes.data, "warehouses", "items"));
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const adjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const qty = Number(form.qty);
    if (!form.productId || !form.warehouseId || !Number.isFinite(qty) || qty === 0) {
      toast.error("Product, warehouse, and a non-zero signed qty are required");
      return;
    }
    setSaving(true);
    const res = await api.post(
      "/erp/stock-movements",
      {
        productId: form.productId,
        warehouseId: form.warehouseId,
        qty,
        type: form.type,
        notes: form.notes.trim() || undefined,
      },
      token
    );
    setSaving(false);
    if (res.success) {
      toast.success("Stock movement recorded");
      setForm({ ...form, qty: "", notes: "" });
      void load();
    } else toast.error(res.error || "Failed to record movement");
  };

  return (
    <PageShell wide>
      <PageHeader
        eyebrow="ERP"
        title="Inventory"
        description="On-hand balances, stock ledger, and manual opening/adjustment entries."
      />

      <form
        onSubmit={adjust}
        className="rounded-2xl border border-border/80 bg-card/60 p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
      >
        <h2 className="sm:col-span-2 lg:col-span-3 text-sm font-semibold">Manual adjustment</h2>
        <select
          className={ERP_INPUT}
          required
          value={form.productId}
          onChange={(e) => setForm({ ...form, productId: e.target.value })}
        >
          <option value="">Product</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} · {p.name}
            </option>
          ))}
        </select>
        <select
          className={ERP_INPUT}
          required
          value={form.warehouseId}
          onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
        >
          <option value="">Warehouse</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} · {w.name}
            </option>
          ))}
        </select>
        <input
          className={ERP_INPUT}
          type="number"
          step="0.0001"
          placeholder="Qty (signed, e.g. 10 or -2)"
          required
          value={form.qty}
          onChange={(e) => setForm({ ...form, qty: e.target.value })}
        />
        <select
          className={ERP_INPUT}
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
        >
          <option value="opening">Opening</option>
          <option value="adjustment">Adjustment</option>
        </select>
        <input
          className={`${ERP_INPUT} sm:col-span-2 lg:col-span-2`}
          placeholder="Notes"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        <button type="submit" disabled={saving} className={`${ERP_BTN} sm:col-span-2 lg:col-span-3`}>
          {saving ? "Posting…" : "Post movement"}
        </button>
      </form>

      <div className="mt-6 rounded-2xl border border-border/80 bg-card/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/70">
          <h2 className="text-sm font-semibold">Balances</h2>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading inventory…</div>
        ) : balances.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No inventory balances yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 font-medium">Warehouse</th>
                  <th className="px-4 py-2 font-medium text-right">On hand</th>
                  <th className="px-4 py-2 font-medium text-right">Reserved</th>
                  <th className="px-4 py-2 font-medium text-right">Avg cost</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b, i) => {
                  const onHand = num(b.qtyOnHand);
                  const reorder = b.product?.reorderLevel != null ? num(b.product.reorderLevel) : null;
                  const low = reorder != null && onHand <= reorder;
                  return (
                    <tr
                      key={b.id || `${b.product?.id}-${b.warehouse?.id}-${i}`}
                      className="border-t border-border/60"
                    >
                      <td className="px-4 py-2">
                        <div className="font-medium">{b.product?.name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{b.product?.sku}</div>
                      </td>
                      <td className="px-4 py-2">
                        {b.warehouse?.name || "—"}{" "}
                        <span className="text-xs text-muted-foreground">{b.warehouse?.code}</span>
                      </td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums ${low ? "text-amber-300 font-semibold" : ""}`}
                      >
                        {onHand}
                        {low ? <span className="ml-1 text-[10px] uppercase">low</span> : null}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{num(b.qtyReserved)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {b.avgCost != null ? money(num(b.avgCost)) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-border/80 bg-card/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/70">
          <h2 className="text-sm font-semibold">Stock movements</h2>
        </div>
        {movements.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No movements yet.</div>
        ) : (
          <div className="divide-y divide-border/60">
            {movements.map((m) => (
              <div key={m.id} className="px-4 py-3 flex flex-wrap justify-between gap-2 text-sm">
                <div>
                  <div className="font-medium">
                    {m.product?.sku || ""} {m.product?.name || "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {m.warehouse?.code || m.warehouse?.name || "—"} · {m.type}
                    {m.createdAt ? ` · ${new Date(m.createdAt).toLocaleString()}` : ""}
                  </div>
                  {m.notes ? <div className="text-xs text-muted-foreground mt-0.5">{m.notes}</div> : null}
                </div>
                <span
                  className={`font-semibold tabular-nums ${num(m.qty) < 0 ? "text-red-300" : "text-emerald-400"}`}
                >
                  {num(m.qty) > 0 ? "+" : ""}
                  {num(m.qty)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
