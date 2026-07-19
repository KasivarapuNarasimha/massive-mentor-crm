"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PORTAL_TOKENS } from "@/lib/portal-config";
import { toast } from "sonner";
import { AdminDataTable, type AdminColumn } from "@/components/admin/AdminDataTable";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { exportCsv, exportExcelHtml, exportPdfPrint } from "@/lib/admin-export";
type Biz = {
  id: string;
  name: string;
  status: string;
  plan: string;
  planStatus: string;
  licenseStatus: string;
  ownerEmail: string;
  memberCount: number;
  contactCount: number;
  createdAt: string;
};

type BulkAction =
  | "suspend"
  | "activate"
  | "delete"
  | "change_plan"
  | "assign_license"
  | "send_email"
  | "send_notification"
  | "export";

export default function AdminBusinessesPage() {
  const [rows, setRows] = useState<Biz[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    companyName: "",
    ownerEmail: "",
    ownerName: "",
    ownerMobile: "",
    businessAddress: "",
    gstNumber: "",
    country: "IN",
    timezone: "Asia/Kolkata",
    currency: "INR",
    maxUsers: "5",
    notes: "",
  });
  const [confirm, setConfirm] = useState<{
    action: BulkAction;
    title: string;
    message: string;
    danger?: boolean;
  } | null>(null);
  const [bulkPlan, setBulkPlan] = useState("professional");
  const [bulkReason, setBulkReason] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [notifMsg, setNotifMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const token = () => localStorage.getItem(PORTAL_TOKENS.admin) || "";

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.platformListBusinesses(token(), { pageSize: 500 });
    if (res.success && res.data) {
      setRows(
        (res.data.businesses as Array<Record<string, unknown>>).map((b) => ({
          id: String(b.id),
          name: String(b.name || ""),
          status: String(b.status || ""),
          plan: String(b.plan || ""),
          planStatus: String(b.planStatus || ""),
          licenseStatus: String(b.licenseStatus || ""),
          ownerEmail: String((b.owner as { email?: string })?.email || b.billingEmail || "—"),
          memberCount: Number(b.memberCount || 0),
          contactCount: Number(b.contactCount || 0),
          createdAt: b.createdAt ? new Date(String(b.createdAt)).toLocaleDateString() : "—",
        }))
      );
    } else toast.error(res.error || "Failed to load");
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedCount = selected.size;
  const selectedNames = useMemo(
    () => rows.filter((r) => selected.has(r.id)).map((r) => r.name),
    [rows, selected]
  );

  const openBulk = (action: BulkAction) => {
    if (!selectedCount) {
      toast.error("Select at least one business");
      return;
    }
    const n = selectedCount;
    const map: Record<BulkAction, { title: string; message: string; danger?: boolean }> = {
      suspend: {
        title: "Bulk Suspend",
        message: `Are you sure you want to suspend ${n} business${n === 1 ? "" : "es"}?`,
        danger: true,
      },
      activate: {
        title: "Bulk Activate",
        message: `Are you sure you want to activate ${n} business${n === 1 ? "" : "es"}?`,
      },
      delete: {
        title: "Bulk Delete",
        message: `Are you sure you want to delete ${n} business${n === 1 ? "" : "es"}? This soft-deletes customer access.`,
        danger: true,
      },
      change_plan: {
        title: "Bulk Change Plan",
        message: `Are you sure you want to change the plan for ${n} business${n === 1 ? "" : "es"}?`,
      },
      assign_license: {
        title: "Bulk Assign License",
        message: `Are you sure you want to assign active licenses to ${n} business${n === 1 ? "" : "es"}?`,
      },
      send_email: {
        title: "Bulk Send Email",
        message: `Queue platform email to ${n} business${n === 1 ? "" : "es"}?`,
      },
      send_notification: {
        title: "Bulk Send Notification",
        message: `Queue notification for ${n} business${n === 1 ? "" : "es"}?`,
      },
      export: {
        title: "Bulk Export",
        message: `Export ${n} selected business${n === 1 ? "" : "es"} to CSV / Excel / PDF?`,
      },
    };
    setConfirm({ action, ...map[action] });
  };

  const runBulk = async () => {
    if (!confirm) return;
    const ids = [...selected];
    setBusy(true);

    if (confirm.action === "export") {
      const data = rows
        .filter((r) => selected.has(r.id))
        .map((r) => ({
          Name: r.name,
          Owner: r.ownerEmail,
          Plan: r.plan,
          Status: r.status,
          License: r.licenseStatus,
          Users: r.memberCount,
          Contacts: r.contactCount,
          Created: r.createdAt,
        }));
      exportCsv("businesses-bulk", data);
      exportExcelHtml("businesses-bulk", data);
      exportPdfPrint("Selected Businesses", data);
      toast.success(`Exported ${data.length} businesses`);
      setConfirm(null);
      setBusy(false);
      return;
    }

    const body: Record<string, unknown> = {
      businessIds: ids,
      action: confirm.action,
    };
    if (confirm.action === "change_plan") body.plan = bulkPlan;
    if (confirm.action === "suspend") body.reason = bulkReason || "Bulk suspend by Super Admin";
    if (confirm.action === "assign_license") body.licenseStatus = "active";
    if (confirm.action === "send_email") {
      body.emailSubject = emailSubject || "Message from Massive Mentor";
      body.emailBody = emailBody || "";
    }
    if (confirm.action === "send_notification") {
      body.notificationMessage = notifMsg || "Notification from Massive Mentor";
    }

    const res = await api.platformBulkAction(body, token());
    if (res.success && res.data) {
      toast.success(`${res.data.success} succeeded · ${res.data.failed} failed`);
      setSelected(new Set());
      await load();
    } else toast.error(res.error || "Bulk action failed");
    setConfirm(null);
    setBusy(false);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.ownerName.trim()) {
      toast.error("Owner name is required");
      return;
    }
    const res = await api.platformCreateBusiness(
      {
        companyName: form.companyName.trim(),
        ownerEmail: form.ownerEmail.trim(),
        ownerName: form.ownerName.trim(),
        ownerMobile: form.ownerMobile.trim() || undefined,
        businessAddress: form.businessAddress.trim() || undefined,
        gstNumber: form.gstNumber.trim() || undefined,
        country: form.country,
        timezone: form.timezone,
        currency: form.currency,
        maxUsers: Number(form.maxUsers) || 5,
        notes: form.notes.trim() || undefined,
      },
      token()
    );
    if (res.success && res.data) {
      const d = res.data as {
        owner?: { temporaryPassword?: string; email?: string };
        trial?: { endDate?: string };
        loginUrl?: string;
      };
      const pwd = d.owner?.temporaryPassword;
      toast.success(
        pwd
          ? `Customer created · temp password: ${pwd}`
          : "Customer workspace created · welcome email queued"
      );
      if (pwd) {
        try {
          await navigator.clipboard.writeText(
            `Login: ${d.loginUrl || ""}\nEmail: ${d.owner?.email}\nPassword: ${pwd}`
          );
          toast.message("Credentials copied to clipboard");
        } catch {
          /* ignore */
        }
      }
      setShowCreate(false);
      setForm({
        companyName: "",
        ownerEmail: "",
        ownerName: "",
        ownerMobile: "",
        businessAddress: "",
        gstNumber: "",
        country: "IN",
        timezone: "Asia/Kolkata",
        currency: "INR",
        maxUsers: "5",
        notes: "",
      });
      load();
    } else toast.error(res.error || "Failed");
  };

  const columns: AdminColumn<Biz>[] = [
    {
      key: "name",
      label: "Business",
      render: (r) => (
        <Link href={`/admin/businesses/${r.id}`} className="font-medium text-white hover:text-violet-300">
          {r.name}
        </Link>
      ),
    },
    { key: "ownerEmail", label: "Owner" },
    {
      key: "plan",
      label: "Plan",
      render: (r) => <span className="capitalize">{r.plan}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <StatusBadge value={r.status} />,
    },
    {
      key: "licenseStatus",
      label: "License",
      render: (r) => <StatusBadge value={r.licenseStatus} />,
    },
    {
      key: "memberCount",
      label: "Users",
      exportValue: (r) => r.memberCount,
    },
    {
      key: "contactCount",
      label: "Contacts",
      exportValue: (r) => r.contactCount,
    },
    { key: "createdAt", label: "Created" },
    {
      key: "actions",
      label: "Actions",
      sortable: false,
      filterable: false,
      hideable: false,
      render: (r) => (
        <Link
          href={`/admin/businesses/${r.id}`}
          className="text-xs px-3 py-1.5 rounded-lg bg-violet-500/20 text-violet-200 hover:bg-violet-500/30"
        >
          Manage
        </Link>
      ),
    },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Customer Management</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Multi-select bulk actions · enterprise table controls · never includes demo tenants.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="min-h-11 px-4 py-2 bg-violet-500 text-zinc-950 rounded-xl text-sm font-semibold"
        >
          {showCreate ? "Close" : "Create business"}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={create}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 grid sm:grid-cols-2 gap-3"
        >
          <p className="sm:col-span-2 text-xs text-zinc-500">
            Sales-led onboarding: creates business, owner, 3-day trial, and emails login credentials
            (password is auto-generated).
          </p>
          <input
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm min-h-11 text-white"
            placeholder="Company name *"
            required
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
          />
          <input
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm min-h-11 text-white"
            placeholder="Owner name *"
            required
            value={form.ownerName}
            onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
          />
          <input
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm min-h-11 text-white"
            placeholder="Owner email *"
            type="email"
            required
            value={form.ownerEmail}
            onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
          />
          <input
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm min-h-11 text-white"
            placeholder="Owner mobile"
            value={form.ownerMobile}
            onChange={(e) => setForm({ ...form, ownerMobile: e.target.value })}
          />
          <input
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm min-h-11 text-white sm:col-span-2"
            placeholder="Business address"
            value={form.businessAddress}
            onChange={(e) => setForm({ ...form, businessAddress: e.target.value })}
          />
          <input
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm min-h-11 text-white"
            placeholder="GST number (optional)"
            value={form.gstNumber}
            onChange={(e) => setForm({ ...form, gstNumber: e.target.value })}
          />
          <input
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm min-h-11 text-white"
            placeholder="Country"
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
          />
          <input
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm min-h-11 text-white"
            placeholder="Timezone"
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          />
          <select
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm min-h-11 text-white"
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
          >
            {["INR", "USD", "EUR", "GBP", "AED"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm min-h-11 text-white"
            placeholder="Max users"
            type="number"
            min={1}
            value={form.maxUsers}
            onChange={(e) => setForm({ ...form, maxUsers: e.target.value })}
          />
          <textarea
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white sm:col-span-2 min-h-[80px]"
            placeholder="Internal notes (optional)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <button type="submit" className="sm:col-span-2 min-h-11 bg-white text-zinc-950 rounded-xl font-medium">
            Create customer + start 3-day trial
          </button>
        </form>
      )}

      {/* Bulk action bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 flex flex-wrap gap-2">
        {(
          [
            ["suspend", "Bulk Suspend"],
            ["activate", "Bulk Activate"],
            ["delete", "Bulk Delete"],
            ["change_plan", "Bulk Change Plan"],
            ["assign_license", "Bulk Assign License"],
            ["send_email", "Bulk Send Email"],
            ["send_notification", "Bulk Notification"],
            ["export", "Bulk Export"],
          ] as const
        ).map(([action, label]) => (
          <button
            key={action}
            type="button"
            onClick={() => openBulk(action)}
            disabled={!selectedCount}
            className="min-h-10 px-3 rounded-xl text-xs font-medium bg-white/10 hover:bg-white/15 disabled:opacity-40"
          >
            {label}
          </button>
        ))}
        <span className="text-xs text-zinc-500 self-center ml-auto">
          {selectedCount ? `${selectedCount} selected` : "Select rows to enable bulk actions"}
        </span>
      </div>

      {loading ? (
        <div className="h-48 bg-zinc-900 rounded-2xl animate-pulse" />
      ) : (
        <AdminDataTable
          rows={rows}
          columns={columns}
          searchKeys={["name", "ownerEmail", "plan", "status"]}
          selectable
          selectedIds={selected}
          onSelectionChange={setSelected}
          exportName="customers"
          emptyMessage="No customer businesses found."
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title || ""}
        message={confirm?.message || ""}
        danger={confirm?.danger}
        busy={busy}
        confirmLabel="Yes, continue"
        onCancel={() => setConfirm(null)}
        onConfirm={runBulk}
      >
        {selectedNames.length > 0 && (
          <div className="text-xs text-zinc-500 max-h-24 overflow-auto">
            {selectedNames.slice(0, 12).join(", ")}
            {selectedNames.length > 12 ? ` +${selectedNames.length - 12} more` : ""}
          </div>
        )}
        {confirm?.action === "change_plan" && (
          <select
            value={bulkPlan}
            onChange={(e) => setBulkPlan(e.target.value)}
            className="w-full mt-2 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white"
          >
            <option value="trial">Trial</option>
            <option value="basic">Basic</option>
            <option value="professional">Professional</option>
            <option value="enterprise">Enterprise</option>
          </select>
        )}
        {confirm?.action === "suspend" && (
          <input
            value={bulkReason}
            onChange={(e) => setBulkReason(e.target.value)}
            placeholder="Reason (optional)"
            className="w-full mt-2 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white"
          />
        )}
        {confirm?.action === "send_email" && (
          <div className="space-y-2 mt-2">
            <input
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Email subject"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white"
            />
            <textarea
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              placeholder="Email body"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm text-white min-h-[80px]"
            />
          </div>
        )}
        {confirm?.action === "send_notification" && (
          <textarea
            value={notifMsg}
            onChange={(e) => setNotifMsg(e.target.value)}
            placeholder="Notification message"
            className="w-full mt-2 bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm text-white min-h-[80px]"
          />
        )}
      </ConfirmDialog>
    </div>
  );
}
