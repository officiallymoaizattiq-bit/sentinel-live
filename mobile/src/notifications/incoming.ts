import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * Incoming-call notification, JS-only via expo-notifications.
 *
 * What this gets us:
 *   - A heads-up notification (Android) / banner (iOS) titled "Sentinel is
 *     calling you" with Answer + Decline action buttons.
 *   - Custom ringtone-style sound and a stronger-than-default vibration
 *     pattern so it's distinguishable from a regular notification.
 *   - Works whether the app is foreground, background, or killed.
 *   - Tapping the notification (or "Answer") routes to the in-app
 *     /(main)/call screen via Notifications.addNotificationResponseReceivedListener.
 *
 * What this does NOT get us:
 *   - True OS-level full-screen incoming-call UI (lock-screen takeover,
 *     persistent ringer, swipe-to-answer). That requires Android's
 *     USE_FULL_SCREEN_INTENT permission + a CallStyle notification
 *     (Notifications.Builder Bridge) or ConnectionService, neither of which
 *     is exposed by expo-notifications. iOS's equivalent (CallKit/PushKit
 *     VoIP push) requires a remote APNS push, not a local schedule.
 *   - Both are real native-module work; intentionally deferred (see HANDOFF).
 *
 * Channel design:
 *   We ship a single high-importance Android channel ("incoming-calls") with
 *   a custom sound and a vibration pattern. Channel settings on Android 8+
 *   are immutable after creation — if you tweak the sound or vibration,
 *   bump the channel ID (e.g. incoming-calls-v2) so the OS provisions a new
 *   channel instead of silently keeping the old config.
 */

// Bumped to v2 because Android channel settings are immutable after the OS
// has provisioned them. The v1 channel was created without explicit
// audio attributes (defaulted to USAGE_NOTIFICATION) and ended up being
// silenced by the foreground heads-up rules + sticky flag combo. v2 is
// configured for ringtone-style audio and is created fresh.
export const INCOMING_CALL_CHANNEL_ID = 'incoming-calls-v2';
export const INCOMING_CALL_CATEGORY_ID = 'sentinel.incoming-call';
export const INCOMING_CALL_NOTIFICATION_ID = 'sentinel.incoming-call.active';

const ANSWER_ACTION_ID = 'answer';
const DECLINE_ACTION_ID = 'decline';

/**
 * Shape of the notification's data payload. The notification listener pulls
 * `mode` and `at` out so the call screen can show "phone widget call started
 * 8s ago" instead of just a generic title.
 */
export type IncomingCallPayload = {
  patientId: string;
  mode: 'phone' | 'widget';
  /** ISO timestamp from the SSE pending_call event. */
  at: string;
};

let configured = false;

/**
 * Idempotent setup: notification handler (foreground display rules), Android
 * channel, and iOS action category. Safe to call from RootLayout's mount
 * effect. A second call is a no-op.
 */
export async function configureIncomingCallNotifications(): Promise<void> {
  if (configured) return;
  configured = true;

  // Foreground display rules. Without this, expo-notifications swallows
  // local notifications fired while the app is in the foreground — which is
  // the most common case for our SSE-triggered "incoming call" since the
  // user is staring at the dashboard. We aggressively opt in to *every*
  // display channel because incoming calls should be unmissable.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      // SDK 50+ split shouldShowAlert into banner/list. Provide both so
      // older + newer SDKs both behave correctly.
      shouldShowBanner: true,
      shouldShowList: true,
      // Per the SDK source (ExpoNotificationBuilder.kt line 281), the
      // handler's priority override wins over content.priority. Without
      // this we get importance=2 (LOW) on the posted record even though
      // our channel is importance=5 (MAX) — and Android then silently
      // drops the heads-up banner.
      priority: Notifications.AndroidNotificationPriority.MAX,
    }),
  });

  await Notifications.setNotificationCategoryAsync(INCOMING_CALL_CATEGORY_ID, [
    {
      identifier: ANSWER_ACTION_ID,
      buttonTitle: 'Answer',
      options: { opensAppToForeground: true },
    },
    {
      identifier: DECLINE_ACTION_ID,
      buttonTitle: 'Decline',
      options: { opensAppToForeground: false, isDestructive: true },
    },
  ]);

  if (Platform.OS === 'android') {
    // Best-effort cleanup of the v1 channel. If the user updated from a
    // build that used the old (silent) channel, leaving it behind would
    // confuse the Settings → Notifications page with two "Incoming
    // check-in calls" entries. Failure here is fine (channel may not
    // exist on a fresh install).
    try {
      await Notifications.deleteNotificationChannelAsync('incoming-calls');
    } catch {
      // ignore
    }

    await Notifications.setNotificationChannelAsync(INCOMING_CALL_CHANNEL_ID, {
      name: 'Incoming check-in calls',
      description:
        'Plays a ringtone when your care team is starting a check-in call.',
      importance: Notifications.AndroidImportance.MAX,
      // null = use the system default ringtone-ish sound. We don't ship a
      // bundled .wav because that would require asset config + native
      // file copies; the default ringer-style sound is "loud enough" for
      // a demo.
      sound: 'default',
      vibrationPattern: [0, 1000, 500, 1000, 500, 1000],
      enableVibrate: true,
      lightColor: '#10B981',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
    });
  }
}

/**
 * Ask for notification permission. Idempotent and silent on subsequent calls
 * once the user has answered. Safe to call alongside or after Health
 * Connect's permission round-trip.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  // On iOS this triggers the system prompt; on Android 13+ it triggers
  // POST_NOTIFICATIONS prompt; on Android <13 it's auto-granted.
  const requested = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return requested.granted;
}

/**
 * Show (or replace) the incoming-call notification. Local-only — we don't
 * round-trip through APNS/FCM. Returns the OS-assigned identifier (so a
 * caller could potentially cancel by id; we cancel by tag instead).
 */
export async function showIncomingCallNotification(
  payload: IncomingCallPayload,
): Promise<void> {
  await configureIncomingCallNotifications();
  // Cancel any previous incoming-call notification before scheduling a new
  // one so we never end up with two ringers competing on the lock screen.
  await dismissIncomingCallNotification();

  // Channel binding is done via the TRIGGER, not the content. expo-notifications'
  // schedule API treats `channelId` as a property of NativeChannelAwareTriggerInput
  // (see node_modules/expo-notifications/src/scheduleNotificationAsync.ts:134-145).
  // Putting `channelId` under `content.android` does NOTHING — the OS routes
  // the notification to `expo_notifications_fallback_notification_channel`
  // (importance=4, no vibration), which is exactly the silent "didn't ring"
  // behavior we were seeing. On iOS the trigger must be `null` (no channels).
  const trigger =
    Platform.OS === 'android'
      ? ({ channelId: INCOMING_CALL_CHANNEL_ID } as Notifications.NotificationTriggerInput)
      : null;

  // Why every field below is required (learned the hard way reading
  // ExpoNotificationBuilder.kt and watching `dumpsys notification`):
  //
  // - sound: true → sets shouldPlayDefaultSound on the native content. If
  //   neither this nor `vibrate` is set, the builder calls
  //   `setSilent(true)` which suppresses both sound AND vibration even
  //   when the channel has them configured. That's what we observed —
  //   notifications posting with `vibrate=null sound=null defaults=0`.
  // - vibrate: [...] → sets vibrationPattern on the native content so
  //   shouldVibrate() returns true.
  // - priority: MAX → expo-notifications computes the NotificationCompat
  //   priority by reading content.priority. With no notificationBehavior
  //   reachable (which happens whenever the JS handler can't run — app
  //   backgrounded, screen off, JS thread paused), the native code falls
  //   back to content.priority. Without this, the posted notification
  //   gets importance=2 (LOW) and never shows as a heads-up banner.
  // - NO sticky: true → Android maps it to FLAG_ONGOING_EVENT, which
  //   exempts notifications from making sound or vibrating regardless of
  //   channel.
  await Notifications.scheduleNotificationAsync({
    identifier: INCOMING_CALL_NOTIFICATION_ID,
    content: {
      title: 'Sentinel is calling you',
      body:
        payload.mode === 'phone'
          ? 'Your care team would like a quick check-in.'
          : 'A check-in is ready when you are.',
      data: { ...payload, kind: 'incoming-call' },
      categoryIdentifier: INCOMING_CALL_CATEGORY_ID,
      sound: true,
      vibrate: [0, 1000, 500, 1000, 500, 1000],
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    trigger,
  });
}

export async function dismissIncomingCallNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(INCOMING_CALL_NOTIFICATION_ID);
    await Notifications.cancelScheduledNotificationAsync(INCOMING_CALL_NOTIFICATION_ID);
  } catch {
    // Notification might already be gone; that's fine.
  }
}

/**
 * Pull the structured payload out of a notification response (i.e. tap or
 * action button press). Returns null if the response wasn't ours.
 */
export function payloadFromResponse(
  response: Notifications.NotificationResponse,
): { payload: IncomingCallPayload; action: 'answer' | 'decline' | 'tap' } | null {
  const data = response.notification.request.content.data as
    | (IncomingCallPayload & { kind?: string })
    | undefined;
  if (!data || data.kind !== 'incoming-call') return null;

  let action: 'answer' | 'decline' | 'tap' = 'tap';
  if (response.actionIdentifier === ANSWER_ACTION_ID) action = 'answer';
  else if (response.actionIdentifier === DECLINE_ACTION_ID) action = 'decline';

  return {
    payload: { patientId: data.patientId, mode: data.mode, at: data.at },
    action,
  };
}
