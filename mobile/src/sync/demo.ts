import type { Credentials } from '../auth/storage';
import type { Sample } from '../health/types';
import { postVitalsBatch, type PostBatchResult } from './client';

/**
 * Pushes a small batch of synthetic vitals straight to /api/vitals/batch.
 *
 * Why this exists: during a hackathon demo the device usually doesn't have
 * any real Health Connect / HealthKit history. The normal sync path returns
 * "0 samples" — correctly, but unhelpfully — and the dashboard never gets
 * the chance to look alive. This shortcut bypasses the platform health
 * adapter and posts a believable HR + SpO2 + resp_rate trickle so the
 * scoring engine has something to chew on.
 *
 * Samples are stamped relative to "now" so they always pass the backend's
 * ±1h clock-skew check. Heart rate hovers at 78–86 bpm with one outlier at
 * 110 to make the trajectory chart visibly non-flat.
 */
export async function sendDemoVitals(
  creds: Credentials,
): Promise<{ ok: true; accepted: number } | { ok: false; message: string }> {
  const samples = buildDemoSamples();
  const result = await postVitalsBatch(creds, samples);
  return summarize(result);
}

function buildDemoSamples(): Sample[] {
  const now = Date.now();
  // Spread 12 readings across the last 11 minutes (one every ~55s).
  const hrSeries = [78, 80, 79, 82, 84, 86, 110, 92, 88, 85, 83, 81];
  const spo2Series = [97, 98, 97, 96, 95, 94, 93, 95, 96, 97, 97, 98];
  const respSeries = [14, 14, 15, 16, 17, 18, 20, 17, 16, 15, 15, 14];
  const out: Sample[] = [];
  hrSeries.forEach((bpm, i) => {
    const t = new Date(now - (hrSeries.length - i) * 55_000).toISOString();
    out.push({
      t,
      kind: 'heart_rate',
      value: bpm,
      unit: 'bpm',
      source: 'manual',
      confidence: null,
    });
    out.push({
      t,
      kind: 'spo2',
      value: spo2Series[i],
      unit: 'pct',
      source: 'manual',
      confidence: null,
    });
    out.push({
      t,
      kind: 'resp_rate',
      value: respSeries[i],
      unit: 'cpm',
      source: 'manual',
      confidence: null,
    });
  });
  return out;
}

function summarize(
  r: PostBatchResult,
): { ok: true; accepted: number } | { ok: false; message: string } {
  if (r.ok) return { ok: true, accepted: r.accepted };
  switch (r.kind) {
    case 'auth':
      return { ok: false, message: `auth: ${r.code}` };
    case 'rate_limited':
      return { ok: false, message: `rate-limited (retry in ${r.retryAfterSeconds}s)` };
    case 'too_large':
      return { ok: false, message: 'payload too large' };
    case 'clock_in_future':
      return { ok: false, message: 'device clock is ahead of server' };
    case 'mismatched_batch_id':
      return { ok: false, message: 'mismatched batch id' };
    case 'schema_invalid':
      return { ok: false, message: 'schema invalid' };
    case 'network':
      return { ok: false, message: `network: ${r.message}` };
    case 'server':
      return { ok: false, message: `server ${r.status}: ${r.message}` };
  }
}
