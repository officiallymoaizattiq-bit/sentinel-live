"use client";

import { useEffect } from "react";

const MSG = "Ambulance dispatched to your location. Stay on the line.";

export function Fake911Modal({ onAutoDismiss }: { onAutoDismiss: () => void }) {
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(MSG);
        u.rate = 0.95;
        window.speechSynthesis.speak(u);
      }
    } catch {}
    const t = window.setTimeout(onAutoDismiss, 15000);
    return () => {
      window.clearTimeout(t);
      try {
        window.speechSynthesis?.cancel();
      } catch {}
    };
  }, [onAutoDismiss]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 backdrop-blur-sm">
      <div className="flex w-[min(92vw,420px)] flex-col items-center gap-4 rounded-2xl border border-rose-500/40 bg-gradient-to-b from-rose-950/90 to-black/90 p-6 text-center">
        <div className="relative grid h-20 w-20 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/40" />
          <span className="absolute inset-2 animate-ping rounded-full bg-rose-500/60 [animation-delay:.4s]" />
          <svg viewBox="0 0 24 24" className="relative h-10 w-10 text-rose-200" fill="none">
            <path
              d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.28-1.28a2 2 0 0 1 2.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0 1 22 16.92z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="text-lg font-semibold tracking-tight text-rose-100">
          Calling 9-1-1…
        </div>
        <div className="text-sm leading-relaxed text-rose-100/80">{MSG}</div>
        <div className="text-[11px] text-rose-300/60">Do not hang up.</div>
      </div>
    </div>
  );
}
