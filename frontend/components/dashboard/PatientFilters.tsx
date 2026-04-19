"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Glass } from "@/components/ui/Glass";
import {
  parseFromURLSearchParams,
  serializePatientQuery,
  SURGERY_TYPES,
  SEVERITY_FILTER_OPTIONS,
  type PatientListParams,
  type SeverityBucket,
} from "@/lib/patientQuery";
import { surgeryLabel } from "@/lib/format";

/** Matches login + glass form controls (dark fill, subtle inner highlight). */
const filterControlClass =
  "w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-[border-color,box-shadow] placeholder:text-slate-500 focus:border-accent-400/45 focus:outline-none scheme-dark";

export function PatientFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draft, setDraft] = useState<PatientListParams>(() =>
    parseFromURLSearchParams(new URLSearchParams(sp.toString()))
  );

  useEffect(() => {
    setDraft(parseFromURLSearchParams(new URLSearchParams(sp.toString())));
  }, [sp]);

  const apply = () => {
    const qs = serializePatientQuery(draft);
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const clear = () => {
    setDraft({});
    router.push(pathname);
  };

  const toggleSeverity = (value: SeverityBucket) => {
    setDraft((d) => {
      const cur = d.severity ?? [];
      const has = cur.includes(value);
      const next = has ? cur.filter((x) => x !== value) : [...cur, value];
      const out: PatientListParams = {
        ...d,
        severity: next.length ? next : undefined,
      };
      return out;
    });
  };

  const sevClass = (value: string, selected: boolean): string => {
    const base =
      "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors";
    if (!selected) {
      return `${base} border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/20 hover:bg-white/[0.07]`;
    }
    switch (value) {
      case "stable":
        return `${base} border-emerald-500/50 bg-emerald-600/30 text-emerald-100`;
      case "at_risk":
        return `${base} border-amber-400/50 bg-amber-500/25 text-amber-50`;
      case "severe":
        return `${base} border-orange-500/50 bg-orange-600/35 text-white`;
      case "911":
        return `${base} border-rose-500/60 bg-rose-600/40 text-white`;
      default:
        return `${base} border-accent-400/40 bg-accent-600/25 text-white`;
    }
  };

  return (
    <Glass backdrop={false} className="p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <div className="mb-1 text-[11px] text-slate-400">Search by name</div>
          <div className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-4 w-4 shrink-0 text-slate-500"
              aria-hidden
            >
              <path
                d="M21 21l-4.3-4.3M11 18a7 7 0 110-14 7 7 0 010 14z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="text"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
              value={draft.q ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, q: e.target.value || undefined }))
              }
              placeholder="Search by name…"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={apply}
            className="rounded-xl bg-accent-500/90 px-3 py-2 text-sm font-medium text-white hover:bg-accent-400"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={clear}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-slate-200 hover:border-white/20 hover:bg-white/[0.07]"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-medium text-slate-300 hover:border-white/15 hover:bg-white/[0.06]"
          >
            {showAdvanced ? "Hide advanced" : "Advanced"}
          </button>
        </div>
      </div>

      {showAdvanced ? (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              Surgery
              <div className="relative">
                <select
                  aria-label="Filter by surgery type"
                  className={`${filterControlClass} cursor-pointer appearance-none pr-10`}
                  value={draft.surgery_type ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      surgery_type: e.target.value || undefined,
                    }))
                  }
                >
                  <option value="">Any procedure</option>
                  {SURGERY_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {surgeryLabel(s)}
                    </option>
                  ))}
                </select>
                <span
                  className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500"
                  aria-hidden
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="h-4 w-4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </div>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              Discharge from
              <input
                type="datetime-local"
                className={filterControlClass}
                value={toLocalInput(draft.discharge_from)}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    discharge_from: fromLocalInput(e.target.value) || undefined,
                  }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              Discharge to
              <input
                type="datetime-local"
                className={filterControlClass}
                value={toLocalInput(draft.discharge_to)}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    discharge_to: fromLocalInput(e.target.value) || undefined,
                  }))
                }
              />
            </label>
          </div>

          <div>
            <div className="mb-2 text-[11px] font-medium text-slate-400">
              Severity
            </div>
            <div className="flex flex-wrap gap-2">
              {SEVERITY_FILTER_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleSeverity(value)}
                  className={sevClass(value, !!draft.severity?.includes(value))}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Severity uses deterioration from the most recent scored call.
            </div>
          </div>
        </div>
      ) : null}
    </Glass>
  );
}

function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}
