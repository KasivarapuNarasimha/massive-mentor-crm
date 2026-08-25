"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { PageHeader, PageShell } from "@/components/ui/PageShell";
import { ThemePreferencePicker } from "@/components/theme/ThemeToggle";
import { normalizeTheme } from "@/lib/theme";

export default function AppearanceSettingsPage() {
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const preference = mounted ? normalizeTheme(theme) : "system";
  const resolved =
    resolvedTheme === "light" || resolvedTheme === "dark" ? resolvedTheme : undefined;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Settings"
        title="Appearance"
        description="Choose how Massive Mentor looks. Your preference is saved to your account and restored on every login."
      />

      <div className="space-y-4 max-w-2xl" data-testid="appearance-settings-page">
        <section className="mm-card p-4 sm:p-5">
          <div className="mb-4">
            <h2 className="mm-section-title">Theme</h2>
            <p className="mm-secondary mt-1">
              Switch anytime — no page refresh required.
              {mounted && (
                <span className="block mt-1">
                  Current:{" "}
                  <span className="font-medium text-foreground capitalize">{preference}</span>
                  {preference === "system" && resolved ? (
                    <span className="mm-secondary">
                      {" "}
                      (resolved to {resolved})
                    </span>
                  ) : null}
                </span>
              )}
            </p>
          </div>
          <ThemePreferencePicker />
        </section>

        <section className="mm-card p-4 sm:p-5">
          <h2 className="mm-section-title mb-1">Color system</h2>
          <p className="mm-secondary mb-3">
            The CRM uses design tokens so every surface adapts to your theme.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { name: "Background", className: "bg-background border border-border" },
              { name: "Card", className: "bg-card border border-border" },
              { name: "Primary", className: "bg-primary" },
              { name: "Muted", className: "bg-muted border border-border" },
              { name: "Success", className: "bg-success" },
              { name: "Warning", className: "bg-warning" },
              { name: "Danger", className: "bg-destructive" },
              { name: "Border", className: "bg-background border-2 border-border" },
            ].map((swatch) => (
              <div key={swatch.name} className="space-y-1.5">
                <div className={`h-10 rounded-lg ${swatch.className}`} />
                <p className="mm-secondary font-medium">{swatch.name}</p>
              </div>
            ))}
          </div>
        </section>

        <p className="mm-secondary">
          You can also change the theme from the{" "}
          <span className="text-foreground font-medium">header Theme control</span> or open{" "}
          <Link href="/dashboard/security" className="text-primary hover:underline">
            Security
          </Link>{" "}
          for account settings.
        </p>
      </div>
    </PageShell>
  );
}
