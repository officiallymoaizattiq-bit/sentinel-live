"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Glass } from "@/components/ui/Glass";

/**
 * Friendly error boundary for any client/server error thrown inside a route
 * segment. Rendered inside the AppShell so the topbar stays visible.
 */
export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the console so devtools + Sentry-style hooks can capture it.
    // eslint-disable-next-line no-console
    console.error("[sentinel] route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Glass
        backdrop={false}
        solidTone="lower"
        className="animate-lift-in w-full max-w-md p-8 text-center"
      >
        <div
          aria-hidden
          className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-rose-500/10 ring-1 ring-rose-400/30"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-rose-300">
            <path
              d="M12 9v4m0 4h.01M10.3 3.3L2.3 17a2 2 0 001.7 3h16a2 2 0 001.7-3L13.7 3.3a2 2 0 00-3.4 0z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-semibold tracking-tight text-white">
          Something went wrong on our end
        </h1>
        <p className="mt-1 text-sm text-muted">
          The page hit an unexpected error. Your data wasn&rsquo;t affected —
          we just need to try that screen again.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-faint">
            Ref: {error.digest}
          </p>
        ) : null}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent-500/90 px-3.5 py-2 text-xs font-semibold text-white shadow-glow transition-colors duration-150 hover:bg-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300/60"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-surface-hover px-3.5 py-2 text-xs font-semibold text-slate-100 transition-colors duration-150 hover:border-hairline-strong hover:bg-white/[0.09]"
          >
            Start over
          </Link>
        </div>
      </Glass>
    </div>
  );
}
