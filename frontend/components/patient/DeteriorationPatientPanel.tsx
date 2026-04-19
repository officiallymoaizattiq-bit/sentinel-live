"use client";

import { useState } from "react";
import {
  deteriorationScoreBands,
  scoreToSeverity,
  severityMeta,
} from "@/lib/format";
import type { Severity } from "@/lib/format";
import { SeverityChip } from "@/components/ui/SeverityChip";

const TIER_TITLE: Record<Severity, string> = {
  none: "Stable",
  patient_check: "Check",
  caregiver_alert: "At risk",
  nurse_alert: "Severe",
  suggest_911: "Emergency",
};

/** One line under your score (current tier only). */
const TIER_BLURB: Record<Severity, string> = {
  none: "No extra follow-up needed from this score alone.",
  patient_check: "A small change — your team may check in.",
  caregiver_alert: "Your care circle should watch symptoms more closely.",
  nurse_alert: "Higher concern — a nurse may contact you soon.",
  suggest_911:
    "If you were told to call 911 or go to the ER, do that. Otherwise wait for your team.",
};

/** Short legend under the colored bar. */
const TIER_LEGEND: Record<Severity, string> = {
  none: "Comfortable recovery range.",
  patient_check: "Light follow-up or extra questions are common.",
  caregiver_alert: "Someone who helps you should stay more alert.",
  nurse_alert: "Clinical team will likely step in.",
  suggest_911: "Treat as urgent until a clinician tells you otherwise.",
};

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function DeteriorationPatientPanel({
  deterioration,
}: {
  deterioration: number | null;
}) {
  const bands = deteriorationScoreBands();
  const sev =
    deterioration != null ? scoreToSeverity(deterioration) : ("none" as Severity);
  const meta = severityMeta(sev);
  const v = deterioration != null ? clamp01(deterioration) : null;
  const activeSev = v != null ? scoreToSeverity(v) : null;
  const [rangesOpen, setRangesOpen] = useState(false);
  const rangesPanelId = "deterioration-ranges-panel";

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Deterioration score
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            <span
              className="num text-4xl font-semibold tracking-tight tabular-nums"
              style={{ color: meta.color }}
            >
              {v != null ? v.toFixed(2) : "—"}
            </span>
            <span className="text-xs text-slate-500">
              0 = best · 1 = highest concern
            </span>
          </div>
        </div>
        {v != null && (
          <SeverityChip severity={sev} size="md" label={TIER_TITLE[sev]} />
        )}
      </div>

      {v != null && (
        <p className="mb-4 text-sm leading-relaxed text-slate-300">
          {TIER_BLURB[sev]}
        </p>
      )}

      {v == null && (
        <p className="mb-4 text-sm text-slate-400">
          After your first check-in, your score and this guide will show here.
        </p>
      )}
      <div className="relative pb-1">
            <div
              className="flex h-3 w-full overflow-hidden rounded-full ring-1 ring-white/10"
              aria-hidden
            >
              {bands.map((b) => {
                const w = (b.y1 - b.y0) * 100;
                const c = severityMeta(b.severity).color;
                return (
                  <div
                    key={`${b.y0}-${b.y1}`}
                    style={{ width: `${w}%`, backgroundColor: c }}
                    className="opacity-85 first:rounded-l-full last:rounded-r-full"
                  />
                );
              })}
            </div>
            {v != null && (
              <div
                className="pointer-events-none absolute -top-1 z-10"
                style={{ left: `${v * 100}%`, transform: "translateX(-50%)" }}
                aria-hidden
              >
                <div
                  className="mx-auto h-0 w-0 border-x-[6px] border-x-transparent border-b-[7px] border-b-white"
                  style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))" }}
                />
                <div
                  className="mx-auto -mt-px h-6 w-0.5 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
              </div>
            )}
            <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-slate-500">
              <span>0</span>
              <span>.2</span>
              <span>.4</span>
              <span>.6</span>
              <span>.8</span>
              <span>1</span>
            </div>
          </div>

      <button
        type="button"
        id="deterioration-ranges-toggle"
        aria-expanded={rangesOpen}
        aria-controls={rangesPanelId}
        onClick={() => setRangesOpen((o) => !o)}
        className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left text-sm font-medium text-slate-200 transition hover:border-white/15 hover:bg-white/[0.07]"
      >
        <span>What the ranges mean</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={
            "h-4 w-4 shrink-0 text-slate-500 transition-transform " +
            (rangesOpen ? "rotate-180" : "")
          }
          aria-hidden
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {rangesOpen ? (
        <div
          id={rangesPanelId}
          role="region"
          aria-labelledby="deterioration-ranges-toggle"
          className="mt-4 border-t border-white/10 pt-4"
        >
          
          <ul className="mt-4 space-y-2.5">
            {bands.map((b) => {
              const m = severityMeta(b.severity);
              const title = TIER_TITLE[b.severity];
              const inBand = activeSev === b.severity;
              return (
                <li
                  key={`${b.y0}-${b.y1}`}
                  className={
                    "flex gap-3 text-xs " +
                    (inBand ? "text-slate-100" : "text-slate-400")
                  }
                >
                  <span
                    className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/20"
                    style={{ backgroundColor: m.color }}
                  />
                  <div>
                    <span className="font-medium text-slate-200">{title}</span>
                    <span className="num text-slate-500">
                      {" "}
                      · {b.y0.toFixed(1)}–{b.y1.toFixed(1)}
                    </span>
                    <div className="mt-0.5 text-[11px] leading-snug text-slate-500">
                      {TIER_LEGEND[b.severity]}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
