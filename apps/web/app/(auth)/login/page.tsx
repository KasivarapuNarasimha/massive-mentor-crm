"use client";

import { useState, useEffect } from "react";
import { useAuth, type LoginResult } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { PasswordInput } from "@/components/ui/PasswordInput";

type SessionConflict = NonNullable<
  Extract<LoginResult, { sessionLimit?: unknown }>["sessionLimit"]
>;

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionConflict, setSessionConflict] = useState<SessionConflict | null>(null);

  const { login, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, router]);

  const finishLogin = async () => {
    const home =
      (typeof window !== "undefined" &&
        localStorage.getItem("massive_mentor_portal_home")) ||
      "/dashboard";
    try {
      const token = localStorage.getItem("massive_mentor_token");
      if (token) {
        const { api } = await import("@/lib/api");
        const portalRes = await api.getCurrentPortal(token);
        if (portalRes.success && portalRes.data?.homeRoute) {
          localStorage.setItem("massive_mentor_portal_home", portalRes.data.homeRoute);
          localStorage.setItem(
            "massive_mentor_dashboard_key",
            portalRes.data.defaultDashboardKey || "main"
          );
          router.push(portalRes.data.homeRoute);
          return;
        }
      }
    } catch {
      /* fall through */
    }
    router.push(home);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSessionConflict(null);

    const result = await login(email, password);

    if (result.success) {
      await finishLogin();
    } else if (result.code === "SESSION_LIMIT" && result.sessionLimit) {
      setSessionConflict(result.sessionLimit);
    } else {
      toast.error(result.error || "Login failed. Please try again.");
    }

    setIsSubmitting(false);
  };

  const continueAndLogoutPrevious = async () => {
    setIsSubmitting(true);
    const result = await login(email, password, { forceNewSession: true });
    if (result.success) {
      setSessionConflict(null);
      toast.success("Previous session ended. You're signed in.");
      await finishLogin();
    } else {
      toast.error(result.error || "Could not take over session");
    }
    setIsSubmitting(false);
  };

  const TRIAL_WHATSAPP_URL =
    "https://wa.me/919182920047?text=Hi%20Massive%20Mentor,%20I%20want%20a%20CRM%20trial.";

  const openTrialWhatsApp = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const w = window.open(TRIAL_WHATSAPP_URL, "_blank", "noopener,noreferrer");
    if (!w) {
      window.location.href = TRIAL_WHATSAPP_URL;
    }
  };

  if (isAuthenticated) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-zinc-950">
        <div className="text-zinc-400 text-sm">Opening dashboard…</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-zinc-950 px-4 py-8 safe-x safe-bottom">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-medium mb-4">
            CUSTOMER PORTAL
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
            Massive Mentor
          </h1>
          <p className="mt-2 text-zinc-400 text-sm sm:text-base">
            Sign in to your business CRM workspace
          </p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5 adaptive-form">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-zinc-300 mb-2">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-3 sm:py-2.5 text-base sm:text-sm min-h-11 bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20"
                placeholder="you@business.com"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="password" className="block text-sm font-medium text-zinc-300">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-zinc-400 hover:text-white underline"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-4 py-3 sm:py-2.5 text-base sm:text-sm min-h-11 bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full min-h-12 bg-white text-zinc-950 font-medium py-3 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2 touch-manipulation"
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-zinc-400">
            Don&apos;t have an account?{" "}
            <button
              type="button"
              onClick={openTrialWhatsApp}
              className="text-white hover:underline font-medium touch-manipulation cursor-pointer bg-transparent border-0 p-0 inline align-baseline"
            >
              Contact sales for a trial
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-zinc-500 mt-8 space-y-1">
          <span className="block">AI-powered business growth platform</span>
          <span className="block text-zinc-600">
            Each employee must use their own login — sharing accounts is not allowed.
          </span>
        </p>
      </div>

      {/* Concurrent session conflict */}
      {sessionConflict && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-limit-title"
        >
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl p-5 sm:p-6">
            <h2 id="session-limit-title" className="text-lg font-semibold text-white tracking-tight">
              Account already active
            </h2>
            <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
              This account is already active on another device
              {sessionConflict.maxSessions === 1
                ? " (your plan allows 1 concurrent session)."
                : ` (limit: ${sessionConflict.maxSessions} sessions).`}
            </p>
            {sessionConflict.activeSessions.length > 0 && (
              <ul className="mt-4 space-y-2 max-h-40 overflow-y-auto">
                {sessionConflict.activeSessions.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400"
                  >
                    <div className="text-zinc-200 font-medium">
                      {s.deviceName || "Unknown device"}
                    </div>
                    <div>
                      {s.ipAddress || "—"}
                      {s.locationLabel ? ` · ${s.locationLabel}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void continueAndLogoutPrevious()}
                className="flex-1 min-h-11 rounded-xl bg-white text-zinc-950 font-semibold text-sm disabled:opacity-50"
              >
                Continue and log out previous session
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setSessionConflict(null)}
                className="flex-1 min-h-11 rounded-xl border border-zinc-700 text-zinc-300 text-sm hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
