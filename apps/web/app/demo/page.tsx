"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { persistDemoSession } from "@/lib/demo-session";

export default function DemoLandingPage() {
  const router = useRouter();
  const [info, setInfo] = useState<{
    message?: string;
    features?: string[];
    loginHint?: { email: string };
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.demoInfo().then((res) => {
      if (res.success && res.data) setInfo(res.data);
    });
  }, []);

  const enterDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.demoEnter();
      if (res.success && res.data?.token) {
        persistDemoSession({ token: res.data.token, user: res.data.user });
        router.push("/dashboard");
        return;
      }
      setError(res.error || "Could not start the demo session. Please try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the demo session. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-16 sm:py-24">
        <div className="inline-flex px-3 py-1 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 text-xs font-medium mb-6">
          DEMO PORTAL · SAMPLE DATA ONLY
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          Massive Mentor product demo
        </h1>
        <p className="mt-4 text-muted-foreground leading-relaxed">
          {info?.message ||
            "Explore the full CRM with sample data. This portal never touches real customer workspaces."}
        </p>

        <div className="mt-8 grid sm:grid-cols-2 gap-2">
          {(info?.features || ["Leads", "Deals", "AI Sales", "Reports", "Finance", "Field Sales"]).map(
            (f) => (
              <div key={f} className="bg-card border border-border rounded-xl px-4 py-3 text-sm">
                {f}
              </div>
            )
          )}
        </div>

        <div className="mt-10 flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={() => void enterDemo()}
            disabled={busy}
            className="min-h-12 inline-flex items-center justify-center px-6 bg-sky-500 text-white font-semibold rounded-xl disabled:opacity-50 touch-manipulation"
          >
            {busy ? "Starting demo…" : "Enter demo"}
          </button>
          <a
            href="https://crm.massivementor.in"
            className="min-h-12 inline-flex items-center justify-center px-6 bg-white/10 rounded-xl text-sm"
          >
            Customer CRM (production)
          </a>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            {error}
          </p>
        ) : null}

        {info?.loginHint?.email ? (
          <p className="mt-8 text-xs text-muted-foreground">
            Demo workspace account: {info.loginHint.email}
          </p>
        ) : null}
      </div>
    </div>
  );
}
