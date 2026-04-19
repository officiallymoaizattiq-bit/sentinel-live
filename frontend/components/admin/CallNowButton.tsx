"use client";

import { useState } from "react";

export function CallNowButton({ patientId }: { patientId: string }) {
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

  return (
    <div className="inline-flex shrink-0 flex-col items-end gap-1">
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          run();
        }}
        disabled={busy}
        className="rounded-full border border-emerald-500/40 bg-slate-950 px-3 py-1 text-xs font-medium text-emerald-200 shadow-sm hover:border-emerald-400/55 hover:bg-slate-900 disabled:opacity-50"
      >
        {busy ? "Calling…" : "Call now"}
      </button>
      {status && (
        <span className="text-[10px] text-slate-400">{status}</span>
      )}
    </div>
  );
}
