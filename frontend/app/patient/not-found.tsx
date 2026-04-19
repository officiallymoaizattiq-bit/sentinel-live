import Link from "next/link";
import { Glass } from "@/components/ui/Glass";

export const metadata = {
  title: "Not found — Sentinel",
};

/** 404 inside the patient surface. Copy is intentionally plainer. */
export default function PatientNotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center p-4 safe-pb">
      <Glass
        backdrop={false}
        solidTone="lower"
        className="animate-lift-in w-full p-6 text-center"
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
          Let&rsquo;s get you back to your check-in.
        </p>
        <div className="mt-5 flex flex-col items-stretch gap-2">
          <Link
            href="/patient"
            className="tap-target inline-flex items-center justify-center rounded-xl bg-accent-500/90 px-4 py-2 text-sm font-semibold text-white shadow-glow transition-colors duration-150 hover:bg-accent-400"
          >
            Back to your check-in
          </Link>
          <Link
            href="/login"
            className="text-xs text-muted underline-offset-2 hover:text-slate-200 hover:underline"
          >
            Sign in again
          </Link>
        </div>
      </Glass>
    </div>
  );
}
