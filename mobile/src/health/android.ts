import {
  initialize,
  requestPermission,
  getGrantedPermissions,
  getSdkStatus,
  openHealthConnectSettings,
  readRecords,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';
import type {
  HealthAdapter,
  HealthDiagnostics,
  Sample,
  SleepStage,
  Window,
} from './types';

const SCOPES = [
  { accessType: 'read' as const, recordType: 'HeartRate' as const },
  { accessType: 'read' as const, recordType: 'HeartRateVariabilityRmssd' as const },
  { accessType: 'read' as const, recordType: 'OxygenSaturation' as const },
  { accessType: 'read' as const, recordType: 'RespiratoryRate' as const },
  { accessType: 'read' as const, recordType: 'BodyTemperature' as const },
  { accessType: 'read' as const, recordType: 'Steps' as const },
  { accessType: 'read' as const, recordType: 'SleepSession' as const },
];

// Mutable diagnostics buffer. Updated on every query() so the dashboard's
// diagnose() call can reason about the most recent fetch without re-running
// it. Module-scoped because the adapter is a singleton (see ./index.ts).
const diagState: {
  countsByKind: Record<string, number>;
  endIso: string | null;
} = { countsByKind: {}, endIso: null };

async function ensureInit(): Promise<boolean> {
  try {
    return await initialize();
  } catch {
    return false;
  }
}

async function readType<T>(
  recordType: Parameters<typeof readRecords>[0],
  startIso: string,
  endIso: string,
): Promise<T[]> {
  try {
    const result = await readRecords(recordType, {
      timeRangeFilter: { operator: 'between', startTime: startIso, endTime: endIso },
    });
    // SDK shape varies between versions; both `records` and bare arrays appear.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records = (result as any)?.records ?? (result as unknown as T[]);
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

export const androidAdapter: HealthAdapter = {
  async requestPermissions() {
    const ok = await ensureInit();
    if (!ok) return false;
    try {
      const granted = await requestPermission(SCOPES);
      // Accept partial grants — Health Connect may not return all requested
      // permissions even when "Allow all" is tapped (e.g. unsupported types
      // on older devices). Require at least heart_rate so sync is useful.
      return granted.length > 0;
    } catch {
      return false;
    }
  },

  async hasPermissions() {
    const ok = await ensureInit();
    if (!ok) return false;
    try {
      const granted = await getGrantedPermissions();
      // Mirror the partial-grant policy in requestPermissions(): any read
      // permission for a SCOPE record type is enough to make sync useful.
      return SCOPES.some((s) =>
        granted.some(
          (g) => g.recordType === s.recordType && g.accessType === s.accessType,
        ),
      );
    } catch {
      return false;
    }
  },

  async query({ startIso, endIso }: Window): Promise<Sample[]> {
    if (!(await ensureInit())) return [];
    const out: Sample[] = [];
    // Build the per-kind tally fresh for this window so the diagnostics
    // panel reflects "what came back this time", not a cumulative total.
    const counts: Record<string, number> = {
      heart_rate: 0,
      hrv_rmssd: 0,
      spo2: 0,
      resp_rate: 0,
      temp: 0,
      steps: 0,
      sleep_stage: 0,
    };

    type HrRec = { samples: { time: string; beatsPerMinute: number }[] };
    const hr = await readType<HrRec>('HeartRate', startIso, endIso);
    for (const rec of hr) {
      for (const s of rec.samples ?? []) {
        out.push({
          t: s.time,
          kind: 'heart_rate',
          value: s.beatsPerMinute,
          unit: 'bpm',
          source: 'health_connect',
          confidence: null,
        });
        counts.heart_rate += 1;
      }
    }

    type HrvRec = { time: string; heartRateVariabilityMillis: number };
    const hrv = await readType<HrvRec>('HeartRateVariabilityRmssd', startIso, endIso);
    for (const r of hrv) {
      out.push({
        t: r.time,
        kind: 'hrv_rmssd',
        value: r.heartRateVariabilityMillis,
        unit: 'ms',
        source: 'health_connect',
        confidence: null,
      });
      counts.hrv_rmssd += 1;
    }

    type SpO2Rec = { time: string; percentage: number };
    const spo2 = await readType<SpO2Rec>('OxygenSaturation', startIso, endIso);
    for (const r of spo2) {
      out.push({
        t: r.time,
        kind: 'spo2',
        value: r.percentage,
        unit: 'pct',
        source: 'health_connect',
        confidence: null,
      });
      counts.spo2 += 1;
    }

    type RrRec = { time: string; rate: number };
    const rr = await readType<RrRec>('RespiratoryRate', startIso, endIso);
    for (const r of rr) {
      out.push({
        t: r.time,
        kind: 'resp_rate',
        value: r.rate,
        unit: 'cpm',
        source: 'health_connect',
        confidence: null,
      });
      counts.resp_rate += 1;
    }

    type TempRec = { time: string; temperature: { inCelsius: number } };
    const temp = await readType<TempRec>('BodyTemperature', startIso, endIso);
    for (const r of temp) {
      out.push({
        t: r.time,
        kind: 'temp',
        value: r.temperature?.inCelsius,
        unit: 'c',
        source: 'health_connect',
        confidence: null,
      });
      counts.temp += 1;
    }

    type StepsRec = { startTime: string; count: number };
    const steps = await readType<StepsRec>('Steps', startIso, endIso);
    for (const r of steps) {
      out.push({
        t: r.startTime,
        kind: 'steps',
        value: r.count,
        unit: 'count',
        source: 'health_connect',
        confidence: null,
      });
      counts.steps += 1;
    }

    type SleepRec = {
      stages?: { startTime: string; stage: number }[];
    };
    const sleep = await readType<SleepRec>('SleepSession', startIso, endIso);
    for (const sess of sleep) {
      for (const stage of sess.stages ?? []) {
        const mapped = mapHcSleepStage(stage.stage);
        if (!mapped) continue;
        out.push({
          t: stage.startTime,
          kind: 'sleep_stage',
          value: mapped,
          unit: 'enum',
          source: 'health_connect',
          confidence: null,
        });
        counts.sleep_stage += 1;
      }
    }

    diagState.countsByKind = counts;
    diagState.endIso = endIso;
    return out;
  },

  async diagnose(): Promise<HealthDiagnostics> {
    let sdkStatus = 'unknown';
    try {
      const status = await getSdkStatus();
      // Map the numeric constants into something a human can read on the
      // dashboard. `available` is the only "good" state; the other two
      // explain why HealthConnect can't be reached at all (vs the more
      // common "available but Samsung Health hasn't synced anything").
      switch (status) {
        case SdkAvailabilityStatus.SDK_AVAILABLE:
          sdkStatus = 'available';
          break;
        case SdkAvailabilityStatus.SDK_UNAVAILABLE:
          sdkStatus = 'unavailable';
          break;
        case SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED:
          sdkStatus = 'needs_provider_update';
          break;
      }
    } catch {
      sdkStatus = 'unknown';
    }

    let grantedScopes: string[] = [];
    try {
      if (await ensureInit()) {
        const g = await getGrantedPermissions();
        // Format as `read:HeartRate` so it's compact + grep-friendly.
        grantedScopes = g.map((p) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const any = p as any;
          return `${any.accessType ?? '?'}:${any.recordType ?? any.permission ?? '?'}`;
        });
      }
    } catch {
      // Leave empty.
    }

    // Run a fresh probe over a wide 24h window so the dashboard's "samples
    // by type" counters reflect what's actually sitting in Health Connect
    // right now, not just whatever the most-recent foreground sync (a tiny
    // ~60s delta after the cursor advances) happened to pull. Without this,
    // the user sees 0 even when there's plenty of data — they'd assume the
    // bridge is broken when really it's just that nothing arrived in the
    // last minute.
    const probeCounts: Record<string, number> = {
      heart_rate: 0,
      hrv_rmssd: 0,
      spo2: 0,
      resp_rate: 0,
      temp: 0,
      steps: 0,
      sleep_stage: 0,
    };
    let probeEnd: string | null = diagState.endIso;
    try {
      if (await ensureInit()) {
        const end = new Date();
        const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
        const startIso = start.toISOString();
        const endIso = end.toISOString();
        probeEnd = endIso;

        type HrRec = { samples: { time: string; beatsPerMinute: number }[] };
        const hr = await readType<HrRec>('HeartRate', startIso, endIso);
        for (const rec of hr) probeCounts.heart_rate += (rec.samples ?? []).length;

        const hrv = await readType<{ time: string }>(
          'HeartRateVariabilityRmssd',
          startIso,
          endIso,
        );
        probeCounts.hrv_rmssd += hrv.length;

        const spo2 = await readType<{ time: string }>('OxygenSaturation', startIso, endIso);
        probeCounts.spo2 += spo2.length;

        const rr = await readType<{ time: string }>('RespiratoryRate', startIso, endIso);
        probeCounts.resp_rate += rr.length;

        const temp = await readType<{ time: string }>('BodyTemperature', startIso, endIso);
        probeCounts.temp += temp.length;

        const steps = await readType<{ startTime: string }>('Steps', startIso, endIso);
        probeCounts.steps += steps.length;

        type SleepRec = { stages?: { startTime: string; stage: number }[] };
        const sleep = await readType<SleepRec>('SleepSession', startIso, endIso);
        for (const sess of sleep) probeCounts.sleep_stage += (sess.stages ?? []).length;
      }
    } catch {
      // If the probe blows up, fall back to the last-sync counts so the
      // panel at least shows *something*. Diagnose must never throw — the
      // dashboard treats an exception as "no diagnostics available."
    }

    // Merge in last-sync counts as a fallback per-kind: if the 24h probe
    // saw nothing for a kind but a recent sync did, prefer the sync number.
    // This handles the edge case where Health Connect's stored history is
    // empty but a fresh write just landed in the cursor delta.
    const merged: Record<string, number> = { ...probeCounts };
    for (const [k, v] of Object.entries(diagState.countsByKind)) {
      if ((merged[k] ?? 0) === 0 && v > 0) merged[k] = v;
    }

    return {
      sdkStatus,
      grantedScopes,
      lastQueryCountsByKind: merged,
      lastQueryEndIso: probeEnd,
    };
  },

  openSettings() {
    try {
      openHealthConnectSettings();
    } catch {
      // No-op: provider missing or method unsupported.
    }
  },
};

function mapHcSleepStage(stage: number): SleepStage | null {
  // Health Connect SleepStageType constants.
  switch (stage) {
    case 1:
      return 'awake'; // STAGE_TYPE_AWAKE
    case 2:
      return 'light'; // STAGE_TYPE_SLEEPING (generic)
    case 3:
      return 'awake'; // STAGE_TYPE_OUT_OF_BED — closest mapping
    case 4:
      return 'light'; // STAGE_TYPE_LIGHT
    case 5:
      return 'deep'; // STAGE_TYPE_DEEP
    case 6:
      return 'rem'; // STAGE_TYPE_REM
    case 7:
      return 'awake'; // STAGE_TYPE_AWAKE_IN_BED
    default:
      return null;
  }
}
