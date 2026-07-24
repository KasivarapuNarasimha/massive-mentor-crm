"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PasswordRulesChecklist, passwordMeetsPolicy } from "@/lib/password-rules";
import { PORTAL_TOKENS, PORTAL_USER_KEYS } from "@/lib/portal-config";
import { PasswordInput } from "@/components/ui/PasswordInput";

const INPUT =
  "portal-login-input w-full min-h-11 px-4 py-3 bg-background border border-border rounded-xl text-base sm:text-sm text-foreground placeholder:text-muted-foreground";

function AdminResetForm() {
  const router = useRouter();
  const search = useSearchParams();
  const token = search.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setChecking(false);
      setError("Missing reset token.");
      return;
    }
    (async () => {
      const res = await api.platformValidateResetToken(token);
      setChecking(false);
      if (res.success && !res.error) {
        setValid(true);
        setEmailHint(res.data?.emailHint || null);
      } else {
        setValid(false);
        setError(res.error || "Invalid or expired reset link");
      }
    })();
  }, [token]);

  const match = password.length > 0 && password === confirm;
  const canSubmit = useMemo(
    () => passwordMeetsPolicy(password) && match && !!token && valid && !busy,
    [password, match, token, valid, busy]
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    const res = await api.platformResetPassword({
      token,
      password,
      confirmPassword: confirm,
    });
    setBusy(false);
    if (res.success) {
      toast.success(res.data?.message || "Password updated. Sign in again.");
      try {
        localStorage.removeItem(PORTAL_TOKENS.admin);
        localStorage.removeItem(PORTAL_USER_KEYS.admin);
      } catch {
        /* ignore */
      }
      router.replace("/admin/login");
    } else {
      toast.error(res.error || "Reset failed");
      setError(res.error || "Reset failed");
    }
  };

  if (checking) return <div className="text-muted-foreground text-sm py-6">Validating…</div>;
  if (!valid) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-red-400">{error}</p>
        <Link href="/admin/forgot-password" className="text-violet-300 underline">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {emailHint && (
        <p className="text-xs text-muted-foreground">
          Account <span className="text-muted-foreground">{emailHint}</span>
        </p>
      )}
      <div>
        <label htmlFor="admin-np" className="block text-sm text-muted-foreground mb-2">
          New password
        </label>
        <PasswordInput
          id="admin-np"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT}
        />
        <PasswordRulesChecklist password={password} />
      </div>
      <div>
        <label htmlFor="admin-cp" className="block text-sm text-muted-foreground mb-2">
          Confirm password
        </label>
        <PasswordInput
          id="admin-cp"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={INPUT}
        />
        {confirm.length > 0 && !match && (
          <p className="text-xs text-red-400 mt-1.5">Passwords do not match</p>
        )}
      </div>
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full min-h-12 bg-violet-500 text-white font-semibold rounded-xl disabled:opacity-40"
      >
        {busy ? "Updating…" : "Update password"}
      </button>
      <p className="text-xs text-muted-foreground text-center">
        All Super Admin sessions will be revoked immediately.
      </p>
    </form>
  );
}

export default function AdminResetPasswordPage() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex px-3 py-1 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30 text-xs font-medium mb-4">
            SUPER ADMIN PORTAL
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Reset password</h1>
        </div>
        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8">
          <Suspense fallback={<div className="text-muted-foreground text-sm">Loading…</div>}>
            <AdminResetForm />
          </Suspense>
        </div>
        <p className="text-center text-sm text-muted-foreground mt-6">
          <Link href="/admin/login" className="underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
