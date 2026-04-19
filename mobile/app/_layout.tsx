import { Stack, useRouter, useSegments } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { exchangePairingCode, parsePairingInput } from '../src/auth/pairing';
import { loadCredentials, type Credentials } from '../src/auth/storage';
import { palette } from '../src/components/ui';
import {
  configureIncomingCallNotifications,
  dismissIncomingCallNotification,
  payloadFromResponse,
} from '../src/notifications/incoming';
import {
  registerPushToken,
  subscribeToPushTokenRefresh,
} from '../src/notifications/pushToken';
import { registerBackgroundSync } from '../src/sync/task';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [ready, setReady] = useState(false);
  const [paired, setPaired] = useState(false);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const lastChecked = useRef(0);

  // Re-read credentials from SecureStore. We keep this debounced (250ms)
  // because expo-router fires `segments` updates several times during a
  // single navigation, and we don't want to thrash SecureStore decryption.
  const refreshAuth = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastChecked.current < 250) return;
    lastChecked.current = now;
    const c = await loadCredentials();
    setCreds(c);
    setPaired((prev) => {
      if (prev !== !!c) {
        if (c) registerBackgroundSync().catch(() => {});
        return !!c;
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

  // Expo Web renders inside a plain <body> whose default background is white,
  // which shows through wherever the RN root view doesn't cover the viewport
  // (e.g. above/below the scroll content). Paint the body with the same
  // canvas gradient the web dashboard uses so the whole page reads as one
  // dark blue surface — no behaviour change on native.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    const prev = {
      background: document.body.style.background,
      minHeight: document.body.style.minHeight,
      margin: document.body.style.margin,
    };
    document.body.style.background =
      'linear-gradient(180deg,#070F1F 0%,#0B1E3D 45%,#0C2748 100%)';
    document.body.style.minHeight = '100vh';
    document.body.style.margin = '0';
    document.documentElement.style.background = '#05070D';
    return () => {
      document.body.style.background = prev.background;
      document.body.style.minHeight = prev.minHeight;
      document.body.style.margin = prev.margin;
    };
  }, []);

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

  // Deep-link pairing handler. `sentinel://pair/<6-digit-code>` is the
  // link produced by `POST /api/patients/{pid}/pair` (see
  // docs/backend-contract.md §5). We claim both the initial URL (cold start
  // from a tap on the pairing QR) and any runtime URL events so a mid-
  // session scan also works. Ignored silently if the app is already paired.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const handleUrl = async (url: string | null) => {
      if (!url) return;
      const code = parsePairingInput(url);
      if (!code) return;
      // Don't clobber an existing session — the user would have to clear
      // credentials manually (e.g. by revoking the device) before a new
      // pair takes effect.
      const existing = await loadCredentials();
      if (existing) return;
      const result = await exchangePairingCode(code);
      if (cancelled) return;
      if (result.ok) {
        await refreshAuth(true);
      }
    };

    Linking.getInitialURL().then(handleUrl).catch(() => {});
    const sub = Linking.addEventListener('url', (ev) => {
      handleUrl(ev.url).catch(() => {});
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [ready, refreshAuth]);

  // Push token registration. Runs once per (re-)pairing. The actual delivery
  // path is: backend /api/calls/trigger -> Expo Push API -> FCM/APNS ->
  // device. Without this the killed-app / screen-off case can't ring.
  useEffect(() => {
    if (!ready || !creds) return;
    registerPushToken(creds).catch(() => {});
    const unsub = subscribeToPushTokenRefresh(creds);
    return unsub;
  }, [ready, creds]);

  // Foreground push receiver. We don't manually display anything — the
  // push body itself already specifies channelId/sound/vibrate/priority, and
  // setNotificationHandler (configured in incoming.ts) returns
  // shouldShowAlert/shouldPlaySound: true with priority: MAX so Expo
  // surfaces the heads-up and rings the channel automatically. Re-firing
  // showIncomingCallNotification() here would double up the banner.
  //
  // Background/killed delivery is rendered by the OS directly from the push
  // payload — same channel, same sound. Tap routing goes through the
  // NotificationResponseReceived listener below.
  //
  // We keep the listener wired so we have a single place to drop in
  // analytics or call-state diagnostics later.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => {
      // Intentionally empty — handled by setNotificationHandler + push payload.
    });
    return () => sub.remove();
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
      // Always clear the incoming-call notification, regardless of whether
      // the user tapped Answer, Decline, or the body. The OS keeps the
      // heads-up pinned until we explicitly dismiss it (action buttons do
      // NOT auto-dismiss), so without this the banner lingers behind the
      // call screen and stays visible after the call ends.
      dismissIncomingCallNotification().catch(() => {});
      if (parsed.action === 'decline') {
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
    // Paint the bootstrap splash with the same canvas colour the rest of
    // the app uses, otherwise the user sees a white flash for the
    // ~200ms it takes loadCredentials() to round-trip SecureStore.
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: palette.canvasFlat,
        }}
      >
        <ActivityIndicator color={palette.accent400} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          // Default RN navigator container background is white. That bleeds
          // through during route transitions, behind translucent status
          // bars, and at the edges of any screen whose root <View> doesn't
          // perfectly fill — which is exactly the white-vs-blue mismatch
          // we see vs. the web canvas. Pin it to the same canvas colour
          // every Screen uses so the whole app reads as one dark surface.
          contentStyle: { backgroundColor: palette.canvasFlat },
          animation: 'fade',
        }}
      />
    </SafeAreaProvider>
  );
}
