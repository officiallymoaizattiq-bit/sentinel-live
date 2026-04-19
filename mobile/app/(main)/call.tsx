import { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  AuroraBackground,
  font,
  palette,
  radius,
  space,
} from '../../src/components/ui';

const AGENT_ID = process.env.EXPO_PUBLIC_ELEVENLABS_AGENT_ID ?? '';

/**
 * Full-screen in-app call route.
 *
 * Visually redesigned to match the Sentinel patient portal on web: dark blue
 * canvas, glass surfaces, glowing aurora ring around the avatar when the
 * call is live, and large tactile pill controls sized for a Pixel 9 Pro XL.
 */
export default function CallScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
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
  const hasBeenLiveRef = useRef(false);
  const [hasBeenLive, setHasBeenLive] = useState(false);

  const callOpen = status === 'connecting' || status === 'connected';
  const live = useLiveVitals({ enabled: callOpen, intervalMs: 5000 });

  useEffect(() => {
    if ((status === 'connecting' || status === 'connected') && !hasBeenLiveRef.current) {
      hasBeenLiveRef.current = true;
      setHasBeenLive(true);
    }
  }, [status]);

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
        if (e instanceof ApiCallError) {
          // ignore
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  useEffect(() => {
    if (status === 'connected' && callStartMs == null) {
      setCallStartMs(Date.now());
    }
  }, [status, callStartMs]);

  useEffect(() => {
    dismissIncomingCallNotification().catch(() => {});
  }, []);

  const liveRef = useRef(live);
  liveRef.current = live;

  const drainAndPost = useCallback(async (c: Credentials | null) => {
    if (!c || drainedRef.current) return;
    drainedRef.current = true;
    const samples = liveRef.current.drainBuffer();
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
  }, []);

  const terminalRef = useRef(false);
  useEffect(() => {
    if (!hasBeenLive) return;
    if (status !== 'disconnected' && status !== 'error') return;
    if (terminalRef.current) return;
    terminalRef.current = true;

    drainAndPost(creds).catch(() => {});
    const timeoutId = setTimeout(() => router.back(), 1200);
    return () => clearTimeout(timeoutId);
  }, [status, hasBeenLive, creds, drainAndPost, router]);

  const onEndPress = async () => {
    try {
      endSession?.();
    } catch {
      // best-effort
    }
    if (!terminalRef.current) {
      terminalRef.current = true;
      drainAndPost(creds).catch(() => {});
      setTimeout(() => router.back(), 1200);
    }
  };

  const onMuteToggle = () => {
    // The ElevenLabs RN SDK doesn't currently expose a mute control via
    // useConversationControls; underneath, LiveKit's local mic track is
    // the source of truth. As a UX placeholder we toggle local visual
    // state so the button works as expected.
    setMuted((m) => !m);
  };

  const elapsedMs = useElapsed(callStartMs);
  const elapsedLabel = formatElapsed(elapsedMs);
  const initials = getInitials(patient?.name ?? 'Patient');
  const phaseLabel = getPhaseLabel(status, !!errorText);
  const isConnected = status === 'connected';

  return (
    <View style={styles.root}>
      <AuroraBackground />

      <View style={styles.topRegion}>
        <Text style={styles.kicker}>SENTINEL CARE TEAM</Text>
        <PulsingAvatar initials={initials} active={isConnected} />
        <Text style={styles.name}>{patient?.name ?? 'Check-in call'}</Text>
        <View style={styles.phaseRow}>
          <View
            style={[
              styles.phaseDot,
              {
                backgroundColor: isConnected
                  ? palette.calm
                  : status === 'error' || errorText
                    ? palette.crit
                    : palette.accent400,
              },
            ]}
          />
          <Text style={styles.phase}>
            {phaseLabel}
            {isConnected && callStartMs ? ` · ${elapsedLabel}` : ''}
          </Text>
        </View>
        {mode === 'widget' ? (
          <Text style={styles.subtleMode}>Started from the widget</Text>
        ) : null}
      </View>

      <View style={styles.middleRegion}>
        <LiveVitalsTile
          hrBpm={live.latestHr?.bpm ?? null}
          hrTIso={live.latestHr?.tIso ?? null}
          spo2Pct={live.latestSpo2?.pct ?? null}
          spo2TIso={live.latestSpo2?.tIso ?? null}
          ready={live.ready}
          callOpen={callOpen}
        />
        {errorText ? (
          <View style={styles.errorBox}>
            <Text style={styles.error}>Voice error: {errorText}</Text>
          </View>
        ) : null}
        {postBatchInfo ? (
          <View style={styles.infoBox}>
            <Text style={styles.batchInfo}>{postBatchInfo}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.controlsRow}>
        <ControlButton
          label={muted ? 'Unmute' : 'Mute'}
          icon={muted ? '🔇' : '🎙'}
          onPress={onMuteToggle}
          tone="neutral"
        />
        <ControlButton label="End" icon="✕" onPress={onEndPress} tone="danger" large />
      </View>
    </View>
  );
}

function MissingAgentScreen() {
  const router = useRouter();
  return (
    <View style={[styles.root, { justifyContent: 'center', paddingHorizontal: space.xl }]}>
      <AuroraBackground />
      <Text style={styles.kicker}>SENTINEL</Text>
      <Text style={[styles.name, { marginTop: space.md }]}>Live check-in unavailable</Text>
      <Text style={[styles.phase, { textAlign: 'center', marginTop: space.md, lineHeight: 20 }]}>
        EXPO_PUBLIC_ELEVENLABS_AGENT_ID is not set. Configure it in{' '}
        <Text style={styles.mono}>mobile/.env</Text> and restart the dev client.
      </Text>
      <View style={[styles.controlsRow, { marginTop: space.huge }]}>
        <ControlButton label="Close" icon="✕" onPress={() => router.back()} tone="neutral" />
      </View>
    </View>
  );
}

// --- pieces ---

function PulsingAvatar({ initials, active }: { initials: string; active: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      scale.setValue(1);
      ring.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.08,
            duration: 1400,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1.0,
            duration: 1400,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(ring, {
            toValue: 1,
            duration: 2000,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(ring, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, scale, ring]);

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.5, 0] });

  return (
    <View style={styles.avatarOuter}>
      <Animated.View
        style={[
          styles.avatarRing,
          { transform: [{ scale: ringScale }], opacity: ringOpacity },
        ]}
      />
      <Animated.View
        style={[
          styles.avatarHalo,
          { transform: [{ scale }], opacity: active ? 0.4 : 0 },
        ]}
      />
      <View style={[styles.avatarCircle, active && styles.avatarCircleActive]}>
        <Text style={styles.avatarInitials}>{initials}</Text>
      </View>
    </View>
  );
}

function LiveVitalsTile({
  hrBpm,
  hrTIso,
  spo2Pct,
  spo2TIso,
  ready,
  callOpen,
}: {
  hrBpm: number | null;
  hrTIso: string | null;
  spo2Pct: number | null;
  spo2TIso: string | null;
  ready: boolean;
  callOpen: boolean;
}) {
  if (!callOpen) return null;
  const hasSpo2 = spo2Pct != null;
  return (
    <View style={styles.vitalsTile}>
      <View style={styles.vitalsHeader}>
        <View style={styles.liveTag}>
          <View style={styles.liveTagDot} />
          <Text style={styles.liveTagText}>LIVE</Text>
        </View>
        <Text style={styles.vitalsLabel}>WATCH · HEALTH CONNECT</Text>
      </View>
      <View style={styles.vitalsRow}>
        <VitalCell
          label="Heart rate"
          value={hrBpm != null ? `${Math.round(hrBpm)}` : '—'}
          unit="bpm"
          accentColor={palette.crit}
          ready={ready}
          ageHint={formatAge(hrTIso)}
        />
        {hasSpo2 ? (
          <VitalCell
            label="SpO₂"
            value={`${Math.round(spo2Pct as number)}`}
            unit="%"
            accentColor={palette.accent400}
            ready={ready}
            ageHint={formatAge(spo2TIso)}
          />
        ) : null}
      </View>
      <Text style={styles.vitalsFootnote}>
        Polling Health Connect every 5s. Wearables (especially Samsung) often batch HR writes
        every ~10–15 min when not in a workout, so the displayed value may lag the watch face.
      </Text>
    </View>
  );
}

function formatAge(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const ageSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (ageSec < 5) return 'just now';
  if (ageSec < 60) return `${ageSec}s ago`;
  const m = Math.round(ageSec / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

function VitalCell({
  label,
  value,
  unit,
  accentColor,
  ready,
  ageHint,
}: {
  label: string;
  value: string;
  unit: string;
  accentColor: string;
  ready: boolean;
  ageHint?: string | null;
}) {
  return (
    <View style={styles.vitalCell}>
      <View style={styles.vitalCellHeader}>
        <View style={[styles.vitalAccent, { backgroundColor: accentColor }]} />
        <Text style={styles.vitalCellLabel}>{label}</Text>
      </View>
      <View style={styles.vitalCellValueRow}>
        <Text style={styles.vitalCellValue}>{value}</Text>
        <Text style={styles.vitalCellUnit}>{unit}</Text>
      </View>
      {!ready ? (
        <ActivityIndicator size="small" color={palette.textMuted} style={{ marginTop: 4 }} />
      ) : ageHint ? (
        <Text style={styles.vitalCellAge}>{ageHint}</Text>
      ) : (
        <Text style={styles.vitalCellAge}>waiting…</Text>
      )}
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
  const bg = tone === 'danger' ? palette.crit : 'rgba(255,255,255,0.08)';
  const border = tone === 'danger' ? '#FDA4AF' : palette.glassBorderStrong;
  const size = large ? 88 : 68;
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={0.8}
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
            borderColor: border,
            shadowColor: tone === 'danger' ? palette.crit : 'transparent',
          },
        ]}
      >
        <Text style={[styles.controlBtnIcon, large && { fontSize: 30 }]}>{icon}</Text>
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
  if (hasError) return 'Call failed';
  switch (status) {
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Connected';
    case 'error':
      return 'Call failed';
    case 'disconnected':
      return 'Starting…';
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
    backgroundColor: palette.canvasFlat,
    paddingHorizontal: space.xl,
    paddingTop: 72,
    paddingBottom: space.huge,
  },
  topRegion: { alignItems: 'center', gap: space.sm },
  kicker: {
    fontSize: font.kicker.size,
    letterSpacing: font.kicker.letterSpacing,
    fontWeight: '700',
    color: palette.accent400,
  },

  avatarOuter: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: space.md,
  },
  avatarRing: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 2,
    borderColor: palette.accent400,
  },
  avatarHalo: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: palette.accent500,
  },
  avatarCircle: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: palette.canvasRise,
    borderWidth: 1,
    borderColor: palette.glassBorderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCircleActive: {
    borderColor: palette.accent400,
    backgroundColor: '#101B34',
  },
  avatarInitials: {
    color: palette.text,
    fontSize: 46,
    fontWeight: '700',
    letterSpacing: 1,
  },
  name: {
    color: palette.text,
    fontSize: 26,
    fontWeight: '600',
    marginTop: 4,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 2,
  },
  phaseDot: { width: 8, height: 8, borderRadius: 4 },
  phase: { color: palette.textMuted, fontSize: 14 },
  subtleMode: { color: palette.textDim, fontSize: 12, marginTop: 2 },

  middleRegion: { flex: 1, justifyContent: 'center', gap: space.md },

  vitalsTile: {
    backgroundColor: palette.glassBg,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    borderRadius: radius.xl,
    padding: space.lg,
    gap: space.md,
  },
  vitalsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.critBorder,
    backgroundColor: palette.critBg,
  },
  liveTagDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.crit,
    shadowColor: palette.crit,
    shadowOpacity: 0.8,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 0 },
  },
  liveTagText: { fontSize: 9, fontWeight: '700', color: palette.critText, letterSpacing: 0.8 },
  vitalsLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: palette.textDim,
  },
  vitalsRow: { flexDirection: 'row', gap: space.md },
  vitalCell: {
    flex: 1,
    backgroundColor: 'rgba(10,15,31,0.55)',
    borderRadius: radius.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: palette.glassBorder,
  },
  vitalCellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  vitalAccent: {
    width: 4,
    height: 12,
    borderRadius: 2,
  },
  vitalCellLabel: {
    fontSize: 11,
    color: palette.textMuted,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  vitalCellValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  vitalCellValue: { fontSize: 36, fontWeight: '700', color: palette.text, letterSpacing: -0.5 },
  vitalCellUnit: { fontSize: 13, color: palette.textDim },
  vitalCellAge: { fontSize: 11, color: palette.textDim, marginTop: 4 },
  vitalsFootnote: { fontSize: 11, color: palette.textDim, lineHeight: 16 },

  errorBox: {
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: palette.critBg,
    borderWidth: 1,
    borderColor: palette.critBorder,
  },
  error: { color: palette.critText, fontSize: 13, textAlign: 'center' },
  infoBox: {
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: palette.calmBg,
    borderWidth: 1,
    borderColor: palette.calmBorder,
  },
  batchInfo: { color: palette.calmText, fontSize: 13, textAlign: 'center' },

  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    paddingTop: space.md,
  },
  controlBtnOuter: { alignItems: 'center', gap: space.sm },
  controlBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  controlBtnIcon: { color: '#F8FAFF', fontSize: 26 },
  controlBtnLabel: { color: palette.textMuted, fontSize: 13, fontWeight: '500' },

  mono: { fontFamily: 'Courier', color: palette.textMuted },
});
