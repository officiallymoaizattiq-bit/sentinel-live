"use client";

import { useEffect, useState } from "react";
import type { Call, CallRecord } from "@/lib/api";
import { api } from "@/lib/api";
import { TrajectoryChart } from "@/components/TrajectoryChart";
import { useEventStream } from "@/lib/hooks/useEventStream";
import { CallLogCard } from "@/components/patient/CallLogCard";
import { Fake911Modal } from "@/components/patient/Fake911Modal";

const WIDGET_SRC = "https://elevenlabs.io/convai-widget/index.js";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "elevenlabs-convai": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { "agent-id": string },
        HTMLElement
      >;
    }
  }
}

type Props = {
  patientId: string;
  patientName: string;
  initialCalls: CallRecord[];
  agentId: string;
};

export function PatientLiveView({
  patientId, patientName, initialCalls, agentId,
}: Props) {
  const [calls, setCalls] = useState<CallRecord[]>(initialCalls);
  const [incoming, setIncoming] = useState<{ at: string; mode: string } | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [latestCall, setLatestCall] = useState<Call | null>(
    initialCalls?.[initialCalls.length - 1] ?? null
  );
  const [show911, setShow911] = useState(false);

  useEffect(() => {
    if (document.querySelector(`script[src="${WIDGET_SRC}"]`)) return;
    const s = document.createElement("script");
    s.src = WIDGET_SRC; s.async = true; s.type = "text/javascript";
    document.body.appendChild(s);
  }, []);

  const { connected } = useEventStream((e) => {
    if (e.type === "pending_call" && e.patient_id === patientId) {
      setIncoming({ at: e.at, mode: e.mode });
    }
    if (e.type === "call_scored" && e.patient_id === patientId) {
      api.calls(patientId).then(setCalls).catch(() => void 0);
    }
    if (e.type === "call_completed" && e.patient_id === patientId) {
      setLatestCall((prev) => ({
        ...((prev ?? {}) as Call),
        id: e.call_id,
        patient_id: e.patient_id,
        outcome_label: e.outcome_label,
        escalation_911: e.escalation_911,
        summary_patient: e.summary_patient,
        summary_nurse: e.summary_nurse,
        summaries_generated_at: new Date().toISOString(),
      } as Call));
      if (e.escalation_911) setShow911(true);
    }
  });

  const points = calls
    .filter((c) => c.score !== null)
    .map((c) => ({
      t: new Date(c.called_at).toLocaleTimeString(),
      deterioration: c.score!.deterioration,
    }));
  const last = calls[calls.length - 1] ?? null;

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4">
      <header>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{patientName}</h1>
          <span className={
            "rounded-full px-2 py-0.5 text-[10px] " +
            (connected
              ? "border border-emerald-400/40 text-emerald-300"
              : "border border-yellow-400/40 text-yellow-300 animate-pulse")
          }>
            {connected ? "● live" : "● connecting"}
          </span>
        </div>
        <p className="text-sm text-slate-400">Your recent check-ins</p>
      </header>

      {incoming && !widgetOpen && (
        <div className="rounded-2xl border border-emerald-400/40 bg-emerald-950/40 p-4">
          <div className="mb-2 text-sm font-medium text-emerald-200">
            Sentinel is calling you
          </div>
          <p className="mb-3 text-xs text-emerald-300/80">
            Your care team would like a quick check-in.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { setWidgetOpen(true); setIncoming(null); }}
              className="rounded-full bg-emerald-500 px-4 py-1.5 text-sm font-medium text-black"
            >
              Answer
            </button>
            <button
              onClick={() => setIncoming(null)}
              className="rounded-full border border-white/20 px-4 py-1.5 text-sm text-slate-300"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {widgetOpen && agentId && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">Live check-in</div>
            <button
              onClick={() => setWidgetOpen(false)}
              className="text-xs text-slate-400 underline"
            >
              End
            </button>
          </div>
          <elevenlabs-convai agent-id={agentId}></elevenlabs-convai>
        </div>
      )}

      {last?.score && (
        <section
          className={
            "rounded-2xl border p-4 " +
            (last.score.recommended_action === "suggest_911"
              ? "border-red-500/40 bg-red-950/40"
              : "border-white/10 bg-white/5")
          }
        >
          <div className="mb-1 text-sm text-slate-400">Latest check-in</div>
          <div className="text-lg">{last.score.summary}</div>
          <div className="mt-2 text-xs text-slate-500">
            {new Date(last.called_at).toLocaleString()}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm text-slate-400">Trend</h2>
        <TrajectoryChart points={points} />
      </section>

      {latestCall && <CallLogCard call={latestCall} audience="patient" />}
      {show911 && <Fake911Modal onAutoDismiss={() => setShow911(false)} />}

      <footer className="pt-4">
        <form action="/api/auth/logout" method="POST">
          <button type="submit" className="text-xs text-slate-500 underline">
            Sign out
          </button>
        </form>
      </footer>
    </div>
  );
}
