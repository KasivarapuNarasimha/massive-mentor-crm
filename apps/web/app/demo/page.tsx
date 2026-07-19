"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function DemoLandingPage() {
  const [info, setInfo] = useState<{
    message?: string;
    features?: string[];
    loginHint?: { email: string; password: string };
  } | null>(null);

  useEffect(() => {
    api.demoInfo().then((res) => {
      if (res.success && res.data) setInfo(res.data);
    });
  }, []);

  return (
    <div className="min-h-dvh bg-zinc-950 text-white">
      <div className="max-w-3xl mx-auto px-4 py-16 sm:py-24">
        <div className="inline-flex px-3 py-1 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 text-xs font-medium mb-6">
          DEMO PORTAL · SAMPLE DATA ONLY
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          Massive Mentor product demo
        </h1>
        <p className="mt-4 text-zinc-400 leading-relaxed">
          {info?.message ||
            "Explore the full CRM with sample data. This portal never touches real customer workspaces."}
        </p>

        <div className="mt-8 grid sm:grid-cols-2 gap-2">
          {(info?.features || ["Leads", "Deals", "AI Sales", "Reports", "Finance", "Field Sales"]).map(
            (f) => (
              <div key={f} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm">
                {f}
              </div>
            )
          )}
        </div>

        <div className="mt-10 flex flex-col sm:flex-row gap-3">
          <Link
            href="/demo/login"
            className="min-h-12 inline-flex items-center justify-center px-6 bg-sky-500 text-zinc-950 font-semibold rounded-xl"
          >
            Enter demo
          </Link>
          <a
            href="https://app.massivementor.in"
            className="min-h-12 inline-flex items-center justify-center px-6 bg-white/10 rounded-xl text-sm"
          >
            Customer CRM (production)
          </a>
        </div>

        {info?.loginHint && (
          <p className="mt-8 text-xs text-zinc-600">
            Demo login: {info.loginHint.email} / {info.loginHint.password}
          </p>
        )}
      </div>
    </div>
  );
}
