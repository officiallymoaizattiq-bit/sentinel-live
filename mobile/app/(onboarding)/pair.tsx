import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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

// The hackathon demo always speaks for John Chen — the recovered-trajectory
// patient seeded by named_seed.py. We resolve his real id from the backend's
// /api/patients list so we don't have to hardcode a UUID that changes
// between fresh seeds.
const DEMO_PATIENT_NAME = 'John Chen';

export default function PairScreen() {
  const router = useRouter();

  const [passkey, setPasskey] = useState('');
  const [loading, setLoading] = useState(false);

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
      .catch((e) =>
        setResolveErr(e instanceof Error ? e.message : String(e)),
      )
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerArea}>
          <Text style={styles.brand}>Sentinel</Text>
          <Text style={styles.title}>Sign in to your patient portal</Text>
          <Text style={styles.subtitle}>
            Enter the passkey from your care team to continue.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Signed in as</Text>
          {resolving ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator />
              <Text style={styles.bodyMuted}>Looking up your record…</Text>
            </View>
          ) : resolveErr ? (
            <View>
              <Text style={styles.error}>{resolveErr}</Text>
              <TouchableOpacity
                onPress={resolveDemoPatient}
                style={styles.linkButton}
              >
                <Text style={styles.link}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : demoPatient ? (
            <View style={styles.identityRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {demoPatient.name
                    .split(' ')
                    .map((s) => s[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.identityName}>{demoPatient.name}</Text>
                <Text style={styles.identityMeta}>
                  {demoPatient.surgery_type}
                </Text>
              </View>
            </View>
          ) : null}

          <Text style={[styles.label, { marginTop: 16 }]}>Passkey</Text>
          <TextInput
            value={passkey}
            onChangeText={setPasskey}
            placeholder="Enter your passkey"
            placeholderTextColor="#999"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            textContentType="password"
            style={styles.input}
            editable={!loading && !!demoPatient}
            onSubmitEditing={onSubmit}
            returnKeyType="go"
            autoFocus
          />

          <TouchableOpacity
            onPress={onSubmit}
            disabled={loading || !demoPatient}
            style={[
              styles.button,
              (loading || !demoPatient) && styles.buttonDisabled,
            ]}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.hint}>Demo passkey: m</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f7' },
  scroll: { padding: 24, paddingTop: 80, paddingBottom: 48, gap: 24 },
  headerArea: { gap: 6, alignItems: 'flex-start' },
  brand: {
    fontSize: 13,
    color: '#0a84ff',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  title: { fontSize: 26, fontWeight: '700', color: '#111' },
  subtitle: { fontSize: 15, color: '#555', lineHeight: 21 },
  card: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  label: {
    fontSize: 12,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  bodyMuted: { fontSize: 14, color: '#666' },
  error: { fontSize: 13, color: '#cf222e' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f4f7fb',
    borderWidth: 1,
    borderColor: '#e6ecf3',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0a84ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: 'white', fontWeight: '700', fontSize: 16 },
  identityName: { fontSize: 16, fontWeight: '600', color: '#111' },
  identityMeta: { fontSize: 12, color: '#666', marginTop: 2 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
    backgroundColor: '#fafafa',
  },
  button: {
    backgroundColor: '#0a84ff',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 16 },
  hint: { fontSize: 12, color: '#888', textAlign: 'center', marginTop: 4 },
  link: { fontSize: 14, color: '#0a84ff', fontWeight: '500' },
  linkButton: { paddingVertical: 6 },
});
