import Link from "next/link";
import { Glass } from "@/components/ui/Glass";

export const metadata = {
  title: "Page not found — Sentinel",
};

/**
 * Root App Router 404 — rendered whenever a path doesn't match any route.
 * Segment-level versions (see /admin/not-found.tsx and /patient/not-found.tsx)
 * override this inside their respective trees.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Glass
        backdrop={false}
        solidTone="lower"
        className="animate-lift-in w-full max-w-md p-8 text-center"
      >
        <div
          aria-hidden
          className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent-500/10 ring-1 ring-accent-400/30"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-accent-200">
            <path
              d="M12 9v4m0 4h.01M21 12A9 9 0 113 12a9 9 0 0118 0z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-semibold tracking-tight text-white">
          We couldn&rsquo;t find that page
        </h1>
        <p className="mt-1 text-sm text-muted">
          The link you followed may be broken, or the page may have moved.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-surface-hover px-3.5 py-2 text-xs font-semibold text-slate-100 transition-colors duration-150 hover:border-hairline-strong hover:bg-white/[0.09]"
          >
            Go to sign-in
          </Link>
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent-500/90 px-3.5 py-2 text-xs font-semibold text-white shadow-glow transition-colors duration-150 hover:bg-accent-400"
          >
            Open dashboard
          </Link>
        </div>
      </Glass>
    </div>
  );
}
