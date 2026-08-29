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
  modules?: string[];
  permissionTemplate?: string;
  permissionsCustomized?: boolean;
};

type CatalogModule = {
  key: string;
  label: string;
  category?: string | null;
  alwaysOn?: boolean;
};
type CatalogTemplate = { roleKey: string; label: string; modules: string[] };

type BizDetail = {
  id: string;
  name: string;
  status: string;
  plan: string;
  planStatus: string;
  isTrial?: boolean;
  isLocked?: boolean;
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
  moduleAccess?: { customized: boolean; enabled: string[] };
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
  subscriptionEvents?: Array<{
    id: string;
    action: string;
    fromPlan?: string | null;
    toPlan?: string | null;
    createdAt: string;
    metadata?: Record<string, unknown> | null;
  }>;
};

type HistoryRow = {
  id: string;
  action: string;
  previousPlan: string | null;
  newPlan: string | null;
  changedBy: string;
  changedByEmail: string | null;
  paymentId: string | null;
  date: string;
  reason: string | null;
  licenseStatus: string | null;
  expiryDate: string | null;
};

export default function AdminBusinessManagePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [biz, setBiz] = useState<BizDetail | null>(null);
  const [plan, setPlan] = useState("professional");
  const [planDays, setPlanDays] = useState(30);
  const [planReason, setPlanReason] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [supportReason, setSupportReason] = useState("");
  const [confirm, setConfirm] = useState<"suspend" | "activate" | "delete" | null>(null);
  const [addUser, setAddUser] = useState({
    email: "",
    password: "",
    name: "",
    role: "sales_executive",
  });
  const [addModules, setAddModules] = useState<string[]>([]);
  const [catalogModules, setCatalogModules] = useState<CatalogModule[]>([]);
  const [catalogTemplates, setCatalogTemplates] = useState<CatalogTemplate[]>([]);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editModules, setEditModules] = useState<string[]>([]);
  const [editRole, setEditRole] = useState("sales_executive");
  const [editUserName, setEditUserName] = useState("");
  const [busy, setBusy] = useState(false);
  const [wl, setWl] = useState({ companyName: "", logoUrl: "", theme: "dark", customDomain: "" });
  const [editBizName, setEditBizName] = useState("");
  const [editTemplateSlug, setEditTemplateSlug] = useState("generic");
  const [bizModules, setBizModules] = useState<string[]>([]);
  const [bizModulesCustomized, setBizModulesCustomized] = useState(false);
  const [industryCatalog, setIndustryCatalog] = useState<Array<{ slug: string; name: string }>>(
    []
  );

  const token = () => localStorage.getItem(PORTAL_TOKENS.admin) || "";

  const applyTemplateModules = (roleKey: string) => {
    const t = catalogTemplates.find((x) => x.roleKey === roleKey);
    if (t?.modules?.length) return [...t.modules];
    return catalogModules.filter((m) => m.alwaysOn).map((m) => m.key);
  };

  const load = useCallback(async () => {
    if (!id) return;
    const [res, hist, cat] = await Promise.all([
      api.platformGetBusiness(id, token()),
      api.platformSubscriptionHistory(id, token(), 50),
      api.platformPermissionCatalog(token()),
    ]);
    if (res.success && res.data) {
      const d = res.data as unknown as BizDetail;
      setBiz(d);
      setPlan(String(d.plan || "trial"));
      setEditBizName(d.name || "");
      setEditTemplateSlug(d.templateSlug || "generic");
      const ma = d.moduleAccess;
      const customized = !!ma?.customized;
      setBizModulesCustomized(customized);
      const white = (d.whiteLabel || {}) as Record<string, string>;
      setWl({
        companyName: white.companyName || "",
        logoUrl: white.logoUrl || "",
        theme: white.theme || "dark",
        customDomain: white.customDomain || "",
      });
      if (cat.success && cat.data) {
        setCatalogModules(cat.data.modules || []);
        setCatalogTemplates(cat.data.templates || []);
        const se = (cat.data.templates || []).find((t) => t.roleKey === "sales_executive");
        if (se?.modules?.length) setAddModules(se.modules);
        if (customized && Array.isArray(ma?.enabled) && ma.enabled.length) {
          setBizModules([...ma.enabled]);
        } else {
          // Not yet capped — show full catalog checked; Save enables business policy
          setBizModules((cat.data.modules || []).map((m) => m.key));
        }
      } else if (customized && Array.isArray(ma?.enabled)) {
        setBizModules([...ma.enabled]);
      }
    } else toast.error(res.error || "Not found");
    if (hist.success && hist.data?.history) {
      setHistory(hist.data.history);
    }
    if (!(res.success && res.data) && cat.success && cat.data) {
      setCatalogModules(cat.data.modules || []);
      setCatalogTemplates(cat.data.templates || []);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    void api.getIndustryCatalog().then((res) => {
      if (res.success && res.data?.templates) {
        setIndustryCatalog(
          res.data.templates.map((t: { slug: string; name: string }) => ({
            slug: t.slug,
            name: t.name,
          }))
        );
      }
    });
  }, []);

  const runPlanAction = async (
    action:
      | "upgrade"
      | "downgrade"
      | "renew"
      | "activate"
      | "extend_trial"
      | "cancel"
      | "activate_license"
      | "suspend_license"
  ) => {
    setBusy(true);
    const res = await api.platformChangePlan(
      id,
      {
        action,
        plan: action === "extend_trial" || action === "cancel" ? undefined : plan,
        days: planDays,
        reason: planReason.trim() || undefined,
      },
      token()
    );
    setBusy(false);
    if (res.success) {
      toast.success(`Subscription: ${action.replace(/_/g, " ")} applied — customer CRM will sync within ~1 min (or on next page load)`);
      setPlanReason("");
      void load();
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
    const res = await api.platformAddUser(
      id,
      {
        ...addUser,
        modules: addModules,
        customized: true,
      },
      token()
    );
    if (res.success) {
      toast.success("User added with module permissions");
      setAddUser({ email: "", password: "", name: "", role: "sales_executive" });
      setAddModules(applyTemplateModules("sales_executive"));
      load();
    } else toast.error(res.error || "Failed");
  };

  const openEditPermissions = (m: Member) => {
    setEditUserId(m.userId);
    setEditRole(m.role || "sales_executive");
    setEditUserName(m.name || "");
    setEditModules(
      m.modules && m.modules.length
        ? [...m.modules]
        : applyTemplateModules(m.role || "sales_executive")
    );
  };

  const saveEditPermissions = async () => {
    if (!editUserId) return;
    setBusy(true);
    if (editUserName.trim() !== (biz?.members.find((x) => x.userId === editUserId)?.name || "")) {
      const nameRes = await api.platformUpdateBusinessUser(
        id,
        editUserId,
        { name: editUserName.trim() },
        token()
      );
      if (!nameRes.success) {
        setBusy(false);
        toast.error(nameRes.error || "Failed to update name");
        return;
      }
    }
    const res = await api.platformSetUserPermissions(
      id,
      editUserId,
      {
        modules: editModules,
        role: editRole,
        template: editRole,
        customized: true,
      },
      token()
    );
    setBusy(false);
    if (res.success) {
      toast.success("Permissions updated — user portal updates on next load");
      setEditUserId(null);
      load();
    } else toast.error(res.error || "Failed");
  };

  const saveBusinessProfile = async () => {
    if (!editBizName.trim()) {
      toast.error("Business name is required");
      return;
    }
    setBusy(true);
    const res = await api.platformUpdateBusiness(
      id,
      {
        name: editBizName.trim(),
        templateSlug: editTemplateSlug || undefined,
      },
      token()
    );
    setBusy(false);
    if (res.success) {
      toast.success("Business profile saved");
      void load();
    } else toast.error(res.error || "Failed");
  };

  const saveBusinessModules = async () => {
    setBusy(true);
    const res = await api.platformUpdateBusiness(
      id,
      {
        moduleAccess: { enabled: bizModules, customized: true },
      },
      token()
    );
    setBusy(false);
    if (res.success) {
      toast.success("Business module policy saved — applies to all members");
      setBizModulesCustomized(true);
      void load();
    } else toast.error(res.error || "Failed");
  };

  const toggleModule = (list: string[], key: string, alwaysOn?: boolean) => {
    if (alwaysOn) return list;
    return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  };

  const ModuleCheckboxes = ({
    selected,
    onChange,
  }: {
    selected: string[];
    onChange: (next: string[]) => void;
  }) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto p-2 rounded-xl border border-border bg-background/50">
      {catalogModules.map((m) => {
        const checked = selected.includes(m.key) || !!m.alwaysOn;
        return (
          <label
            key={m.key}
            className={`flex items-center gap-2 text-xs rounded-lg px-2 py-1.5 cursor-pointer ${
              checked ? "bg-violet-500/10 text-foreground" : "text-muted-foreground"
            } ${m.alwaysOn ? "opacity-70" : ""}`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={!!m.alwaysOn}
              onChange={() => onChange(toggleModule(selected, m.key, m.alwaysOn))}
              className="rounded border-border"
            />
            <span>{m.label}</span>
          </label>
        );
      })}
      {!catalogModules.length && (
        <p className="col-span-full text-xs text-muted-foreground">Loading catalog…</p>
      )}
    </div>
  );

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

      {/* Business Info — editable */}
      <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <h2 className="font-semibold">Business Info</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs text-muted-foreground space-y-1">
            Business name
            <input
              value={editBizName}
              onChange={(e) => setEditBizName(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground min-h-11"
            />
          </label>
          <label className="text-xs text-muted-foreground space-y-1">
            Business type
            <select
              value={editTemplateSlug}
              onChange={(e) => setEditTemplateSlug(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground min-h-11"
            >
              {(industryCatalog.length
                ? industryCatalog
                : [{ slug: editTemplateSlug || "generic", name: editTemplateSlug || "generic" }]
              ).map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          {[
            ["Owner", biz.owner?.name || "—"],
            ["Email", biz.owner?.email || biz.billingEmail || "—"],
            ["Phone", biz.phone || "—"],
            ["Industry", biz.industry || "—"],
            ["Status", biz.status],
            ["Created", biz.createdAt ? new Date(biz.createdAt).toLocaleString() : "—"],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="text-foreground mt-0.5 break-all">{v}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Changing business type updates the template label only — existing CRM/ERP data is not
          deleted. Use Business Modules below to change access.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveBusinessProfile()}
          className="min-h-11 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          Save business profile
        </button>
      </section>

      {/* Business-level module allowlist */}
      <section className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <div>
          <h2 className="font-semibold">Business Modules</h2>
          <p className="text-xs text-muted-foreground mt-1">
            ON/OFF for this entire business (all members). Example: turn ERP off and leave CRM on.
            Per-user permissions below cannot grant modules that are off here. Existing data is never
            deleted.
            {bizModulesCustomized ? (
              <span className="text-violet-600 dark:text-violet-300"> Policy active.</span>
            ) : (
              <span> Saving enables the business allowlist.</span>
            )}
          </p>
        </div>
        <ModuleCheckboxes selected={bizModules} onChange={setBizModules} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveBusinessModules()}
            className="min-h-11 px-4 rounded-xl bg-violet-600 text-white text-sm font-medium disabled:opacity-50"
          >
            Save business modules
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBizModules(catalogModules.map((m) => m.key));
            }}
            className="min-h-11 px-4 rounded-xl bg-white/10 text-sm disabled:opacity-50"
          >
            Select all
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBizModules(
                catalogModules.filter((m) => m.alwaysOn || m.category === "crm" || m.key === "dashboard" || m.key === "finance" || m.key === "reports" || m.key === "mentor" || m.key === "marketing" || m.key === "whatsapp" || m.key === "team" || m.key === "activity").map((m) => m.key)
              );
            }}
            className="min-h-11 px-4 rounded-xl bg-white/10 text-sm disabled:opacity-50"
            title="CRM-oriented preset (no ERP)"
          >
            CRM only (no ERP)
          </button>
        </div>
      </section>

      {/* Subscription management — syncs immediately to customer CRM */}
      <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Subscription</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <StatusBadge value={biz.planStatus} />
            {biz.isTrial ? <StatusBadge value="isTrial" /> : null}
            {biz.isLocked ? <StatusBadge value="locked" /> : null}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Current Plan" value={String(biz.plan)} tone="info" />
          <KpiCard
            label="Trial Days Left"
            value={biz.isTrial && biz.trialDaysLeft != null ? biz.trialDaysLeft : "—"}
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
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <label className="text-xs text-muted-foreground space-y-1">
            Target plan
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground min-h-11"
            >
              <option value="trial">Trial</option>
              <option value="basic">Basic (Starter)</option>
              <option value="professional">Professional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground space-y-1">
            Period (days)
            <input
              type="number"
              min={1}
              max={3650}
              value={planDays}
              onChange={(e) => setPlanDays(Math.max(1, parseInt(e.target.value, 10) || 30))}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground min-h-11"
            />
          </label>
          <label className="text-xs text-muted-foreground space-y-1 sm:col-span-2">
            Reason (audit)
            <input
              type="text"
              value={planReason}
              onChange={(e) => setPlanReason(e.target.value)}
              placeholder="Optional reason for history"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground min-h-11"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void runPlanAction("upgrade")}
            className="min-h-11 px-4 bg-violet-500 text-white rounded-xl text-sm font-medium disabled:opacity-50"
          >
            Upgrade Plan
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runPlanAction("downgrade")}
            className="min-h-11 px-4 bg-white/10 rounded-xl text-sm disabled:opacity-50"
          >
            Downgrade Plan
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runPlanAction("renew")}
            className="min-h-11 px-4 bg-emerald-600/90 text-white rounded-xl text-sm font-medium disabled:opacity-50"
          >
            Renew Subscription
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runPlanAction("extend_trial")}
            className="min-h-11 px-4 bg-sky-600/90 text-white rounded-xl text-sm disabled:opacity-50"
          >
            Extend Trial
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runPlanAction("activate_license")}
            className="min-h-11 px-4 bg-white/10 rounded-xl text-sm disabled:opacity-50"
          >
            Activate License
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runPlanAction("suspend_license")}
            className="min-h-11 px-4 bg-amber-500/20 text-amber-200 rounded-xl text-sm disabled:opacity-50"
          >
            Suspend License
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runPlanAction("cancel")}
            className="min-h-11 px-4 bg-red-500/20 text-red-300 rounded-xl text-sm disabled:opacity-50"
          >
            Cancel Subscription
          </button>
        </div>
        {biz.licenseKey && (
          <p className="text-xs text-muted-foreground font-mono">License key: {biz.licenseKey}</p>
        )}
        <p className="text-[11px] text-muted-foreground">
          Paid upgrades clear trial flags immediately. Customer CRM refreshes on next billing access poll
          (focus / ~45s) without logout.
        </p>
      </section>

      {/* Subscription history */}
      <section className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <h2 className="font-semibold">Subscription History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No plan changes recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Previous</th>
                  <th className="py-2 pr-3 font-medium">New</th>
                  <th className="py-2 pr-3 font-medium">By</th>
                  <th className="py-2 pr-3 font-medium">License</th>
                  <th className="py-2 pr-3 font-medium">Payment</th>
                  <th className="py-2 pr-3 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-border/60">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {h.date ? new Date(h.date).toLocaleString() : "—"}
                    </td>
                    <td className="py-2 pr-3">{h.previousPlan || "—"}</td>
                    <td className="py-2 pr-3 font-medium">{h.newPlan || h.action}</td>
                    <td className="py-2 pr-3">
                      <div>{h.changedBy}</div>
                      {h.changedByEmail ? (
                        <div className="text-[11px] text-muted-foreground">{h.changedByEmail}</div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">{h.licenseStatus || "—"}</td>
                    <td className="py-2 pr-3 font-mono text-[11px]">{h.paymentId || "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground max-w-[12rem] truncate" title={h.reason || ""}>
                      {h.reason || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

      {/* Users + module permissions */}
      <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Users &amp; Module Permissions</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Assign a portal role template, then customize module checkboxes. Users only see granted
            modules in the CRM sidebar and APIs.
          </p>
        </div>
        <div className="space-y-2">
          {(biz.members || []).map((m) => (
            <div
              key={m.userId}
              className="bg-background border border-border rounded-xl p-3 text-sm space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{m.name || m.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.email} · {m.role} {m.isDisabled ? "· disabled" : ""}
                    {m.modules?.length ? ` · ${m.modules.length} modules` : " · template defaults"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openEditPermissions(m)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-violet-500/20 text-violet-200 border border-violet-500/30"
                  >
                    Permissions
                  </button>
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
              {editUserId === m.userId && (
                <div className="border-t border-border pt-3 space-y-2">
                  <label className="block text-xs text-muted-foreground">
                    User name
                    <input
                      value={editUserName}
                      onChange={(e) => setEditUserName(e.target.value)}
                      className="mt-1 w-full bg-card border border-border rounded-xl px-3 py-2 text-sm text-foreground"
                      placeholder="Display name"
                    />
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    Portal / role template
                    <select
                      value={editRole}
                      onChange={(e) => {
                        const r = e.target.value;
                        setEditRole(r);
                        setEditModules(applyTemplateModules(r));
                      }}
                      className="mt-1 w-full bg-card border border-border rounded-xl px-3 py-2 text-sm text-foreground"
                    >
                      {(catalogTemplates.length
                        ? catalogTemplates
                        : [
                            { roleKey: "ceo", label: "CEO" },
                            { roleKey: "business_admin", label: "Business Admin" },
                            { roleKey: "sales_manager", label: "Sales Manager" },
                            { roleKey: "sales_executive", label: "Sales Executive" },
                            { roleKey: "marketing", label: "Marketing" },
                            { roleKey: "finance", label: "Finance" },
                            { roleKey: "support", label: "Support" },
                          ]
                      ).map((t) => (
                        <option key={t.roleKey} value={t.roleKey}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-[11px] text-muted-foreground">Modules (customize after template)</p>
                  <ModuleCheckboxes selected={editModules} onChange={setEditModules} />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveEditPermissions()}
                      className="min-h-10 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                    >
                      Save permissions
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditUserId(null)}
                      className="min-h-10 px-4 rounded-xl bg-white/10 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!biz.members?.length && <p className="text-sm text-muted-foreground">No members.</p>}
        </div>

        <form onSubmit={createUser} className="grid sm:grid-cols-2 gap-2 pt-3 border-t border-border">
          <h3 className="sm:col-span-2 text-sm font-medium text-foreground">Add User</h3>
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
            onChange={(e) => {
              const role = e.target.value;
              setAddUser({ ...addUser, role });
              setAddModules(applyTemplateModules(role));
            }}
            className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground"
          >
            {(catalogTemplates.length
              ? catalogTemplates
              : [
                  { roleKey: "ceo", label: "CEO" },
                  { roleKey: "business_admin", label: "Business Admin" },
                  { roleKey: "sales_manager", label: "Sales Manager" },
                  { roleKey: "sales_executive", label: "Sales Executive" },
                  { roleKey: "marketing", label: "Marketing" },
                  { roleKey: "finance", label: "Finance" },
                  { roleKey: "support", label: "Support" },
                ]
            ).map((t) => (
              <option key={t.roleKey} value={t.roleKey}>
                {t.label} (portal template)
              </option>
            ))}
          </select>
          <div className="sm:col-span-2 space-y-1">
            <p className="text-xs text-muted-foreground">Module access</p>
            <ModuleCheckboxes selected={addModules} onChange={setAddModules} />
          </div>
          <button
            type="submit"
            className="sm:col-span-2 min-h-11 bg-primary text-primary-foreground rounded-xl text-sm font-medium"
          >
            Add User with permissions
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
