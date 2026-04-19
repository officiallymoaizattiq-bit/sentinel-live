"use client";

import { useState } from "react";
import { api, type Call } from "@/lib/api";
import { Glass } from "@/components/ui/Glass";

export function CallLogCard({
  call,
  audience,
}: {
  call: Call;
  audience: "patient" | "nurse";
}) {
  const initial =
    audience === "patient"
      ? call.summary_patient ?? null
      : call.summary_nurse ?? null;
  const [summary, setSummary] = useState<string | null>(initial);
  const [busy, setBusy] = useState(false);
  const generating = !summary && !call.summaries_error;

  async function regenerate() {
    if (!call.id) return;
    setBusy(true);
    try {
      const r = await api.regenerateSummary(call.id);
      setSummary(audience === "patient" ? r.summary_patient : r.summary_nurse);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Glass className="overflow-hidden p-4">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">
        {audience === "patient" ? "Your check-in summary" : "Clinical summary"}
      </div>
      {generating ? (
        <div className="space-y-2">
          <div className="h-3 w-3/4 animate-pulse rounded bg-white/10" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-white/10" />
        </div>
      ) : summary ? (
        <p className="animate-[fadeIn_.3s_ease-out] text-sm leading-relaxed text-slate-100">
          {summary}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-rose-300">
            Summary failed to generate
            {call.summaries_error ? `: ${call.summaries_error}` : ""}.
          </p>
          <button
            disabled={busy}
            onClick={regenerate}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-100 hover:bg-white/10 disabled:opacity-50"
          >
            {busy ? "Generating…" : "Generate summary"}
          </button>
        </div>
      )}
      {!generating && summary && (
        <button
          disabled={busy}
          onClick={regenerate}
          className="mt-2 text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-50"
        >
          {busy ? "Regenerating…" : "Regenerate"}
        </button>
      )}
    </Glass>
  );
}
