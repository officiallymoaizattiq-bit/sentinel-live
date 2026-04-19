import { Suspense } from "react";
import { api } from "@/lib/api";
import { latestScoredCall } from "@/lib/latestScoredCall";
import { AlertFeed } from "@/components/AlertFeed";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { PatientFilters } from "@/components/dashboard/PatientFilters";
import { PatientGrid } from "@/components/dashboard/PatientGrid";

export const revalidate = 0;

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

export default async function Dashboard() {
  const [patients, alerts] = await Promise.all([
    api.patients().catch(() => []),
    api.alerts().catch(() => []),
  ]);
  const { count: initialOpenAlertCount } = await api
    .openAlertCount()
    .catch(() => ({ count: 0 }));

  const summaryEntries = await Promise.all(
    patients.map(async (p): Promise<readonly [string, CallSummary]> => {
      try {
        const calls = await api.calls(p.id);
        const series = calls
          .filter((c) => c.score)
          .map((c) => c.score!.deterioration);
        const last = calls[calls.length - 1];
        const lastScored = latestScoredCall(calls);
        return [
          p.id,
          {
            series,
            lastDeterioration: lastScored?.score?.deterioration ?? null,
            lastCalledAt: last?.called_at ?? null,
            lastOutcome: last?.outcome_label ?? null,
          },
        ] as const;
      } catch {
        return [p.id, EMPTY] as const;
      }
    })
  );
  const summaries: Record<string, CallSummary> = Object.fromEntries(summaryEntries);

  return (
    <div className="space-y-6">
      <Suspense
        fallback={
          <div className="mb-6 h-[120px] animate-pulse rounded-2xl bg-white/[0.04] ring-1 ring-white/10" />
        }
      >
        <KpiStrip
          initialPatients={patients}
          initialAlerts={alerts}
          initialSummaries={summaries}
          initialOpenAlertCount={initialOpenAlertCount}
        />
      </Suspense>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="min-w-0 space-y-4 lg:col-span-2">
          <Suspense
            fallback={
              <div className="h-40 animate-pulse rounded-2xl bg-white/[0.04] ring-1 ring-white/10" />
            }
          >
            <PatientFilters />
          </Suspense>
          <Suspense
            fallback={
              <div className="h-64 animate-pulse rounded-2xl bg-white/[0.04] ring-1 ring-white/10" />
            }
          >
            <PatientGrid
              initialPatients={patients}
              initialSummaries={summaries}
            />
          </Suspense>
        </section>

        <aside className="min-w-0">
          <div className="lg:sticky lg:top-4">
            <AlertFeed initial={alerts} />
          </div>
        </aside>
      </div>
    </div>
  );
}
