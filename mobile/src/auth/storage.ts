import { Platform } from 'react-native';
import * as ExpoSecureStore from 'expo-secure-store';

// expo-secure-store is iOS/Android only. For local web previews (Expo Web),
// fall back to a localStorage-backed shim so the app can mount and we can
// iterate on the UI without the app exploding on startup.
const SecureStore = Platform.OS === 'web'
  ? {
      getItemAsync: async (k: string) =>
        typeof window === 'undefined' ? null : window.localStorage.getItem(k),
      setItemAsync: async (k: string, v: string) => {
        if (typeof window !== 'undefined') window.localStorage.setItem(k, v);
      },
      deleteItemAsync: async (k: string) => {
        if (typeof window !== 'undefined') window.localStorage.removeItem(k);
      },
    }
  : ExpoSecureStore;

const KEYS = {
  deviceToken: 'sentinel.device_token',
  patientId: 'sentinel.patient_id',
  deviceId: 'sentinel.device_id',
  pairTime: 'sentinel.pair_time',
  syncCursor: 'sentinel.sync_cursor',
} as const;

export type Credentials = {
  deviceToken: string;
  patientId: string;
  deviceId: string;
  pairTime: string; // ISO8601
};

export async function saveCredentials(c: Credentials): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.deviceToken, c.deviceToken),
    SecureStore.setItemAsync(KEYS.patientId, c.patientId),
    SecureStore.setItemAsync(KEYS.deviceId, c.deviceId),
    SecureStore.setItemAsync(KEYS.pairTime, c.pairTime),
    // Initial cursor = pair_time (forward-only, no backfill).
    SecureStore.setItemAsync(KEYS.syncCursor, c.pairTime),
  ]);
}

export async function loadCredentials(): Promise<Credentials | null> {
  const [deviceToken, patientId, deviceId, pairTime] = await Promise.all([
    SecureStore.getItemAsync(KEYS.deviceToken),
    SecureStore.getItemAsync(KEYS.patientId),
    SecureStore.getItemAsync(KEYS.deviceId),
    SecureStore.getItemAsync(KEYS.pairTime),
  ]);
  if (!deviceToken || !patientId || !deviceId || !pairTime) return null;
  return { deviceToken, patientId, deviceId, pairTime };
}

export async function clearCredentials(): Promise<void> {
  await Promise.all(
    Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k)),
  );
}

export async function getSyncCursor(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.syncCursor);
}

export async function setSyncCursor(iso: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.syncCursor, iso);
}

/**
 * Wipes just the sync cursor, leaving auth credentials intact. Used by the
 * "Backfill last 24h" affordance on the dashboard so the next sync re-reads
 * the full initial-lookback window instead of the tiny incremental delta.
 */
export async function clearSyncCursor(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.syncCursor);
}
