"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

type Row = {
  id: string;
  status: string;
  progress: number;
  size: string;
  createdAt: string;
  trigger: string;
};

export default function TenantBackupsPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    restoreId: string;
    confirmationToken: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const res = await api.listTenantBackups(token);
    if (res.success && res.data?.backups) {
      setRows(
        res.data.backups.map((x) => ({
          id: String(x.id),
          status: String(x.status || ""),
          progress: Number(x.progress || 0),
          size: String(x.sizeBytes || "0"),
          createdAt: x.createdAt ? new Date(String(x.createdAt)).toLocaleString() : "—",
          trigger: String(x.trigger || ""),
        }))
      );
    }
  }, [token]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
  }, [load]);

  const create = async () => {
    if (!token) return;
    setBusy(true);
    const res = await api.createTenantBackup(token);
    setBusy(false);
    if (res.success) toast.success("Business backup started");
    else toast.error(res.error || "Only business admins can create backups");
    void load();
  };

  const restore = async (id: string) => {
    if (!token) return;
    if (
      !window.confirm(
        "Restore this backup into YOUR business only? Current CRM data for this workspace will be replaced."
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await api.requestTenantRestore(id, token);
    setBusy(false);
    if (res.success && res.data) {
      setPending({
        restoreId: res.data.restoreId,
        confirmationToken: res.data.confirmationToken,
      });
      toast.success("Confirm restore below");
    } else toast.error(res.error || "Failed");
  };

  const confirmRestore = async () => {
    if (!token || !pending) return;
    setBusy(true);
    const res = await api.confirmTenantRestore(
      pending.restoreId,
      pending.confirmationToken,
      token
    );
    setBusy(false);
    if (res.success) {
      toast.success("Restore started");
      setPending(null);
    } else toast.error(res.error || "Failed");
    void load();
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Backups</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Business-only backups. You cannot access other tenants. Restore requires confirmation.
        </p>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={create}
        className="px-4 py-2.5 rounded-xl bg-white text-zinc-950 font-medium text-sm disabled:opacity-50"
      >
        Create backup now
      </button>

      {pending && (
        <div className="rounded-2xl border border-amber-800/50 bg-amber-950/30 p-4 space-y-2">
          <div className="font-medium text-amber-200">Confirm restore</div>
          <code className="text-xs break-all block">{pending.confirmationToken}</code>
          <button
            type="button"
            disabled={busy}
            onClick={confirmRestore}
            className="px-3 py-2 rounded-lg bg-amber-500 text-zinc-950 text-sm font-semibold"
          >
            Confirm restore
          </button>
        </div>
      )}

      <div className="space-y-2">
        {rows.length === 0 && (
          <div className="text-sm text-zinc-500">No backups yet for this business.</div>
        )}
        {rows.map((r) => (
          <div
            key={r.id}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 flex flex-wrap items-center justify-between gap-3"
          >
            <div>
              <div className="text-sm text-white font-medium">{r.createdAt}</div>
              <div className="text-xs text-zinc-500">
                {r.status} · {r.trigger} · {r.progress}%
              </div>
              <div className="mt-1 h-1 w-40 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: `${r.progress}%` }} />
              </div>
            </div>
            <button
              type="button"
              disabled={busy || r.status === "running" || r.status === "failed"}
              onClick={() => restore(r.id)}
              className="text-sm text-emerald-300 underline disabled:opacity-40"
            >
              Restore
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
