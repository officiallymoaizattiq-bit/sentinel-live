import { Stack, useRouter, useSegments } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { loadCredentials } from '../src/auth/storage';
import {
  configureIncomingCallNotifications,
  dismissIncomingCallNotification,
  payloadFromResponse,
} from '../src/notifications/incoming';
import { registerBackgroundSync } from '../src/sync/task';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [ready, setReady] = useState(false);
  const [paired, setPaired] = useState(false);
  const lastChecked = useRef(0);

  // Re-read credentials from SecureStore. We keep this debounced (250ms)
  // because expo-router fires `segments` updates several times during a
  // single navigation, and we don't want to thrash SecureStore decryption.
  const refreshAuth = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastChecked.current < 250) return;
    lastChecked.current = now;
    const creds = await loadCredentials();
    setPaired((prev) => {
      if (prev !== !!creds) {
        if (creds) registerBackgroundSync().catch(() => {});
        return !!creds;
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    (async () => {
      await refreshAuth(true);
      setReady(true);
    })();
  }, [refreshAuth]);

  // Re-check on every navigation. Without this, a successful pair (which
  // writes credentials and replaces() into a different group) leaves the
  // layout's `paired` state stale, and the auth guard below bounces the
  // user straight back to /(onboarding)/pair even though they're now paired.
  useEffect(() => {
    if (ready) refreshAuth();
  }, [segments, ready, refreshAuth]);

  // Re-check when the app foregrounds (e.g. after the Health Connect
  // round-trip) so the guard doesn't act on stale state.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && ready) refreshAuth(true);
    });
    return () => sub.remove();
  }, [ready, refreshAuth]);

  useEffect(() => {
    if (!ready) return;
    const segs = segments as readonly string[];
    const inOnboarding = segs[0] === '(onboarding)';
    if (!paired && !inOnboarding) {
      router.replace('/(onboarding)/pair');
    } else if (paired && inOnboarding) {
      // Only auto-promote out of the pair screen. The permissions screen
      // is part of (onboarding) but should NOT bounce the user away —
      // they need to grant Health Connect access before reaching status.
      if (segs[1] === 'pair') {
        router.replace('/(onboarding)/permissions');
      }
    }
  }, [ready, paired, segments, router]);

  // Notifications setup. We do this at the root so the channel + handler
  // are configured before any screen mounts — otherwise the first
  // pending_call SSE event of a fresh boot can fire showIncomingCallNotification()
  // before the channel exists, and Android will silently drop it.
  useEffect(() => {
    configureIncomingCallNotifications().catch(() => {});
  }, []);

  // Tap-to-answer routing. When the user hits Answer (or just taps the
  // heads-up notification body), expo-notifications fires a
  // NotificationResponseReceived event; we deep-link straight into the
  // full-screen call route. Decline just dismisses the notification.
  //
  // We also catch the "app was launched by tapping the notification while
  // killed" case via getLastNotificationResponseAsync, which is the only
  // path that catches a cold-start tap. Without it, the user would land
  // on /(main)/status with no call screen.
  useEffect(() => {
    if (!ready) return;
    const handleResponse = (response: Notifications.NotificationResponse) => {
      const parsed = payloadFromResponse(response);
      if (!parsed) return;
      if (parsed.action === 'decline') {
        dismissIncomingCallNotification().catch(() => {});
        return;
      }
      router.push({
        pathname: '/(main)/call',
        params: { mode: parsed.payload.mode },
      });
    };

    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) handleResponse(r);
    });
    return () => sub.remove();
  }, [ready, router]);

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
