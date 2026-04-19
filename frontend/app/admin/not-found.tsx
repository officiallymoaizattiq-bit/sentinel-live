import Link from "next/link";
import { Glass } from "@/components/ui/Glass";

export const metadata = {
  title: "Not found — Sentinel dashboard",
};

/** 404 inside the clinician dashboard tree. */
export default function AdminNotFound() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
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
              d="M9.5 14a4.5 4.5 0 119 0M4 20l5-5M13 9a4 4 0 11-8 0 4 4 0 018 0z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-semibold tracking-tight text-white">
          That patient view doesn&rsquo;t exist
        </h1>
        <p className="mt-1 text-sm text-muted">
          The patient may have been removed, or the ID is malformed. Head back
          to the dashboard to pick another.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent-500/90 px-3.5 py-2 text-xs font-semibold text-white shadow-glow transition-colors duration-150 hover:bg-accent-400"
          >
            Back to dashboard
          </Link>
        </div>
      </Glass>
    </div>
  );
}
