"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy /demo/login route — password login lives on /demo.
 * Keep this path for bookmarks; never passwordless enter.
 */
export default function DemoLoginRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/demo");
  }, [router]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background">
      <div className="text-muted-foreground text-sm">Opening demo login…</div>
    </div>
  );
}
