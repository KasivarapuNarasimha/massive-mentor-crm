"use client";

import { Toaster } from "sonner";
import { useAppTheme } from "@/lib/theme";

/** Sonner toaster that follows resolved light/dark theme */
export function ThemeAwareToaster() {
  const { resolvedTheme, mounted } = useAppTheme();
  const theme = mounted && resolvedTheme === "light" ? "light" : "dark";

  return (
    <Toaster
      position="top-center"
      richColors
      closeButton
      expand={false}
      visibleToasts={4}
      gap={10}
      duration={3200}
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-xl",
          title: "group-[.toast]:font-medium group-[.toast]:text-sm",
          description: "group-[.toast]:text-muted-foreground group-[.toast]:text-xs",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-foreground",
          error:
            "group-[.toaster]:bg-destructive/10 group-[.toaster]:border-destructive/30 group-[.toaster]:text-destructive",
          success:
            "group-[.toaster]:bg-success/10 group-[.toaster]:border-success/30 group-[.toaster]:text-success",
        },
      }}
    />
  );
}
