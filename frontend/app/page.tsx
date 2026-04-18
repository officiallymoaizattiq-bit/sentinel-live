import { api } from "@/lib/api";
import { AlertFeed } from "@/components/AlertFeed";
import { KpiStrip } from "@/components/dashboard/KpiStrip";
import { PatientGrid } from "@/components/dashboard/PatientGrid";
import { ConvaiWidget } from "@/components/ConvaiWidget";
import { FinalizeButton } from "@/components/FinalizeButton";

export const revalidate = 0;

type CallSummary = {
  series: number[];
  lastDeterioration: number | null;
  lastAction: string | null;
  lastCalledAt: string | null;
};

const EMPTY: CallSummary = {
  series: [],
  lastDeterioration: null,
  lastAction: null,
  lastCalledAt: null,
};

export default async function Dashboard() {
  const [patients, alerts] = await Promise.all([
    api.patients().catch(() => []),
    api.alerts().catch(() => []),
  ]);

  const summaryEntries = await Promise.all(
    patients.map(async (p): Promise<readonly [string, CallSummary]> => {
      try {
        const calls = await api.calls(p.id);
        const series = calls
          .filter((c) => c.score)
          .map((c) => c.score!.deterioration);
        const last = calls[calls.length - 1];
        return [
          p.id,
          {
            series,
            lastDeterioration: last?.score?.deterioration ?? null,
            lastAction: last?.score?.recommended_action ?? null,
            lastCalledAt: last?.called_at ?? null,
          },
        ] as const;
      } catch {
        return [p.id, EMPTY] as const;
      }
    })
  );
  const summaries: Record<string, CallSummary> = Object.fromEntries(summaryEntries);

  const lastDets = Object.values(summaries)
    .map((s) => s.lastDeterioration)
    .filter((v): v is number => typeof v === "number");
  const avgDeterioration =
    lastDets.length > 0
      ? lastDets.reduce((a, b) => a + b, 0) / lastDets.length
      : null;

  return (
    <div className="space-y-6">
      <KpiStrip
        initialPatients={patients}
        initialAlerts={alerts}
        initialAvgDeterioration={avgDeterioration}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="min-w-0 lg:col-span-2">
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
              {patients.length} total
            </span>
          </div>
          <PatientGrid
            initialPatients={patients}
            initialSummaries={summaries}
          />
        </section>

        <aside className="min-w-0">
          <div className="lg:sticky lg:top-4">
            <AlertFeed initial={alerts} />
          </div>
        </aside>
      </div>
  const patients = await api.patients();
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "";

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      <section className="md:col-span-2 space-y-6">
        <div>
          <h2 className="mb-2 text-lg font-semibold">Patients</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {patients.map((p) => (
              <PatientCard key={p.id} p={p} />
            ))}
          </div>
        </div>
        <ConvaiWidget agentId={agentId} />
        <FinalizeButton />
      </section>
      <aside>
        <h2 className="mb-2 text-lg font-semibold">Recent alerts</h2>
        <AlertFeed />
      </aside>
    </div>
  );
}
