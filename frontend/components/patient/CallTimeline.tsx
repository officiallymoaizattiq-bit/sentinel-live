"use client";

import { useState } from "react";
import { Glass } from "@/components/ui/Glass";
import type { CallRecord } from "@/lib/api";

const OUTCOME_COLOR: Record<string, string> = {
  fine: "#34D399",
  schedule_visit: "#FBBF24",
  escalated_911: "#F43F5E",
};
import {
  actionToSeverity,
  formatRelative,
  formatTime,
  scoreToSeverity,
  severityMeta,
} from "@/lib/format";

export function CallTimeline({ calls }: { calls: CallRecord[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!calls.length) {
    return (
      <Glass className="flex items-center justify-center p-6 text-sm text-slate-500">
        No calls yet.
      </Glass>
    );
  }

  const active = hoverIdx != null ? calls[hoverIdx] : calls[calls.length - 1];
  const activeSev =
    actionToSeverity(active.score?.recommended_action) !== "none"
      ? actionToSeverity(active.score?.recommended_action)
      : scoreToSeverity(active.score?.deterioration);

  return (
    <Glass className="overflow-hidden p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold tracking-tight text-white text-on-glass">
            Call timeline
          </div>
          <div className="text-[11px] text-slate-400">
            {calls.length} scored {calls.length === 1 ? "call" : "calls"}
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Stable
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            Watch
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-orange-400" />
            Warn
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            Critical
          </span>
        </div>
      </div>

      <div className="relative">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <div
          className="scrollbar-thin flex items-center gap-2 overflow-x-auto py-3"
          onMouseLeave={() => setHoverIdx(null)}
        >
          {calls.map((c, i) => {
            const sev = c.score?.recommended_action
              ? actionToSeverity(c.score.recommended_action)
              : scoreToSeverity(c.score?.deterioration);
            const meta = severityMeta(sev);
            const isActive = i === (hoverIdx ?? calls.length - 1);
            const size = isActive ? 14 : 10;
            return (
              <button
                key={c.id}
                type="button"
                onMouseEnter={() => setHoverIdx(i)}
                onFocus={() => setHoverIdx(i)}
                className="group relative grid shrink-0 place-items-center"
                style={{ width: 28, height: 28 }}
              >
                <span
                  className="rounded-full transition-all"
                  style={{
                    width: size,
                    height: size,
                    background: meta.color,
                    boxShadow: `0 0 ${isActive ? 14 : 8}px ${meta.glow}`,
                  }}
                />
                {c.outcome_label && OUTCOME_COLOR[c.outcome_label] && (
                  <span
                    className="absolute bottom-0 right-0 rounded-full border border-slate-900"
                    style={{
                      width: 6,
                      height: 6,
                      background: OUTCOME_COLOR[c.outcome_label],
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            When
          </div>
          <div className="text-sm font-medium text-slate-100">
            {formatTime(active.called_at)}
          </div>
          <div className="text-[10px] text-slate-500">
            {formatRelative(active.called_at)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            Deterioration
          </div>
          <div
            className="num text-sm font-semibold"
            style={{ color: severityMeta(activeSev).color }}
          >
            {active.score ? active.score.deterioration.toFixed(2) : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            qSOFA / NEWS2
          </div>
          <div className="num text-sm font-medium text-slate-100">
            {active.score
              ? `${active.score.qsofa} / ${active.score.news2}`
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            Action
          </div>
          <div className="font-mono text-xs text-slate-200">
            {active.score?.recommended_action ?? "—"}
          </div>
        </div>
      </div>
    </Glass>
  );
}
