'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Isolated logging only — no external services or business logic
    console.error('[Dashboard Error Boundary]', error);
  }, [error]);

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
      <div className="bg-card border border-border rounded-2xl p-8 sm:p-10 text-center">
        <div className="mx-auto w-14 h-14 bg-muted rounded-2xl flex items-center justify-center mb-6">
          <span className="text-3xl" aria-hidden="true">⚠️</span>
        </div>

        <h2 className="text-xl font-semibold tracking-tight mb-3">Something went wrong in this section</h2>

        <p className="text-muted-foreground mb-8 leading-relaxed max-w-md mx-auto">
          We couldn&apos;t load or process the content here. Your data is safe — you can try again or navigate elsewhere.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary-hover focus-ring button-active transition-colors"
          >
            Try again
          </button>

          <Link
            href="/dashboard"
            className="px-6 py-2.5 bg-muted border border-border text-foreground rounded-xl font-medium hover:bg-muted focus-ring button-active transition-colors"
          >
            Go to Dashboard overview
          </Link>
        </div>

        {process.env.NODE_ENV === 'development' && error?.message && (
          <details className="mt-8 text-left">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-muted-foreground select-none">
              Technical details (development only)
            </summary>
            <pre className="mt-2 p-3 bg-background border border-border rounded-lg text-xs text-red-400 overflow-auto max-h-40 whitespace-pre-wrap break-words">
              {error.message}
              {error.digest && `\n\nDigest: ${error.digest}`}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
