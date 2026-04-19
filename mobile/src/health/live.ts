import { useEffect, useRef, useState } from 'react';
import type { Sample } from './types';
import { getHealthAdapter } from './index';

/**
 * Live HR/SpO2 polling hook used during a voice call.
 *
 * Why polling and not a true stream:
 *   Health Connect (Android) and HealthKit (iOS) are both pull-based for
 *   on-demand reads. Health Connect *does* expose HealthDataService change
 *   tokens via getChanges(), but those are batched (delivered when the OS
 *   feels like it) and the typings in react-native-health-connect@3.x are
 *   sparse, so for a 60-second clinical-style readout we just poll. 5s is a
 *   good compromise between "feels live" and "doesn't hammer the OS".
 *
 * The query window walks forward as the call progresses: start at "now -
 * lookbackMs" the first time, then advance to the latest seen sample. This
 * matches what the background sync task does, just on a much tighter loop.
 *
 * The hook also collects every sample observed across all polls into a
 * de-duplicated buffer; when the call ends, callers drain it via
 * drainBuffer() and POST it as a single batch so the dashboard chart updates
 * with everything the watch produced during the call window — even if the
 * background sync task hasn't fired yet.
 */
export type LiveVitalsState = {
  /** Most recent HR sample observed during this session, or null. */
  latestHr: { bpm: number; tIso: string } | null;
  /** Most recent SpO2 sample observed during this session, or null. */
  latestSpo2: { pct: number; tIso: string } | null;
  /** Whether the polling loop has run at least once. */
  ready: boolean;
  /** Drain the accumulated sample buffer (and clear it). */
  drainBuffer: () => Sample[];
};

type Options = {
  /** Whether the loop should be running. Toggle false to stop without unmounting. */
  enabled: boolean;
  /** Poll cadence in ms. Defaults to 5000. */
  intervalMs?: number;
  /** First-poll lookback in ms. Defaults to 60000 (one minute). */
  lookbackMs?: number;
};

export function useLiveVitals({
  enabled,
  intervalMs = 5000,
  lookbackMs = 60_000,
}: Options): LiveVitalsState {
  const [latestHr, setLatestHr] = useState<LiveVitalsState['latestHr']>(null);
  const [latestSpo2, setLatestSpo2] = useState<LiveVitalsState['latestSpo2']>(null);
  const [ready, setReady] = useState(false);

  // Buffer + cursor live in refs because we mutate them inside an async loop
  // and don't want to re-render on every push. Keyed by `${kind}|${t}` so
  // re-querying the same window doesn't double-count.
  const bufferRef = useRef<Map<string, Sample>>(new Map());
  const cursorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const adapter = getHealthAdapter();
    // First poll uses a much wider window so the live tile shows *something*
    // even when the wearable hasn't written in the last minute (Samsung
    // Health, in particular, batches HR writes to Health Connect every
    // ~10-15 min when the user isn't actively in a workout). Subsequent
    // polls advance with the cursor so we only pick up new samples for the
    // call-window buffer.
    let firstPoll = true;

    const poll = async () => {
      const now = new Date();
      const initialLookbackMs = Math.max(lookbackMs, 30 * 60 * 1000);
      const startIso =
        cursorRef.current ??
        new Date(now.getTime() - (firstPoll ? initialLookbackMs : lookbackMs)).toISOString();
      const endIso = now.toISOString();

      let samples: Sample[] = [];
      try {
        samples = await adapter.query({ startIso, endIso });
      } catch {
        // The adapter swallows its own errors; this catch is belt-and-
        // suspenders so an unexpected throw can't kill the interval.
        samples = [];
      }
      if (cancelled) return;

      let maxT: string | null = cursorRef.current;
      for (const s of samples) {
        const key = `${s.kind}|${s.t}`;
        if (!bufferRef.current.has(key)) {
          bufferRef.current.set(key, s);
        }
        if (!maxT || s.t > maxT) maxT = s.t;

        // Track the most recent value per relevant kind. Compare ISO
        // strings directly — they're lexicographically orderable when in
        // the same Z form, which the adapter guarantees.
        if (s.kind === 'heart_rate' && typeof s.value === 'number') {
          setLatestHr((prev) =>
            !prev || s.t > prev.tIso ? { bpm: s.value as number, tIso: s.t } : prev,
          );
        } else if (s.kind === 'spo2' && typeof s.value === 'number') {
          setLatestSpo2((prev) =>
            !prev || s.t > prev.tIso ? { pct: s.value as number, tIso: s.t } : prev,
          );
        }
      }

      if (maxT) cursorRef.current = maxT;
      if (!ready) setReady(true);
      firstPoll = false;
    };

    poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // We deliberately re-run the effect when `enabled` toggles or interval
    // changes. `ready` flips at most once and shouldn't restart the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, lookbackMs]);

  const drainBuffer = (): Sample[] => {
    const drained = Array.from(bufferRef.current.values()).sort((a, b) =>
      a.t < b.t ? -1 : 1,
    );
    bufferRef.current.clear();
    return drained;
  };

  return { latestHr, latestSpo2, ready, drainBuffer };
}
