"use client";

import { useState } from "react";

export function FinalizeButton() {
  const [convId, setConvId] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!convId.trim()) return;
    setBusy(true);
    setStatus("calling backend…");
    try {
      const r = await fetch("/api/calls/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation_id: convId.trim() }),
      });
      const json = await r.json().catch(() => ({}));
      if (r.ok) {
        setStatus(`scored call ${json.call_id ?? "?"}`);
      } else {
        setStatus(`error ${r.status}: ${JSON.stringify(json)}`);
      }
    } catch (e) {
      setStatus(`network: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded border border-slate-800 bg-slate-900 p-4">
      <h3 className="mb-2 text-sm font-semibold">Finalize live call</h3>
      <p className="mb-2 text-xs text-slate-400">
        After ending the Convai call above, paste the conversation ID from
        ElevenLabs (agent page → History) and score it.
      </p>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
          placeholder="conv_xxx..."
          value={convId}
          onChange={(e) => setConvId(e.target.value)}
          disabled={busy}
        />
        <button
          onClick={run}
          disabled={busy || !convId.trim()}
          className="rounded border border-slate-700 bg-slate-800 px-3 py-1 text-xs disabled:opacity-50"
        >
          {busy ? "…" : "Finalize"}
        </button>
      </div>
      {status && (
        <div className="mt-2 font-mono text-xs text-slate-400">{status}</div>
      )}
    </div>
  );
}
