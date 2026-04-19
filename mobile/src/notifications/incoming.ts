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
//
// Note on bypassDnd: We intentionally do NOT set bypassDnd here.
// expo-notifications@0.29 silently drops the bypassDnd field on Android
// (it isn't read by NotificationsChannelSerializer.java, and the Expo
// team has confirmed it's not supported because Android only allows
// privileged system apps to flip mBypassDnd). To survive Bedtime/Sleeping
// modes the user must either grant DND access in Settings → Apps →
// Sentinel → Notifications → Override Do Not Disturb, OR add Sentinel
// to "Priority Apps" under the active Mode. There's no all-code fix that
// works on stock Android without writing a native module that calls
// NotificationChannel#setBypassDnd(true) directly + requesting
// ACCESS_NOTIFICATION_POLICY.
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
    // Best-effort cleanup of older channel revisions. If the user updated
    // from a build that used an earlier (silent or stale) channel,
    // leaving them behind would clutter Settings → Notifications. Each
    // delete is independently safe to fail (channel may not exist on a
    // fresh install). Includes incoming-calls-v3 because we briefly
    // shipped that ID while debugging bypassDnd; superseded back to v2.
    for (const stale of ['incoming-calls', 'incoming-calls-v3']) {
      try {
        await Notifications.deleteNotificationChannelAsync(stale);
      } catch {
        // ignore
      }
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
      // bypassDnd is intentionally omitted; see channel-ID comment for why
      // expo-notifications can't set it from JS.
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

export async function dismissIncomingCallNotification(): Promise<void> {
  // Our own locally-scheduled copy. Safe no-op if it isn't present.
  try {
    await Notifications.dismissNotificationAsync(INCOMING_CALL_NOTIFICATION_ID);
    await Notifications.cancelScheduledNotificationAsync(INCOMING_CALL_NOTIFICATION_ID);
  } catch {
    // ignore
  }

  // Sweep everything else the OS still has on-screen. The remote Expo push
  // that actually rings the device (backend/sentinel/push.py) is scheduled
  // by the OS with a provider-assigned identifier, NOT
  // INCOMING_CALL_NOTIFICATION_ID — so the dismissNotificationAsync() above
  // doesn't touch it. Without this loop the "Sentinel is calling you"
  // heads-up stays pinned after the call ends / is answered / is scored,
  // and the user has to swipe it away by hand.
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => {
          const data = n.request?.content?.data as { kind?: string } | undefined;
          return data?.kind === 'incoming-call';
        })
        .map((n) =>
          Notifications.dismissNotificationAsync(n.request.identifier).catch(
            () => {},
          ),
        ),
    );
  } catch {
    // ignore
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
