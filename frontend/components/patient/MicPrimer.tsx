"use client";

import { useEffect, useState } from "react";

/**
 * Safari is strict: `navigator.mediaDevices.getUserMedia` must be invoked
 * synchronously inside a user-gesture handler. The ElevenLabs widget calls
 * getUserMedia internally, but if we've never asked before, the prompt can
 * be swallowed when the widget initialises from our Answer handler.
 *
 * MicPrimer shows a one-time "Enable microphone" button. When tapped, we
 * request mic access (direct gesture), immediately stop every track, and
 * persist the granted state so we don't nag again.
 */

const LS_KEY = "sentinel.micPrimed.v1";

type Status = "unknown" | "primed" | "denied" | "unsupported";

function readInitial(): Status {
  if (typeof window === "undefined") return "unknown";
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return "unsupported";
  }
  try {
    const v = window.localStorage.getItem(LS_KEY);
    if (v === "primed") return "primed";
    if (v === "denied") return "denied";
  } catch {
    /* localStorage blocked (private browsing) — treat as unknown. */
  }
  return "unknown";
}

export function MicPrimer({ onPrimed }: { onPrimed?: () => void }) {
  const [status, setStatus] = useState<Status>("unknown");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(readInitial());
  }, []);

  const prime = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release the mic immediately — we only needed the permission grant.
      stream.getTracks().forEach((t) => t.stop());
      try {
        window.localStorage.setItem(LS_KEY, "primed");
      } catch {
        /* */
      }
      setStatus("primed");
      onPrimed?.();
    } catch {
      try {
        window.localStorage.setItem(LS_KEY, "denied");
      } catch {
        /* */
      }
      setStatus("denied");
    } finally {
      setBusy(false);
    }
  };

  if (status === "primed" || status === "unsupported") return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-1 text-sm font-medium text-slate-100">
        Enable microphone for voice check-ins
      </div>
      <p className="mb-3 text-xs leading-relaxed text-slate-400">
        Safari only asks once per site. Tap below so the mic prompt appears
        now, before your nurse calls.
      </p>
      <button
        type="button"
        onClick={prime}
        disabled={busy}
        className="tap-target w-full rounded-xl bg-accent-500 px-4 text-sm font-semibold text-white shadow-glow transition hover:bg-accent-400 active:bg-accent-600 disabled:opacity-60"
      >
        {busy
          ? "Requesting…"
          : status === "denied"
            ? "Microphone blocked — tap to retry"
            : "Enable microphone"}
      </button>
      {status === "denied" && (
        <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">
          If the prompt didn&apos;t appear, open Settings → Safari → Microphone
          (or tap the &quot;AA&quot; button in the address bar → Website Settings)
          and allow it for this site.
        </p>
      )}
    </div>
  );
}
