"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { PageShell, PageHeader } from "@/components/ui/PageShell";
import { ERP_BTN, ERP_BTN_GHOST, ERP_INPUT, listFrom } from "@/lib/erp";

type Warehouse = {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
};

const emptyForm = { code: "", name: "", address: "", isDefault: false };

export default function ErpWarehousesPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await api.get<unknown>("/erp/warehouses", token);
    if (res.success) {
      setRows(listFrom<Warehouse>(res.data, "warehouses", "items"));
    } else {
      toast.error(res.error || "Unable to load warehouses");
      setRows([]);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    const res = await api.post(
      "/erp/warehouses",
      {
        code: form.code.trim(),
        name: form.name.trim(),
        address: form.address.trim() || undefined,
        isDefault: form.isDefault,
      },
      token
    );
    setSaving(false);
    if (res.success) {
      toast.success("Warehouse created");
      setForm(emptyForm);
      void load();
    } else toast.error(res.error || "Failed to create warehouse");
  };

  const setDefault = async (id: string) => {
    if (!token) return;
    const res = await api.put(`/erp/warehouses/${id}`, { isDefault: true }, token);
    if (res.success) {
      toast.success("Default warehouse updated");
      void load();
    } else toast.error(res.error || "Failed to set default");
  };

  return (
    <PageShell wide>
      <PageHeader
        eyebrow="ERP"
        title="Warehouses"
        description="Stock locations. One warehouse can be marked as the default."
      />

      <form
        onSubmit={create}
        className="rounded-2xl border border-border/80 bg-card/60 p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        <h2 className="sm:col-span-2 text-sm font-semibold">New warehouse</h2>
        <input
          className={ERP_INPUT}
          placeholder="Code (e.g. MAIN)"
          required
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
        />
        <input
          className={ERP_INPUT}
          placeholder="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          className={`${ERP_INPUT} sm:col-span-2`}
          placeholder="Address (optional)"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
          />
          Set as default
        </label>
        <button type="submit" disabled={saving} className={`${ERP_BTN} sm:col-span-2`}>
          {saving ? "Saving…" : "Create warehouse"}
        </button>
      </form>

      <div className="mt-6 space-y-2">
        {loading ? (
          <div className="rounded-2xl border border-border/60 bg-muted/30 p-6 text-sm text-muted-foreground">
            Loading warehouses…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card/50 p-6 text-sm text-muted-foreground">
            No warehouses yet.
          </div>
        ) : (
          rows.map((w) => (
            <div
              key={w.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card/60 p-4"
            >
              <div className="min-w-0">
                <div className="font-medium">
                  {w.name}{" "}
                  <span className="text-xs text-muted-foreground tabular-nums">({w.code})</span>
                </div>
                {w.address ? (
                  <div className="text-xs text-muted-foreground mt-0.5">{w.address}</div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {w.isDefault ? (
                  <span className="text-xs px-2 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                    Default
                  </span>
                ) : (
                  <button type="button" className={ERP_BTN_GHOST} onClick={() => setDefault(w.id)}>
                    Set default
                  </button>
                )}
                {w.isActive === false ? (
                  <span className="text-xs text-muted-foreground">Inactive</span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </PageShell>
  );
}
