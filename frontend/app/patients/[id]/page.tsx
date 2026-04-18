import Link from "next/link";
import { api } from "@/lib/api";
import { Glass } from "@/components/ui/Glass";
import { TrajectoryChart } from "@/components/TrajectoryChart";
import { CohortPanel } from "@/components/CohortPanel";
import { PatientHero } from "@/components/patient/PatientHero";
import { VitalsRow } from "@/components/patient/VitalsRow";
import { CallTimeline } from "@/components/patient/CallTimeline";
import {
  actionToSeverity,
  scoreToSeverity,
  type Severity,
} from "@/lib/format";
import { VitalsPanel } from "@/components/VitalsPanel";

export const revalidate = 0;

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default async function PatientDetail({
  params,
}: {
  params: { id: string };
}) {
  const [patients, calls] = await Promise.all([
    api.patients(),
    api.calls(params.id),
  ]);
  const patient = patients.find((p) => p.id === params.id);
  if (!patient) {
    return (
      <Glass className="p-10 text-center">
        <div className="text-base font-medium text-slate-200">
          Patient not found
        </div>
        <div className="mt-1 text-sm text-slate-400">
          This patient may have been removed.
        </div>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-white/20"
        >
          ← Back to dashboard
        </Link>
      </Glass>
    );
  }

  const points = calls
    .filter((c) => c.score !== null)
    .map((c) => ({
      t: new Date(c.called_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      deterioration: c.score!.deterioration,
    }));

  const last = calls[calls.length - 1] ?? null;
  const severity: Severity = last?.score
    ? actionToSeverity(last.score.recommended_action) !== "none"
      ? actionToSeverity(last.score.recommended_action)
      : scoreToSeverity(last.score.deterioration)
    : "none";

  const callsToday = calls.filter((c) => isToday(c.called_at)).length;

  return (
    <div className="space-y-6">
      <PatientHero
        patient={patient}
        severity={severity}
        deterioration={last?.score?.deterioration ?? null}
        callsToday={callsToday}
        totalCalls={calls.length}
      />

      <VitalsRow
        deterioration={last?.score?.deterioration ?? null}
        qsofa={last?.score?.qsofa ?? null}
        news2={last?.score?.news2 ?? null}
        redFlags={last?.score?.red_flags ?? []}
        severity={severity}
        summary={last?.score?.summary ?? null}
        recommendedAction={last?.score?.recommended_action ?? null}
      />

      <Glass className="overflow-hidden p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold tracking-tight text-white text-on-glass">
              Deterioration trajectory
            </div>
            <div className="text-[11px] text-slate-400">
              Recent scored calls · severity bands shown
            </div>
          </div>
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400/60" />
              Calm
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400/60" />
              Watch
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500/70" />
              Critical
            </span>
          </div>
        </div>
        <TrajectoryChart points={points} />
      </Glass>

      <section>
        <h3 className="mb-2 text-sm text-slate-400">Wearable vitals (24h)</h3>
        <VitalsPanel patientId={params.id} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          <CallTimeline calls={calls} />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <CohortPanel last={last} />
        </div>
      </div>
    </div>
  );
}
