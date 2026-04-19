import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import EventSource from 'react-native-sse';
import { config } from '../config';
import type { Credentials } from '../auth/storage';

export type StreamEvent =
  | { type: 'hello' }
  | {
      type: 'alert';
      patient_id: string;
      call_id: string;
      severity: string;
      summary: string;
      at: string;
    }
  | {
      type: 'call_scored';
      call_id: string;
      patient_id: string;
      score: Record<string, unknown>;
      at: string;
    }
  | {
      type: 'call_completed';
      call_id: string;
      patient_id: string;
      outcome_label: 'fine' | 'schedule_visit' | 'escalated_911';
      escalation_911: boolean;
      summary_patient: string | null;
      summary_nurse: string | null;
    }
  | {
      type: 'pending_call';
      patient_id: string;
      mode: 'phone' | 'widget';
      at: string;
    }
  | {
      type: 'vitals';
      patient_id: string;
      device_id: string;
      accepted: number;
      at: string;
    };

export type EventStreamState = {
  connected: boolean;
  reconnectAt: number | null;
};

/**
 * Subscribe to /api/stream over SSE on React Native.
 *
 * Why react-native-sse and not the browser EventSource?
 *   - The browser EventSource global doesn't exist in Hermes.
 *   - react-native-sse implements the same protocol over fetch(), works in
 *     Hermes, and supports custom headers (so we can send the device JWT).
 *
 * Auth: /api/stream is currently unauthenticated server-side (no Depends, no
 * cookie check). We still send the device JWT as Authorization so that when
 * the backend lands per-patient filtering or auth (HANDOFF §3.4 q1) the mobile
 * client doesn't need to change. Until then, we filter events client-side by
 * patient_id, matching what the web /patient view does.
 *
 * Reconnect behavior mirrors the web hook (exponential backoff, capped at
 * 30s, retry counter resets on successful open). On top of that, we force a
 * reconnect when the app foregrounds — SSE pauses while backgrounded on both
 * iOS and Android, and the underlying socket is usually dead by the time we
 * come back.
 */
export function useEventStream(
  creds: Credentials | null,
  onEvent: (e: StreamEvent) => void,
): EventStreamState {
  const [connected, setConnected] = useState(false);
  const [reconnectAt, setReconnectAt] = useState<number | null>(null);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  // Stable token across renders so the effect doesn't tear down + reopen on
  // every component update. We re-key the effect on token + apiUrl only.
  const token = creds?.deviceToken ?? null;
  const apiUrl = (() => {
    try {
      return config.apiUrl;
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    if (!apiUrl || !token) {
      setConnected(false);
      return;
    }

    let cancelled = false;
    let source: EventSource | null = null;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (cancelled) return;
      try {
        source = new EventSource(`${apiUrl}/api/stream`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // If construction itself fails (rare), schedule a retry.
        scheduleRetry();
        return;
      }

      source.addEventListener('open', () => {
        if (cancelled) return;
        setConnected(true);
        setReconnectAt(null);
        retry = 0;
      });

      source.addEventListener('message', (ev) => {
        if (cancelled) return;
        const raw = (ev as { data?: string | null }).data;
        if (!raw) return;
        try {
          const data = JSON.parse(raw) as StreamEvent;
          handlerRef.current(data);
        } catch {
          // ignore malformed event lines
        }
      });

      source.addEventListener('error', () => {
        if (cancelled) return;
        setConnected(false);
        try {
          source?.close();
        } catch {}
        source = null;
        scheduleRetry();
      });
    };

    const scheduleRetry = () => {
      if (cancelled) return;
      retry = Math.min(retry + 1, 6);
      const delay = Math.min(1000 * 2 ** retry, 30_000);
      const at = Date.now() + delay;
      setReconnectAt(at);
      retryTimer = setTimeout(open, delay);
    };

    const onAppStateChange = (s: AppStateStatus) => {
      if (s !== 'active') return;
      // Force-cycle the connection on foreground. Don't trust the existing
      // socket — iOS in particular silently closes long-lived sockets when
      // the app is suspended.
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      try {
        source?.close();
      } catch {}
      source = null;
      retry = 0;
      open();
    };

    open();
    const sub = AppState.addEventListener('change', onAppStateChange);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      try {
        source?.close();
      } catch {}
      sub.remove();
    };
  }, [apiUrl, token]);

  return { connected, reconnectAt };
}
