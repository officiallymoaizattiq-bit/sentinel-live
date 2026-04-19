"use client";

import { useEffect, useRef, useState } from "react";
import type { Call, CallRecord } from "@/lib/api";
import { api } from "@/lib/api";
import { TrajectoryChart } from "@/components/TrajectoryChart";
import { formatTrajectoryAxisLabel } from "@/lib/format";
import { useEventStream } from "@/lib/hooks/useEventStream";
import { CallLogCard } from "@/components/patient/CallLogCard";
import { DeteriorationPatientPanel } from "@/components/patient/DeteriorationPatientPanel";
import { Fake911Modal } from "@/components/patient/Fake911Modal";

/** Official embed (see ElevenLabs widget docs). Legacy elevenlabs.io URL often fails to register the element. */
const WIDGET_SRC = "https://unpkg.com/@elevenlabs/convai-widget-embed";

/** Convai web component instance (methods not in HTMLElement typings). */
type ConvaiElement = HTMLElement & {
  startConversation?: () => void;
  endConversation?: () => void;
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "elevenlabs-convai": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          "agent-id"?: string;
          variant?: "compact" | "expanded";
        },
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
  const convaiRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const existing = document.querySelector(
      `script[src^="${WIDGET_SRC}"],script[src*="convai-widget-embed"]`,
    );
    if (existing) return;
    const s = document.createElement("script");
    s.src = WIDGET_SRC;
    s.async = true;
    s.type = "text/javascript";
    document.body.appendChild(s);
  }, []);

  /** Mic / getUserMedia must run in the user-gesture stack — never after async gaps. */
  const primeConvaiElement = () => {
    const el = convaiRef.current as ConvaiElement | null;
    if (!el || !agentId.trim()) return false;
    el.setAttribute("agent-id", agentId.trim());
    el.setAttribute("variant", "expanded");
    return true;
  };

  const startVoiceFromUserGesture = () => {
    if (!primeConvaiElement()) return;
    const el = convaiRef.current as ConvaiElement | null;
    try {
      el?.startConversation?.();
    } catch {
      /* blocked or widget not ready */
    }
  };

  /** When panel opens, keep attributes fresh (no async — gesture handled by Answer / Start button). */
  useEffect(() => {
    if (!widgetOpen || !agentId.trim()) return;
    primeConvaiElement();
  }, [widgetOpen, agentId]);

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
      api
        .calls(patientId)
        .then((next) => {
          setCalls(next);
          setLatestCall(next.length ? next[next.length - 1]! : null);
        })
        .catch(() => void 0);
    }
    if (e.type === "call_completed" && e.patient_id === patientId) {
      api
        .calls(patientId)
        .then((next) => {
          setCalls(next);
          setLatestCall(next.length ? next[next.length - 1]! : null);
        })
        .catch(() => void 0);
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
  const lastWithScore = [...calls].reverse().find((c) => c.score != null) ?? null;
  const deterioration = lastWithScore?.score?.deterioration ?? null;

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
      </header>

      <DeteriorationPatientPanel deterioration={deterioration} />

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
              type="button"
              onClick={() => {
                setIncoming(null);
                setWidgetOpen(true);
              }}
              className="rounded-full bg-emerald-500 px-4 py-1.5 text-sm font-medium text-black"
            >
              Answer
            </button>
            <button
              type="button"
              onClick={() => setIncoming(null)}
              className="rounded-full border border-white/20 px-4 py-1.5 text-sm text-slate-300"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {widgetOpen && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          {!agentId.trim() ? (
            <div className="space-y-3 text-sm text-slate-300">
              <p className="font-medium text-amber-200/90">
                Voice check-in is not configured
              </p>
              <p className="text-xs leading-relaxed text-slate-400">
                Set{" "}
                <code className="rounded bg-black/30 px-1 py-0.5 text-[11px] text-slate-200">
                  NEXT_PUBLIC_ELEVENLABS_AGENT_ID
                </code>{" "}
                in <code className="text-[11px]">frontend/.env.local</code> to your
                public Conversational AI agent ID, then restart{" "}
                <code className="text-[11px]">npm run dev</code>.
              </p>
              <button
                type="button"
                onClick={() => setWidgetOpen(false)}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  Live check-in
                  {secondsLeft != null && (
                    <span className="ml-2 text-[11px] text-slate-400">
                      auto-ends in {Math.max(0, secondsLeft)}s
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
                    type="button"
                    onClick={async () => {
                      const sev = (
                        document.getElementById("demoSeverity") as HTMLSelectElement
                      )?.value;
                      try {
                        await api.widgetEndCall(patientId, sev);
                      } catch {
                        /* */
                      }
                      setWidgetOpen(false);
                    }}
                    className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/20"
                  >
                    End & summarize
                  </button>
                </div>
              </div>
              <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
                Tap the button below to allow the microphone — browsers require a
                direct tap (starting the call from code alone will not show the
                mic prompt). If nothing happens, confirm this site is allowed in
                the lock / mic icon in the address bar and that your ElevenLabs
                agent allows this domain in its security allowlist.
              </p>
              <button
                type="button"
                onClick={startVoiceFromUserGesture}
                className="mb-3 w-full rounded-xl bg-emerald-500/90 py-2.5 text-sm font-semibold text-black shadow-sm transition hover:bg-emerald-400"
              >
                Start voice check-in
              </button>
              <div className="relative min-h-[220px] w-full">
                <elevenlabs-convai
                  ref={convaiRef}
                  variant="expanded"
                  {...{ "agent-id": agentId.trim() }}
                />
              </div>
            </>
          )}
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
        <h2 className="mb-2 text-sm text-slate-400">Your Recent Check-In Trends</h2>
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
