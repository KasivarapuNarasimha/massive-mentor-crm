"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

const CONTACT_SALES_MAILTO =
  "mailto:team@massivementor.in?subject=CRM%20Subscription%20Inquiry";

const WHATSAPP_URL =
  "https://wa.me/919182920047?text=Hi%20Massive%20Mentor,%20I%20want%20to%20subscribe%20to%20the%20CRM.";

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

  const openContactSales = () => {
    // window.open works on desktop; assign fallback for mobile mail clients
    const w = window.open(CONTACT_SALES_MAILTO, "_blank");
    if (!w) {
      window.location.href = CONTACT_SALES_MAILTO;
    }
  };

  const openWhatsApp = () => {
    const w = window.open(WHATSAPP_URL, "_blank", "noopener,noreferrer");
    if (!w) {
      window.location.href = WHATSAPP_URL;
    }
  };

  const title =
    reason === "suspended"
      ? "Account suspended"
      : reason === "subscription_expired"
        ? "Subscription expired"
        : "Your Free Trial has expired";

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-3xl p-8 sm:p-10 text-center shadow-2xl">
        <div className="text-xs uppercase tracking-widest text-amber-400/90 mb-3">
          Massive Mentor CRM
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">{title}</h1>
        {bizName && <p className="text-sm text-zinc-500 mb-2">{bizName}</p>}
        <p className="text-zinc-400 text-sm sm:text-base leading-relaxed mb-8">
          Please subscribe to continue using Massive Mentor CRM. Your data is safe — unlock full
          access with a plan that fits your team.
        </p>

        <div className="flex flex-col gap-3">
          <Link
            href="/dashboard/billing"
            className="min-h-12 flex items-center justify-center rounded-xl bg-white text-zinc-950 font-semibold hover:bg-zinc-200"
          >
            Subscribe
          </Link>
          <button
            type="button"
            onClick={openContactSales}
            className="min-h-12 flex items-center justify-center rounded-xl bg-white/10 border border-zinc-700 font-medium hover:bg-white/15 touch-manipulation"
          >
            Contact Sales
          </button>
          <button
            type="button"
            onClick={openWhatsApp}
            className="min-h-12 flex items-center justify-center rounded-xl bg-emerald-600/90 text-white font-medium hover:bg-emerald-500 touch-manipulation"
          >
            WhatsApp
          </button>
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
