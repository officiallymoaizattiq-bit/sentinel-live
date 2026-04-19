import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ConversationProvider,
  useConversationControls,
  useConversationStatus,
} from '@elevenlabs/react-native';
import { palette, radius, space } from './ui';

type Props = {
  agentId: string;
  onEnd: () => void;
};

/**
 * "Sentinel is calling you" panel, backed by @elevenlabs/react-native.
 *
 * SDK shape (v1.1.1):
 *   - <ConversationProvider agentId="..."> wraps the conversation surface.
 *   - useConversationControls() exposes startSession({ onConnect, onError })
 *     and endSession().
 *   - useConversationStatus() exposes { status }, where status is one of
 *     "connecting" | "connected" | "disconnecting" | "disconnected".
 *
 * Mic permission:
 *   - iOS: NSMicrophoneUsageDescription in app.json triggers the system
 *     prompt the first time LiveKit accesses the mic.
 *   - Android: RECORD_AUDIO is in app.json, but Android 6+ also needs a
 *     runtime request — we issue it explicitly before startSession.
 *
 * NOTE on packaging: this component pulls in @elevenlabs/react-native at
 * module-evaluation time, which transitively loads @livekit/react-native +
 * @livekit/react-native-webrtc. Both have native modules and require an
 * Expo development build (Expo Go can't load them). We intentionally do
 * NOT lazy-require the SDK any more — Metro's static analysis pass got
 * confused by a top-level dynamic require() and surfaced as
 * "Requiring unknown module 'undefined'" the first time the panel mounted.
 * A plain ES import is the supported pattern, and the package install +
 * config plugins are already verified at build time, so a missing dep
 * would fail loudly at `npx expo prebuild` instead of at runtime.
 */
export function CallPanel({ agentId, onEnd }: Props) {
  return (
    <ConversationProvider agentId={agentId}>
      <LiveCallPanel onEnd={onEnd} />
    </ConversationProvider>
  );
}

function LiveCallPanel({ onEnd }: { onEnd: () => void }) {
  const { startSession, endSession } = useConversationControls();
  const { status } = useConversationStatus();
  const [errorText, setErrorText] = useState<string | null>(null);
  const startedRef = useRef(false);

  // Auto-start the session once on mount. The user already tapped Answer
  // to mount this component; we don't make them tap again.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const ok = await ensureMicPermission();
        if (!ok) {
          if (cancelled) return;
          setErrorText('Microphone permission denied.');
          return;
        }
        await startSession({
          onError: (message: string) => {
            if (cancelled) return;
            setErrorText(message);
          },
        });
      } catch (e) {
        if (cancelled) return;
        setErrorText(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      // Best-effort hangup if the user navigates away mid-call.
      try {
        Promise.resolve(endSession?.()).catch(() => {});
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the session ends server-side (or the user taps End), bubble up.
  useEffect(() => {
    if (status === 'disconnected') {
      onEnd();
    }
  }, [status, onEnd]);

  const end = async () => {
    try {
      await endSession?.();
    } catch {
      // best-effort
    }
    onEnd();
  };

  const isConnecting = status === 'connecting';
  const isConnected = status === 'connected';

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Live check-in</Text>
        <TouchableOpacity onPress={end} accessibilityRole="button">
          <Text style={styles.endBtn}>End</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.statusRow}>
        {isConnecting ? (
          <ActivityIndicator size="small" color="#34D399" />
        ) : (
          <View
            style={[
              styles.dot,
              { backgroundColor: isConnected ? '#34D399' : '#94A3B8' },
            ]}
          />
        )}
        <Text style={styles.statusText}>{label(status, !!errorText)}</Text>
      </View>
      {errorText && (
        <Text style={styles.errorText}>Voice check-in error: {errorText}</Text>
      )}
    </View>
  );
}

function label(status: string, hasError: boolean): string {
  if (hasError) return 'Disconnected';
  switch (status) {
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Connected — speak when ready';
    case 'disconnecting':
      return 'Ending call…';
    case 'disconnected':
      return 'Call ended';
    default:
      return 'Starting…';
  }
}

async function ensureMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Microphone access',
        message: 'Sentinel needs the microphone to talk with your care team.',
        buttonPositive: 'Allow',
        buttonNegative: 'Cancel',
      },
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

const styles = StyleSheet.create({
  container: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    backgroundColor: palette.glassBg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: { fontSize: 14, fontWeight: '600', color: palette.text },
  endBtn: {
    fontSize: 12,
    color: palette.accent300,
    fontWeight: '600',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, color: palette.textMuted },
  errorText: { fontSize: 12, color: palette.critText, marginTop: 6 },
});
