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
import { Glass } from "@/components/ui/Glass";

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
              return [p.id, summarize(calls)] as const;
            } catch {
              return [p.id, summaries[p.id] ?? EMPTY] as const;
            }
          })
        );
        if (alive) {
          setSummaries(Object.fromEntries(entries));
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
      <Glass
        backdrop={false}
        solidTone="lower"
        className="flex flex-col items-center justify-center gap-2 p-12 text-center"
      >
        <div className="grid h-12 w-12 place-items-center rounded-full bg-accent-500/15 ring-1 ring-accent-400/30">
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-accent-300">
            <path
              d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3.5 0-8 1.8-8 5v2h16v-2c0-3.2-4.5-5-8-5z"
              fill="currentColor"
            />
          </svg>
        </div>
        <div className="text-sm font-medium text-slate-200">
          No patients enrolled yet
        </div>
        <div className="max-w-sm text-xs text-slate-500">
          Run{" "}
          <code className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-slate-300">
            POST /api/demo/run
          </code>{" "}
          to seed a synthetic 5-day trajectory for the demo.
        </div>
      </Glass>
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
        <Glass
          backdrop={false}
          solidTone="lower"
          className="flex flex-col items-center justify-center gap-3 p-12 text-center"
        >
          <div className="text-sm font-medium text-slate-200">
            No patients match your filters
          </div>
          <p className="max-w-sm text-xs text-slate-500">
            Try widening the search or clearing advanced filters.
          </p>
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-white/20"
          >
            Clear all filters
          </Link>
        </Glass>
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-2">
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
