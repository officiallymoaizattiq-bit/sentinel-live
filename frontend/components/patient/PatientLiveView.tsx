"use client";

import { useEffect, useRef, useState } from "react";
import type { Call, CallRecord } from "@/lib/api";
import { api } from "@/lib/api";
import { TrajectoryChart } from "@/components/TrajectoryChart";
import {
  formatTrajectoryAxisLabel,
  scoreToSeverity,
} from "@/lib/format";
import { SeverityChip } from "@/components/ui/SeverityChip";
import { useEventStream } from "@/lib/hooks/useEventStream";
import { CallLogCard } from "@/components/patient/CallLogCard";
import { DeteriorationPatientPanel } from "@/components/patient/DeteriorationPatientPanel";
import { Fake911Modal } from "@/components/patient/Fake911Modal";
import { IncomingCallCard } from "@/components/patient/IncomingCallCard";
import { MicPrimer } from "@/components/patient/MicPrimer";

/** Official embed (see ElevenLabs widget docs). Legacy elevenlabs.io URL often fails to register the element. */
const WIDGET_SRC = "https://unpkg.com/@elevenlabs/convai-widget-embed@0.11.4/dist/index.js";

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
  const [wrappingUp, setWrappingUp] = useState(false);
  const [latestCall, setLatestCall] = useState<Call | null>(
    initialCalls?.[initialCalls.length - 1] ?? null
  );
  const [show911, setShow911] = useState(false);
  const convaiRef = useRef<HTMLElement | null>(null);

  const [widgetReady, setWidgetReady] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  useEffect(() => {
    const checkReady = () => {
      if (typeof window !== "undefined" && window.customElements?.get("elevenlabs-convai")) {
        setWidgetReady(true);
        return true;
      }
      return false;
    };
    if (checkReady()) return;

    const existing = document.querySelector(
      `script[src*="convai-widget-embed"]`,
    );
    let script: HTMLScriptElement | null = existing as HTMLScriptElement | null;
    if (!existing) {
      script = document.createElement("script");
      script.src = WIDGET_SRC;
      script.async = true;
      script.type = "module";
      script.crossOrigin = "anonymous";
      script.onerror = () => setWidgetError("Widget script failed to load");
      document.head.appendChild(script);
    }
    const iv = window.setInterval(() => {
      if (checkReady()) window.clearInterval(iv);
    }, 200);
    const fail = window.setTimeout(() => {
      if (!checkReady()) setWidgetError("Widget did not register within 10s");
    }, 10000);
    return () => { window.clearInterval(iv); window.clearTimeout(fail); };
  }, []);

  /** Mic / getUserMedia must run in the user-gesture stack — never after async gaps. */
  const primeConvaiElement = () => {
    const el = convaiRef.current as ConvaiElement | null;
    if (!el || !agentId.trim()) return false;
    el.setAttribute("agent-id", agentId.trim());
    el.setAttribute("variant", "expanded");
    return true;
  };

  /**
   * iOS Safari blocks AudioContext until it is created/resumed from a direct
   * user gesture. Call this synchronously inside any tap handler that will
   * eventually produce audio (Answer / Start voice) so the widget's later
   * playback isn't silently muted.
   */
  const unlockAudio = () => {
    try {
      const Ctx =
        (window as unknown as {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        }).AudioContext ||
        (window as unknown as {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      // Resume in same tick — if it returns a promise, that's fine, the
      // gesture has already been consumed by the time we awaited nothing.
      void ctx.resume?.();
      // Play a silent buffer to fully unlock audio on iOS.
      const buffer = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* best-effort */
    }
  };

  const startVoiceFromUserGesture = () => {
    unlockAudio();
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
    if (!widgetOpen) { setSecondsLeft(null); setWrappingUp(false); return; }
    const startedAt = Date.now();
    const MIN_MS = 40_000;
    const WRAP_UP_MS = 55_000;
    const MAX_MS = 60_000;
    let done = false;
    setSecondsLeft(60);
    setWrappingUp(false);

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

    const wrapNudge = window.setTimeout(() => setWrappingUp(true), WRAP_UP_MS);
    const hardCap = window.setTimeout(() => finalize("60s-cap"), MAX_MS);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(wrapNudge);
      window.clearTimeout(hardCap);
      listenTypes.forEach((t) => {
        window.removeEventListener(t, onEvt as EventListener);
        document.removeEventListener(t, onEvt as EventListener);
      });
    };
  }, [widgetOpen, patientId]);

  const { connected, reconnectAt } = useEventStream((e) => {
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

  const reconnecting = !connected && reconnectAt != null;
  const latestSeverity = scoreToSeverity(deterioration);

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4 safe-pb">
      <header className="safe-pt">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{patientName}</h1>
          <div className="flex items-center gap-2">
            {reconnecting && (
              <span
                role="status"
                className="inline-flex items-center gap-1 rounded-full border border-yellow-400/40 bg-yellow-500/10 px-2 py-0.5 text-[10px] text-yellow-200"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-300" />
                reconnecting…
              </span>
            )}
            <span
              className={
                "rounded-full px-2 py-0.5 text-[10px] transition-colors duration-200 " +
                (connected
                  ? "border border-emerald-400/40 text-emerald-300"
                  : "border border-yellow-400/40 text-yellow-300 animate-pulse")
              }
            >
              {connected ? "● live" : "● connecting"}
            </span>
          </div>
        </div>
        {deterioration != null && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            <SeverityChip severity={latestSeverity} size="sm" pulse />
            <span>
              Latest score{" "}
              <span className="num text-slate-200">
                {deterioration.toFixed(2)}
              </span>
            </span>
          </div>
        )}
      </header>

      <DeteriorationPatientPanel deterioration={deterioration} />

      {!widgetOpen && !incoming && <MicPrimer />}

      {incoming && !widgetOpen && (
        <IncomingCallCard
          mode={incoming.mode}
          onAnswer={() => {
            // Must run inside this direct tap handler so Safari registers the
            // gesture for AudioContext + mic. Unlock audio synchronously.
            unlockAudio();
            setIncoming(null);
            setWidgetOpen(true);
          }}
          onDecline={() => setIncoming(null)}
        />
      )}

      {widgetOpen && agentId.trim() && (
        <div className="flex w-full items-center justify-center">
          {widgetError ? (
            <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              {widgetError}. Check network + reload.
            </div>
          ) : !widgetReady ? (
            <div className="text-sm text-slate-400">Loading voice widget…</div>
          ) : (
            <elevenlabs-convai
              key={agentId.trim()}
              ref={convaiRef}
              variant="expanded"
              {...{ "agent-id": agentId.trim() }}
            />
          )}
        </div>
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
