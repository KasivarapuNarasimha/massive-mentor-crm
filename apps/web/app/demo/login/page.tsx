"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { PORTAL_TOKENS, PORTAL_USER_KEYS } from "@/lib/portal-config";
import { toast } from "sonner";
import { PasswordInput } from "@/components/ui/PasswordInput";

const INPUT_CLASS =
  "portal-login-input w-full min-h-11 px-4 py-3 bg-background border border-border rounded-xl text-base sm:text-sm text-foreground placeholder:text-muted-foreground";

export default function DemoLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("demo@massivementor.in");
  const [password, setPassword] = useState("123456789");
  const [busy, setBusy] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    const t =
      localStorage.getItem(PORTAL_TOKENS.demo) ||
      localStorage.getItem(PORTAL_TOKENS.customer) ||
      localStorage.getItem("massive_mentor_token");
    if (t && localStorage.getItem("massive_mentor_demo_mode") === "1") {
      setHasSession(true);
      router.replace("/dashboard");
      return;
    }
    api.demoInfo().then((res) => {
      if (res.success && res.data?.loginHint) {
        setEmail(res.data.loginHint.email);
        setPassword(res.data.loginHint.password);
      }
    });
  }, [router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await api.demoLogin(email, password);
    if (res.success && res.data?.token) {
      localStorage.setItem(PORTAL_TOKENS.demo, res.data.token);
      localStorage.setItem(PORTAL_USER_KEYS.demo, JSON.stringify(res.data.user));
      localStorage.setItem(PORTAL_TOKENS.customer, res.data.token);
      localStorage.setItem(PORTAL_USER_KEYS.customer, JSON.stringify(res.data.user));
      localStorage.setItem("massive_mentor_demo_mode", "1");
      toast.success("Demo session started — sample data only");
      router.push("/dashboard");
    } else {
      toast.error(res.error || "Demo login failed");
    }
    setBusy(false);
  };

  if (hasSession) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Opening demo workspace…</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex px-3 py-1 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 text-xs font-medium mb-4">
            DEMO PORTAL
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Product demonstration</h1>
          <p className="mt-2 text-muted-foreground text-sm">
            Uses sample data only. Never production customers. Resets periodically.
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6">
          <form onSubmit={onSubmit} className="space-y-4">
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
                placeholder="Enter password"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-12 bg-sky-500 text-white font-semibold rounded-xl disabled:opacity-50 touch-manipulation"
            >
              {busy ? "Starting demo…" : "Launch demo CRM"}
            </button>
          </form>
          <p className="text-xs text-muted-foreground mt-4 text-center">
            <Link href="/demo" className="underline hover:text-muted-foreground">
              Back
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
