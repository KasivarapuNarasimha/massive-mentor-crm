"use client";

import Link from "next/link";

/**
 * Public registration is disabled — sales-led SaaS onboarding only.
 * Super Admin provisions customers after deal close.
 */
export default function RegisterPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-card border border-border rounded-3xl p-8 text-center">
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Massive Mentor CRM</div>
        <h1 className="text-2xl font-semibold mb-3">Registration is closed</h1>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          New business accounts are created by our team after a sales consultation and demo.
          Contact us to start your free trial.
        </p>
        <div className="flex flex-col gap-3">
          <a
            href="mailto:team@massivementor.in?subject=CRM%20Trial%20Request"
            className="min-h-11 flex items-center justify-center rounded-xl bg-primary text-primary-foreground font-semibold"
          >
            Contact Sales
          </a>
          <a
            href="https://wa.me/919182920047"
            target="_blank"
            rel="noreferrer"
            className="min-h-11 flex items-center justify-center rounded-xl bg-emerald-600 font-medium"
          >
            WhatsApp
          </a>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground min-h-10 inline-flex items-center justify-center">
            Already have an account? Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
