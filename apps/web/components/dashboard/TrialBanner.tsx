"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { subscribeDataChanged } from "@/lib/data-events";

/**
 * Top trial countdown banner — blue / orange / red by days remaining.
 * Hides immediately when Super Admin / payment ends trial (poll + events).
 */
export function TrialBanner() {
  const { token, isAuthenticated } = useAuth();
  const [days, setDays] = useState<number | null>(null);
  const [isTrial, setIsTrial] = useState(false);
  const [planLabel, setPlanLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !isAuthenticated) return;
    let cancelled = false;

    const load = async () => {
      const res = await api.get<{
        access: {
          allowed: boolean;
          isTrial: boolean;
          trialDaysRemaining: number | null;
          reason?: string;
          plan?: string | null;
          planStatus?: string;
        };
      }>("/billing/access", token);
      if (cancelled || !res.success || !res.data?.access) return;
      const a = res.data.access;
      if (!a.allowed && a.reason) {
        setIsTrial(false);
        return;
      }
      // Paid active plan must never show trial chrome
      const paidActive =
        !a.isTrial &&
        a.plan &&
        a.plan !== "trial" &&
        (a.planStatus === "active" || a.planStatus === "past_due");
      if (paidActive) {
        setIsTrial(false);
        setDays(null);
        setPlanLabel(a.plan || null);
        return;
      }
      setIsTrial(!!a.isTrial);
      setPlanLabel(a.plan || null);
      const rem = a.trialDaysRemaining;
      setDays(rem == null ? null : Math.min(Math.max(0, rem), 3));
    };

    void load();
    const unsub = subscribeDataChanged((ev) => {
      if (ev.module === "billing" || ev.module === "all") void load();
    });
    const poll = window.setInterval(() => void load(), 45_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);

    return () => {
      cancelled = true;
      unsub();
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [token, isAuthenticated]);

  if (!isTrial || days == null) return null;

  const tone =
    days <= 0
      ? "bg-red-950/95 border-red-800 text-red-100"
      : days === 1
        ? "bg-red-950/90 border-red-800/80 text-red-100"
        : days === 2
          ? "bg-amber-950/90 border-amber-700/80 text-amber-100"
          : "bg-sky-950/90 border-sky-800/80 text-sky-100";

  const msg =
    days <= 0
      ? "Today is your last trial day."
      : days === 1
        ? "Only 1 day remaining."
        : days === 2
          ? "Only 2 days remaining."
          : `Your Free Trial expires in ${days} days.`;

  return (
    <div
      className={`w-full border-b px-3 sm:px-5 py-2 text-xs sm:text-sm flex flex-wrap items-center justify-between gap-2 ${tone}`}
      role="status"
      data-testid="trial-banner"
    >
      <span className="font-medium">
        {msg}
        {planLabel && planLabel !== "trial" ? (
          <span className="opacity-80 font-normal"> · Preview plan: {planLabel}</span>
        ) : null}
      </span>
      <Link
        href="/dashboard/billing"
        className="underline font-semibold shrink-0 hover:opacity-90"
      >
        Upgrade plan
      </Link>
    </div>
  );
}
