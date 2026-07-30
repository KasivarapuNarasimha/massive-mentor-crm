"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { toast } from "sonner";

const INPUT =
  "portal-login-input w-full min-h-11 px-4 py-3 bg-background border border-border rounded-xl text-base sm:text-sm text-foreground placeholder:text-muted-foreground";

export default function AdminForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.platformForgotPassword(email.trim());
      if (!res.success) {
        toast.error(
          res.error ||
            "We could not send the reset email. Please try again or contact support."
        );
        return;
      }
      setSent(true);
      toast.success(
        res.data?.message ||
          "If an account exists with this email, a password reset link has been sent."
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Network error while sending reset email. Please try again."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex px-3 py-1 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30 text-xs font-medium mb-4">
            SUPER ADMIN PORTAL
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Forgot password</h1>
          <p className="mt-2 text-muted-foreground text-sm">
            Staff accounts only. A secure one-time link will be emailed if the address is registered.
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8">
          {sent ? (
            <div className="space-y-4 text-sm text-muted-foreground">
              <p>
                If an account exists with this email, a password reset link has been sent.
              </p>
              <div className="rounded-xl border border-violet-800/40 bg-violet-950/20 p-3 text-xs text-violet-100/90 space-y-2">
                <p className="font-semibold text-violet-200">Check your staff inbox</p>
                <p>
                  When SMTP is set in <code className="text-violet-200">apps/api/.env</code>, the reset link is
                  emailed via Hostinger. Check spam if needed.
                </p>
                <p className="text-muted-foreground">
                  In development the API also prints the link under{" "}
                  <span className="font-mono text-[11px]">PASSWORD RESET / EMAIL</span> (port 4000). After
                  editing SMTP_*, restart the API — <code className="text-muted-foreground">tsx watch</code> does not
                  reload <code className="text-muted-foreground">.env</code>.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Link expires in 30 minutes and is single-use.
              </p>
              <Link href="/admin/login" className="inline-block text-violet-300 underline">
                Back to Super Admin sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-5">
              <div>
                <label htmlFor="afp-email" className="block text-sm text-muted-foreground mb-2">
                  Staff email
                </label>
                <input
                  id="afp-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={INPUT}
                  placeholder="team@massivementor.in"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-12 bg-violet-500 text-white font-semibold rounded-xl disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send reset link"}
              </button>
              <p className="text-center text-sm text-muted-foreground">
                <Link href="/admin/login" className="hover:text-muted-foreground underline">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
