"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";

/**
 * Landing never hard-blocks on auth bootstrap.
 * If session exists, redirect to dashboard after init — otherwise show marketing immediately.
 */
export default function LandingPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, isLoading, router]);

  // Authenticated users briefly see redirect cue; never infinite Loading
  if (isAuthenticated && !isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Opening dashboard…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <nav className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="font-semibold tracking-tight text-xl">Massive Mentor</div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm hover:text-muted-foreground">
              Sign in
            </Link>
            <a
              href="mailto:team@massivementor.in?subject=CRM%20Demo"
              className="text-sm bg-primary text-primary-foreground px-4 py-1.5 rounded-lg font-medium hover:bg-primary-hover"
            >
              Contact sales
            </a>
          </div>
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-2xl text-center">
          <div className="inline-block px-3 py-1 rounded-full bg-white/10 text-xs tracking-[2px] mb-6">
            AI BUSINESS OS
          </div>
          <h1 className="text-5xl sm:text-6xl font-semibold tracking-tighter leading-none mb-6">
            Grow your business
            <br />
            with an AI mentor.
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-10">
            CRM, finance, role portals, and AI mentorship — built for real multi-tenant operations.
          </p>

          <div className="flex items-center justify-center gap-4 flex-wrap">
            <a
              href="mailto:team@massivementor.in?subject=CRM%20Demo%20Request"
              className="px-8 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary-hover transition-colors"
            >
              Book a demo
            </a>
            <Link
              href="/login"
              className="px-8 py-3 border border-border hover:bg-card rounded-xl font-medium transition-colors"
            >
              Sign in
            </Link>
          </div>
          {isLoading && (
            <p className="text-xs text-muted-foreground mt-6">Checking session…</p>
          )}
          <p className="text-xs text-muted-foreground mt-8">No credit card required</p>
        </div>
      </main>
    </div>
  );
}
