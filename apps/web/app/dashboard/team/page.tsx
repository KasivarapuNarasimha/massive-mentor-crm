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

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-5 lg:py-6 overflow-x-hidden pb-20 md:pb-6">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-5">
        <div className="min-w-0">
          <h1 className="mm-page-title">Team & Roles</h1>
          <p className="mm-secondary mt-1">
            Your role:{" "}
            <span className="font-mono text-foreground">{portal?.role || role}</span>
            {portal ? (
              <span> · Portal: {portal.portalLabel}</span>
            ) : null}
          </p>
          <p className="mm-secondary mt-1">
            Each employee signs in with their own email and password. Their role loads the matching
            dashboard, sidebar, charts, AI tools, and permissions automatically.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="mm-btn mm-btn-primary w-full sm:w-auto focus-ring touch-manipulation"
          >
            {showCreate ? "Close" : "Add Team Member"}
          </button>
        )}
      </div>

      {canManage && showCreate && (
        <form
          onSubmit={createUser}
          className="mm-card p-4 sm:p-5 mb-4 space-y-3 adaptive-form"
        >
          <h3 className="text-[13px] font-semibold text-foreground">Create user (email + password + role)</h3>
          <p className="mm-secondary">
            User joins this business. On login they only see the portal for their assigned role.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mm-label">Name</label>
              <input
                className="mm-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="mm-label">Role *</label>
              <select
                className="mm-input"
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
              <label className="mm-label">Email *</label>
              <input
                className="mm-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="user@company.com"
              />
            </div>
            <div>
              <label className="mm-label">Password *</label>
              <PasswordInput
                className="mm-input"
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
            className={`mm-btn mm-btn-primary focus-ring ${submitting ? "mm-btn-loading" : ""}`}
          >
            {submitting ? "Creating…" : "Create user"}
          </button>
        </form>
      )}

      <div className="mm-card p-4 sm:p-5">
        <h3 className="text-[13px] font-semibold text-foreground mb-3">Business users</h3>
        {loading ? (
          <div className="h-24 animate-pulse bg-muted rounded-lg" />
        ) : users.length === 0 ? (
          <div className="py-10 text-center space-y-3">
            <p className="mm-secondary font-medium">No team members yet</p>
            {canManage && (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="mm-btn mm-btn-primary focus-ring"
              >
                Add Team Member
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {users.map((u) => {
              const isSelf = u.id === user?.id;
              const disabled = u.isDisabled || u.status === "disabled";
              return (
                <div
                  key={u.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border border-border bg-background"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 rounded-full bg-muted border border-border flex items-center justify-center text-sm font-semibold shrink-0">
                      {(u.name || u.email || "?")[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-foreground truncate">
                        {u.name || "—"}
                        {isSelf && (
                          <span className="ml-2 text-[10px] text-muted-foreground font-normal">(you)</span>
                        )}
                        {u.isOwner && (
                          <span className="mm-badge mm-badge-success ml-2">owner</span>
                        )}
                      </div>
                      <div className="mm-secondary truncate">{u.email}</div>
                      <div className="mm-secondary mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
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
                      className={
                        disabled
                          ? "mm-badge mm-badge-danger"
                          : "mm-badge mm-badge-success"
                      }
                    >
                      {disabled ? "Disabled" : "Active"}
                    </span>

                    {canManage ? (
                      <select
                        className="mm-input w-auto max-w-[140px] h-9 min-h-9 text-xs py-0"
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
                      <span className="font-mono text-xs text-muted-foreground">{u.role}</span>
                    )}

                    {canManage && !isSelf && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEdit(u)}
                          className="mm-btn mm-btn-secondary h-9 px-3 text-xs"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleDisable(u)}
                          className="mm-btn mm-btn-secondary h-9 px-3 text-xs"
                        >
                          {disabled ? "Enable" : "Disable"}
                        </button>
                        {!u.isOwner && (
                          <button
                            type="button"
                            onClick={() => deleteUser(u)}
                            className="mm-btn mm-btn-danger h-9 px-3 text-xs"
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
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4" role="dialog">
          <div className="absolute inset-0 bg-black/50 dark:bg-black/60" onClick={() => setEditUser(null)} />
          <form
            onSubmit={saveEdit}
            className="relative w-full sm:max-w-sm bg-card border border-border rounded-t-xl sm:rounded-lg p-4 sm:p-5 space-y-3 adaptive-form shadow-lg safe-bottom"
          >
            <h3 className="text-base font-semibold tracking-tight">Edit user</h3>
            <div>
              <label className="mm-label">Name</label>
              <input className="mm-input" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div>
              <label className="mm-label">Email</label>
              <input
                className="mm-input"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mm-label">Role</label>
              <select className="mm-input" value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label || roleLabel(r.key)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mm-label">New password (optional)</label>
              <PasswordInput
                className="mm-input"
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
                className="mm-btn mm-btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className={`mm-btn mm-btn-primary flex-1 focus-ring ${editSaving ? "mm-btn-loading" : ""}`}
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
