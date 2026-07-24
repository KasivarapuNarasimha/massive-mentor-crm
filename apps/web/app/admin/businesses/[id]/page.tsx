"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { PORTAL_TOKENS, PORTAL_USER_KEYS } from "@/lib/portal-config";
import { toast } from "sonner";
import { KpiCard } from "@/components/admin/KpiCard";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { DeveloperRaw } from "@/components/admin/DeveloperRaw";
import { downloadBlob } from "@/lib/admin-export";
import { PasswordInput } from "@/components/ui/PasswordInput";

type Member = {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  isDisabled: boolean;
};

type BizDetail = {
  id: string;
  name: string;
  status: string;
  plan: string;
  planStatus: string;
  licenseKey?: string;
  licenseStatus: string;
  trialEndsAt?: string | null;
  subscriptionEndsAt?: string | null;
  trialDaysLeft?: number | null;
  billingEmail?: string | null;
  industry?: string;
  templateSlug?: string | null;
  phone?: string | null;
  createdAt: string;
  owner?: { id: string; email: string; name: string | null };
  members: Member[];
  stats: {
    leads: number;
    clients: number;
    deals: number;
    meetings: number;
    tasks: number;
    revenue: number;
    users: number;
    aiUsage: number;
    whatsapp: number;
    emailUsage: number;
    apiUsage: number;
  };
  whiteLabel?: Record<string, string> | null;
};

export default function AdminBusinessManagePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [biz, setBiz] = useState<BizDetail | null>(null);
  const [plan, setPlan] = useState("professional");
  const [supportReason, setSupportReason] = useState("");
  const [confirm, setConfirm] = useState<"suspend" | "activate" | "delete" | null>(null);
  const [addUser, setAddUser] = useState({ email: "", password: "", name: "", role: "sales_executive" });
  const [busy, setBusy] = useState(false);
  const [wl, setWl] = useState({ companyName: "", logoUrl: "", theme: "dark", customDomain: "" });

  const token = () => localStorage.getItem(PORTAL_TOKENS.admin) || "";

  const load = useCallback(async () => {
    if (!id) return;
    const res = await api.platformGetBusiness(id, token());
    if (res.success && res.data) {
      const d = res.data as unknown as BizDetail;
      setBiz(d);
      setPlan(String(d.plan || "trial"));
      const white = (d.whiteLabel || {}) as Record<string, string>;
      setWl({
        companyName: white.companyName || "",
        logoUrl: white.logoUrl || "",
        theme: white.theme || "dark",
        customDomain: white.customDomain || "",
      });
    } else toast.error(res.error || "Not found");
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const changePlan = async (action: "upgrade" | "downgrade" | "renew" | "activate") => {
    const res = await api.platformChangePlan(id, { action, plan, days: 30 }, token());
    if (res.success) {
      toast.success(`Plan ${action} complete`);
      load();
    } else toast.error(res.error || "Failed");
  };

  const runStatus = async () => {
    if (!confirm) return;
    setBusy(true);
    let res;
    if (confirm === "suspend") {
      res = await api.platformSuspendBusiness(id, "Suspended from manage page", token());
    } else if (confirm === "activate") {
      res = await api.platformActivateBusiness(id, token());
    } else {
      res = await api.platformDeleteBusiness(id, token());
    }
    if (res.success) {
      toast.success("Done");
      if (confirm === "delete") router.push("/admin/businesses");
      else load();
    } else toast.error(res.error || "Failed");
    setConfirm(null);
    setBusy(false);
  };

  const supportLogin = async () => {
    if (supportReason.trim().length < 5) {
      toast.error("Support reason required (min 5 chars, audited)");
      return;
    }
    const res = await api.platformSupportLoginAs(id, supportReason.trim(), token());
    if (res.success && res.data?.token) {
      localStorage.setItem(PORTAL_TOKENS.customer, res.data.token);
      localStorage.setItem(
        PORTAL_USER_KEYS.customer,
        JSON.stringify({ email: res.data.targetEmail, name: "Support Mode" })
      );
      toast.message("Support mode active", { description: res.data.warning });
      window.open("/dashboard", "_blank");
    } else toast.error(res.error || "Failed");
  };

  const exportData = async () => {
    const res = await api.platformExportBusiness(id, token());
    if (res.success && res.data) {
      downloadBlob(
        `business-${id}-export.json`,
        JSON.stringify(res.data, null, 2),
        "application/json"
      );
      toast.success("Business data exported");
    } else toast.error(res.error || "Export failed");
  };

  const backup = async () => {
    const res = await api.platformExportBusiness(id, token());
    if (res.success && res.data) {
      downloadBlob(
        `business-${id}-backup-${Date.now()}.json`,
        JSON.stringify({ type: "business_backup", ...res.data }, null, 2),
        "application/json"
      );
      toast.success("Backup file downloaded");
    } else toast.error(res.error || "Backup failed");
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await api.platformAddUser(id, addUser, token());
    if (res.success) {
      toast.success("User added");
      setAddUser({ email: "", password: "", name: "", role: "sales_executive" });
      load();
    } else toast.error(res.error || "Failed");
  };

  const toggleUser = async (userId: string, disabled: boolean) => {
    const res = await api.platformDisableUser(id, userId, !disabled, token());
    if (res.success) {
      toast.success(disabled ? "User enabled" : "User disabled");
      load();
    } else toast.error(res.error || "Failed");
  };

  const resetPw = async (userId: string) => {
    const password = prompt("New password (min 8 characters):");
    if (!password) return;
    const res = await api.platformResetUserPassword(id, userId, password, token());
    if (res.success) toast.success("Password reset");
    else toast.error(res.error || "Failed");
  };

  const saveWl = async () => {
    const res = await api.platformWhiteLabel(id, wl, token());
    if (res.success) toast.success("White label saved");
    else toast.error(res.error || "Failed");
  };

  if (!biz) {
    return <div className="h-48 max-w-6xl bg-card rounded-2xl animate-pulse" />;
  }

  const s = biz.stats || ({} as BizDetail["stats"]);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <button
        type="button"
        onClick={() => router.push("/admin/businesses")}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to customers
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold">{biz.name}</h1>
          <p className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-2 items-center">
            <StatusBadge value={biz.status} />
            <StatusBadge value={biz.plan} />
            <span>Business Management</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {biz.status === "active" ? (
            <button
              type="button"
              onClick={() => setConfirm("suspend")}
              className="min-h-10 px-3 rounded-xl text-xs bg-amber-500/20 text-amber-200"
            >
              Suspend
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm("activate")}
              className="min-h-10 px-3 rounded-xl text-xs bg-emerald-500/20 text-emerald-200"
            >
              Activate
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirm("delete")}
            className="min-h-10 px-3 rounded-xl text-xs bg-red-500/20 text-red-300"
          >
            Delete
          </button>
          <button type="button" onClick={exportData} className="min-h-10 px-3 rounded-xl text-xs bg-white/10">
            Export Data
          </button>
          <button type="button" onClick={backup} className="min-h-10 px-3 rounded-xl text-xs bg-white/10">
            Backup Business
          </button>
        </div>
      </div>

      {/* Business Info */}
      <section className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-semibold mb-4">Business Info</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          {[
            ["Business Name", biz.name],
            ["Owner", biz.owner?.name || "—"],
            ["Email", biz.owner?.email || biz.billingEmail || "—"],
            ["Phone", biz.phone || "—"],
            ["Industry", biz.industry || "—"],
            ["Business Type", biz.templateSlug || "generic"],
            ["Created", biz.createdAt ? new Date(biz.createdAt).toLocaleString() : "—"],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="text-foreground mt-0.5 break-all">{v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Subscription */}
      <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <h2 className="font-semibold">Subscription</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Current Plan" value={String(biz.plan)} tone="info" />
          <KpiCard
            label="Trial Days Left"
            value={biz.trialDaysLeft != null ? biz.trialDaysLeft : "—"}
            hint={biz.trialEndsAt ? new Date(biz.trialEndsAt).toLocaleDateString() : undefined}
          />
          <KpiCard
            label="Expiry"
            value={
              biz.subscriptionEndsAt
                ? new Date(biz.subscriptionEndsAt).toLocaleDateString()
                : biz.trialEndsAt
                  ? new Date(biz.trialEndsAt).toLocaleDateString()
                  : "—"
            }
          />
          <KpiCard label="License" value={biz.licenseStatus} />
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground min-h-11"
          >
            <option value="trial">Trial</option>
            <option value="basic">Basic</option>
            <option value="professional">Professional</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <button type="button" onClick={() => changePlan("upgrade")} className="min-h-11 px-4 bg-violet-500 text-white rounded-xl text-sm font-medium">
            Upgrade
          </button>
          <button type="button" onClick={() => changePlan("downgrade")} className="min-h-11 px-4 bg-white/10 rounded-xl text-sm">
            Downgrade
          </button>
          <button type="button" onClick={() => changePlan("renew")} className="min-h-11 px-4 bg-white/10 rounded-xl text-sm">
            Renew 30d
          </button>
        </div>
        {biz.licenseKey && (
          <p className="text-xs text-muted-foreground font-mono">License key: {biz.licenseKey}</p>
        )}
      </section>

      {/* CRM Stats */}
      <section>
        <h2 className="font-semibold mb-3">CRM Stats</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Leads" value={s.leads ?? 0} />
          <KpiCard label="Clients" value={s.clients ?? 0} />
          <KpiCard label="Deals" value={s.deals ?? 0} />
          <KpiCard label="Meetings" value={s.meetings ?? 0} />
          <KpiCard label="Tasks" value={s.tasks ?? 0} />
          <KpiCard label="Revenue" value={`₹${Number(s.revenue || 0).toLocaleString()}`} tone="success" />
        </div>
      </section>

      {/* AI / Channel usage */}
      <section>
        <h2 className="font-semibold mb-3">AI & Channel Usage</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="AI Requests" value={s.aiUsage ?? 0} tone="info" />
          <KpiCard label="WhatsApp Usage" value={s.whatsapp ?? 0} />
          <KpiCard label="Email Usage" value={s.emailUsage ?? 0} />
          <KpiCard label="API Usage" value={s.apiUsage ?? 0} />
        </div>
      </section>

      {/* Users */}
      <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <h2 className="font-semibold">Users</h2>
        <div className="space-y-2">
          {(biz.members || []).map((m) => (
            <div
              key={m.userId}
              className="flex flex-wrap items-center justify-between gap-2 bg-background border border-border rounded-xl p-3 text-sm"
            >
              <div>
                <div className="font-medium">{m.name || m.email}</div>
                <div className="text-xs text-muted-foreground">
                  {m.email} · {m.role} {m.isDisabled ? "· disabled" : ""}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => toggleUser(m.userId, m.isDisabled)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-white/10"
                >
                  {m.isDisabled ? "Enable" : "Disable"}
                </button>
                <button
                  type="button"
                  onClick={() => resetPw(m.userId)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-white/10"
                >
                  Reset Password
                </button>
              </div>
            </div>
          ))}
          {!biz.members?.length && <p className="text-sm text-muted-foreground">No members.</p>}
        </div>

        <form onSubmit={createUser} className="grid sm:grid-cols-2 gap-2 pt-2 border-t border-border">
          <h3 className="sm:col-span-2 text-sm font-medium text-muted-foreground">Add User</h3>
          <input
            required
            type="email"
            placeholder="Email"
            value={addUser.email}
            onChange={(e) => setAddUser({ ...addUser, email: e.target.value })}
            className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground"
          />
          <PasswordInput
            required
            minLength={8}
            placeholder="Password"
            autoComplete="new-password"
            value={addUser.password}
            onChange={(e) => setAddUser({ ...addUser, password: e.target.value })}
            className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground"
          />
          <input
            placeholder="Name"
            value={addUser.name}
            onChange={(e) => setAddUser({ ...addUser, name: e.target.value })}
            className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground"
          />
          <select
            value={addUser.role}
            onChange={(e) => setAddUser({ ...addUser, role: e.target.value })}
            className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground"
          >
            <option value="sales_executive">Sales Executive</option>
            <option value="sales_manager">Sales Manager</option>
            <option value="business_admin">Business Admin</option>
          </select>
          <button type="submit" className="sm:col-span-2 min-h-11 bg-primary text-primary-foreground rounded-xl text-sm font-medium">
            Add User
          </button>
        </form>
      </section>

      {/* White label */}
      <section className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <h2 className="font-semibold">White Label</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {(["companyName", "logoUrl", "theme", "customDomain"] as const).map((k) => (
            <input
              key={k}
              className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground"
              placeholder={k}
              value={wl[k]}
              onChange={(e) => setWl({ ...wl, [k]: e.target.value })}
            />
          ))}
        </div>
        <button type="button" onClick={saveWl} className="min-h-11 px-4 bg-primary text-primary-foreground rounded-xl text-sm font-medium">
          Save branding
        </button>
      </section>

      {/* Support mode */}
      <section className="bg-amber-950/30 border border-amber-900/40 rounded-2xl p-5 space-y-3">
        <h2 className="font-semibold text-amber-200">Login as Business (Support Mode)</h2>
        <p className="text-xs text-amber-200/70">
          Short-lived customer token. Fully audited. Legitimate support only.
        </p>
        <textarea
          value={supportReason}
          onChange={(e) => setSupportReason(e.target.value)}
          placeholder="Reason for support access (required)…"
          className="w-full bg-background border border-border rounded-xl p-3 text-sm text-foreground min-h-[80px]"
        />
        <button
          type="button"
          onClick={supportLogin}
          className="min-h-11 px-4 bg-amber-500 text-white rounded-xl text-sm font-semibold"
        >
          Open customer CRM
        </button>
      </section>

      <DeveloperRaw data={biz} />

      <ConfirmDialog
        open={!!confirm}
        title={
          confirm === "delete"
            ? "Delete business?"
            : confirm === "suspend"
              ? "Suspend business?"
              : "Activate business?"
        }
        message={
          confirm === "delete"
            ? `Are you sure you want to delete ${biz.name}? Customers will lose access.`
            : confirm === "suspend"
              ? `Are you sure you want to suspend ${biz.name}?`
              : `Are you sure you want to activate ${biz.name}?`
        }
        danger={confirm === "delete" || confirm === "suspend"}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={runStatus}
      />
    </div>
  );
}
