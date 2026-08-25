"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { api, API_BASE_URL } from "@/lib/api";
import { PageShell, PageHeader } from "@/components/ui/PageShell";
import { ERP_BTN, ERP_BTN_GHOST, ERP_INPUT, listFrom } from "@/lib/erp";

type Vendor = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  gstNumber?: string | null;
  address?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  isActive?: boolean;
};

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  company: "",
  gstNumber: "",
  address: "",
  paymentTerms: "",
  notes: "",
  isActive: true,
};

export default function ErpVendorsPage() {
  const { token } = useAuth();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await api.get<unknown>("/erp/vendors", token);
    if (res.success) {
      setVendors(listFrom<Vendor>(res.data, "vendors", "items"));
    } else {
      toast.error(res.error || "Unable to load vendors");
      setVendors([]);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (v: Vendor) => {
    setEditingId(v.id);
    setForm({
      name: v.name || "",
      email: v.email || "",
      phone: v.phone || "",
      company: v.company || "",
      gstNumber: v.gstNumber || "",
      address: v.address || "",
      paymentTerms: v.paymentTerms || "",
      notes: v.notes || "",
      isActive: v.isActive !== false,
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const body = {
      name: form.name.trim(),
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      company: form.company.trim() || undefined,
      gstNumber: form.gstNumber.trim() || undefined,
      address: form.address.trim() || undefined,
      paymentTerms: form.paymentTerms.trim() || undefined,
      notes: form.notes.trim() || undefined,
      isActive: form.isActive,
    };
    setSaving(true);
    const res = editingId
      ? await api.put(`/erp/vendors/${editingId}`, body, token)
      : await api.post("/erp/vendors", body, token);
    setSaving(false);
    if (res.success) {
      toast.success(editingId ? "Vendor updated" : "Vendor created");
      resetForm();
      void load();
    } else toast.error(res.error || "Failed to save vendor");
  };

  const remove = async (id: string) => {
    if (!token || !confirm("Delete this vendor?")) return;
    const r = await fetch(`${API_BASE_URL}/erp/vendors/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    let json: { success?: boolean; error?: string } = {};
    try {
      json = (await r.json()) as { success?: boolean; error?: string };
    } catch {
      json = {};
    }
    if (r.ok && json.success !== false) {
      toast.success("Vendor deleted");
      if (editingId === id) resetForm();
      void load();
    } else toast.error(json.error || "Failed to delete vendor");
  };

  return (
    <PageShell wide>
      <PageHeader
        eyebrow="ERP"
        title="Vendors"
        description="Supplier records used by purchase orders and returns."
      />

      <form
        onSubmit={save}
        className="mm-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        <h2 className="sm:col-span-2 text-sm font-semibold">
          {editingId ? "Edit vendor" : "New vendor"}
        </h2>
        <input
          className={ERP_INPUT}
          placeholder="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          className={ERP_INPUT}
          placeholder="Company"
          value={form.company}
          onChange={(e) => setForm({ ...form, company: e.target.value })}
        />
        <input
          className={ERP_INPUT}
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <input
          className={ERP_INPUT}
          placeholder="Phone"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        <input
          className={ERP_INPUT}
          placeholder="GST / tax number"
          value={form.gstNumber}
          onChange={(e) => setForm({ ...form, gstNumber: e.target.value })}
        />
        <input
          className={ERP_INPUT}
          placeholder="Payment terms"
          value={form.paymentTerms}
          onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
        />
        <input
          className={`${ERP_INPUT} sm:col-span-2`}
          placeholder="Address"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
        />
        <input
          className={`${ERP_INPUT} sm:col-span-2`}
          placeholder="Notes"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          Active
        </label>
        <div className="sm:col-span-2 flex flex-wrap gap-2">
          <button type="submit" disabled={saving} className={ERP_BTN}>
            {saving ? "Saving…" : editingId ? "Update vendor" : "Create vendor"}
          </button>
          {editingId ? (
            <button type="button" className={ERP_BTN_GHOST} onClick={resetForm}>
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>

      <div className="mt-6 space-y-2">
        {loading ? (
          <div className="rounded-lg border border-border bg-muted p-6 text-sm text-muted-foreground">
            Loading vendors…
          </div>
        ) : vendors.length === 0 ? (
          <div className="mm-card p-6 text-sm text-muted-foreground">
            No vendors yet.
          </div>
        ) : (
          vendors.map((v) => (
            <div
              key={v.id}
              className="flex flex-wrap items-start justify-between gap-3 mm-card p-4 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">
                  {v.name}
                  {v.isActive === false ? (
                    <span className="ml-2 text-xs text-muted-foreground">inactive</span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {[v.company, v.email, v.phone, v.gstNumber].filter(Boolean).join(" · ") || "—"}
                </div>
                {v.address ? (
                  <div className="text-xs text-muted-foreground mt-0.5">{v.address}</div>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button type="button" className={ERP_BTN_GHOST} onClick={() => startEdit(v)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="text-xs text-red-700 dark:text-red-400 px-2"
                  onClick={() => void remove(v.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </PageShell>
  );
}
