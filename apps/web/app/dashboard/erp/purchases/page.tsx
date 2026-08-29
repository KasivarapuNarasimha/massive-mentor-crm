"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { useBusinessCurrency } from "@/lib/use-business-currency";
import { PageShell, PageHeader } from "@/components/ui/PageShell";
import { ERP_BTN, ERP_BTN_GHOST, ERP_INPUT, listFrom, num } from "@/lib/erp";

type Tab = "orders" | "receipts" | "returns";

type Vendor = { id: string; name: string };
type Product = { id: string; sku: string; name: string };
type Warehouse = { id: string; code: string; name: string };

type PoItem = {
  id?: string;
  productId?: string;
  qty?: number | string;
  qtyOrdered?: number | string;
  unitCost?: number | string;
  product?: Product;
};

type PurchaseOrder = {
  id: string;
  number?: string;
  status?: string;
  total?: number | string;
  orderDate?: string;
  vendor?: Vendor;
  vendorId?: string;
  items?: PoItem[];
};

type GoodsReceipt = {
  id: string;
  number?: string;
  status?: string;
  purchaseOrderId?: string;
  warehouse?: Warehouse;
  purchaseOrder?: { id: string; number?: string };
  createdAt?: string;
};

type PurchaseReturn = {
  id: string;
  number?: string;
  status?: string;
  vendor?: Vendor;
  warehouse?: Warehouse;
  createdAt?: string;
};

type Line = { key: string; productId: string; qty: string; unitCost: string };

let lineKeySeq = 0;
const emptyLine = (): Line => ({
  key: `line-${Date.now()}-${++lineKeySeq}`,
  productId: "",
  qty: "",
  unitCost: "",
});

export default function ErpPurchasesPage() {
  const { token } = useAuth();
  const { money } = useBusinessCurrency();
  const [tab, setTab] = useState<Tab>("orders");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [poVendorId, setPoVendorId] = useState("");
  const [poNotes, setPoNotes] = useState("");
  const [poLines, setPoLines] = useState<Line[]>([emptyLine()]);

  const [grnPoId, setGrnPoId] = useState("");
  const [grnWarehouseId, setGrnWarehouseId] = useState("");

  const [retVendorId, setRetVendorId] = useState("");
  const [retWarehouseId, setRetWarehouseId] = useState("");
  const [retReason, setRetReason] = useState("");
  const [retLines, setRetLines] = useState<Line[]>([emptyLine()]);

  const loadLookups = useCallback(async () => {
    if (!token) return;
    const [v, p, w] = await Promise.all([
      api.get<unknown>("/erp/vendors", token),
      api.get<unknown>("/erp/products", token),
      api.get<unknown>("/erp/warehouses", token),
    ]);
    if (v.success) setVendors(listFrom<Vendor>(v.data, "vendors", "items"));
    if (p.success) setProducts(listFrom<Product>(p.data, "products", "items"));
    if (w.success) setWarehouses(listFrom<Warehouse>(w.data, "warehouses", "items"));
  }, [token]);

  const loadOrders = useCallback(async () => {
    if (!token) return;
    const res = await api.get<unknown>("/erp/purchase-orders", token);
    if (res.success) setOrders(listFrom<PurchaseOrder>(res.data, "purchaseOrders", "orders", "items"));
    else toast.error(res.error || "Unable to load purchase orders");
  }, [token]);

  const loadReceipts = useCallback(async () => {
    if (!token) return;
    const res = await api.get<unknown>("/erp/goods-receipts", token);
    if (res.success) setReceipts(listFrom<GoodsReceipt>(res.data, "goodsReceipts", "receipts", "items"));
    else toast.error(res.error || "Unable to load receipts");
  }, [token]);

  const loadReturns = useCallback(async () => {
    if (!token) return;
    const res = await api.get<unknown>("/erp/purchase-returns", token);
    if (res.success) setReturns(listFrom<PurchaseReturn>(res.data, "purchaseReturns", "returns", "items"));
    else toast.error(res.error || "Unable to load returns");
  }, [token]);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const run = async () => {
      if (tab === "orders") await loadOrders();
      if (tab === "receipts") {
        await Promise.all([loadReceipts(), loadOrders()]);
      }
      if (tab === "returns") await loadReturns();
      setLoading(false);
    };
    void run();
  }, [tab, token, loadOrders, loadReceipts, loadReturns]);

  const validLines = (lines: Line[]) =>
    lines
      .filter((l) => l.productId && Number(l.qty) > 0)
      .map((l) => ({
        productId: l.productId,
        qty: Number(l.qty),
        qtyOrdered: Number(l.qty),
        unitCost: Number(l.unitCost || 0),
      }));

  const createPo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const items = validLines(poLines);
    if (!poVendorId || items.length === 0) {
      toast.error("Vendor and at least one line item are required");
      return;
    }
    setSaving(true);
    const res = await api.post(
      "/erp/purchase-orders",
      { vendorId: poVendorId, notes: poNotes.trim() || undefined, items },
      token
    );
    setSaving(false);
    if (res.success) {
      toast.success("Purchase order created");
      setPoVendorId("");
      setPoNotes("");
      setPoLines([emptyLine()]);
      void loadOrders();
    } else toast.error(res.error || "Failed to create PO");
  };

  const actPo = async (id: string, action: "send" | "cancel") => {
    if (!token) return;
    const res = await api.post(`/erp/purchase-orders/${id}/${action}`, {}, token);
    if (res.success) {
      toast.success(action === "send" ? "PO sent" : "PO cancelled");
      void loadOrders();
    } else toast.error(res.error || `Failed to ${action} PO`);
  };

  const createGrn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (!grnPoId || !grnWarehouseId) {
      toast.error("Purchase order and warehouse are required");
      return;
    }
    setSaving(true);
    const res = await api.post(
      "/erp/goods-receipts",
      { purchaseOrderId: grnPoId, warehouseId: grnWarehouseId },
      token
    );
    setSaving(false);
    if (res.success) {
      toast.success("Goods receipt created");
      setGrnPoId("");
      void loadReceipts();
    } else toast.error(res.error || "Failed to create receipt");
  };

  const postGrn = async (id: string) => {
    if (!token) return;
    const res = await api.post(`/erp/goods-receipts/${id}/post`, {}, token);
    if (res.success) {
      toast.success("Receipt posted");
      void loadReceipts();
    } else toast.error(res.error || "Failed to post receipt");
  };

  const createReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const items = validLines(retLines);
    if (!retVendorId || !retWarehouseId || items.length === 0) {
      toast.error("Vendor, warehouse, and at least one line are required");
      return;
    }
    setSaving(true);
    const res = await api.post(
      "/erp/purchase-returns",
      {
        vendorId: retVendorId,
        warehouseId: retWarehouseId,
        reason: retReason.trim() || undefined,
        items,
      },
      token
    );
    setSaving(false);
    if (res.success) {
      toast.success("Purchase return created");
      setRetVendorId("");
      setRetReason("");
      setRetLines([emptyLine()]);
      void loadReturns();
    } else toast.error(res.error || "Failed to create return");
  };

  const postReturn = async (id: string) => {
    if (!token) return;
    const res = await api.post(`/erp/purchase-returns/${id}/post`, {}, token);
    if (res.success) {
      toast.success("Return posted");
      void loadReturns();
    } else toast.error(res.error || "Failed to post return");
  };

  const updateLine = (
    lines: Line[],
    setLines: (next: Line[]) => void,
    key: string,
    patch: Partial<Omit<Line, "key">>
  ) => {
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (lines: Line[], setLines: (next: Line[]) => void, key: string) => {
    if (lines.length <= 1) return;
    setLines(lines.filter((l) => l.key !== key));
  };

  const lineEditor = (lines: Line[], setLines: (next: Line[]) => void) => (
    <div className="md:col-span-2 space-y-2">
      {lines.map((line) => (
        <div key={line.key} className="grid grid-cols-1 sm:grid-cols-8 gap-2 items-center">
          <select
            className={`${ERP_INPUT} sm:col-span-3`}
            value={line.productId}
            onChange={(e) => updateLine(lines, setLines, line.key, { productId: e.target.value })}
          >
            <option value="">Product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} · {p.name}
              </option>
            ))}
          </select>
          <input
            className={`${ERP_INPUT} md:col-span-2`}
            type="number"
            min="0"
            step="0.0001"
            placeholder="Qty"
            value={line.qty}
            onChange={(e) => updateLine(lines, setLines, line.key, { qty: e.target.value })}
          />
          <input
            className={`${ERP_INPUT} md:col-span-2`}
            type="number"
            min="0"
            step="0.01"
            placeholder="Unit cost"
            value={line.unitCost}
            onChange={(e) => updateLine(lines, setLines, line.key, { unitCost: e.target.value })}
          />
          <button
            type="button"
            className={`${ERP_BTN_GHOST} sm:col-span-1 text-red-300 border-red-500/30 disabled:opacity-40`}
            disabled={lines.length <= 1}
            title={
              lines.length <= 1
                ? "At least one line is required"
                : "Remove this line from the unsaved form"
            }
            aria-label="Remove line"
            onClick={() => removeLine(lines, setLines, line.key)}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className={ERP_BTN_GHOST}
        onClick={() => setLines([...lines, emptyLine()])}
      >
        Add line
      </button>
    </div>
  );

  const openPos = orders.filter((o) => {
    const s = (o.status || "").toLowerCase();
    return s === "sent" || s === "partial" || s === "draft" || s === "";
  });

  return (
    <PageShell wide>
      <PageHeader
        eyebrow="ERP"
        title="Purchases"
        description="Purchase orders, goods receipts, and vendor returns — not Finance invoices."
      />

      <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-2 mb-5">
        {(["orders", "receipts", "returns"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`min-h-9 px-4 py-2.5 rounded-md text-sm capitalize touch-manipulation ${
              tab === t
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border text-muted-foreground"
            }`}
          >
            {t === "orders" ? "Orders" : t === "receipts" ? "Receipts" : "Returns"}
          </button>
        ))}
      </div>

      {tab === "orders" && (
        <div className="space-y-4">
          <form
            onSubmit={createPo}
            className="mm-card p-4 grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4"
          >
            <h2 className="md:col-span-2 text-sm font-semibold">Create purchase order</h2>
            <select
              className={ERP_INPUT}
              required
              value={poVendorId}
              onChange={(e) => setPoVendorId(e.target.value)}
            >
              <option value="">Vendor</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <input
              className={ERP_INPUT}
              placeholder="Notes"
              value={poNotes}
              onChange={(e) => setPoNotes(e.target.value)}
            />
            {lineEditor(poLines, setPoLines)}
            <button type="submit" disabled={saving} className={`${ERP_BTN} md:col-span-2`}>
              {saving ? "Saving…" : "Create PO"}
            </button>
          </form>

          {loading ? (
            <div className="rounded-lg border border-border bg-muted p-6 text-sm text-muted-foreground">
              Loading orders…
            </div>
          ) : orders.length === 0 ? (
            <div className="mm-card p-6 text-sm text-muted-foreground">
              No purchase orders yet.
            </div>
          ) : (
            orders.map((o) => (
              <div
                key={o.id}
                className="mm-card p-4 flex flex-wrap justify-between gap-3 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {o.number || o.id} · {o.vendor?.name || "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {o.status || "draft"}
                    {o.orderDate ? ` · ${new Date(o.orderDate).toLocaleDateString()}` : ""}
                    {o.items?.length ? ` · ${o.items.length} lines` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">
                    {o.total != null ? money(num(o.total)) : "—"}
                  </span>
                  {(o.status || "draft") === "draft" ? (
                    <button type="button" className={ERP_BTN_GHOST} onClick={() => void actPo(o.id, "send")}>
                      Send
                    </button>
                  ) : null}
                  {["draft", "sent"].includes((o.status || "draft").toLowerCase()) ? (
                    <button
                      type="button"
                      className="text-xs text-red-700 dark:text-red-400 px-2"
                      onClick={() => void actPo(o.id, "cancel")}
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "receipts" && (
        <div className="space-y-4">
          <form
            onSubmit={createGrn}
            className="mm-card p-4 grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4"
          >
            <h2 className="md:col-span-2 text-sm font-semibold">Create goods receipt</h2>
            <select
              className={ERP_INPUT}
              required
              value={grnPoId}
              onChange={(e) => setGrnPoId(e.target.value)}
            >
              <option value="">Purchase order</option>
              {openPos.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.number || o.id} · {o.vendor?.name || ""}
                </option>
              ))}
            </select>
            <select
              className={ERP_INPUT}
              required
              value={grnWarehouseId}
              onChange={(e) => setGrnWarehouseId(e.target.value)}
            >
              <option value="">Warehouse</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </select>
            <button type="submit" disabled={saving} className={`${ERP_BTN} md:col-span-2`}>
              {saving ? "Saving…" : "Create GRN"}
            </button>
          </form>

          {loading ? (
            <div className="rounded-lg border border-border bg-muted p-6 text-sm text-muted-foreground">
              Loading receipts…
            </div>
          ) : receipts.length === 0 ? (
            <div className="mm-card p-6 text-sm text-muted-foreground">
              No goods receipts yet.
            </div>
          ) : (
            receipts.map((g) => (
              <div
                key={g.id}
                className="mm-card p-4 flex flex-wrap justify-between gap-3 text-sm"
              >
                <div>
                  <div className="font-medium">{g.number || g.id}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {g.status || "draft"} · PO {g.purchaseOrder?.number || g.purchaseOrderId || "—"} ·{" "}
                    {g.warehouse?.name || "—"}
                  </div>
                </div>
                {(g.status || "draft").toLowerCase() === "draft" ? (
                  <button type="button" className={ERP_BTN} onClick={() => void postGrn(g.id)}>
                    Post
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}

      {tab === "returns" && (
        <div className="space-y-4">
          <form
            onSubmit={createReturn}
            className="mm-card p-4 grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4"
          >
            <h2 className="md:col-span-2 text-sm font-semibold">Create purchase return</h2>
            <select
              className={ERP_INPUT}
              required
              value={retVendorId}
              onChange={(e) => setRetVendorId(e.target.value)}
            >
              <option value="">Vendor</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <select
              className={ERP_INPUT}
              required
              value={retWarehouseId}
              onChange={(e) => setRetWarehouseId(e.target.value)}
            >
              <option value="">Warehouse</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </select>
            <input
              className={`${ERP_INPUT} md:col-span-2`}
              placeholder="Reason"
              value={retReason}
              onChange={(e) => setRetReason(e.target.value)}
            />
            {lineEditor(retLines, setRetLines)}
            <button type="submit" disabled={saving} className={`${ERP_BTN} md:col-span-2`}>
              {saving ? "Saving…" : "Create return"}
            </button>
          </form>

          {loading ? (
            <div className="rounded-lg border border-border bg-muted p-6 text-sm text-muted-foreground">
              Loading returns…
            </div>
          ) : returns.length === 0 ? (
            <div className="mm-card p-6 text-sm text-muted-foreground">
              No purchase returns yet.
            </div>
          ) : (
            returns.map((r) => (
              <div
                key={r.id}
                className="mm-card p-4 flex flex-wrap justify-between gap-3 text-sm"
              >
                <div>
                  <div className="font-medium">{r.number || r.id}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {r.status || "draft"} · {r.vendor?.name || "—"} · {r.warehouse?.name || "—"}
                  </div>
                </div>
                {(r.status || "draft").toLowerCase() === "draft" ? (
                  <button type="button" className={ERP_BTN} onClick={() => void postReturn(r.id)}>
                    Post
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}
    </PageShell>
  );
}
