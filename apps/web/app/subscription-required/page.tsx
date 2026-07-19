"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

export default function SubscriptionRequiredPage() {
  const { token, logout, isAuthenticated } = useAuth();
  const router = useRouter();
  const [reason, setReason] = useState<string>("trial_expired");
  const [bizName, setBizName] = useState("");

  useEffect(() => {
    if (!token) return;
    void (async () => {
      const res = await api.get<{
        access: {
          allowed: boolean;
          reason?: string;
          businessName?: string | null;
        };
      }>("/billing/access", token);
      if (res.success && res.data?.access) {
        if (res.data.access.allowed) {
          router.replace("/dashboard");
          return;
        }
        setReason(res.data.access.reason || "trial_expired");
        setBizName(res.data.access.businessName || "");
      }
    })();
  }, [token, router]);

  useEffect(() => {
    if (!isAuthenticated) router.replace("/login");
  }, [isAuthenticated, router]);

  const title =
    reason === "suspended"
      ? "Account suspended"
      : reason === "subscription_expired"
        ? "Subscription expired"
        : "Your Free Trial has expired";

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-3xl p-8 sm:p-10 text-center shadow-2xl">
        <div className="text-xs uppercase tracking-widest text-amber-400/90 mb-3">Massive Mentor CRM</div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">{title}</h1>
        {bizName && <p className="text-sm text-zinc-500 mb-2">{bizName}</p>}
        <p className="text-zinc-400 text-sm sm:text-base leading-relaxed mb-8">
          Please subscribe to continue using Massive Mentor CRM. Your data is safe — unlock full access
          with a plan that fits your team.
        </p>

        <div className="flex flex-col gap-3">
          <Link
            href="/dashboard/billing"
            className="min-h-12 flex items-center justify-center rounded-xl bg-white text-zinc-950 font-semibold hover:bg-zinc-200"
          >
            Subscribe
          </Link>
          <a
            href="mailto:team@massivementor.in?subject=CRM%20Subscription"
            className="min-h-12 flex items-center justify-center rounded-xl bg-white/10 border border-zinc-700 font-medium"
          >
            Contact Sales
          </a>
          <a
            href="https://wa.me/919000000000?text=Hi%2C%20I%20need%20help%20with%20Massive%20Mentor%20CRM%20subscription"
            target="_blank"
            rel="noreferrer"
            className="min-h-12 flex items-center justify-center rounded-xl bg-emerald-600/90 text-white font-medium"
          >
            WhatsApp
          </a>
          <button
            type="button"
            onClick={() => logout({ redirect: true })}
            className="min-h-11 text-sm text-zinc-500 hover:text-zinc-300"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
