"use client";

import { useEffect, useRef, useState } from "react";

const PILL_CLASS =
  "inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-slate-950 px-3 py-1 text-xs font-medium text-emerald-200 shadow-sm transition-colors duration-150 hover:border-emerald-400/60 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:opacity-60";

const HERO_CLASS =
  "inline-flex items-center gap-2 rounded-xl border border-accent-400/40 bg-gradient-to-r from-accent-500/30 to-accent-600/20 px-3.5 py-1.5 text-xs font-semibold text-white shadow-glow transition-colors duration-150 hover:from-accent-500/40 hover:to-accent-600/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:opacity-60";

/** ~6s optimistic state so the clinician sees immediate feedback. */
const OPTIMISTIC_MS = 6000;

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden>
      <path
        d="M6.6 10.8a15 15 0 006.6 6.6l2.2-2.2a1 1 0 011-.25 11.4 11.4 0 003.6.6 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.4 11.4 0 00.6 3.6 1 1 0 01-.25 1l-2.25 2.2z"
        fill="currentColor"
      />
    </svg>
  );
}

function Dot() {
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300"
    />
  );
}

export function CallNowButton({
  patientId,
  label = "Call now",
  appearance = "pill",
}: {
  patientId: string;
  /** Shown on the button when not busy (e.g. "Trigger call" on patient hero). */
  label?: string;
  /** `pill` = dashboard card footer; `hero` = patient overview accent button. */
  appearance?: "pill" | "hero";
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const revertRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (revertRef.current != null) window.clearTimeout(revertRef.current);
    };
  }, []);

  const run = async () => {
    setBusy(true);
    setStatus(null);
    // Optimistic: keep the "Calling…" state for OPTIMISTIC_MS regardless of
    // backend latency so the button doesn't flicker between states.
    const revertAt = Date.now() + OPTIMISTIC_MS;
    try {
      const r = await fetch("/api/calls/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patient_id: patientId }),
      });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        setStatus(
          j?.call_id ? `queued (${String(j.call_id).slice(0, 8)}…)` : "queued",
        );
      } else {
        setStatus(`error ${r.status}`);
      }
    } catch (e) {
      setStatus(`network: ${String(e)}`);
    } finally {
      const remaining = Math.max(250, revertAt - Date.now());
      revertRef.current = window.setTimeout(() => {
        setBusy(false);
        revertRef.current = window.setTimeout(() => setStatus(null), 3500);
      }, remaining);
    }
  };

  const btnClass = appearance === "hero" ? HERO_CLASS : PILL_CLASS;

  return (
    <div className="inline-flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        aria-label={busy ? `Calling patient ${patientId}` : `${label} — call patient`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          run();
        }}
        disabled={busy}
        className={btnClass}
      >
        {busy ? <Dot /> : appearance === "hero" ? <PhoneIcon /> : null}
        {busy ? "Calling…" : label}
      </button>
      {status && (
        <span
          role="status"
          aria-live="polite"
          className="text-[10px] text-slate-400"
        >
          {status}
        </span>
      )}
    </div>
  );
}
