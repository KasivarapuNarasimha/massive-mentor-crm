"use client";

/**
 * ERP Sales Orders — Phase 2.5 local.
 * Deal → SO → Post → stock out + existing Invoice.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { useBusinessCurrency } from "@/lib/use-business-currency";
import { PageShell, PageHeader } from "@/components/ui/PageShell";
import { ERP_BTN, ERP_BTN_GHOST, ERP_INPUT, listFrom, num } from "@/lib/erp";

type Product = { id: string; sku: string; name: string; sellingPrice?: number | string | null };
type Warehouse = { id: string; code: string; name: string };
type Line = { productId: string; qty: string; unitPrice: string };

type SalesOrder = {
  id: string;
  number?: string;
  status?: string;
  total?: number | string;
  dealId?: string | null;
  contactId?: string | null;
  warehouse?: Warehouse;
  deal?: { id: string; title?: string } | null;
  invoice?: { id: string; number?: string; status?: string } | null;
  items?: Array<{
    productId?: string;
    qtyOrdered?: number | string;
    unitPrice?: number | string;
    product?: Product;
  }>;
};

const emptyLine = (): Line => ({ productId: "", qty: "", unitPrice: "" });

function ErpSalesOrdersPageInner() {
  const { token } = useAuth();
  const { money } = useBusinessCurrency();
  const searchParams = useSearchParams();
  const dealIdParam = searchParams.get("dealId") || "";

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [warehouseId, setWarehouseId] = useState("");
  const [dealId, setDealId] = useState(dealIdParam);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const [o, p, w] = await Promise.all([
      api.get<unknown>("/erp/sales-orders", token),
      api.get<unknown>("/erp/products", token),
      api.get<unknown>("/erp/warehouses", token),
    ]);
    if (o.success) setOrders(listFrom<SalesOrder>(o.data, "salesOrders", "items"));
    else toast.error(o.error || "Unable to load sales orders");
    if (p.success) setProducts(listFrom<Product>(p.data, "products", "items"));
    if (w.success) {
      const list = listFrom<Warehouse>(w.data, "warehouses", "items");
      setWarehouses(list);
      if (!warehouseId && list[0]) setWarehouseId(list[0].id);
    }
    setLoading(false);
  }, [token, warehouseId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token || !dealIdParam) return;
    setDealId(dealIdParam);
    void (async () => {
      const res = await api.get<{
        deal?: { id: string; title?: string; contactId?: string | null };
        warehouseId?: string | null;
      }>(`/erp/sales-orders/from-deal/${dealIdParam}`, token);
      if (res.success && res.data) {
        if (res.data.warehouseId) setWarehouseId(res.data.warehouseId);
        setNotes(`From deal: ${res.data.deal?.title || dealIdParam}`);
        toast.message("Prefill from Deal", {
          description: "Add products, then create the sales order.",
        });
      }
    })();
  }, [token, dealIdParam]);

  const validLines = useMemo(
    () =>
      lines
        .filter((l) => l.productId && Number(l.qty) > 0)
        .map((l) => ({
          productId: l.productId,
          qtyOrdered: Number(l.qty),
          unitPrice: Number(l.unitPrice || 0),
        })),
    [lines]
  );

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (!warehouseId || validLines.length === 0) {
      toast.error("Warehouse and at least one line are required");
      return;
    }
    setSaving(true);
    const res = await api.post(
      "/erp/sales-orders",
      {
        warehouseId,
        dealId: dealId.trim() || undefined,
        notes: notes.trim() || undefined,
        items: validLines,
      },
      token
    );
    setSaving(false);
    if (res.success) {
      toast.success("Sales order created");
      setLines([emptyLine()]);
      setNotes("");
      void load();
    } else toast.error(res.error || "Failed to create sales order");
  };

  const act = async (id: string, action: "confirm" | "cancel" | "post") => {
    if (!token) return;
    const res = await api.post(`/erp/sales-orders/${id}/${action}`, {}, token);
    if (res.success) {
      toast.success(
        action === "post"
          ? "Posted — stock deducted & invoice created"
          : action === "confirm"
            ? "Confirmed"
            : "Cancelled"
      );
      void load();
    } else toast.error(res.error || `Failed to ${action}`);
  };

  const onProductPick = (idx: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    setLines((prev) =>
      prev.map((l, i) =>
        i === idx
          ? {
              ...l,
              productId,
              unitPrice:
                l.unitPrice ||
                (p?.sellingPrice != null ? String(num(p.sellingPrice)) : l.unitPrice),
            }
          : l
      )
    );
  };

  return (
    <PageShell wide>
      <PageHeader
        eyebrow="ERP"
        title="Sales Orders"
        description="Fulfill CRM deals with products: post deducts stock and creates a Finance invoice (no duplicate Deal invoice when an SO is linked)."
        actions={
          <Link href="/dashboard/deals" className={ERP_BTN_GHOST}>
            ← Deals
          </Link>
        }
      />

      <form
        onSubmit={create}
        className="rounded-2xl border border-border/80 bg-card/60 p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6"
      >
        <h2 className="sm:col-span-2 lg:col-span-3 text-sm font-semibold">Create sales order</h2>
        <div>
          <label className="text-xs text-muted-foreground">Warehouse</label>
          <select
            className={ERP_INPUT}
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            required
          >
            <option value="">Select…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Deal ID (optional)</label>
          <input
            className={ERP_INPUT}
            value={dealId}
            onChange={(e) => setDealId(e.target.value)}
            placeholder="Link CRM deal"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Notes</label>
          <input className={ERP_INPUT} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="sm:col-span-2 lg:col-span-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Lines</p>
          {lines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                className={ERP_INPUT}
                value={line.productId}
                onChange={(e) => onProductPick(idx, e.target.value)}
              >
                <option value="">Product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </select>
              <input
                className={ERP_INPUT}
                type="number"
                min="0"
                step="any"
                placeholder="Qty"
                value={line.qty}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((l, i) => (i === idx ? { ...l, qty: e.target.value } : l))
                  )
                }
              />
              <input
                className={ERP_INPUT}
                type="number"
                min="0"
                step="any"
                placeholder="Unit price"
                value={line.unitPrice}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((l, i) => (i === idx ? { ...l, unitPrice: e.target.value } : l))
                  )
                }
              />
            </div>
          ))}
          <button
            type="button"
            className={ERP_BTN_GHOST}
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
          >
            + Line
          </button>
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <button type="submit" className={ERP_BTN} disabled={saving}>
            {saving ? "Saving…" : "Create draft"}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="rounded-2xl border border-border/80 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Deal</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Invoice</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-border/60">
                  <td className="px-3 py-2 font-medium">{o.number}</td>
                  <td className="px-3 py-2">{o.status}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {o.deal?.title || o.dealId || "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{money(num(o.total))}</td>
                  <td className="px-3 py-2">{o.invoice?.number || "—"}</td>
                  <td className="px-3 py-2 flex flex-wrap gap-1">
                    {(o.status === "draft") && (
                      <>
                        <button
                          type="button"
                          className={ERP_BTN_GHOST}
                          onClick={() => void act(o.id, "confirm")}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          className={ERP_BTN_GHOST}
                          onClick={() => void act(o.id, "cancel")}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {(o.status === "draft" || o.status === "confirmed") && (
                      <button
                        type="button"
                        className={ERP_BTN}
                        onClick={() => void act(o.id, "post")}
                      >
                        Post
                      </button>
                    )}
                    {o.status === "confirmed" && (
                      <button
                        type="button"
                        className={ERP_BTN_GHOST}
                        onClick={() => void act(o.id, "cancel")}
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!orders.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    No sales orders yet. Create a draft above, or open a Deal and click SO.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}

export default function ErpSalesOrdersPage() {
  return (
    <Suspense
      fallback={
        <PageShell wide>
          <p className="text-sm text-muted-foreground">Loading sales orders…</p>
        </PageShell>
      }
    >
      <ErpSalesOrdersPageInner />
    </Suspense>
  );
}
