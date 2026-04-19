import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { devLogin, isDevPasskey } from '../../src/auth/pairing';
import { api } from '../../src/api/client';
import type { Patient } from '../../src/api/client';
import {
  AuroraBackground,
  Button,
  Glass,
  font,
  palette,
  radius,
  space,
} from '../../src/components/ui';

// The hackathon demo always speaks for John Chen — the recovered-trajectory
// patient seeded by named_seed.py. We resolve his real id from the backend's
// /api/patients list so we don't have to hardcode a UUID that changes
// between fresh seeds.
const DEMO_PATIENT_NAME = 'John Chen';

export default function PairScreen() {
  const router = useRouter();

  const [passkey, setPasskey] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);

  // Resolved patient (hidden from the UI — we just need the id and name to
  // confirm the demo is wired up, and to surface a friendly "signing in as
  // John Chen" affordance).
  const [demoPatient, setDemoPatient] = useState<Patient | null>(null);
  const [resolveErr, setResolveErr] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);

  const resolveDemoPatient = () => {
    setResolveErr(null);
    setResolving(true);
    api
      .patients(null)
      .then((ps) => {
        const match = ps.find((p) => p.name === DEMO_PATIENT_NAME);
        if (!match) {
          setResolveErr(
            `Backend has no patient named "${DEMO_PATIENT_NAME}". Re-seed via /api/seed-named.`,
          );
          return;
        }
        setDemoPatient(match);
      })
      .catch((e) => setResolveErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setResolving(false));
  };

  useEffect(resolveDemoPatient, []);

  async function onSubmit() {
    if (!demoPatient) {
      Alert.alert(
        'Not ready',
        resolveErr ?? 'Still loading your patient record. Try again in a moment.',
      );
      return;
    }
    if (!isDevPasskey(passkey)) {
      Alert.alert(
        'Wrong passkey',
        "That passkey isn't recognized. Ask your care team for the right one.",
      );
      return;
    }

    setLoading(true);
    const result = await devLogin(demoPatient.id, passkey.trim());
    setLoading(false);

    if (!result.ok) {
      const msg =
        result.error.kind === 'code_invalid_or_expired'
          ? 'The backend rejected that passkey.'
          : result.error.kind === 'network'
            ? `Could not reach the backend: ${result.error.message}`
            : 'Could not start your session.';
      Alert.alert('Sign-in failed', msg);
      return;
    }
    router.replace('/(onboarding)/permissions');
  }

  const initials = demoPatient
    ? demoPatient.name
        .split(' ')
        .map((s) => s[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '';

  return (
    <View style={styles.root}>
      <AuroraBackground />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.container}>
          <View style={styles.headerArea}>
            <Text style={styles.brand}>SENTINEL</Text>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>
              Sign in with the passkey from your care team to continue your recovery check-ins.
            </Text>
          </View>

          <Glass padded style={styles.card}>
            <Text style={styles.label}>SIGNED IN AS</Text>

            {resolving ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={palette.accent400} />
                <Text style={styles.bodyMuted}>Looking up your record…</Text>
              </View>
            ) : resolveErr ? (
              <View style={{ gap: space.sm }}>
                <Text style={styles.error}>{resolveErr}</Text>
                <TouchableOpacity onPress={resolveDemoPatient}>
                  <Text style={styles.link}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : demoPatient ? (
              <View style={styles.identityRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.identityName}>{demoPatient.name}</Text>
                  <Text style={styles.identityMeta}>{demoPatient.surgery_type}</Text>
                </View>
              </View>
            ) : null}

            <Text style={[styles.label, { marginTop: space.lg }]}>PASSKEY</Text>
            <TextInput
              value={passkey}
              onChangeText={setPasskey}
              placeholder="Enter your passkey"
              placeholderTextColor={palette.textDim}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              textContentType="password"
              style={[styles.input, focused && styles.inputFocused]}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              editable={!loading && !!demoPatient}
              onSubmitEditing={onSubmit}
              returnKeyType="go"
              autoFocus
            />

            <Button
              label="Sign in"
              onPress={onSubmit}
              loading={loading}
              disabled={!demoPatient}
              fullWidth
              size="lg"
              style={{ marginTop: space.md }}
            />

            <Text style={styles.hint}>Demo passkey: m</Text>
          </Glass>

          <Text style={styles.footer}>
            End-to-end encrypted · Your care team never sees your raw vitals.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.canvasFlat },
  flex: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: space.xl,
    paddingTop: 80,
    paddingBottom: space.xxxl,
    gap: space.xxl,
    justifyContent: 'center',
  },
  headerArea: { gap: space.xs },
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
  card: { gap: space.sm },
  label: {
    fontSize: font.label.size,
    color: palette.textDim,
    letterSpacing: font.label.letterSpacing,
    fontWeight: '600',
  },
  bodyMuted: { fontSize: 14, color: palette.textMuted },
  error: { fontSize: 13, color: palette.critText },
  link: { fontSize: 14, color: palette.accent300, fontWeight: '600' },

  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: space.sm,
  },

  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(59,130,246,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.22)',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: palette.accent500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#F8FAFF', fontWeight: '700', fontSize: 16 },
  identityName: {
    fontSize: 16,
    fontWeight: '600',
    color: palette.text,
  },
  identityMeta: { fontSize: 12, color: palette.textMuted, marginTop: 2 },

  input: {
    borderWidth: 1,
    borderColor: palette.glassBorderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 14,
    fontSize: 16,
    color: palette.text,
    backgroundColor: 'rgba(10,15,31,0.6)',
  },
  inputFocused: {
    borderColor: palette.accent400,
    backgroundColor: 'rgba(10,15,31,0.85)',
  },
  hint: {
    fontSize: 12,
    color: palette.textDim,
    textAlign: 'center',
    marginTop: space.sm,
  },
  footer: {
    fontSize: 11,
    color: palette.textFaint,
    textAlign: 'center',
    marginTop: space.sm,
  },
});
