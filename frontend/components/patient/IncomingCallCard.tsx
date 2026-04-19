"use client";

import { useEffect, useState } from "react";

type Props = {
  caller?: string;
  mode?: string;
  onAnswer: () => void;
  onDecline: () => void;
};

/**
 * Native-call-feel incoming call card for iPhone Safari.
 * - Pulsing ring (CSS keyframe) around the avatar.
 * - 56px tap targets for Answer / Decline.
 * - Counts up elapsed "ringing" seconds so the card feels alive.
 */
export function IncomingCallCard({
  caller = "Sentinel care team",
  mode,
  onAnswer,
  onDecline,
}: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t0 = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - t0) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Incoming call from Sentinel"
      className="relative overflow-hidden rounded-3xl border border-emerald-400/40 bg-gradient-to-b from-emerald-950/70 to-emerald-950/30 p-5 shadow-[0_8px_40px_-10px_rgba(16,185,129,0.35)]"
    >
      <div className="flex items-center gap-4">
        <div className="relative grid h-16 w-16 shrink-0 place-items-center">
          {/* Pulse ring */}
          <span
            aria-hidden
            className="ring-pulse-incoming absolute inset-0 rounded-full"
          />
          <div className="relative grid h-16 w-16 place-items-center rounded-full bg-emerald-500/20 ring-1 ring-emerald-300/40">
            {/* Phone glyph */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-7 w-7 text-emerald-200"
              aria-hidden
            >
              <path
                d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-300/80">
            Incoming {mode === "phone" ? "call" : "voice check-in"}
          </div>
          <div className="truncate text-lg font-semibold text-emerald-50">
            {caller}
          </div>
          <div className="text-xs tabular-nums text-emerald-300/70">
            ringing · {String(Math.floor(elapsed / 60)).padStart(1, "0")}:
            {String(elapsed % 60).padStart(2, "0")}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onDecline}
          className="tap-target flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 text-sm font-semibold text-slate-100 active:bg-white/10"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
            <path
              d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
              strokeLinecap="round"
              transform="rotate(135 12 12)"
            />
          </svg>
          Decline
        </button>
        <button
          type="button"
          onClick={onAnswer}
          className="tap-target flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-sm font-semibold text-black shadow-[0_6px_24px_-6px_rgba(16,185,129,0.7)] active:bg-emerald-400"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
            <path
              d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          Answer
        </button>
      </div>
    </div>
  );
}
