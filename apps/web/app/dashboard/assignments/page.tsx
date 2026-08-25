"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import Link from "next/link";

type Line = {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  leadCount: number;
};

type AssignmentRow = {
  id: string;
  sequence: number;
  actorUserId: string;
  actorName: string | null;
  mode: string;
  scope: string;
  leadCount: number;
  memberCount: number;
  status: string;
  notes: string | null;
  createdAt: string;
  lines: Line[];
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function modeLabel(mode: string, scope: string) {
  if (scope === "edit_move") return "Edit / Move";
  if (scope === "reassign") return "Reassign";
  if (mode === "all_members") return "All Members";
  if (scope === "first_n") return "First N";
  if (scope === "all_filtered") return "All Filtered";
  return "Bulk / Selected";
}

export default function AssignmentHistoryPage() {
  const { token, role } = useAuth();
  const [items, setItems] = useState<AssignmentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AssignmentRow | null>(null);
  const [moveFrom, setMoveFrom] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [moveCount, setMoveCount] = useState("20");
  const [moving, setMoving] = useState(false);
  const [members, setMembers] = useState<
    Array<{ id: string; name: string | null; email: string }>
  >([]);

  const canView = ["ceo", "owner", "business_admin", "admin", "super_admin"].includes(
    (role || "").toLowerCase()
  );

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await api.listLeadAssignments(token, { page, pageSize: 25 });
    if (res.success && res.data) {
      setItems(res.data.items as AssignmentRow[]);
      setTotal(res.data.total);
    } else {
      toast.error(res.error || "Failed to load assignment history");
    }
    setLoading(false);
  }, [token, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token) return;
    void api.listAssignableMembers(token).then((res) => {
      if (res.success && res.data?.members) {
        setMembers(res.data.members.map((m) => ({ id: m.id, name: m.name, email: m.email })));
      }
    });
  }, [token]);

  const openDetail = async (id: string) => {
    if (!token) return;
    const res = await api.getLeadAssignment(id, token);
    if (res.success && res.data) {
      setDetail(res.data as unknown as AssignmentRow);
      const lines = (res.data as AssignmentRow).lines || [];
      if (lines[0]) setMoveFrom(lines[0].userId);
      if (lines[1]) setMoveTo(lines[1].userId);
      else if (members[0]) setMoveTo(members[0].id);
    } else {
      toast.error(res.error || "Failed to load details");
    }
  };

  const runMove = async () => {
    if (!token || !detail) return;
    const count = Number.parseInt(moveCount, 10);
    if (!moveFrom || !moveTo || !Number.isFinite(count) || count < 1) {
      toast.error("Choose from/to members and a valid count");
      return;
    }
    setMoving(true);
    const res = await api.moveLeadAssignment(
      detail.id,
      { fromUserId: moveFrom, toUserId: moveTo, count },
      token
    );
    setMoving(false);
    if (res.success) {
      toast.success(`Moved ${res.data?.assigned ?? count} lead(s)`, {
        description: "History updated (original batch preserved)",
      });
      setDetail(null);
      await load();
    } else {
      toast.error(res.error || "Move failed");
    }
  };

  if (!canView) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="mm-page-title">Lead Assignment History</h1>
        <p className="mm-secondary mt-2">
          Only Business Admin / Admin / CEO can view assignment history.
        </p>
        <Link href="/dashboard/leads" className="mm-btn mm-btn-secondary mt-4 inline-flex">
          Back to Leads
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-5 lg:py-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
        <div className="min-w-0">
          <h1 className="mm-page-title">
            Lead Assignment History
          </h1>
          <p className="mm-secondary mt-1">
            Track bulk assigns, equal distribution, and reassignments. History is never deleted.
          </p>
        </div>
        <Link
          href="/dashboard/leads"
          className="mm-btn mm-btn-secondary"
        >
          ← Leads
        </Link>
      </div>

      <div className="mm-table-wrap">
        <table className="mm-table min-w-[720px]">
          <thead>
            <tr>
              <th>#</th>
              <th>Assigned By</th>
              <th>Assigned To</th>
              <th>Leads</th>
              <th>Type</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-muted-foreground">
                  No assignments yet. Use Leads → Assign User to create one.
                </td>
              </tr>
            ) : (
              items.map((row) => {
                const toLabel =
                  row.mode === "all_members"
                    ? `All Members (${row.memberCount})`
                    : row.lines
                        .slice(0, 2)
                        .map((l) => l.userName || l.userEmail || l.userId)
                        .join(", ") + (row.lines.length > 2 ? "…" : "");
                return (
                  <tr
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => void openDetail(row.id)}
                  >
                    <td className="tabular-nums font-medium">#{row.sequence}</td>
                    <td>{row.actorName || "—"}</td>
                    <td className="max-w-[200px] truncate" title={toLabel}>
                      {toLabel || "—"}
                    </td>
                    <td className="tabular-nums font-semibold">
                      {row.leadCount.toLocaleString()}
                    </td>
                    <td>
                      <span className="mm-badge">
                        {modeLabel(row.mode, row.scope)}
                      </span>
                    </td>
                    <td className="text-muted-foreground whitespace-nowrap">
                      {formatDate(row.createdAt)}
                    </td>
                    <td>
                      <span className="mm-badge mm-badge-success capitalize">{row.status}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {total > 25 && (
          <div className="flex items-center justify-between px-3 py-2.5 border-t border-border text-[13px]">
            <span className="mm-secondary">
              {(page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="mm-btn mm-btn-secondary h-9 px-3 disabled:opacity-40"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={page * 25 >= total}
                onClick={() => setPage((p) => p + 1)}
                className="mm-btn mm-btn-secondary h-9 px-3 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/60 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-card border border-border rounded-t-xl sm:rounded-lg w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-5 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">Assignment #{detail.sequence}</h2>
                <p className="mm-secondary mt-0.5">{formatDate(detail.createdAt)}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="mm-btn mm-btn-ghost h-9 px-2"
              >
                Close
              </button>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
              <div>
                <dt className="mm-secondary">Assigned By</dt>
                <dd className="font-medium">{detail.actorName || "—"}</dd>
              </div>
              <div>
                <dt className="mm-secondary">Total Leads</dt>
                <dd className="font-medium tabular-nums">{detail.leadCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="mm-secondary">Type</dt>
                <dd className="font-medium">{modeLabel(detail.mode, detail.scope)}</dd>
              </div>
              <div>
                <dt className="mm-secondary">Status</dt>
                <dd>
                  <span className="mm-badge mm-badge-success capitalize">{detail.status}</span>
                </dd>
              </div>
            </dl>
            {detail.notes && (
              <p className="mt-3 text-[13px] text-muted-foreground border border-border rounded-md p-3">
                {detail.notes}
              </p>
            )}

            <h3 className="text-[13px] font-semibold mt-5 mb-2">Members</h3>
            <ul className="rounded-md border border-border divide-y divide-border">
              {(detail.lines || []).map((l) => (
                <li key={l.userId} className="flex justify-between px-3 py-2 text-[13px]">
                  <span>
                    {l.userName || l.userEmail || l.userId}
                    {l.userEmail && l.userName ? (
                      <span className="mm-secondary block">{l.userEmail}</span>
                    ) : null}
                  </span>
                  <span className="tabular-nums font-semibold">{l.leadCount.toLocaleString()}</span>
                </li>
              ))}
            </ul>

            <div className="mt-5 pt-4 border-t border-border">
              <h3 className="text-[13px] font-semibold mb-2">Edit assignment</h3>
              <p className="mm-secondary mb-3">
                Move leads from one member to another without editing each lead. Creates a new history
                entry; original is kept.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="mm-label">From</label>
                  <select
                    value={moveFrom}
                    onChange={(e) => setMoveFrom(e.target.value)}
                    className="mm-input"
                  >
                    {(detail.lines || []).map((l) => (
                      <option key={l.userId} value={l.userId}>
                        {l.userName || l.userEmail} ({l.leadCount})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mm-label">To</label>
                  <select
                    value={moveTo}
                    onChange={(e) => setMoveTo(e.target.value)}
                    className="mm-input"
                  >
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name?.trim() || m.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mm-label">Count</label>
                  <input
                    type="number"
                    min={1}
                    value={moveCount}
                    onChange={(e) => setMoveCount(e.target.value)}
                    className="mm-input tabular-nums"
                  />
                </div>
              </div>
              <button
                type="button"
                disabled={moving}
                onClick={() => void runMove()}
                className={`mt-3 w-full mm-btn mm-btn-primary ${moving ? "mm-btn-loading" : ""}`}
              >
                {moving ? "Moving…" : "Move leads"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
