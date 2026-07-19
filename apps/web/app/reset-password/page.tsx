"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PasswordRulesChecklist, passwordMeetsPolicy } from "@/lib/password-rules";
import { PasswordInput } from "@/components/ui/PasswordInput";

const INPUT =
  "portal-login-input w-full min-h-11 px-4 py-3 bg-zinc-950 border border-zinc-700 rounded-xl text-base sm:text-sm text-white placeholder:text-zinc-400";

function ResetPasswordForm() {
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
      setValid(false);
      setError("Missing reset token. Request a new link from the login page.");
      return;
    }
    (async () => {
      const res = await api.validateResetToken(token);
      setChecking(false);
      if (res.success && res.data?.valid !== false && !res.error) {
        // API returns success with valid payload
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
    const res = await api.resetPassword({
      token,
      password,
      confirmPassword: confirm,
    });
    setBusy(false);
    if (res.success) {
      toast.success(res.data?.message || "Password updated. Please sign in.");
      // Clear any stale sessions in this browser
      try {
        localStorage.removeItem("massive_mentor_token");
        localStorage.removeItem("massive_mentor_user");
      } catch {
        /* ignore */
      }
      router.replace("/login");
    } else {
      toast.error(res.error || "Reset failed");
      setError(res.error || "Reset failed");
    }
  };

  if (checking) {
    return (
      <div className="text-center text-zinc-500 text-sm py-8">Validating reset link…</div>
    );
  }

  if (!valid) {
    return (
      <div className="space-y-4 text-sm">
        <p className="text-red-400">{error || "Invalid or expired reset link"}</p>
        <Link href="/forgot-password" className="text-white underline">
          Request a new reset link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {emailHint && (
        <p className="text-xs text-zinc-500">
          Resetting password for <span className="text-zinc-300">{emailHint}</span>
        </p>
      )}
      <div>
        <label htmlFor="np" className="block text-sm text-zinc-300 mb-2">
          New password
        </label>
        <PasswordInput
          id="np"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT}
          placeholder="Create a strong password"
        />
        <PasswordRulesChecklist password={password} />
      </div>
      <div>
        <label htmlFor="cp" className="block text-sm text-zinc-300 mb-2">
          Confirm password
        </label>
        <PasswordInput
          id="cp"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={INPUT}
          placeholder="Repeat password"
        />
        {confirm.length > 0 && !match && (
          <p className="text-xs text-red-400 mt-1.5">Passwords do not match</p>
        )}
        {match && confirm.length > 0 && (
          <p className="text-xs text-emerald-400 mt-1.5">Passwords match</p>
        )}
      </div>
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full min-h-12 bg-white text-zinc-950 font-semibold rounded-xl disabled:opacity-40"
      >
        {busy ? "Updating…" : "Update password"}
      </button>
      <p className="text-xs text-zinc-500 text-center">
        After reset, all existing sessions are signed out. You must log in again.
      </p>
    </form>
  );
}

export default function CustomerResetPasswordPage() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-zinc-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-medium mb-4">
            CUSTOMER PORTAL
          </div>
          <h1 className="text-2xl font-semibold text-white">Reset password</h1>
          <p className="mt-2 text-zinc-400 text-sm">Choose a new secure password for your account.</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8">
          <Suspense fallback={<div className="text-zinc-500 text-sm">Loading…</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
        <p className="text-center text-sm text-zinc-500 mt-6">
          <Link href="/login" className="underline hover:text-zinc-300">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
