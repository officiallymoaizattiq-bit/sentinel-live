"use client";

import { useEffect, useRef, useState } from "react";

export type StreamEvent =
  | { type: "hello" }
  | { type: "alert"; patient_id: string; call_id: string; severity: string;
      summary: string; at: string }
  | { type: "call_scored"; call_id: string; patient_id: string;
      score: Record<string, unknown>; at: string }
  | { type: "pending_call"; patient_id: string; mode: "phone" | "widget";
      at: string }
  | { type: "vitals"; patient_id: string; device_id: string;
      accepted: number; at: string }
  | {
      type: "call_completed";
      call_id: string;
      patient_id: string;
      outcome_label: "fine" | "schedule_visit" | "escalated_911";
      escalation_911: boolean;
      summary_patient: string | null;
      summary_nurse: string | null;
    }
  | {
      type: "alert_opened";
      alert_id: string;
      patient_id: string;
      severity: string;
    }
  | { type: "alert_ack"; alert_id: string };

export function useEventStream(onEvent: (e: StreamEvent) => void): {
  connected: boolean;
  reconnectAt: number | null;
} {
  const [connected, setConnected] = useState(false);
  const [reconnectAt, setReconnectAt] = useState<number | null>(null);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (cancelled) return;
      // Bypass Next dev proxy which buffers SSE; hit backend direct in browser
      // when an explicit backend URL is configured. Otherwise fall back to a
      // same-origin relative URL so production deploys (with rewrites) work
      // without needing NEXT_PUBLIC_BACKEND_URL set.
      const override =
        typeof window !== "undefined" &&
        (window as unknown as { SENTINEL_BACKEND?: string }).SENTINEL_BACKEND;
      const base =
        override ||
        process.env.NEXT_PUBLIC_BACKEND_URL ||
        "";
      const url = base ? `${base}/api/stream` : "/api/stream";
      source = new EventSource(url, { withCredentials: true });
      source.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        setReconnectAt(null);
        retry = 0;
      };
      source.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(ev.data) as StreamEvent;
          handlerRef.current(data);
        } catch { /* ignore malformed */ }
      };
      source.onerror = () => {
        if (cancelled) return;
        setConnected(false);
        source?.close();
        source = null;
        retry = Math.min(retry + 1, 6);
        const delay = Math.min(1000 * 2 ** retry, 30_000);
        const at = Date.now() + delay;
        setReconnectAt(at);
        reconnectTimer = setTimeout(open, delay);
      };
    };

    open();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
      source = null;
    };
  }, []);

  return { connected, reconnectAt };
}
