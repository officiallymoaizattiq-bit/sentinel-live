import { Suspense } from "react";
import { api } from "@/lib/api";
import { latestScoredCall } from "@/lib/latestScoredCall";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { PatientGrid } from "@/components/dashboard/PatientGrid";
import {
  KpiStripSkeleton,
  PatientGridSkeleton,
} from "@/components/ui/Skeleton";

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
  const patients = await api.patients().catch(() => []);

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
    <div className="animate-fade-in space-y-6">
      <Suspense fallback={<KpiStripSkeleton />}>
        <KpiStrip initialPatients={patients} initialSummaries={summaries} />
      </Suspense>

      <section className="min-w-0 space-y-4">
        <Suspense fallback={<PatientGridSkeleton count={4} />}>
          <PatientGrid initialPatients={patients} initialSummaries={summaries} />
        </Suspense>
      </section>
    </div>
  );
}
