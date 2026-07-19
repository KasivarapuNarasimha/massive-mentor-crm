"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";
import { PageShell } from "@/components/ui/PageShell";
import { usePlan } from "@/lib/plan-context";
import {
  ANNUAL_DISCOUNT_PCT,
  COMPARISON_ROWS,
  DEMO_MAILTO,
  PLAN_FEATURE_LISTS,
  PLAN_PRICING_META,
  SALES_EMAIL,
  SALES_MAILTO,
  displayPlanName,
  isEnterprisePlan,
  isProfessionalPlan,
  planCycle,
  planFamily,
  sortPlanFamilies,
  type BillingCycleFilter,
} from "@/lib/plan-entitlements";

type Plan = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  billingCycle: string;
  price: number;
  currency: string;
  maxUsers: number;
  storageGb?: number;
  features?: string[] | unknown;
};

type Overview = {
  access: {
    allowed: boolean;
    isTrial: boolean;
    trialDaysRemaining: number | null;
    planStatus: string;
    trialEndsAt?: string | null;
    subscriptionEndsAt?: string | null;
  };
  business: {
    id?: string;
    name: string;
    plan: string;
    planStatus: string;
    isTrial: boolean;
    isLocked: boolean;
    trialStartDate?: string | null;
    trialEndsAt?: string | null;
    trialDays?: number | null;
    subscriptionEndsAt?: string | null;
    renewalDate?: string | null;
    renewalDaysRemaining?: number | null;
    maxUsers?: number;
    createdAt?: string | null;
    currentPlan?: {
      name?: string;
      code?: string;
      billingCycle?: string;
      maxUsers?: number;
      storageGb?: number;
    } | null;
  };
  plans: Plan[];
  payments: Array<{
    id: string;
    amount: number;
    gst: number;
    status: string;
    invoiceNumber?: string | null;
    invoiceUrl?: string | null;
    createdAt: string;
    plan?: { name: string; code?: string } | null;
  }>;
  timeline?: Array<{ at: string; type: string; label: string; status: string }>;
  usage?: {
    maxUsers?: number;
    members?: number;
    contacts?: number;
    deals?: number;
  };
  razorpayKeyId?: string | null;
  razorpayEnabled?: boolean;
};

type CheckoutConfirm = {
  plan: Plan;
  purpose: string;
};

type PaySuccess = {
  planName: string;
  amount: number;
  currency: string;
  invoiceNumber?: string | null;
  paymentId: string;
};

type PayFailure = {
  reason: string;
  planCode?: string;
  purpose?: string;
};

type UiMode = "main" | "success" | "failure";

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => {
      open: () => void;
      on?: (event: string, cb: (resp: { error?: { description?: string } }) => void) => void;
    };
  }
}

function IconCheck({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function IconCross({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function PlanIcon({
  family,
  className = "h-7 w-7",
}: {
  family: "starter" | "professional" | "enterprise";
  className?: string;
}) {
  if (family === "professional") {
    return (
      <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.75}
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
    );
  }
  if (family === "enterprise") {
    return (
      <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.75}
          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
        />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
      />
    </svg>
  );
}

function ProgressBar({
  label,
  used,
  total,
  unit,
  tone = "violet",
}: {
  label: string;
  used: number;
  total: number;
  unit?: string;
  tone?: "violet" | "sky" | "amber";
}) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const bar =
    tone === "sky"
      ? "from-sky-500 to-cyan-400"
      : tone === "amber"
        ? "from-amber-500 to-orange-400"
        : "from-violet-500 to-fuchsia-400";
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-zinc-200">{label}</span>
        <span className="tabular-nums text-zinc-400">
          {used}
          {unit ? ` ${unit}` : ""} / {total}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <div
        className="h-2.5 rounded-full bg-zinc-800/90 overflow-hidden ring-1 ring-inset ring-zinc-700/50"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${used} of ${total}${unit ? " " + unit : ""}`}
      >
        <div
          className={`h-full rounded-full bg-gradient-to-r ${bar} transition-all duration-500 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-zinc-500">{pct}% used</p>
    </div>
  );
}

function familyOf(code: string, name: string): "starter" | "professional" | "enterprise" {
  if (isProfessionalPlan(code, name)) return "professional";
  if (isEnterprisePlan(code, name)) return "enterprise";
  return "starter";
}

export default function BillingPage() {
  const { token, user } = useAuth();
  const { refresh: refreshPlan } = usePlan();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");
  const [cycle, setCycle] = useState<BillingCycleFilter>("monthly");
  const [confirm, setConfirm] = useState<CheckoutConfirm | null>(null);
  const [uiMode, setUiMode] = useState<UiMode>("main");
  const [success, setSuccess] = useState<PaySuccess | null>(null);
  const [failure, setFailure] = useState<PayFailure | null>(null);
  const plansRef = useRef<HTMLElement | null>(null);
  const confirmTitleId = useId();
  const failTitleId = useId();
  const successTitleId = useId();

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await api.get<Overview>("/billing/overview", token);
    if (res.success && res.data) {
      setData(res.data);
      const currentCycle =
        planCycle(res.data.business?.plan, res.data.business?.currentPlan?.billingCycle) || null;
      if (currentCycle) setCycle(currentCycle);
    } else toast.error(res.error || "Failed to load billing");
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Focus trap helpers for modals
  useEffect(() => {
    if (!confirm && uiMode === "main") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirm) setConfirm(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, uiMode]);

  const pollUntilActive = async (paymentId: string) => {
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await api.get<{
        activated: boolean;
        status: string;
        invoiceNumber?: string | null;
      }>(`/billing/payments/${paymentId}/status`, token!);
      if (st.success && st.data?.activated) return st.data;
    }
    return null;
  };

  const runCheckout = async (
    planCode: string,
    opts?: { purpose?: string; previousPaymentId?: string; couponCode?: string }
  ) => {
    if (!token) return;
    if (!data?.razorpayEnabled) {
      toast.error("Online payments are not configured. Contact sales.");
      return;
    }
    const planMeta = (data.plans || []).find((p) => p.code === planCode);
    setBusyCode(planCode);
    const orderRes = await api.post<{
      keyId: string;
      orderId: string;
      amount: number;
      currency: string;
      paymentId: string;
      plan: { name: string; total: number };
      prefill: { name: string; email: string };
    }>(
      "/billing/checkout/order",
      {
        planCode,
        purpose: opts?.purpose || "checkout",
        previousPaymentId: opts?.previousPaymentId,
        couponCode: coupon || opts?.couponCode,
      },
      token
    );

    if (!orderRes.success || !orderRes.data) {
      setFailure({
        reason: orderRes.error || "Could not start checkout",
        planCode,
        purpose: opts?.purpose,
      });
      setUiMode("failure");
      setBusyCode(null);
      setConfirm(null);
      return;
    }

    const o = orderRes.data;
    if (!window.Razorpay) {
      setFailure({
        reason: "Razorpay SDK not loaded. Refresh and try again.",
        planCode,
        purpose: opts?.purpose,
      });
      setUiMode("failure");
      setBusyCode(null);
      setConfirm(null);
      return;
    }

    setConfirm(null);

    const rzp = new window.Razorpay({
      key: o.keyId,
      amount: o.amount,
      currency: o.currency,
      name: "Massive Mentor CRM",
      description: o.plan.name,
      order_id: o.orderId,
      prefill: o.prefill,
      theme: { color: "#7c3aed" },
      handler: async (response: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }) => {
        const verify = await api.post<{
          activated?: boolean;
          status?: string;
          message?: string;
          invoiceNumber?: string | null;
        }>(
          "/billing/checkout/verify",
          {
            ...response,
            paymentId: o.paymentId,
          },
          token
        );
        if (!verify.success) {
          setFailure({
            reason: verify.error || "Payment verification failed",
            planCode,
            purpose: opts?.purpose,
          });
          setUiMode("failure");
          setBusyCode(null);
          return;
        }

        const showSuccess = (invoiceNumber?: string | null) => {
          setSuccess({
            planName: o.plan.name || planMeta?.name || planCode,
            amount: o.plan.total ?? o.amount / 100,
            currency: o.currency || "INR",
            invoiceNumber: invoiceNumber || null,
            paymentId: o.paymentId,
          });
          setUiMode("success");
          setBusyCode(null);
          void load();
          void refreshPlan();
        };

        if (verify.data?.activated) {
          showSuccess(verify.data?.invoiceNumber);
          return;
        }
        toast.message(verify.data?.message || "Confirming payment with bank…");
        const activated = await pollUntilActive(o.paymentId);
        if (activated) {
          showSuccess(activated.invoiceNumber);
        } else {
          // Payment likely succeeded; activation pending webhook
          showSuccess(null);
          toast.message("Activation may take a minute if webhook is delayed.");
        }
      },
      modal: {
        ondismiss: () => {
          setBusyCode(null);
        },
      },
    });

    rzp.on?.("payment.failed", (resp) => {
      setFailure({
        reason: resp?.error?.description || "Payment was declined or cancelled.",
        planCode,
        purpose: opts?.purpose,
      });
      setUiMode("failure");
      setBusyCode(null);
    });

    rzp.open();
  };

  const requestSubscribe = (plan: Plan, purpose: string) => {
    if (isEnterprisePlan(plan.code, plan.name)) return;
    setConfirm({ plan, purpose });
  };

  const downloadInvoice = async (paymentId: string, invoiceNumber?: string | null) => {
    if (!token) return;
    const r = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api"}/billing/invoices/${paymentId}/pdf`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) {
      toast.error("Invoice PDF not ready yet. Try again shortly.");
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoiceNumber || paymentId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const scrollToPlans = () => {
    plansRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const biz = data?.business;
  const access = data?.access;

  const filteredPlans = useMemo(() => {
    const list = (data?.plans || []).filter(
      (p) => String(p.billingCycle).toLowerCase() === cycle
    );
    return sortPlanFamilies(list);
  }, [data?.plans, cycle]);

  const currentFamily = planFamily(biz?.plan);
  const currentCycle = planCycle(biz?.plan, biz?.currentPlan?.billingCycle);

  const trialDaysLeft =
    access?.isTrial && access.trialDaysRemaining != null
      ? Math.min(access.trialDaysRemaining, biz?.trialDays || 3)
      : access?.trialDaysRemaining;

  const storageGb =
    biz?.currentPlan?.storageGb ||
    (currentFamily === "enterprise" ? 500 : currentFamily === "professional" ? 50 : 5);
  const maxUsers = biz?.currentPlan?.maxUsers || biz?.maxUsers || data?.usage?.maxUsers || 5;
  const members = data?.usage?.members ?? 0;
  // Approximate storage used from contacts/deals (display only — no backend change)
  const storageUsedApprox = Math.min(
    storageGb,
    Math.round(((data?.usage?.contacts || 0) + (data?.usage?.deals || 0)) / 500) || 0
  );

  const displayPlanTitle = access?.isTrial
    ? "Free Trial"
    : currentFamily === "unknown"
      ? biz?.plan || "—"
      : currentFamily.charAt(0).toUpperCase() + currentFamily.slice(1);

  const statusLabel = access?.isTrial
    ? "Trial"
    : biz?.isLocked
      ? "Locked"
      : biz?.planStatus === "active"
        ? "Active"
        : biz?.planStatus || "—";

  const statusTone =
    biz?.isLocked || biz?.planStatus === "expired"
      ? "text-red-300 bg-red-500/10 border-red-500/30"
      : access?.isTrial
        ? "text-sky-200 bg-sky-500/10 border-sky-500/30"
        : "text-emerald-300 bg-emerald-500/10 border-emerald-500/30";

  const renewalDisplay = biz?.renewalDate
    ? new Date(biz.renewalDate).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : biz?.subscriptionEndsAt
      ? new Date(biz.subscriptionEndsAt).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : biz?.trialEndsAt
        ? new Date(biz.trialEndsAt).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : "—";

  const heroUpgradeTarget =
    currentFamily === "enterprise"
      ? null
      : currentFamily === "professional"
        ? "Enterprise"
        : "Professional";

  // Visual timeline nodes
  const visualTimeline = useMemo(() => {
    const nodes: { label: string; date?: string | null; state: "done" | "current" | "upcoming" }[] =
      [];
    nodes.push({
      label: "Customer Created",
      date: biz?.createdAt || null,
      state: "done",
    });
    if (access?.isTrial || biz?.trialStartDate || biz?.trialEndsAt) {
      nodes.push({
        label: "Trial Started",
        date: biz?.trialStartDate || null,
        state: "done",
      });
      nodes.push({
        label: "Trial Ends",
        date: biz?.trialEndsAt || null,
        state: access?.isTrial ? "current" : "done",
      });
    }
    const hasPaid = (data?.payments || []).some((p) => p.status === "paid");
    if (hasPaid || (!access?.isTrial && biz?.planStatus === "active")) {
      nodes.push({
        label: "Subscription Activated",
        date:
          (data?.payments || []).find((p) => p.status === "paid")?.createdAt || null,
        state: access?.isTrial ? "upcoming" : "done",
      });
    } else {
      nodes.push({
        label: "Subscription Activated",
        date: null,
        state: "upcoming",
      });
    }
    nodes.push({
      label: "Next Renewal",
      date: biz?.renewalDate || biz?.subscriptionEndsAt || null,
      state:
        !access?.isTrial && (biz?.renewalDate || biz?.subscriptionEndsAt)
          ? "current"
          : "upcoming",
    });
    return nodes;
  }, [access?.isTrial, biz, data?.payments]);

  if (loading && !data) {
    return (
      <PageShell wide>
        <div className="space-y-5 animate-pulse" aria-busy="true" aria-label="Loading billing">
          <div className="h-44 rounded-3xl bg-zinc-900 border border-zinc-800" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-96 rounded-3xl bg-zinc-900 border border-zinc-800" />
            ))}
          </div>
        </div>
      </PageShell>
    );
  }

  // ── Success screen ──────────────────────────────────────────
  if (uiMode === "success" && success) {
    return (
      <PageShell wide>
        <div className="mx-auto max-w-lg py-10 sm:py-16 mm-success-pop text-center">
          <div
            className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/40"
            aria-hidden
          >
            <span className="text-4xl">🎉</span>
          </div>
          <h1
            id={successTitleId}
            className="text-2xl sm:text-3xl font-semibold tracking-tight text-white"
          >
            Subscription Activated
          </h1>
          <p className="mt-3 text-sm sm:text-base text-zinc-400 leading-relaxed">
            Thank you for choosing Massive Mentor CRM. Your workspace is unlocked and ready.
          </p>
          <dl className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/70 text-left divide-y divide-zinc-800">
            {[
              { k: "Plan", v: success.planName },
              {
                k: "Amount",
                v: formatCurrency(success.amount, success.currency),
              },
              { k: "Invoice Number", v: success.invoiceNumber || "Generating…" },
              { k: "Payment ID", v: success.paymentId },
            ].map((row) => (
              <div key={row.k} className="flex justify-between gap-4 px-5 py-3.5 text-sm">
                <dt className="text-zinc-500">{row.k}</dt>
                <dd className="font-medium text-zinc-100 text-right break-all">{row.v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <Link
              href="/dashboard"
              className="flex-1 min-h-12 inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-violet-600 to-sky-600 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 focus-ring button-active"
            >
              Go to Dashboard
            </Link>
            <button
              type="button"
              onClick={() => void downloadInvoice(success.paymentId, success.invoiceNumber)}
              className="flex-1 min-h-12 rounded-2xl border border-zinc-700 bg-zinc-900 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-ring button-active"
            >
              Download Invoice
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setUiMode("main");
              setSuccess(null);
              void load();
            }}
            className="mt-4 text-sm text-zinc-500 underline-offset-2 hover:underline focus-ring rounded"
          >
            Back to Billing
          </button>
        </div>
      </PageShell>
    );
  }

  // ── Failure screen ──────────────────────────────────────────
  if (uiMode === "failure" && failure) {
    return (
      <PageShell wide>
        <div className="mx-auto max-w-lg py-10 sm:py-16 mm-fade-up text-center">
          <div
            className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10 border border-red-500/30"
            aria-hidden
          >
            <svg className="h-10 w-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.75}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
          </div>
          <h1 id={failTitleId} className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
            Payment unsuccessful
          </h1>
          <p className="mt-3 text-sm text-zinc-400 leading-relaxed" role="alert">
            {failure.reason || "Something went wrong while processing your payment."}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            {failure.planCode && (
              <button
                type="button"
                onClick={() => {
                  setUiMode("main");
                  const p = (data?.plans || []).find((x) => x.code === failure.planCode);
                  if (p) setConfirm({ plan: p, purpose: failure.purpose || "checkout" });
                  else setFailure(null);
                }}
                className="flex-1 min-h-12 rounded-2xl bg-gradient-to-r from-violet-600 to-sky-600 text-sm font-semibold text-white focus-ring button-active"
              >
                Retry payment
              </button>
            )}
            <a
              href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent("Billing support")}`}
              className="flex-1 min-h-12 inline-flex items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-900 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-ring"
            >
              Contact Support
            </a>
          </div>
          <button
            type="button"
            onClick={() => {
              setUiMode("main");
              setFailure(null);
            }}
            className="mt-4 text-sm text-zinc-500 underline-offset-2 hover:underline focus-ring rounded"
          >
            Back to Billing
          </button>
        </div>
      </PageShell>
    );
  }

  // ── Main billing UI ─────────────────────────────────────────
  return (
    <PageShell wide>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />

      {/* Hero */}
      <section
        className="mm-fade-up relative overflow-hidden rounded-3xl border border-zinc-800/80 bg-gradient-to-br from-violet-950/90 via-zinc-950 to-sky-950/60 p-6 sm:p-8 mb-8"
        aria-labelledby="billing-hero-title"
      >
        <div
          className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-violet-600/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-sky-500/15 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300/90">
              Massive Mentor CRM
            </p>
            <h1
              id="billing-hero-title"
              className="mt-2 text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-white"
            >
              {displayPlanTitle} Plan
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${statusTone}`}
              >
                {biz?.isLocked ? "⚠" : "✅"} {statusLabel}
              </span>
              {access?.isTrial && trialDaysLeft != null && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100">
                  ⏱ {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} trial remaining
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/60 px-3 py-1 text-xs font-medium text-zinc-300">
                📅 Renewal {renewalDisplay}
              </span>
            </div>
            <p className="mt-4 max-w-xl text-sm text-zinc-400 leading-relaxed">
              Manage your subscription, compare packages, and upgrade when your team is ready to
              scale.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0">
            {heroUpgradeTarget && (
              <button
                type="button"
                onClick={scrollToPlans}
                className="min-h-12 px-6 rounded-2xl bg-gradient-to-r from-violet-600 to-sky-600 text-sm font-semibold text-white shadow-lg shadow-violet-900/40 hover:from-violet-500 hover:to-sky-500 focus-ring button-active transition-all"
              >
                Upgrade to {heroUpgradeTarget}
              </button>
            )}
            <button
              type="button"
              onClick={scrollToPlans}
              className="min-h-12 px-6 rounded-2xl border border-zinc-600/80 bg-zinc-950/40 text-sm font-semibold text-zinc-200 hover:bg-zinc-900 focus-ring button-active"
            >
              View all plans
            </button>
          </div>
        </div>

        {/* Usage progress */}
        <div className="relative mt-8 grid grid-cols-1 sm:grid-cols-2 gap-5 rounded-2xl border border-white/5 bg-black/20 p-5 backdrop-blur-sm">
          <ProgressBar label="Users" used={members} total={maxUsers} tone="violet" />
          <ProgressBar
            label="Storage"
            used={storageUsedApprox}
            total={storageGb}
            unit="GB"
            tone="sky"
          />
        </div>
      </section>

      {/* Cycle toggle */}
      <section
        ref={plansRef}
        className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
        aria-labelledby="plans-heading"
      >
        <div>
          <h2 id="plans-heading" className="text-xl font-semibold tracking-tight text-white">
            Choose your plan
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Toggle billing cycle — only matching packages are shown.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="inline-flex rounded-full border border-zinc-700/80 bg-zinc-900/90 p-1 shadow-inner"
            role="tablist"
            aria-label="Billing cycle"
          >
            {(["monthly", "annual"] as const).map((c) => {
              const active = cycle === c;
              return (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCycle(c)}
                  className={[
                    "mm-toggle-thumb min-h-11 min-w-[7.5rem] rounded-full px-5 text-sm font-semibold capitalize focus-ring",
                    active
                      ? "bg-gradient-to-r from-violet-600 to-sky-600 text-white shadow-md shadow-violet-900/30"
                      : "text-zinc-400 hover:text-white",
                  ].join(" ")}
                >
                  {c === "annual" ? "Annual" : "Monthly"}
                  {c === "annual" && (
                    <span className="ml-1.5 text-[10px] font-bold text-emerald-200/90">
                      Save {ANNUAL_DISCOUNT_PCT}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <label className="sr-only" htmlFor="coupon-input">
            Coupon code
          </label>
          <input
            id="coupon-input"
            value={coupon}
            onChange={(e) => setCoupon(e.target.value.toUpperCase())}
            placeholder="Coupon code"
            className="bg-zinc-950/80 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm min-h-11 w-40 focus-ring"
            autoComplete="off"
          />
        </div>
      </section>

      {/* Pricing cards */}
      <section
        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 xl:gap-6 mb-12 items-stretch"
        aria-label="Subscription plans"
      >
        {filteredPlans.length === 0 && (
          <div className="col-span-full rounded-3xl border border-zinc-800 bg-zinc-900/50 p-12 text-center text-zinc-500">
            No {cycle} plans available right now.
          </div>
        )}
        {filteredPlans.map((p) => {
          const family = familyOf(p.code, p.name);
          const title = displayPlanName(p.code, p.name);
          const features =
            PLAN_FEATURE_LISTS[family] || PLAN_FEATURE_LISTS.starter;
          const meta = PLAN_PRICING_META[family];
          const popular = family === "professional";
          const enterprise = family === "enterprise";
          const isCurrent =
            !access?.isTrial &&
            currentFamily === family &&
            (!currentCycle || currentCycle === cycle);
          const purpose =
            biz?.isTrial || biz?.planStatus === "trial" ? "checkout" : "upgrade";
          const includedUsers = meta.includedUsers || p.maxUsers || 3;
          const listPrice =
            cycle === "annual" && meta.annualListPrice != null
              ? meta.annualListPrice
              : null;
          const addOnPrice =
            cycle === "annual"
              ? meta.additionalUserAnnual
              : meta.additionalUserMonthly;
          const addOnUnit = cycle === "annual" ? "Year" : "Month";

          let ctaLabel = "Subscribe";
          if (isCurrent) ctaLabel = "Current Plan";
          else if (enterprise) ctaLabel = "Contact Sales";
          else if (!access?.isTrial && currentFamily === "starter" && family === "professional")
            ctaLabel = "Upgrade";
          else if (!access?.isTrial && currentFamily !== "unknown") ctaLabel = "Switch plan";

          const busy = busyCode === p.code;

          return (
            <article
              key={p.id}
              className={[
                "mm-card-hover relative flex flex-col rounded-[1.75rem] border p-6 sm:p-8 min-w-0",
                popular
                  ? "border-violet-500/55 bg-gradient-to-b from-violet-950/90 via-zinc-900 to-zinc-950 shadow-2xl shadow-violet-950/50 xl:scale-[1.04] xl:z-[1] xl:py-10"
                  : enterprise
                    ? "border-amber-500/30 bg-gradient-to-b from-amber-950/40 via-zinc-900 to-zinc-950"
                    : "border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950",
              ].join(" ")}
            >
              {/* Badges / ribbons */}
              {isCurrent && (
                <div className="absolute -right-px top-6 overflow-hidden z-[2]">
                  <span className="block bg-gradient-to-r from-emerald-600 to-teal-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-md rounded-l-lg">
                    Current Plan
                  </span>
                </div>
              )}
              {popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-[2]">
                  <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-600 to-sky-600 px-3.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow-lg whitespace-nowrap">
                    ⭐ Most Popular
                  </span>
                </div>
              )}
              {!popular && !enterprise && (
                <div className="absolute top-5 right-5 max-w-[45%]">
                  <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-200">
                    {meta.badge}
                  </span>
                </div>
              )}
              {enterprise && (
                <div className="absolute top-5 right-5 max-w-[50%]">
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">
                    {meta.badge}
                  </span>
                </div>
              )}

              <div
                className={[
                  "mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border",
                  popular
                    ? "border-violet-500/40 bg-violet-500/15 text-violet-300"
                    : enterprise
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                      : "border-zinc-700 bg-zinc-800/80 text-zinc-300",
                ].join(" ")}
              >
                <PlanIcon family={family} />
              </div>

              <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
                {cycle === "annual" ? "Billed annually" : "Billed monthly"}
              </p>
              <h3 className="mt-1 text-2xl sm:text-[1.75rem] font-semibold tracking-tight text-white">
                {title}
              </h3>
              {p.description && (
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed line-clamp-2">
                  {p.description}
                </p>
              )}

              {/* Price block */}
              <div className="mt-6">
                {enterprise ? (
                  <div>
                    <span className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
                      Custom Pricing
                    </span>
                    <p className="mt-1 text-sm text-zinc-500">Tailored for your organization</p>
                  </div>
                ) : (
                  <>
                    {cycle === "annual" && listPrice != null && (
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
                          🎉 Save {ANNUAL_DISCOUNT_PCT}%
                        </span>
                        <span className="text-sm text-zinc-500 line-through tabular-nums">
                          {formatCurrency(listPrice, p.currency)}
                        </span>
                      </div>
                    )}
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-3xl sm:text-4xl font-bold tracking-tight text-white tabular-nums">
                        {formatCurrency(p.price, p.currency)}
                      </span>
                      <span className="text-sm text-zinc-500">
                        / {cycle === "annual" ? "Year" : "Month"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">+ 18% GST · exclusive of taxes</p>
                  </>
                )}
              </div>

              {/* Users + additional seats — always visible for paid tiers */}
              {!enterprise && (
                <div className="mt-4 space-y-2 rounded-2xl border border-zinc-800 bg-zinc-950/50 p-3.5">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-zinc-400">Users included</span>
                    <span className="font-semibold text-zinc-100">
                      Up to {includedUsers} Users
                    </span>
                  </div>
                  {addOnPrice != null && (
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 pt-2 border-t border-zinc-800/80">
                      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Additional Users
                      </span>
                      <span className="text-sm font-semibold text-violet-300 tabular-nums">
                        {formatCurrency(addOnPrice, p.currency)} / User / {addOnUnit}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {enterprise ? (
                <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-950/20 p-4 space-y-2 flex-1">
                  <p className="text-sm font-semibold text-amber-100">
                    Need more than 10 Users?
                  </p>
                  <p className="text-sm text-zinc-400">Need White Label CRM?</p>
                  <p className="text-sm text-zinc-400">Need Custom AI?</p>
                  <p className="text-sm text-zinc-400">Need API Integration?</p>
                  <p className="text-sm text-zinc-400">Need Dedicated Infrastructure?</p>
                  <p className="text-base font-semibold text-white pt-2">Let&apos;s Talk</p>
                  <div className="flex flex-col gap-2 pt-3">
                    <a
                      href={DEMO_MAILTO}
                      className="min-h-12 inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-amber-600 to-orange-600 text-sm font-semibold text-white shadow-lg shadow-amber-900/20 hover:from-amber-500 hover:to-orange-500 focus-ring button-active"
                    >
                      Schedule Demo
                    </a>
                    <a
                      href={SALES_MAILTO}
                      className="min-h-11 inline-flex items-center justify-center rounded-2xl border border-amber-500/40 bg-transparent text-sm font-semibold text-amber-100 hover:bg-amber-500/10 focus-ring"
                    >
                      Contact Sales
                    </a>
                  </div>
                </div>
              ) : (
                <>
                  <ul className="mt-6 space-y-2.5 flex-1" aria-label={`${title} features`}>
                    {features.map((f) => (
                      <li key={f.label} className="flex items-start gap-2.5 text-sm text-zinc-300">
                        <IconCheck
                          className={`h-4 w-4 shrink-0 mt-0.5 ${popular ? "text-violet-400" : "text-emerald-400"}`}
                        />
                        <span>{f.label}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={isCurrent || busy}
                    onClick={() => requestSubscribe(p, purpose)}
                    aria-busy={busy}
                    className={[
                      "mt-8 min-h-12 rounded-2xl text-sm font-semibold transition-all focus-ring button-active disabled:cursor-not-allowed",
                      isCurrent
                        ? "border border-zinc-700 bg-zinc-800/50 text-zinc-400"
                        : popular
                          ? "bg-gradient-to-r from-violet-600 to-sky-600 text-white shadow-lg shadow-violet-900/30 hover:from-violet-500 hover:to-sky-500"
                          : "bg-white text-zinc-950 hover:bg-zinc-100",
                      busy ? "opacity-70" : "",
                    ].join(" ")}
                  >
                    {busy ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                        Opening checkout…
                      </span>
                    ) : (
                      ctaLabel
                    )}
                  </button>
                </>
              )}
            </article>
          );
        })}
      </section>

      {/* Feature comparison */}
      <section className="mb-12" aria-labelledby="compare-heading">
        <h2 id="compare-heading" className="text-xl font-semibold tracking-tight text-white mb-1">
          Feature comparison
        </h2>
        <p className="text-sm text-zinc-500 mb-5">
          See exactly what unlocks when you upgrade.
        </p>
        <div className="rounded-2xl border border-zinc-800 overflow-hidden bg-zinc-900/40">
          <div className="overflow-x-auto table-scroll">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/60">
                  <th
                    scope="col"
                    className="p-4 text-left font-medium text-zinc-400 sticky left-0 bg-zinc-950/95"
                  >
                    Feature
                  </th>
                  {(["Starter", "Professional", "Enterprise"] as const).map((col) => (
                    <th
                      key={col}
                      scope="col"
                      className={`p-4 text-center font-semibold ${
                        col === "Professional" ? "text-violet-300" : "text-zinc-200"
                      }`}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, i) => (
                  <tr
                    key={row.label}
                    className={i % 2 === 0 ? "bg-zinc-900/20" : "bg-transparent"}
                  >
                    <th
                      scope="row"
                      className="p-3.5 text-left font-medium text-zinc-300 sticky left-0 bg-zinc-950/90"
                    >
                      {row.label}
                    </th>
                    {(
                      [
                        ["starter", row.starter],
                        ["professional", row.professional],
                        ["enterprise", row.enterprise],
                      ] as const
                    ).map(([key, ok]) => (
                      <td key={key} className="p-3.5 text-center">
                        {ok ? (
                          <span className="inline-flex items-center justify-center gap-1 text-emerald-400 font-medium">
                            <IconCheck className="h-4 w-4" />
                            <span className="sr-only">Included</span>
                            <span className="hidden sm:inline text-xs" aria-hidden>
                              Included
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center gap-1 text-zinc-600">
                            <IconCross className="h-4 w-4" />
                            <span className="sr-only">Not included</span>
                            <span className="hidden sm:inline text-xs" aria-hidden>
                              Not included
                            </span>
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Billing timeline */}
      <section className="mb-12" aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="text-xl font-semibold tracking-tight text-white mb-5">
          Billing timeline
        </h2>
        <ol className="relative space-y-0 pl-2">
          {visualTimeline.map((node, i) => (
            <li key={node.label} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span
                  className={[
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                    node.state === "done"
                      ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                      : node.state === "current"
                        ? "border-violet-500/60 bg-violet-500/20 text-violet-200 ring-2 ring-violet-500/30"
                        : "border-zinc-700 bg-zinc-900 text-zinc-500",
                  ].join(" ")}
                  aria-hidden
                >
                  {node.state === "done" ? "✓" : i + 1}
                </span>
                {i < visualTimeline.length - 1 && (
                  <span
                    className="w-px flex-1 min-h-[1.75rem] bg-gradient-to-b from-zinc-600 to-zinc-800"
                    aria-hidden
                  />
                )}
              </div>
              <div className="pb-6 pt-1.5 min-w-0">
                <p
                  className={[
                    "text-sm font-semibold",
                    node.state === "upcoming" ? "text-zinc-500" : "text-white",
                  ].join(" ")}
                >
                  {node.label}
                </p>
                {node.date && (
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {new Date(node.date).toLocaleString()}
                  </p>
                )}
                {!node.date && node.state === "upcoming" && (
                  <p className="mt-0.5 text-xs text-zinc-600">Pending</p>
                )}
              </div>
            </li>
          ))}
        </ol>

        {data?.timeline && data.timeline.length > 0 && (
          <div className="mt-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              Recent events
            </h3>
            <ul className="space-y-2 text-sm text-zinc-400 max-h-48 overflow-y-auto">
              {data.timeline.slice(0, 12).map((t, i) => (
                <li key={i} className="flex flex-col sm:flex-row sm:gap-3 border-l border-zinc-700 pl-3">
                  <span className="text-xs text-zinc-600 sm:w-40 shrink-0">
                    {new Date(t.at).toLocaleString()}
                  </span>
                  <span>{t.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Payment history */}
      <section className="mb-10" aria-labelledby="payments-heading">
        <h2 id="payments-heading" className="text-xl font-semibold tracking-tight text-white mb-4">
          Payment history
        </h2>
        {(data?.payments || []).length === 0 ? (
          <div className="rounded-3xl border border-dashed border-zinc-700 bg-zinc-900/30 px-6 py-14 text-center">
            <div
              className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800/80 border border-zinc-700"
              aria-hidden
            >
              <svg className="h-8 w-8 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white">No payments yet</h3>
            <p className="mt-2 text-sm text-zinc-500 max-w-sm mx-auto leading-relaxed">
              When you subscribe, invoices and payment receipts will appear here for easy
              download and audit.
            </p>
            <button
              type="button"
              onClick={scrollToPlans}
              className="mt-6 min-h-11 px-5 rounded-xl bg-white text-zinc-950 text-sm font-semibold hover:bg-zinc-100 focus-ring button-active"
            >
              Browse plans
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
            <div className="overflow-x-auto desktop-only-table">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-800 bg-zinc-950/40">
                    <th className="p-3.5 font-medium">Date</th>
                    <th className="p-3.5 font-medium">Invoice</th>
                    <th className="p-3.5 font-medium">Plan</th>
                    <th className="p-3.5 font-medium">Amount</th>
                    <th className="p-3.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.payments || []).map((pay) => (
                    <tr
                      key={pay.id}
                      className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors"
                    >
                      <td className="p-3.5 whitespace-nowrap">
                        {new Date(pay.createdAt).toLocaleString()}
                      </td>
                      <td className="p-3.5 font-mono text-xs text-zinc-400">
                        {pay.invoiceNumber || "—"}
                      </td>
                      <td className="p-3.5">{pay.plan?.name || "—"}</td>
                      <td className="p-3.5 tabular-nums">
                        {formatCurrency(pay.amount, "INR")}
                      </td>
                      <td className="p-3.5 capitalize">
                        <span
                          className={
                            pay.status === "paid"
                              ? "text-emerald-400"
                              : pay.status === "failed"
                                ? "text-red-400"
                                : "text-zinc-400"
                          }
                        >
                          {pay.status}
                        </span>
                        {pay.status === "paid" && (
                          <button
                            type="button"
                            className="ml-2 text-xs text-sky-400 underline focus-ring rounded"
                            onClick={() => void downloadInvoice(pay.id, pay.invoiceNumber)}
                          >
                            PDF
                          </button>
                        )}
                        {(pay.status === "failed" || pay.status === "cancelled") && (
                          <button
                            type="button"
                            className="ml-2 text-xs text-amber-400 underline focus-ring rounded"
                            onClick={() => {
                              const code =
                                data?.plans?.find((x) => x.name === pay.plan?.name)?.code ||
                                filteredPlans[0]?.code ||
                                "";
                              const p = (data?.plans || []).find((x) => x.code === code);
                              if (p)
                                setConfirm({
                                  plan: p,
                                  purpose: "retry",
                                });
                            }}
                          >
                            Retry
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-card-list p-3 space-y-3">
              {(data?.payments || []).map((pay) => (
                <div
                  key={pay.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 text-sm"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-white">{pay.plan?.name || "Payment"}</span>
                    <span className="tabular-nums text-zinc-200">
                      {formatCurrency(pay.amount, "INR")}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {new Date(pay.createdAt).toLocaleString()} · {pay.status}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {user?.email && (
        <p className="text-xs text-zinc-600 pb-4">Signed in as {user.email}</p>
      )}

      {/* Checkout confirmation modal */}
      {confirm && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={confirmTitleId}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            aria-label="Close confirmation"
            onClick={() => !busyCode && setConfirm(null)}
          />
          <div className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-zinc-700/80 bg-gradient-to-b from-zinc-900 to-zinc-950 shadow-2xl p-6 sm:p-8 mm-fade-up">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
              Confirm checkout
            </p>
            <h2 id={confirmTitleId} className="mt-2 text-xl font-semibold text-white tracking-tight">
              {displayPlanName(confirm.plan.code, confirm.plan.name)}{" "}
              {cycle === "annual" ? "Annual" : "Monthly"}
            </h2>
            <p className="mt-3 text-3xl font-bold text-white tabular-nums">
              {formatCurrency(confirm.plan.price, confirm.plan.currency)}
              <span className="text-sm font-normal text-zinc-500">
                {" "}
                / {cycle === "annual" ? "year" : "month"}
              </span>
            </p>
            <p className="mt-1 text-xs text-zinc-500">+ 18% GST applied at checkout</p>
            <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
                Included
              </p>
              <ul className="space-y-1.5 text-sm text-zinc-300">
                {(PLAN_FEATURE_LISTS[familyOf(confirm.plan.code, confirm.plan.name)] || [])
                  .slice(0, 6)
                  .map((f) => (
                    <li key={f.label} className="flex items-center gap-2">
                      <IconCheck className="h-3.5 w-3.5 text-emerald-400" />
                      {f.label}
                    </li>
                  ))}
              </ul>
            </div>
            <p className="mt-4 text-sm text-zinc-400">Continue to secure Razorpay checkout?</p>
            <div className="mt-6 flex flex-col-reverse sm:flex-row gap-2.5">
              <button
                type="button"
                disabled={!!busyCode}
                onClick={() => setConfirm(null)}
                className="flex-1 min-h-11 rounded-xl border border-zinc-700 text-sm font-medium text-zinc-300 hover:bg-zinc-800 focus-ring disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!!busyCode}
                onClick={() =>
                  void runCheckout(confirm.plan.code, {
                    purpose: confirm.purpose,
                  })
                }
                className="flex-1 min-h-11 rounded-xl bg-gradient-to-r from-violet-600 to-sky-600 text-sm font-semibold text-white focus-ring button-active disabled:opacity-70"
              >
                {busyCode ? "Please wait…" : "Continue"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
