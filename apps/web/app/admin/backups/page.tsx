"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PORTAL_TOKENS } from "@/lib/portal-config";
import { AdminDataTable, type AdminColumn } from "@/components/admin/AdminDataTable";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { toast } from "sonner";

type BackupRow = {
  id: string;
  type: string;
  businessId: string;
  status: string;
  trigger: string;
  size: string;
  progress: number;
  checksum: string;
  createdAt: string;
  verified: string;
};

type RestoreRow = {
  id: string;
  backupId: string;
  status: string;
  scope: string;
  progress: number;
  createdAt: string;
};

type ScheduleRow = {
  id: string;
  cadence: string;
  enabled: string;
  hourUtc: string;
  backupType: string;
  retentionDays: string;
  nextRunAt: string;
  lastRunAt: string;
};

function token() {
  return localStorage.getItem(PORTAL_TOKENS.admin) || "";
}

export default function AdminBackupsPage() {
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [restores, setRestores] = useState<RestoreRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [businessId, setBusinessId] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<{
    restoreId: string;
    confirmationToken: string;
    scope: string;
  } | null>(null);
  const [confirmPhrase, setConfirmPhrase] = useState("");

  const load = useCallback(async () => {
    const t = token();
    if (!t) return;
    const [b, r, s] = await Promise.all([
      api.platformListBackups(t),
      api.platformListRestores(t),
      api.platformListBackupSchedules(t),
    ]);
    if (b.success && b.data?.backups) {
      setBackups(
        b.data.backups.map((x) => ({
          id: String(x.id),
          type: String(x.type || ""),
          businessId: String(x.businessId || "—"),
          status: String(x.status || ""),
          trigger: String(x.trigger || ""),
          size: formatBytes(x.sizeBytes),
          progress: Number(x.progress || 0),
          checksum: String(x.checksumSha256 || "").slice(0, 12) + "…",
          createdAt: x.createdAt ? new Date(String(x.createdAt)).toLocaleString() : "—",
          verified: x.verificationOk === true ? "yes" : x.verificationOk === false ? "no" : "—",
        }))
      );
    }
    if (r.success && r.data?.restores) {
      setRestores(
        r.data.restores.map((x) => ({
          id: String(x.id),
          backupId: String(x.backupId || ""),
          status: String(x.status || ""),
          scope: String(x.scope || ""),
          progress: Number(x.progress || 0),
          createdAt: x.createdAt ? new Date(String(x.createdAt)).toLocaleString() : "—",
        }))
      );
    }
    if (s.success && s.data?.schedules) {
      setSchedules(
        s.data.schedules.map((x) => ({
          id: String(x.id),
          cadence: String(x.cadence || ""),
          enabled: x.enabled ? "on" : "off",
          hourUtc: String(x.hourUtc ?? ""),
          backupType: String(x.backupType || ""),
          retentionDays: String(x.retentionDays ?? ""),
          nextRunAt: x.nextRunAt ? new Date(String(x.nextRunAt)).toLocaleString() : "—",
          lastRunAt: x.lastRunAt ? new Date(String(x.lastRunAt)).toLocaleString() : "—",
        }))
      );
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(id);
  }, [load]);

  const createFull = async () => {
    setBusy(true);
    const res = await api.platformCreateBackup({ type: "full" }, token());
    setBusy(false);
    if (res.success) toast.success("Full platform backup started");
    else toast.error(res.error || "Failed");
    void load();
  };

  const createBusiness = async () => {
    if (!businessId.trim()) {
      toast.error("Enter a business ID");
      return;
    }
    setBusy(true);
    const res = await api.platformCreateBackup(
      { type: "business", businessId: businessId.trim() },
      token()
    );
    setBusy(false);
    if (res.success) toast.success("Business backup started");
    else toast.error(res.error || "Failed");
    void load();
  };

  const verify = async (id: string) => {
    const res = await api.platformVerifyBackup(id, token());
    if (res.success && res.data?.ok) toast.success(res.data.detail || "Verified");
    else toast.error(res.data?.detail || res.error || "Verification failed");
    void load();
  };

  const download = (id: string) => {
    const t = token();
    window.open(
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api"}/platform/backups/${id}/download`,
      "_blank"
    );
    // Note: browser open won't send Authorization — use fetch blob instead
    void (async () => {
      try {
        const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
        const resp = await fetch(`${base}/platform/backups/${id}/download`, {
          headers: { Authorization: `Bearer ${t}` },
        });
        if (!resp.ok) {
          toast.error("Download failed");
          return;
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `backup-${id}.mmbak`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Download started");
      } catch {
        toast.error("Download error");
      }
    })();
  };

  const del = async (id: string) => {
    if (!confirm("Delete this backup permanently?")) return;
    const res = await api.platformDeleteBackup(id, token());
    if (res.success) toast.success("Deleted");
    else toast.error(res.error || "Failed");
    void load();
  };

  const requestRestore = async (id: string, scope: "full" | "business", biz?: string) => {
    if (scope === "full") {
      if (confirmPhrase !== "RESTORE PLATFORM") {
        toast.error('Type RESTORE PLATFORM in the confirm box first');
        return;
      }
    }
    setBusy(true);
    const res = await api.platformRequestRestore(
      id,
      {
        scope,
        businessId: biz || undefined,
        confirmPhrase: scope === "full" ? confirmPhrase : undefined,
      },
      token()
    );
    setBusy(false);
    if (res.success && res.data) {
      setPendingConfirm({
        restoreId: res.data.restoreId,
        confirmationToken: res.data.confirmationToken,
        scope,
      });
      toast.success("Confirm restore with the one-time token shown below");
    } else toast.error(res.error || "Failed");
  };

  const confirmRestore = async () => {
    if (!pendingConfirm) return;
    setBusy(true);
    const res = await api.platformConfirmRestore(
      pendingConfirm.restoreId,
      pendingConfirm.confirmationToken,
      token()
    );
    setBusy(false);
    if (res.success) {
      toast.success("Restore running");
      setPendingConfirm(null);
    } else toast.error(res.error || "Failed");
    void load();
  };

  const toggleSchedule = async (cadence: string, enabled: boolean) => {
    const res = await api.platformUpsertBackupSchedule({ cadence, enabled }, token());
    if (res.success) toast.success(`${cadence} schedule ${enabled ? "enabled" : "disabled"}`);
    else toast.error(res.error || "Failed");
    void load();
  };

  const bcols: AdminColumn<BackupRow>[] = [
    { key: "createdAt", label: "Created" },
    { key: "type", label: "Type" },
    { key: "businessId", label: "Business" },
    {
      key: "status",
      label: "Status",
      render: (r) => <StatusBadge value={r.status === "completed" || r.status === "verified" ? "active" : r.status} />,
    },
    { key: "trigger", label: "Trigger" },
    { key: "size", label: "Size" },
    {
      key: "progress",
      label: "Progress",
      render: (r) => (
        <div className="w-24">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-violet-500" style={{ width: `${r.progress}%` }} />
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{r.progress}%</div>
        </div>
      ),
    },
    { key: "verified", label: "Verified" },
    {
      key: "id",
      label: "Actions",
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          <button type="button" className="text-xs text-violet-300 underline" onClick={() => verify(r.id)}>
            Verify
          </button>
          <button type="button" className="text-xs text-emerald-300 underline" onClick={() => download(r.id)}>
            Download
          </button>
          {r.type === "business" && (
            <button
              type="button"
              className="text-xs text-amber-300 underline"
              onClick={() => requestRestore(r.id, "business", r.businessId === "—" ? undefined : r.businessId)}
            >
              Restore biz
            </button>
          )}
          {r.type === "full" && (
            <button type="button" className="text-xs text-amber-300 underline" onClick={() => requestRestore(r.id, "full")}>
              Restore full
            </button>
          )}
          <button type="button" className="text-xs text-red-400 underline" onClick={() => del(r.id)}>
            Delete
          </button>
        </div>
      ),
    },
  ];

  const rcols: AdminColumn<RestoreRow>[] = [
    { key: "createdAt", label: "When" },
    { key: "scope", label: "Scope" },
    { key: "status", label: "Status", render: (r) => <StatusBadge value={r.status} /> },
    { key: "progress", label: "%", render: (r) => `${r.progress}%` },
    { key: "backupId", label: "Backup" },
  ];

  const scols: AdminColumn<ScheduleRow>[] = [
    { key: "cadence", label: "Cadence" },
    { key: "enabled", label: "Enabled" },
    { key: "hourUtc", label: "Hour UTC" },
    { key: "backupType", label: "Type" },
    { key: "retentionDays", label: "Retention d" },
    { key: "lastRunAt", label: "Last run" },
    { key: "nextRunAt", label: "Next run" },
    {
      key: "id",
      label: "Toggle",
      render: (r) => (
        <button
          type="button"
          className="text-xs text-violet-300 underline"
          onClick={() => toggleSchedule(r.cadence, r.enabled !== "on")}
        >
          {r.enabled === "on" ? "Disable" : "Enable"}
        </button>
      ),
    },
  ];

  return (
    <div className="max-w-7xl space-y-8 p-1">
      <div>
        <h1 className="text-2xl font-semibold">Backup &amp; Restore</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Encrypted platform and per-business backups. Restore requires verification + one-time confirmation.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <button
          type="button"
          disabled={busy}
          onClick={createFull}
          className="px-4 py-2.5 rounded-xl bg-violet-500 text-white font-semibold text-sm disabled:opacity-50"
        >
          Manual full backup
        </button>
        <div className="flex gap-2 items-end">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Business ID</label>
            <input
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
              className="px-3 py-2 rounded-xl bg-card border border-border text-sm w-64"
              placeholder="cuid…"
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={createBusiness}
            className="px-4 py-2.5 rounded-xl bg-secondary text-secondary-foreground font-medium text-sm disabled:opacity-50"
          >
            Backup business
          </button>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-muted-foreground mb-1">
            Full restore phrase (type exactly <code className="text-amber-300">RESTORE PLATFORM</code>)
          </label>
          <input
            value={confirmPhrase}
            onChange={(e) => setConfirmPhrase(e.target.value)}
            className="px-3 py-2 rounded-xl bg-card border border-border text-sm w-full max-w-md"
          />
        </div>
      </div>

      {pendingConfirm && (
        <div className="rounded-2xl border border-amber-700/50 bg-amber-950/30 p-4 space-y-3">
          <div className="font-semibold text-amber-200">Restore confirmation required</div>
          <p className="text-sm text-amber-100/90">
            Scope: <strong>{pendingConfirm.scope}</strong>. Click confirm within 15 minutes.
          </p>
          <code className="block text-xs break-all bg-black/40 p-2 rounded-lg">
            {pendingConfirm.confirmationToken}
          </code>
          <button
            type="button"
            disabled={busy}
            onClick={confirmRestore}
            className="px-4 py-2 rounded-xl bg-amber-500 text-white font-semibold text-sm"
          >
            Confirm one-click restore
          </button>
        </div>
      )}

      <section>
        <h2 className="text-lg font-medium mb-3">Backups</h2>
        <AdminDataTable columns={bcols} rows={backups} emptyMessage="No backups yet" />
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Restore history</h2>
        <AdminDataTable columns={rcols} rows={restores} emptyMessage="No restores yet" />
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Automatic schedules</h2>
        <p className="text-xs text-muted-foreground mb-3">Daily / weekly / monthly jobs run inside the API process.</p>
        <AdminDataTable columns={scols} rows={schedules} emptyMessage="No schedules" />
      </section>
    </div>
  );
}

function formatBytes(v: unknown): string {
  const n = typeof v === "string" ? parseInt(v, 10) : Number(v || 0);
  if (!n || Number.isNaN(n)) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
