"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type Call } from "@/lib/api";
import { Glass } from "@/components/ui/Glass";

function resolvedSummary(call: Call, audience: "patient" | "nurse"): string | null {
  if (audience === "patient") {
    const gemini = call.summary_patient?.trim();
    if (gemini) return gemini;
    return call.score?.summary?.trim() || null;
  }
  return call.summary_nurse?.trim() || null;
}

export function CallLogCard({
  call,
  audience,
  embedded = false,
}: {
  call: Call;
  audience: "patient" | "nurse";
  /** When true, omit outer Glass (e.g. nested inside another panel). */
  embedded?: boolean;
}) {
  const fromCall = useMemo(
    () => resolvedSummary(call, audience),
    [
      audience,
      call.id,
      call.summary_patient,
      call.summary_nurse,
      call.score?.summary,
    ],
  );
  const [summary, setSummary] = useState<string | null>(fromCall);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSummary(fromCall);
  }, [fromCall]);

  const usedScoreFallback =
    audience === "patient" &&
    !call.summary_patient?.trim() &&
    Boolean(call.score?.summary?.trim()) &&
    !call.summaries_error;

  /** In-flight summary only if call is not finalized yet (rare on this card). */
  const awaitingSummary =
    !summary &&
    !call.summaries_error &&
    call.ended_at == null &&
    call.score != null;

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

  const body = (
    <>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">
        {audience === "patient" ? "Your check-in summary" : "Clinical summary"}
      </div>
      {awaitingSummary ? (
        <div className="space-y-2">
          <div className="h-3 w-3/4 animate-pulse rounded bg-white/10" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-white/10" />
        </div>
      ) : call.summaries_error ? (
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
      ) : summary ? (
        <>
          <p className="animate-[fadeIn_.3s_ease-out] text-sm leading-relaxed text-slate-100">
            {summary}
          </p>
          {usedScoreFallback && (
            <p className="mt-2 text-[10px] leading-snug text-slate-500">
              Plain-language summary is not available yet; this is the short
              clinical note from your check-in score.
            </p>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-slate-400">
            No summary for this visit yet.
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
      {!awaitingSummary && summary && !call.summaries_error && (
        <button
          disabled={busy}
          onClick={regenerate}
          className="mt-2 text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-50"
        >
          {busy ? "Regenerating…" : "Regenerate"}
        </button>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/25 p-4">
        {body}
      </div>
    );
  }

  return <Glass className="overflow-hidden p-4">{body}</Glass>;
}
