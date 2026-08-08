"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { PORTAL_TOKENS, PORTAL_USER_KEYS } from "@/lib/portal-config";
import { toast } from "sonner";
import { PasswordInput } from "@/components/ui/PasswordInput";

const INPUT_CLASS =
  "portal-login-input w-full min-h-11 px-4 py-3 bg-background border border-border rounded-xl text-base sm:text-sm text-foreground placeholder:text-muted-foreground";

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("team@massivementor.in");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem(PORTAL_TOKENS.admin);
    if (t) {
      setHasSession(true);
      router.replace("/admin");
    }
  }, [router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await api.platformLogin(email, password);
    if (res.success && res.data?.token) {
      localStorage.setItem(PORTAL_TOKENS.admin, res.data.token);
      localStorage.setItem(PORTAL_USER_KEYS.admin, JSON.stringify(res.data.user));
      localStorage.removeItem(PORTAL_TOKENS.customer);
      localStorage.removeItem("massive_mentor_demo_mode");
      // Seed next-themes storage; ThemeSync applies on portal load (same as CRM)
      try {
        const pref = (res.data.user as { themePreference?: string })?.themePreference;
        if (pref === "light" || pref === "dark" || pref === "system") {
          localStorage.setItem("massive_mentor_theme", pref);
        }
      } catch {
        /* ignore */
      }
      toast.success("Signed in to Super Admin");
      router.push("/admin");
    } else {
      toast.error(res.error || "Login failed");
    }
    setBusy(false);
  };

  if (hasSession) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Opening Super Admin…</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30 text-xs font-medium mb-4">
            SUPER ADMIN PORTAL
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight">
            Massive Mentor Platform
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">
            Internal staff only. Completely isolated from customer CRM authentication.
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8">
          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label htmlFor="admin-email" className="block text-sm text-muted-foreground mb-2">
                Staff email
              </label>
              <input
                id="admin-email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={INPUT_CLASS}
                placeholder="team@massivementor.in"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="admin-password" className="block text-sm text-muted-foreground">
                  Password
                </label>
                <Link
                  href="/admin/forgot-password"
                  className="text-xs text-muted-foreground hover:text-violet-300 underline"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                id="admin-password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={INPUT_CLASS}
                placeholder="Enter password"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-12 bg-violet-500 hover:bg-violet-400 text-white font-semibold rounded-xl disabled:opacity-50 touch-manipulation"
            >
              {busy ? "Signing in…" : "Sign in to Platform"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Customers use crm.massivementor.in · Demo uses demo.massivementor.in
        </p>
      </div>
    </div>
  );
}
