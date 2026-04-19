import Link from "next/link";
import { api } from "@/lib/api";
import { Glass } from "@/components/ui/Glass";
import { TrajectoryChart } from "@/components/TrajectoryChart";
import { PatientHero } from "@/components/patient/PatientHero";
import { VitalsRow } from "@/components/patient/VitalsRow";
import { CallTimeline } from "@/components/patient/CallTimeline";
import { CallLogCard } from "@/components/patient/CallLogCard";
import {
  formatTrajectoryAxisLabel,
  scoreToSeverity,
  type Severity,
  severityMeta,
} from "@/lib/format";
import { latestScoredCall } from "@/lib/latestScoredCall";
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
          href="/admin"
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
      t: formatTrajectoryAxisLabel(c.called_at),
      at: c.called_at,
      deterioration: c.score!.deterioration,
      outcome_label: c.outcome_label ?? undefined,
    }));

  const lastCall = calls[calls.length - 1] ?? null;
  const lastScored = latestScoredCall(calls);
  const lastFinalized =
    [...calls]
      .reverse()
      .find((c) => c.summary_nurse || c.summary_patient || c.outcome_label) ??
    lastCall;
  const severity: Severity = scoreToSeverity(
    lastScored?.score?.deterioration ?? null
  );

  const callsToday = calls.filter((c) => isToday(c.called_at)).length;

  return (
    <div className="space-y-6">
      <PatientHero
        patient={patient}
        severity={severity}
        deterioration={lastScored?.score?.deterioration ?? null}
        callsToday={callsToday}
        totalCalls={calls.length}
      />

      <VitalsRow
        deterioration={lastScored?.score?.deterioration ?? null}
        qsofa={lastScored?.score?.qsofa ?? null}
        news2={lastScored?.score?.news2 ?? null}
        redFlags={lastScored?.score?.red_flags ?? []}
        severity={severity}
        summary={lastScored?.score?.summary ?? null}
        recommendedAction={lastScored?.score?.recommended_action ?? null}
      />

      <Glass className="overflow-hidden p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold tracking-tight text-white text-on-glass">
              Deterioration trajectory
            </div>
            <div className="text-[11px] text-slate-400">
              Bands at 0.2 / 0.4 / 0.6 / 0.8 — same scale as the deterioration score
            </div>
          </div>
          <div className="flex max-w-[min(100%,520px)] flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] uppercase tracking-wider text-slate-500">
            {(
              [
                "none",
                "patient_check",
                "caregiver_alert",
                "nurse_alert",
                "suggest_911",
              ] as const
            ).map((s) => {
              const m = severityMeta(s);
              return (
                <span key={s} className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: m.color }}
                  />
                  {m.shortLabel}
                </span>
              );
            })}
          </div>
        </div>
        <TrajectoryChart points={points} />
      </Glass>

      <section>
        <h3 className="mb-2 text-sm text-slate-400">Wearable vitals (24h)</h3>
        <VitalsPanel patientId={params.id} />
      </section>

      <div className="min-w-0 space-y-4">
        {lastFinalized && (
          <CallLogCard call={lastFinalized} audience="nurse" />
        )}
        <CallTimeline calls={calls} />
      </div>
    </div>
  );
}
