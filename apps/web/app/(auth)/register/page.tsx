"use client";

import Link from "next/link";

/**
 * Public registration is disabled — sales-led SaaS onboarding only.
 * Super Admin provisions customers after deal close.
 */
export default function RegisterPage() {
  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center">
        <div className="text-xs uppercase tracking-widest text-zinc-500 mb-3">Massive Mentor CRM</div>
        <h1 className="text-2xl font-semibold mb-3">Registration is closed</h1>
        <p className="text-sm text-zinc-400 leading-relaxed mb-6">
          New business accounts are created by our team after a sales consultation and demo.
          Contact us to start your free trial.
        </p>
        <div className="flex flex-col gap-3">
          <a
            href="mailto:team@massivementor.in?subject=CRM%20Trial%20Request"
            className="min-h-11 flex items-center justify-center rounded-xl bg-white text-zinc-950 font-semibold"
          >
            Contact Sales
          </a>
          <a
            href="https://wa.me/919000000000"
            target="_blank"
            rel="noreferrer"
            className="min-h-11 flex items-center justify-center rounded-xl bg-emerald-600 font-medium"
          >
            WhatsApp
          </a>
          <Link href="/login" className="text-sm text-zinc-400 hover:text-white min-h-10 inline-flex items-center justify-center">
            Already have an account? Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
