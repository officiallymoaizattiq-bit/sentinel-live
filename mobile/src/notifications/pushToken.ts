import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api, ApiCallError } from '../api/client';
import type { Credentials } from '../auth/storage';
import { ensureNotificationPermission } from './incoming';

/**
 * Push-token plumbing for Expo Push API (a thin proxy over FCM/APNS that we
 * use so we don't have to maintain a Firebase project + an APNS key for the
 * demo).
 *
 * Why Expo Push (and not raw FCM): a real Firebase project requires
 * `google-services.json`, a config plugin, native rebuilds, and a service
 * account on the backend. Expo's relay handles all of that — backend just
 * POSTs to https://exp.host/--/api/v2/push/send with a JSON body, and the
 * device gets a real FCM/APNS push, even when killed/screen-off (which was
 * the whole reason we abandoned the SSE-only path).
 *
 * Token shape: `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`. Backend stores
 * it on `devices.push_token` (already in the schema; see
 * backend/sentinel/pairing.py:83). One token per device; rotates on app
 * reinstall and occasionally on FCM/APNS push key rotation, which is why we
 * also wire `addPushTokenListener` to re-register on the fly.
 */

/**
 * Pull the EAS projectId out of app.json. Required by SDK 49+ — `getExpoPushTokenAsync`
 * throws ERR_NOTIFICATIONS_NO_EXPERIENCE_ID without it.
 *
 * Lookup order:
 *   1. EXPO_PUBLIC_EAS_PROJECT_ID env var (most reliable — survives stale
 *      Metro/dev-client manifest caching, which is real and painful).
 *   2. Constants.expoConfig.extra.eas.projectId — what `eas init` writes to
 *      app.json. The dev-client reads this through Metro's served manifest;
 *      if Metro is serving a cached pre-init manifest, this misses.
 *   3. Constants.easConfig.projectId — embedded at APK build time.
 *
 * To populate (1) drop EXPO_PUBLIC_EAS_PROJECT_ID into mobile/.env. To
 * populate (2) run `eas init` from `mobile/` — it writes
 * `expo.extra.eas.projectId` into app.json and creates a free EAS project
 * server-side (no Firebase / native config involved).
 */
function readProjectId(): string | null {
  const fromEnv = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (fromEnv) return fromEnv;
  const fromExpoConfig =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants.expoConfig as unknown as { projectId?: string } | null)?.projectId;
  const fromEasConfig = Constants.easConfig?.projectId;
  return (fromExpoConfig ?? fromEasConfig ?? null) || null;
}

export type PushTokenInfo = {
  token: string;
  provider: 'expo';
  platform: 'ios' | 'android';
};

/**
 * Resolve an Expo push token for this device. Returns null on emulators (no
 * push delivery), missing permissions, or missing projectId — caller should
 * log + bail rather than treat a missing token as fatal, since the app still
 * works with SSE in foreground.
 */
export async function getPushToken(): Promise<PushTokenInfo | null> {
  // Emulators / simulators don't get real APNS/FCM tokens. Expo's call
  // returns an unusable string on iOS sim and outright throws on Android
  // emu without Google Play Services. Skip cleanly.
  if (!Device.isDevice) {
    return null;
  }

  const granted = await ensureNotificationPermission();
  if (!granted) {
    return null;
  }

  const projectId = readProjectId();
  if (!projectId) {
    if (__DEV__) {
      console.warn(
        '[push] No EAS projectId. Set EXPO_PUBLIC_EAS_PROJECT_ID in ' +
          'mobile/.env or run `eas init` to enable killed-app pushes.',
      );
    }
    return null;
  }

  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    return {
      token: result.data,
      provider: 'expo',
      platform: Platform.OS as 'ios' | 'android',
    };
  } catch (e) {
    if (__DEV__) {
      console.warn('[push] getExpoPushTokenAsync failed', e);
    }
    return null;
  }
}

/**
 * Resolve a token and POST it to the backend so /api/calls/trigger can
 * reach this device. Idempotent — backend upserts by device id. Best-effort:
 * a failure just leaves the previous token in place server-side and the app
 * continues to function.
 */
export async function registerPushToken(creds: Credentials): Promise<void> {
  const info = await getPushToken();
  if (!info) return;
  try {
    await api.registerPushToken(creds, {
      token: info.token,
      provider: info.provider,
      platform: info.platform,
    });
  } catch (e) {
    if (e instanceof ApiCallError && e.error.kind === 'auth') {
      // Caller (root layout) handles auth churn elsewhere; rethrow so the
      // standard auth-failure flow runs instead of swallowing here.
      throw e;
    }
    if (__DEV__) console.warn('[push] register token failed', e);
  }
}

/**
 * Subscribe to the live token-rotation event. APNS/FCM rotate tokens
 * occasionally (e.g. after restore-from-backup); when that happens we want
 * to re-POST the new value so the next push lands on the right device.
 *
 * Returns an unsubscribe fn — call it from the same effect that subscribed.
 */
export function subscribeToPushTokenRefresh(
  creds: Credentials,
  onRotated?: (token: string) => void,
): () => void {
  const sub = Notifications.addPushTokenListener((event) => {
    onRotated?.(event.data);
    // Re-register the rotated token. We don't rerun `getPushToken` because
    // the listener already gives us the new value, and the rotated event
    // is the ground truth (no need to re-check permission state).
    api
      .registerPushToken(creds, {
        token: event.data,
        provider: 'expo',
        platform: Platform.OS as 'ios' | 'android',
      })
      .catch((e) => {
        if (__DEV__) console.warn('[push] re-register on rotate failed', e);
      });
  });
  return () => sub.remove();
}
