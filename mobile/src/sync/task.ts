import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BACKGROUND_SYNC_TASK,
  config,
} from '../config';
import {
  clearCredentials,
  getSyncCursor,
  loadCredentials,
  setSyncCursor,
} from '../auth/storage';
import { getHealthAdapter } from '../health';
import { chunkSamples, maxTimestamp } from './batch';
import { postVitalsBatch } from './client';

const STATUS_KEY = 'sentinel.last_sync_status';

export type LastSyncStatus = {
  at: string; // ISO8601
  result:
    | 'ok'
    | 'no_creds'
    | 'no_perms'
    | 'partial'
    | 'error'
    | 'rate_limited'
    | 'revoked'
    | 'dev_unsigned';
  acceptedTotal?: number;
  flaggedClockSkewTotal?: number;
  message?: string;
};

// Dev / demo tokens issued by devLogin() in src/auth/pairing.ts. They aren't
// HMAC-signed, so the backend's verify_device_token() will reject them with
// a 401 — which is correct behavior in production but would otherwise nuke
// the demo session on the very first sync attempt. We special-case this
// prefix to keep the demo paired and just surface a helpful status line.
function isDevDeviceToken(token: string): boolean {
  return token.startsWith('dev-');
}

export async function readLastSyncStatus(): Promise<LastSyncStatus | null> {
  const raw = await AsyncStorage.getItem(STATUS_KEY);
  return raw ? (JSON.parse(raw) as LastSyncStatus) : null;
}

async function writeStatus(s: LastSyncStatus): Promise<void> {
  await AsyncStorage.setItem(STATUS_KEY, JSON.stringify(s));
}

/**
 * Runs one sync pass. Returns BackgroundFetchResult so the OS can decide
 * future scheduling cadence. Idempotent — safe to call from foreground or
 * background.
 */
export async function runSyncOnce(): Promise<BackgroundFetch.BackgroundFetchResult> {
  const now = new Date();

  const creds = await loadCredentials();
  if (!creds) {
    await writeStatus({ at: now.toISOString(), result: 'no_creds' });
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }

  const adapter = getHealthAdapter();
  if (!(await adapter.hasPermissions())) {
    await writeStatus({ at: now.toISOString(), result: 'no_perms' });
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }

  const cursorIso =
    (await getSyncCursor()) ??
    new Date(now.getTime() - config.initialLookbackMinutes * 60_000).toISOString();

  let samples: Awaited<ReturnType<typeof adapter.query>>;
  try {
    samples = await adapter.query({ startIso: cursorIso, endIso: now.toISOString() });
  } catch (e) {
    await writeStatus({
      at: now.toISOString(),
      result: 'error',
      message: e instanceof Error ? e.message : String(e),
    });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }

  if (samples.length === 0) {
    await setSyncCursor(now.toISOString());
    await writeStatus({ at: now.toISOString(), result: 'ok', acceptedTotal: 0, flaggedClockSkewTotal: 0 });
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }

  const chunks = chunkSamples(samples);
  let acceptedTotal = 0;
  let flaggedTotal = 0;
  let advancedCursorTo = cursorIso;

  for (const chunk of chunks) {
    const r = await postVitalsBatch(creds, chunk);

    if (r.ok) {
      acceptedTotal += r.accepted;
      flaggedTotal += r.flaggedClockSkew;
      const top = maxTimestamp(chunk);
      if (top && top > advancedCursorTo) advancedCursorTo = top;
      continue;
    }

    if (r.kind === 'auth') {
      // Demo sessions hold an unsigned `dev-…` token that the backend is
      // expected to reject. Don't wipe creds — the user is just here to
      // show the UI. Surface a clear status so the dashboard can explain
      // why uploads aren't accepted.
      if (isDevDeviceToken(creds.deviceToken)) {
        await writeStatus({
          at: now.toISOString(),
          result: 'dev_unsigned',
          acceptedTotal,
          flaggedClockSkewTotal: flaggedTotal,
          message:
            'Demo session: backend rejected the unsigned dev token (expected). Pair with a real 6-digit code to upload.',
        });
        return BackgroundFetch.BackgroundFetchResult.NoData;
      }

      // Real session: a 401 means the device was revoked or the token is
      // malformed. Wipe so the user re-pairs.
      await clearCredentials();
      await writeStatus({
        at: now.toISOString(),
        result: 'revoked',
        message: r.code,
      });
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }

    if (r.kind === 'rate_limited') {
      // Save what we have; OS will retry on next interval.
      await setSyncCursor(advancedCursorTo);
      await writeStatus({
        at: now.toISOString(),
        result: 'rate_limited',
        acceptedTotal,
        flaggedClockSkewTotal: flaggedTotal,
        message: `retry after ${r.retryAfterSeconds}s`,
      });
      return BackgroundFetch.BackgroundFetchResult.NewData;
    }

    if (r.kind === 'clock_in_future') {
      await writeStatus({
        at: now.toISOString(),
        result: 'error',
        message: 'Device clock is ahead of server. Check date/time settings.',
      });
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }

    // Other failures (network/server/schema/too_large) — keep cursor where successful chunks ended.
    await setSyncCursor(advancedCursorTo);
    await writeStatus({
      at: now.toISOString(),
      result: 'partial',
      acceptedTotal,
      flaggedClockSkewTotal: flaggedTotal,
      message: r.kind,
    });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }

  await setSyncCursor(advancedCursorTo);
  await writeStatus({
    at: now.toISOString(),
    result: 'ok',
    acceptedTotal,
    flaggedClockSkewTotal: flaggedTotal,
  });
  return BackgroundFetch.BackgroundFetchResult.NewData;
}

// Define the background task at module load so TaskManager finds it on cold start.
if (!TaskManager.isTaskDefined(BACKGROUND_SYNC_TASK)) {
  TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
    try {
      return await runSyncOnce();
    } catch {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

export async function registerBackgroundSync(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied
  ) {
    return;
  }
  await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
    minimumInterval: config.syncIntervalMinutes * 60,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

export async function unregisterBackgroundSync(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)) {
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
  }
}
