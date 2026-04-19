"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, type CallRecord, type Patient } from "@/lib/api";
import {
  filterPatientsByParams,
  hasActivePatientFilters,
  parseFromURLSearchParams,
} from "@/lib/patientQuery";
import { latestScoredCall } from "@/lib/latestScoredCall";
import { usePolling } from "@/lib/hooks/usePolling";
import { useEventStream } from "@/lib/hooks/useEventStream";
import { PatientCard } from "@/components/PatientCard";
import { CallNowButton } from "@/components/admin/CallNowButton";
import { EmptyState } from "@/components/ui/EmptyState";

type CallSummary = {
  series: number[];
  lastDeterioration: number | null;
  lastCalledAt: string | null;
  lastOutcome: "fine" | "schedule_visit" | "escalated_911" | null;
};

const EMPTY: CallSummary = {
  series: [],
  lastDeterioration: null,
  lastCalledAt: null,
  lastOutcome: null,
};

function summarize(calls: CallRecord[]): CallSummary {
  if (!calls.length) return EMPTY;
  const series = calls
    .filter((c) => c.score)
    .map((c) => c.score!.deterioration);
  const last = calls[calls.length - 1];
  const lastScored = latestScoredCall(calls);
  return {
    series,
    lastDeterioration: lastScored?.score?.deterioration ?? null,
    lastCalledAt: last.called_at ?? null,
    lastOutcome: last?.outcome_label ?? null,
  };
}

export function PatientGrid({
  initialPatients,
  initialSummaries,
}: {
  initialPatients: Patient[];
  initialSummaries: Record<string, CallSummary>;
}) {
  const sp = useSearchParams();
  const filterParams = useMemo(
    () => parseFromURLSearchParams(new URLSearchParams(sp.toString())),
    [sp]
  );

  const { data: patientsData } = usePolling<Patient[]>(
    api.patients,
    10_000,
    initialPatients
  );
  const patients = patientsData ?? initialPatients;

  const [summaries, setSummaries] =
    useState<Record<string, CallSummary>>(initialSummaries);

  const filteredPatients = useMemo(
    () => filterPatientsByParams(patients, summaries, filterParams),
    [patients, summaries, filterParams]
  );

  // Live refresh: when a call is scored for a patient, refetch that patient's calls.
  useEventStream((e) => {
    if (e.type === "call_scored") {
      const pid = e.patient_id;
      api
        .calls(pid)
        .then((calls) => {
          setSummaries((prev) => ({ ...prev, [pid]: summarize(calls) }));
        })
        .catch(() => void 0);
    }
  });

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const entries = await Promise.all(
          patients.map(async (p) => {
            try {
              const calls = await api.calls(p.id);
              return [p.id, summarize(calls), true] as const;
            } catch {
              return [p.id, EMPTY, false] as const;
            }
          })
        );
        if (alive) {
          setSummaries((prev) => {
            const next: Record<string, CallSummary> = {};
            for (const [id, s, ok] of entries) {
              // Preserve prior summary when a per-patient fetch errored.
              next[id] = ok ? s : prev[id] ?? EMPTY;
            }
            return next;
          });
        }
      } catch {
        /* noop */
      }
    };
    const id = setInterval(tick, 8_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients.map((p) => p.id).join(",")]);

  if (!patients.length) {
    return (
      <EmptyState
        tone="accent"
        title="No patients enrolled yet"
        description={
          <>
            Run{" "}
            <code className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-slate-300">
              POST /api/demo/run
            </code>{" "}
            to seed a synthetic 5-day trajectory for the demo.
          </>
        }
        icon={
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
            <path
              d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3.5 0-8 1.8-8 5v2h16v-2c0-3.2-4.5-5-8-5z"
              fill="currentColor"
            />
          </svg>
        }
      />
    );
  }

  if (!filteredPatients.length && hasActivePatientFilters(filterParams)) {
    return (
      <>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-white text-on-glass">
              Monitored patients
            </h2>
            <p className="text-[11px] text-slate-400">
              Status reflects the most recent scored call
            </p>
          </div>
          <span className="text-[11px] text-slate-500">
            0 shown · {patients.length} enrolled
          </span>
        </div>
        <EmptyState
          tone="muted"
          title="No patients match your filters"
          description="Try widening the search or clearing advanced filters."
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-5 w-5"
              aria-hidden
            >
              <path
                d="M4 6h16M7 12h10M10 18h4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          }
          action={
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-surface-hover px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors duration-150 hover:border-hairline-strong hover:bg-white/[0.09]"
            >
              Clear all filters
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-white text-on-glass">
            Monitored patients
          </h2>
          <p className="text-[11px] text-slate-400">
            Status reflects the most recent scored call
          </p>
        </div>
        <span className="text-[11px] text-slate-500">
          {hasActivePatientFilters(filterParams)
            ? `${filteredPatients.length} shown · ${patients.length} enrolled`
            : `${patients.length} total`}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*:nth-child(odd):last-child]:sm:col-span-2">
        {filteredPatients.map((p) => {
          const s = summaries[p.id] ?? EMPTY;
          return (
            <PatientCard
              key={p.id}
              p={p}
              series={s.series}
              lastDeterioration={s.lastDeterioration}
              lastCalledAt={s.lastCalledAt}
              footerAction={<CallNowButton patientId={p.id} />}
              lastOutcome={s.lastOutcome}
            />
          );
        })}
      </div>
    </>
  );
}
