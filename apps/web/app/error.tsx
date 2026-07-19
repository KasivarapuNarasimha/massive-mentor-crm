'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Isolated logging only — no external services, no business logic changes
    console.error('[Root Error Boundary]', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center">
        <div className="mx-auto w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center mb-6">
          <span className="text-4xl" aria-hidden="true">⚠️</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight mb-3">Something went wrong</h1>

        <p className="text-zinc-400 mb-8 leading-relaxed">
          An unexpected error occurred while loading the page. We&apos;ve recorded the details for investigation.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 bg-white text-zinc-950 rounded-xl font-medium hover:bg-zinc-200 focus-ring button-active transition-colors"
          >
            Try again
          </button>

          <Link
            href="/"
            className="px-6 py-2.5 bg-zinc-800 border border-zinc-700 text-white rounded-xl font-medium hover:bg-zinc-700 focus-ring button-active transition-colors"
          >
            Go to homepage
          </Link>
        </div>

        {process.env.NODE_ENV === 'development' && error?.message && (
          <details className="mt-8 text-left">
            <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400 select-none">
              Technical details (development only)
            </summary>
            <pre className="mt-2 p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-red-400 overflow-auto max-h-40 whitespace-pre-wrap break-words">
              {error.message}
              {error.digest && `\n\nDigest: ${error.digest}`}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
