import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  PermissionsAndroid,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ConversationProvider,
  useConversationControls,
  useConversationStatus,
} from '@elevenlabs/react-native';
import type { Patient } from '../../src/api/client';
import { api, ApiCallError } from '../../src/api/client';
import { loadCredentials, type Credentials } from '../../src/auth/storage';
import { useLiveVitals } from '../../src/health/live';
import { dismissIncomingCallNotification } from '../../src/notifications/incoming';
import { postVitalsBatch } from '../../src/sync/client';

const AGENT_ID = process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_ID ?? '';

/**
 * Full-screen in-app call route.
 *
 * The previous design embedded the ConversationProvider inline on the
 * dashboard as a card. That's fine for a "tech demo" but doesn't read like
 * a real phone call to a clinical user — there's no commit to "you're now in
 * a call", no big green/red affordances, and the dashboard list scrolls
 * underneath. This route fixes that:
 *
 *   - Pushed via router.push('/(main)/call') so the user gets a system back
 *     transition and can never accidentally background the call by tapping
 *     somewhere else on the dashboard.
 *   - Hides the navigation stack header and forces the status bar to a
 *     dark theme so the screen reads as full-bleed.
 *   - Auto-mounts the ElevenLabs ConversationProvider and starts a session
 *     immediately (the user already tapped Answer to get here).
 *   - Polls Health Connect every 5s for live HR/SpO2 (see useLiveVitals)
 *     and shows them as a live tile next to the avatar.
 *   - On End, drains the live-vitals buffer, POSTs it as a single
 *     /api/vitals/batch so the call window's data lands on the dashboard
 *     immediately even if background sync hasn't fired yet.
 */
export default function CallScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      <StatusBar barStyle="light-content" />
      {AGENT_ID ? (
        <ConversationProvider agentId={AGENT_ID}>
          <CallSurface />
        </ConversationProvider>
      ) : (
        <MissingAgentScreen />
      )}
    </>
  );
}

function CallSurface() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const { startSession, endSession } = useConversationControls();
  const { status } = useConversationStatus();

  const [creds, setCreds] = useState<Credentials | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [callStartMs, setCallStartMs] = useState<number | null>(null);
  const [postBatchInfo, setPostBatchInfo] = useState<string | null>(null);
  const startedRef = useRef(false);
  const drainedRef = useRef(false);

  // Live HR/SpO2 polling. We tie `enabled` to "we believe a call is open"
  // so we don't burn cycles after the user hangs up but before the screen
  // unmounts.
  const callOpen = status === 'connecting' || status === 'connected';
  const live = useLiveVitals({ enabled: callOpen, intervalMs: 5000 });

  // Resolve credentials + patient name (so the call screen says "Calling
  // Jane" instead of generic "Patient"). Best-effort — if the patient
  // lookup fails, we still let the call proceed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await loadCredentials();
      if (cancelled) return;
      setCreds(c);
      if (!c) return;
      try {
        const p = await api.getPatient(c, c.patientId);
        if (!cancelled) setPatient(p);
      } catch (e) {
        // Don't tear down the call for a metadata fetch failure.
        if (e instanceof ApiCallError) {
          // ignore
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-start the session once. Mic permission goes through the same
  // platform path the inline panel used — Android needs an explicit runtime
  // request even though RECORD_AUDIO is in app.json.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const ok = await ensureMicPermission();
        if (!ok) {
          if (!cancelled) setErrorText('Microphone permission denied.');
          return;
        }
        await startSession({
          onError: (message: string) => {
            if (!cancelled) setErrorText(message);
          },
        });
      } catch (e) {
        if (!cancelled) {
          setErrorText(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stamp the connect time so we can render an mm:ss elapsed clock without
  // a separate state update on every tick.
  useEffect(() => {
    if (status === 'connected' && callStartMs == null) {
      setCallStartMs(Date.now());
    }
  }, [status, callStartMs]);

  // The notification (if any) lingers until we explicitly dismiss it. Do
  // it as soon as the call screen mounts — the user has already accepted
  // by being here.
  useEffect(() => {
    dismissIncomingCallNotification().catch(() => {});
  }, []);

  // Drain + post live vitals when the call ends. Guard with drainedRef so
  // we only fire once even if `status` flips through multiple terminal
  // states (`disconnecting` -> `disconnected`) before unmount.
  const drainAndPost = useCallback(
    async (c: Credentials | null) => {
      if (!c || drainedRef.current) return;
      drainedRef.current = true;
      const samples = live.drainBuffer();
      if (samples.length === 0) {
        setPostBatchInfo('No watch samples captured during the call.');
        return;
      }
      const result = await postVitalsBatch(c, samples);
      if (result.ok) {
        setPostBatchInfo(`Sent ${result.accepted} samples from the call window.`);
      } else {
        setPostBatchInfo(`Couldn\u2019t send call vitals (${result.kind}).`);
      }
    },
    [live],
  );

  useEffect(() => {
    if (status === 'disconnected') {
      drainAndPost(creds).finally(() => {
        // Small grace so the user can read the "sent N samples" toast
        // before we pop back to the dashboard.
        const t = setTimeout(() => router.back(), 1200);
        return () => clearTimeout(t);
      });
    }
  }, [status, creds, drainAndPost, router]);

  const onEndPress = async () => {
    try {
      await endSession?.();
    } catch {
      // Best-effort; the status->effect path will still fire on disconnect.
    }
    await drainAndPost(creds);
    router.back();
  };

  const onMuteToggle = () => {
    // The ElevenLabs RN SDK doesn't currently expose a mute control via
    // useConversationControls; underneath, LiveKit's local mic track is
    // the source of truth. As a UX placeholder we toggle local visual
    // state so the button works as expected, and document the gap below.
    // TODO: when @elevenlabs/react-native exposes setMicrophoneEnabled
    // (or we drop down to LiveKit's room.localParticipant), wire it up
    // here so the agent actually stops receiving audio.
    setMuted((m) => !m);
  };

  const elapsedMs = useElapsed(callStartMs);
  const elapsedLabel = formatElapsed(elapsedMs);
  const initials = getInitials(patient?.name ?? 'Patient');
  const phaseLabel = getPhaseLabel(status, !!errorText);

  return (
    <View style={styles.root}>
      {/* Top section: who you're talking to + status */}
      <View style={styles.topRegion}>
        <Text style={styles.kicker}>SENTINEL CARE TEAM</Text>
        <PulsingAvatar initials={initials} active={status === 'connected'} />
        <Text style={styles.name}>{patient?.name ?? 'Check-in call'}</Text>
        <Text style={styles.phase}>
          {phaseLabel}
          {status === 'connected' && callStartMs ? ` · ${elapsedLabel}` : ''}
        </Text>
        {mode === 'widget' ? (
          <Text style={styles.subtleMode}>You started this call from the widget.</Text>
        ) : null}
      </View>

      {/* Live vitals + errors */}
      <View style={styles.middleRegion}>
        <LiveVitalsTile
          hrBpm={live.latestHr?.bpm ?? null}
          spo2Pct={live.latestSpo2?.pct ?? null}
          ready={live.ready}
          callOpen={callOpen}
        />
        {errorText ? (
          <Text style={styles.error}>Voice error: {errorText}</Text>
        ) : null}
        {postBatchInfo ? (
          <Text style={styles.batchInfo}>{postBatchInfo}</Text>
        ) : null}
      </View>

      {/* Bottom controls */}
      <View style={styles.controlsRow}>
        <ControlButton
          label={muted ? 'Unmute' : 'Mute'}
          icon={muted ? '🔇' : '🎙'}
          onPress={onMuteToggle}
          tone="neutral"
        />
        <ControlButton
          label="End"
          icon="✕"
          onPress={onEndPress}
          tone="danger"
          large
        />
      </View>
    </View>
  );
}

function MissingAgentScreen() {
  const router = useRouter();
  return (
    <View style={[styles.root, { paddingTop: 96 }]}>
      <Text style={styles.kicker}>SENTINEL</Text>
      <Text style={styles.name}>Live check-in unavailable</Text>
      <Text style={[styles.phase, { textAlign: 'center', marginTop: 12 }]}>
        EXPO_PUBLIC_ELEVENLABS_AGENT_ID is not set. Configure it in{' '}
        <Text style={{ fontFamily: 'Courier', color: '#94A3B8' }}>mobile/.env</Text>{' '}
        and restart the dev client.
      </Text>
      <View style={[styles.controlsRow, { marginTop: 32 }]}>
        <ControlButton label="Close" icon="✕" onPress={() => router.back()} tone="neutral" />
      </View>
    </View>
  );
}

// --- pieces ---

function PulsingAvatar({ initials, active }: { initials: string; active: boolean }) {
  // Soft outward pulse while connected — visual cue that audio is live, even
  // if the screen is mostly text. Skipped on connecting/disconnected states
  // to avoid drawing attention before we're actually carrying audio.
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) {
      scale.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.08,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1.0,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, scale]);

  return (
    <View style={styles.avatarOuter}>
      <Animated.View
        style={[
          styles.avatarHalo,
          { transform: [{ scale }], opacity: active ? 0.35 : 0 },
        ]}
      />
      <View style={styles.avatarCircle}>
        <Text style={styles.avatarInitials}>{initials}</Text>
      </View>
    </View>
  );
}

function LiveVitalsTile({
  hrBpm,
  spo2Pct,
  ready,
  callOpen,
}: {
  hrBpm: number | null;
  spo2Pct: number | null;
  ready: boolean;
  callOpen: boolean;
}) {
  if (!callOpen) return null;
  return (
    <View style={styles.vitalsTile}>
      <Text style={styles.vitalsLabel}>WATCH · LIVE</Text>
      <View style={styles.vitalsRow}>
        <VitalCell
          label="HR"
          value={hrBpm != null ? `${Math.round(hrBpm)}` : '—'}
          unit="bpm"
          ready={ready}
        />
        <VitalCell
          label="SpO₂"
          value={spo2Pct != null ? `${Math.round(spo2Pct)}` : '—'}
          unit="%"
          ready={ready}
        />
      </View>
      <Text style={styles.vitalsFootnote}>
        Polling Health Connect every 5s while the call is active.
      </Text>
    </View>
  );
}

function VitalCell({
  label,
  value,
  unit,
  ready,
}: {
  label: string;
  value: string;
  unit: string;
  ready: boolean;
}) {
  return (
    <View style={styles.vitalCell}>
      <Text style={styles.vitalCellLabel}>{label}</Text>
      <View style={styles.vitalCellValueRow}>
        <Text style={styles.vitalCellValue}>{value}</Text>
        <Text style={styles.vitalCellUnit}>{unit}</Text>
      </View>
      {!ready ? (
        <ActivityIndicator size="small" color="#64748B" style={{ marginTop: 4 }} />
      ) : null}
    </View>
  );
}

type ControlTone = 'neutral' | 'danger';
function ControlButton({
  label,
  icon,
  onPress,
  tone,
  large,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  tone: ControlTone;
  large?: boolean;
}) {
  const bg = tone === 'danger' ? '#EF4444' : 'rgba(255,255,255,0.12)';
  const ring = tone === 'danger' ? '#FCA5A5' : 'rgba(255,255,255,0.25)';
  const size = large ? 84 : 64;
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.controlBtnOuter}
    >
      <View
        style={[
          styles.controlBtn,
          {
            backgroundColor: bg,
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: ring,
          },
        ]}
      >
        <Text style={styles.controlBtnIcon}>{icon}</Text>
      </View>
      <Text style={styles.controlBtnLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// --- helpers ---

function useElapsed(startMs: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startMs == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startMs]);
  return startMs == null ? 0 : Math.max(0, now - startMs);
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function getPhaseLabel(status: string, hasError: boolean): string {
  if (hasError) return 'Disconnected';
  switch (status) {
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Connected';
    case 'disconnecting':
      return 'Ending…';
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
  root: {
    flex: 1,
    backgroundColor: '#0B1220',
    paddingHorizontal: 24,
    paddingTop: 72,
    paddingBottom: 36,
  },
  topRegion: { alignItems: 'center', gap: 12 },
  kicker: {
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: '700',
    color: '#94A3B8',
  },
  avatarOuter: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  avatarHalo: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#10B981',
  },
  avatarCircle: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: '#E2E8F0',
    fontSize: 44,
    fontWeight: '700',
    letterSpacing: 1,
  },
  name: {
    color: '#F1F5F9',
    fontSize: 24,
    fontWeight: '600',
    marginTop: 4,
  },
  phase: { color: '#94A3B8', fontSize: 14 },
  subtleMode: { color: '#64748B', fontSize: 12, marginTop: 2 },

  middleRegion: { flex: 1, justifyContent: 'center', gap: 12 },

  vitalsTile: {
    backgroundColor: 'rgba(15,23,42,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.15)',
    borderRadius: 18,
    padding: 18,
    gap: 10,
  },
  vitalsLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#94A3B8',
  },
  vitalsRow: { flexDirection: 'row', gap: 16 },
  vitalCell: {
    flex: 1,
    backgroundColor: 'rgba(30,41,59,0.7)',
    borderRadius: 12,
    padding: 14,
  },
  vitalCellLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  vitalCellValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  vitalCellValue: { fontSize: 32, fontWeight: '700', color: '#F8FAFC' },
  vitalCellUnit: { fontSize: 13, color: '#94A3B8' },
  vitalsFootnote: { fontSize: 11, color: '#64748B' },

  error: {
    color: '#FCA5A5',
    fontSize: 13,
    textAlign: 'center',
  },
  batchInfo: {
    color: '#A7F3D0',
    fontSize: 13,
    textAlign: 'center',
  },

  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    paddingTop: 12,
  },
  controlBtnOuter: { alignItems: 'center', gap: 8 },
  controlBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  controlBtnIcon: { color: 'white', fontSize: 26 },
  controlBtnLabel: { color: '#CBD5E1', fontSize: 13, fontWeight: '500' },
});
