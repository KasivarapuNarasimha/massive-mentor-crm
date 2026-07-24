"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { toast } from "sonner";

const INPUT =
  "portal-login-input w-full min-h-11 px-4 py-3 bg-background border border-border rounded-xl text-base sm:text-sm text-foreground placeholder:text-muted-foreground";

export default function CustomerForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await api.forgotPassword(email.trim());
    setBusy(false);
    // Always same UX message (anti-enumeration)
    setSent(true);
    const msg =
      res.data?.message ||
      "If an account exists with this email, a password reset link has been sent.";
    toast.success(msg);
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-medium mb-4">
            CUSTOMER PORTAL
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Forgot password</h1>
          <p className="mt-2 text-muted-foreground text-sm">
            Enter your registered email. We&apos;ll send a secure reset link if an account exists.
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8">
          {sent ? (
            <div className="space-y-4 text-sm text-muted-foreground">
              <p>
                If an account exists with this email, a password reset link has been sent.
              </p>
              <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-3 text-xs text-emerald-100/90 space-y-2">
                <p className="font-semibold text-emerald-200">Check your inbox</p>
                <p>
                  If SMTP is configured on the API (<code className="text-emerald-200">apps/api/.env</code>),
                  the reset link is sent to your email (Hostinger). Also check spam.
                </p>
                <p className="text-muted-foreground">
                  In development, the same link is also printed in the <strong>API terminal</strong> (port 4000)
                  under <span className="font-mono text-[11px]">PASSWORD RESET / EMAIL</span> as a fallback.
                  After changing SMTP settings, restart the API — <code className="text-muted-foreground">tsx watch</code> does not reload{" "}
                  <code className="text-muted-foreground">.env</code>.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                The link expires in 30 minutes and can only be used once.
              </p>
              <Link href="/login" className="inline-block text-foreground underline font-medium">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-5">
              <div>
                <label htmlFor="fp-email" className="block text-sm text-muted-foreground mb-2">
                  Email address
                </label>
                <input
                  id="fp-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={INPUT}
                  placeholder="you@business.com"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-12 bg-primary text-primary-foreground font-medium rounded-xl disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send reset link"}
              </button>
              <p className="text-center text-sm text-muted-foreground">
                <Link href="/login" className="text-muted-foreground hover:text-foreground underline">
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
