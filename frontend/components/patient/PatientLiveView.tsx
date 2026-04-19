"use client";

import { useEffect, useState } from "react";
import type { Call, CallRecord } from "@/lib/api";
import { api } from "@/lib/api";
import { TrajectoryChart } from "@/components/TrajectoryChart";
import { formatTrajectoryAxisLabel } from "@/lib/format";
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
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
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

  useEffect(() => {
    if (!widgetOpen) { setSecondsLeft(null); return; }
    const startedAt = Date.now();
    const MIN_MS = 40_000;
    const MAX_MS = 60_000;
    let done = false;
    setSecondsLeft(60);

    const finalize = async (reason: string) => {
      if (done) return;
      done = true;
      const sev = (document.getElementById("demoSeverity") as HTMLSelectElement)?.value;
      try { await api.widgetEndCall(patientId, sev); } catch {}
      setWidgetOpen(false);
      // eslint-disable-next-line no-console
      console.log("widget auto-end:", reason);
    };

    const tick = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setSecondsLeft(Math.max(0, Math.ceil((MAX_MS - elapsed) / 1000)));
    }, 500);

    // Listen for ElevenLabs widget end/disconnect signals.
    const isEndEvent = (t: string) =>
      /convai.*(end|disconnect|close|stop|ended)/i.test(t) ||
      /(call|conversation).*ended/i.test(t) ||
      t === "elevenlabs-convai:end" ||
      t === "elevenlabs-convai:call-ended";
    const onEvt = (e: Event) => {
      if (!isEndEvent(e.type)) return;
      if (Date.now() - startedAt < MIN_MS) return; // ignore pre-minimum ends
      finalize(`widget-event:${e.type}`);
    };
    // Widget dispatches on window + on its own element. Attach broadly.
    const listenTypes = [
      "elevenlabs-convai:end",
      "elevenlabs-convai:call-ended",
      "convai-conversation-end",
      "convai-call-ended",
      "convai-end",
      "agent-end",
      "conversation-ended",
    ];
    listenTypes.forEach((t) => {
      window.addEventListener(t, onEvt as EventListener);
      document.addEventListener(t, onEvt as EventListener);
    });

    const hardCap = window.setTimeout(() => finalize("60s-cap"), MAX_MS);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(hardCap);
      listenTypes.forEach((t) => {
        window.removeEventListener(t, onEvt as EventListener);
        document.removeEventListener(t, onEvt as EventListener);
      });
    };
  }, [widgetOpen, patientId]);

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
      t: formatTrajectoryAxisLabel(c.called_at),
      at: c.called_at,
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
            <div className="text-sm font-semibold">
              Live check-in
              {secondsLeft != null && (
                <span className="ml-2 text-[11px] text-slate-400">
                  auto-ends in {Math.max(0, secondsLeft)}s
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <select
                id="demoSeverity"
                defaultValue="none"
                className="rounded-md border border-white/10 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-200"
              >
                <option value="none">Fine</option>
                <option value="nurse_alert">Schedule visit</option>
                <option value="suggest_911">911</option>
              </select>
              <button
                onClick={async () => {
                  const sev = (document.getElementById("demoSeverity") as HTMLSelectElement)?.value;
                  try { await api.widgetEndCall(patientId, sev); } catch {}
                  setWidgetOpen(false);
                }}
                className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/20"
              >
                End & summarize
              </button>
            </div>
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
