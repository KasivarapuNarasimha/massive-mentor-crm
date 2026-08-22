"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { persistDemoSession } from "@/lib/demo-session";
import { PasswordInput } from "@/components/ui/PasswordInput";

const INPUT_CLASS =
  "portal-login-input w-full min-h-11 px-4 py-3 bg-background border border-border rounded-xl text-base sm:text-sm text-foreground placeholder:text-muted-foreground";

export default function DemoLandingPage() {
  const router = useRouter();
  const [info, setInfo] = useState<{
    message?: string;
    features?: string[];
    loginHint?: { email: string };
  } | null>(null);
  const [email, setEmail] = useState("demo@massivementor.in");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.demoInfo().then((res) => {
      if (res.success && res.data) {
        setInfo(res.data);
        if (res.data.loginHint?.email) setEmail(res.data.loginHint.email);
      }
    });
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!password.trim()) {
        setError("Invalid demo password.");
        setBusy(false);
        return;
      }
      const res = await api.demoLogin(email, password);
      if (res.success && res.data?.token) {
        persistDemoSession({ token: res.data.token, user: res.data.user });
        let dest = "/dashboard";
        try {
          const next = new URLSearchParams(window.location.search).get("next");
          if (next && next.startsWith("/dashboard")) dest = next;
        } catch {
          /* ignore */
        }
        router.push(dest);
        return;
      }
      setError(res.error || "Invalid demo password.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid demo password.");
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

        <form
          onSubmit={onSubmit}
          className="mt-10 rounded-2xl border border-border/80 bg-card/60 p-5 sm:p-6 space-y-4 max-w-md"
        >
          <h2 className="text-sm font-semibold">Enter Demo CRM</h2>
          <div>
            <label htmlFor="demo-email" className="block text-sm text-muted-foreground mb-2">
              Demo email
            </label>
            <input
              id="demo-email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT_CLASS}
              placeholder="demo@massivementor.in"
            />
          </div>
          <div>
            <label htmlFor="demo-password" className="block text-sm text-muted-foreground mb-2">
              Password
            </label>
            <PasswordInput
              id="demo-password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT_CLASS}
              placeholder="Enter demo password"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full min-h-12 bg-sky-500 text-white font-semibold rounded-xl disabled:opacity-50 touch-manipulation"
          >
            {busy ? "Signing in…" : "Enter Demo CRM"}
          </button>
          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
            >
              {error}
            </p>
          ) : null}
        </form>

        <div className="mt-6">
          <a
            href="https://crm.massivementor.in"
            className="min-h-11 inline-flex items-center justify-center px-5 bg-white/10 rounded-xl text-sm"
          >
            Customer CRM (production)
          </a>
        </div>
      </div>
    </div>
  );
}
