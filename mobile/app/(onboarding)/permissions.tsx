import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  type AppStateStatus,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getHealthAdapter } from '../../src/health';
import { registerBackgroundSync, runSyncOnce } from '../../src/sync/task';
import {
  AuroraBackground,
  Button,
  Glass,
  font,
  palette,
  radius,
  space,
} from '../../src/components/ui';

type Phase = 'intro' | 'sheet' | 'awaiting-system' | 'verifying';

export default function PermissionsScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState<string | null>(null);
  const adapter = getHealthAdapter();

  // Auto-detect when the user returns from the system Health Connect
  // settings screen. If they granted anything, advance to Status without
  // requiring another tap.
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next: AppStateStatus) => {
      const wasBackground = appState.current.match(/inactive|background/);
      appState.current = next;
      if (!wasBackground || next !== 'active') return;
      if (phase !== 'awaiting-system') return;

      setPhase('verifying');
      const ok = await adapter.hasPermissions();
      if (ok) {
        await onGranted();
      } else {
        setPhase('sheet');
        setError(
          Platform.OS === 'android'
            ? 'It looks like access wasn\u2019t granted. Tap Continue to try again.'
            : 'Permissions still missing. Open Health to grant.',
        );
      }
    });
    return () => sub.remove();
  }, [phase]);

  async function onGranted() {
    await registerBackgroundSync().catch(() => {});
    runSyncOnce().catch(() => {});
    router.replace('/(main)/status');
  }

  async function onContinue() {
    setError(null);
    setPhase('awaiting-system');
    const granted = await adapter.requestPermissions();
    if (granted) {
      await onGranted();
      return;
    }
    if (appState.current === 'active') {
      setPhase('sheet');
      setError(
        Platform.OS === 'android'
          ? 'Health Connect closed without granting access. Tap Continue to try again, or open Health Connect manually.'
          : 'Open the Health app \u2192 Sharing \u2192 Sentinel to grant access.',
      );
    }
  }

  const sourceName = Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect';

  return (
    <View style={styles.container}>
      <AuroraBackground />

      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.brand}>STEP 2 OF 2</Text>
          <Text style={styles.title}>Allow vitals access</Text>
          <Text style={styles.subtitle}>
            Sentinel reads your heart rate, blood oxygen, respiratory rate, temperature, sleep,
            and activity from {sourceName}. Your care team uses this alongside check-in calls to
            spot early signs of post-operative deterioration.
          </Text>
        </View>

        <Glass padded style={{ gap: space.md }}>
          <SourceRow sourceName={sourceName} />

          <View style={styles.bullet}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>
              Read-only — Sentinel never writes to {sourceName}.
            </Text>
          </View>
          <View style={styles.bullet}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>
              Synced every 15 min, encrypted end-to-end.
            </Text>
          </View>
          <View style={styles.bullet}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>
              You can revoke access anytime in system settings.
            </Text>
          </View>
        </Glass>

        <Button
          label="Get started"
          onPress={() => setPhase('sheet')}
          size="lg"
          fullWidth
        />
      </View>

      <HandoffSheet
        visible={phase !== 'intro'}
        loading={phase === 'awaiting-system' || phase === 'verifying'}
        loadingLabel={
          phase === 'verifying' ? 'Checking access\u2026' : 'Opening Health Connect\u2026'
        }
        error={error}
        sourceName={sourceName}
        onContinue={onContinue}
        onClose={() => {
          if (phase === 'awaiting-system' || phase === 'verifying') return;
          setPhase('intro');
          setError(null);
        }}
      />
    </View>
  );
}

function SourceRow({ sourceName }: { sourceName: string }) {
  return (
    <View style={styles.sourceRow}>
      <View style={styles.sourceIcon}>
        <Text style={{ fontSize: 22 }}>❤</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.sourceLabel}>DATA SOURCE</Text>
        <Text style={styles.sourceName}>{sourceName}</Text>
      </View>
    </View>
  );
}

type SheetProps = {
  visible: boolean;
  loading: boolean;
  loadingLabel: string;
  error: string | null;
  sourceName: string;
  onContinue: () => void;
  onClose: () => void;
};

function HandoffSheet({
  visible,
  loading,
  loadingLabel,
  error,
  sourceName,
  onContinue,
  onClose,
}: SheetProps) {
  const translateY = useRef(new Animated.Value(700)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: visible ? 0 : 700,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: visible ? 1 : 0,
        duration: 240,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible]);

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.handle} />
        <Text style={styles.sheetTitle}>Connect to {sourceName}</Text>
        <Text style={styles.sheetBody}>
          {Platform.OS === 'android'
            ? 'When you tap Continue, Android will open the Health Connect settings page so you can choose what to share.'
            : 'When you tap Continue, the Health app will ask which vitals to share.'}
        </Text>

        <View style={styles.steps}>
          <Step
            n={1}
            text={
              Platform.OS === 'android'
                ? 'Tap "Allow all" at the top of the Health Connect screen.'
                : 'Tap "Turn On All" at the top.'
            }
          />
          <Step
            n={2}
            text={
              Platform.OS === 'android'
                ? 'Press the back button or swipe back when you\u2019re done.'
                : 'Tap "Allow" in the top-right corner.'
            }
          />
          <Step n={3} text="Sentinel will pick up where it left off automatically." />
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Button
          label={loading ? loadingLabel : `Continue to ${sourceName}`}
          onPress={onContinue}
          loading={loading}
          fullWidth
          size="lg"
          style={{ marginTop: space.sm }}
        />

        <Button
          label="Not now"
          onPress={onClose}
          variant="ghost"
          disabled={loading}
          fullWidth
        />
      </Animated.View>
    </Modal>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepBadgeText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvasFlat },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.xxl,
  },
  header: { gap: space.xs },
  brand: {
    fontSize: font.kicker.size,
    letterSpacing: 2,
    fontWeight: '700',
    color: palette.accent400,
  },
  title: {
    fontSize: font.hero.size,
    fontWeight: '700',
    color: palette.text,
    letterSpacing: font.hero.letterSpacing,
  },
  subtitle: {
    fontSize: 15,
    color: palette.textMuted,
    lineHeight: 22,
  },

  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: palette.glassBorder,
  },
  sourceIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: 'rgba(244,63,94,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(244,63,94,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: palette.textDim,
    letterSpacing: 1,
  },
  sourceName: {
    fontSize: 16,
    fontWeight: '600',
    color: palette.text,
    marginTop: 2,
  },

  bullet: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.accent400,
    marginTop: 7,
  },
  bulletText: { flex: 1, fontSize: 13, color: palette.textMuted, lineHeight: 19 },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3,6,15,0.72)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0B1220',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: palette.glassBorderStrong,
    paddingHorizontal: space.xl,
    paddingTop: 12,
    paddingBottom: 36,
    gap: space.md,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.glassBorderStrong,
    marginBottom: space.sm,
  },
  sheetTitle: { fontSize: 22, fontWeight: '700', color: palette.text },
  sheetBody: { fontSize: 14, color: palette.textMuted, lineHeight: 20 },

  steps: { gap: space.sm, marginTop: space.xs },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: palette.accent500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: { color: '#F8FAFF', fontWeight: '700', fontSize: 13 },
  stepText: { flex: 1, fontSize: 14, color: palette.text, lineHeight: 20 },

  errorBox: {
    padding: space.md,
    backgroundColor: palette.critBg,
    borderWidth: 1,
    borderColor: palette.critBorder,
    borderRadius: radius.md,
  },
  errorText: { fontSize: 13, color: palette.critText, lineHeight: 18 },
});
