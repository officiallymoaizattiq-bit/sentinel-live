"use client";

import { useState } from "react";

const PILL_CLASS =
  "rounded-full border border-emerald-500/40 bg-slate-950 px-3 py-1 text-xs font-medium text-emerald-200 shadow-sm hover:border-emerald-400/55 hover:bg-slate-900 disabled:opacity-50";

const HERO_CLASS =
  "inline-flex items-center gap-2 rounded-xl border border-accent-400/40 bg-gradient-to-r from-accent-500/30 to-accent-600/20 px-3.5 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:from-accent-500/40 hover:to-accent-600/30 disabled:opacity-50";

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
      <path
        d="M6.6 10.8a15 15 0 006.6 6.6l2.2-2.2a1 1 0 011-.25 11.4 11.4 0 003.6.6 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.4 11.4 0 00.6 3.6 1 1 0 01-.25 1l-2.25 2.2z"
        fill="currentColor"
      />
    </svg>
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

  const run = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch("/api/calls/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patient_id: patientId }),
      });
      if (r.ok) {
        const j = await r.json();
        setStatus(`call queued (${j.call_id?.slice(0, 8)}…)`);
      } else {
        setStatus(`error ${r.status}`);
      }
    } catch (e) {
      setStatus(`network: ${String(e)}`);
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 4000);
    }
  };

  const btnClass = appearance === "hero" ? HERO_CLASS : PILL_CLASS;

  return (
    <div className="inline-flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          run();
        }}
        disabled={busy}
        className={btnClass}
      >
        {appearance === "hero" ? <PhoneIcon /> : null}
        {busy ? "Calling…" : label}
      </button>
      {status && (
        <span className="text-[10px] text-slate-400">{status}</span>
      )}
    </div>
  );
}
