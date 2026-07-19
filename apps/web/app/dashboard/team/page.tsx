"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { usePortal } from "@/lib/portal-context";
import { PasswordInput } from "@/components/ui/PasswordInput";

type BizUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isDisabled?: boolean;
  status?: "active" | "disabled";
  isOwner?: boolean;
  lastLoginAt?: string | null;
  activeSessions?: number;
  deviceCount?: number;
  passwordChangedAt?: string | null;
};

type RoleOpt = { key: string; label: string };

function roleLabel(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function TeamPage() {
  const { token, role, user } = useAuth();
  const { portal } = usePortal();
  const [users, setUsers] = useState<BizUser[]>([]);
  const [roles, setRoles] = useState<RoleOpt[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState("sales_executive");
  const [submitting, setSubmitting] = useState(false);

  const [editUser, setEditUser] = useState<BizUser | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const canManage =
    ["business_admin", "admin", "owner", "ceo"].includes(role) ||
    ["business_admin", "admin", "owner", "ceo"].includes(portal?.role || "");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const [u, r] = await Promise.all([
      api.listBusinessUsers(token),
      api.listAssignableRoles(token),
    ]);
    if (u.success && u.data?.users) setUsers(u.data.users);
    else if (!u.success) toast.error(u.error || "Failed to load users");
    if (r.success && r.data?.roles) {
      setRoles(r.data.roles);
      if (r.data.roles[0]) {
        setNewRole((prev) =>
          r.data!.roles.find((x) => x.key === prev) ? prev : r.data!.roles[0].key
        );
      }
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    const res = await api.createBusinessUser(
      { email, password, name: name || undefined, role: newRole },
      token
    );
    if (res.success) {
      toast.success(
        res.data?.created
          ? "User created — they log in with their own email & password"
          : "Existing user added to business"
      );
      setName("");
      setEmail("");
      setPassword("");
      setShowCreate(false);
      await load();
    } else {
      toast.error(res.error || "Failed to create user");
    }
    setSubmitting(false);
  };

  const openEdit = (u: BizUser) => {
    setEditUser(u);
    setEditName(u.name || "");
    setEditEmail(u.email);
    setEditRole(u.role);
    setEditPassword("");
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !editUser) return;
    setEditSaving(true);
    const res = await api.updateBusinessUser(
      editUser.id,
      {
        name: editName,
        email: editEmail,
        role: editRole,
        ...(editPassword ? { password: editPassword } : {}),
      },
      token
    );
    if (res.success) {
      toast.success("User updated");
      setEditUser(null);
      await load();
    } else {
      toast.error(res.error || "Failed to update user");
    }
    setEditSaving(false);
  };

  const changeRole = async (userId: string, roleKey: string) => {
    if (!token) return;
    const res = await api.updateBusinessUserRole(userId, roleKey, token);
    if (res.success) {
      toast.success("Role assigned — user sees that role portal after login");
      await load();
    } else toast.error(res.error || "Failed to update role");
  };

  const toggleDisable = async (u: BizUser) => {
    if (!token) return;
    const next = !u.isDisabled;
    if (
      next &&
      !confirm(`Disable ${u.name || u.email}? They will not be able to sign in.`)
    ) {
      return;
    }
    const res = await api.setBusinessUserDisabled(u.id, next, token);
    if (res.success) {
      toast.success(next ? "User disabled" : "User enabled");
      await load();
    } else toast.error(res.error || "Failed to update status");
  };

  const deleteUser = async (u: BizUser) => {
    if (!token) return;
    if (!confirm(`Delete ${u.name || u.email} from this business?`)) return;
    const res = await api.deleteBusinessUser(u.id, token);
    if (res.success) {
      toast.success("User removed");
      await load();
    } else toast.error(res.error || "Failed to delete user");
  };

  const inputClass =
    "w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-600";

  return (
    <div className="w-full max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold mb-2">Team & Roles</h1>
          <p className="text-zinc-400 text-sm">
            Your role:{" "}
            <span className="font-mono text-zinc-200">{portal?.role || role}</span>
            {portal ? (
              <span className="text-zinc-500"> · Portal: {portal.portalLabel}</span>
            ) : null}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            Each employee signs in with their own email and password. Their role loads the matching
            dashboard, sidebar, charts, AI tools, and permissions automatically.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="w-full sm:w-auto min-h-11 px-4 py-2.5 bg-white text-zinc-950 rounded-xl text-sm font-medium touch-manipulation"
          >
            {showCreate ? "Close" : "Add Team Member"}
          </button>
        )}
      </div>

      {canManage && showCreate && (
        <form
          onSubmit={createUser}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6 space-y-4"
        >
          <h3 className="font-semibold">Create user (email + password + role)</h3>
          <p className="text-xs text-zinc-500">
            User joins this business. On login they only see the portal for their assigned role.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Name</label>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Role *</label>
              <select
                className={inputClass}
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                required
              >
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label || roleLabel(r.key)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Email *</label>
              <input
                className={inputClass}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="user@company.com"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Password *</label>
              <PasswordInput
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="Min 8 characters"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2.5 bg-white text-zinc-950 rounded-xl font-medium disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create user"}
          </button>
        </form>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        <h3 className="font-semibold mb-4">Business users</h3>
        {loading ? (
          <div className="h-24 animate-pulse bg-zinc-800 rounded-xl" />
        ) : users.length === 0 ? (
          <div className="py-10 text-center space-y-3">
            <p className="text-sm text-zinc-300 font-medium">No team members yet</p>
            {canManage && (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="px-5 py-2.5 bg-white text-zinc-950 rounded-xl text-sm font-medium"
              >
                Add Team Member
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {users.map((u) => {
              const isSelf = u.id === user?.id;
              const disabled = u.isDisabled || u.status === "disabled";
              return (
                <div
                  key={u.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border border-zinc-800 bg-zinc-950/50"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-full bg-zinc-700 ring-1 ring-zinc-600 flex items-center justify-center text-sm font-semibold shrink-0">
                      {(u.name || u.email || "?")[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white truncate">
                        {u.name || "—"}
                        {isSelf && (
                          <span className="ml-2 text-[10px] text-zinc-500 font-normal">(you)</span>
                        )}
                        {u.isOwner && (
                          <span className="ml-2 text-[10px] text-emerald-500/80 font-normal">
                            owner
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 truncate">{u.email}</div>
                      <div className="text-[11px] text-zinc-600 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                        <span>
                          Last login:{" "}
                          {u.lastLoginAt
                            ? new Date(u.lastLoginAt).toLocaleString()
                            : "Never"}
                        </span>
                        <span>· Sessions: {u.activeSessions ?? 0}</span>
                        <span>· Devices: {u.deviceCount ?? 0}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        disabled
                          ? "border-red-500/40 text-red-400"
                          : "border-emerald-500/40 text-emerald-400"
                      }`}
                    >
                      {disabled ? "Disabled" : "Active"}
                    </span>

                    {canManage ? (
                      <select
                        className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-xs max-w-[140px]"
                        value={u.role}
                        onChange={(e) => changeRole(u.id, e.target.value)}
                        title="Assign role"
                      >
                        {roles.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.label || roleLabel(r.key)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="font-mono text-xs text-zinc-400">{u.role}</span>
                    )}

                    {canManage && !isSelf && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEdit(u)}
                          className="text-xs px-2 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleDisable(u)}
                          className="text-xs px-2 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                        >
                          {disabled ? "Enable" : "Disable"}
                        </button>
                        {!u.isOwner && (
                          <button
                            type="button"
                            onClick={() => deleteUser(u)}
                            className="text-xs px-2 py-1 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10"
                          >
                            Delete
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setEditUser(null)} />
          <form
            onSubmit={saveEdit}
            className="relative w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-6 space-y-3"
          >
            <h3 className="text-lg font-semibold">Edit user</h3>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Name</label>
              <input className={inputClass} value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Email</label>
              <input
                className={inputClass}
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Role</label>
              <select className={inputClass} value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label || roleLabel(r.key)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">New password (optional)</label>
              <PasswordInput
                className={inputClass}
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                placeholder="Leave blank to keep"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditUser(null)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm border border-zinc-700 text-zinc-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-white text-zinc-950 disabled:opacity-40"
              >
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
