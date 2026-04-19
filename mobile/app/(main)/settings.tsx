import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { config } from '../../src/config';
import { clearCredentials } from '../../src/auth/storage';
import { unregisterBackgroundSync } from '../../src/sync/task';
import {
  Button,
  Glass,
  Screen,
  font,
  palette,
  radius,
  space,
} from '../../src/components/ui';

export default function SettingsScreen() {
  const router = useRouter();

  function onUnpair() {
    Alert.alert(
      'Unpair this device?',
      'You will need a new pairing code from your care team to reconnect.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair',
          style: 'destructive',
          onPress: async () => {
            await unregisterBackgroundSync().catch(() => {});
            await clearCredentials();
            router.replace('/(onboarding)/pair');
          },
        },
      ],
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.kicker}>ACCOUNT</Text>
        <Text style={styles.h1}>Settings</Text>
        <Text style={styles.subtle}>
          Connection info and device management for your Sentinel session.
        </Text>
      </View>

      <Glass padded>
        <Row label="BACKEND" value={config.apiUrl} mono />
        <Divider />
        <Row label="APP VERSION" value={config.appVersion} />
        <Divider />
        <Row label="SYNC INTERVAL" value={`${config.syncIntervalMinutes} minutes`} />
      </Glass>

      <Glass padded style={{ gap: space.sm }}>
        <Text style={styles.cardTitle}>Device</Text>
        <Text style={styles.cardCaption}>
          Removes the stored credentials and stops background sync. You'll need a fresh
          passkey from your care team to pair again.
        </Text>
        <Button
          label="Unpair this device"
          onPress={onUnpair}
          variant="danger"
          fullWidth
          style={{ marginTop: space.sm }}
        />
      </Glass>

      <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
        <Text style={styles.link}>← Back</Text>
      </TouchableOpacity>
    </Screen>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]}>{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  header: { gap: space.xs, marginBottom: space.xs },
  kicker: {
    fontSize: font.kicker.size,
    letterSpacing: font.kicker.letterSpacing,
    fontWeight: '700',
    color: palette.accent400,
  },
  h1: {
    fontSize: font.h1.size,
    fontWeight: '700',
    color: palette.text,
    letterSpacing: font.h1.letterSpacing,
  },
  subtle: { fontSize: 14, color: palette.textMuted, lineHeight: 20 },

  row: { paddingVertical: space.sm, gap: 4 },
  rowLabel: {
    fontSize: 10,
    color: palette.textDim,
    fontWeight: '700',
    letterSpacing: 1,
  },
  rowValue: { fontSize: 15, color: palette.text },
  mono: {
    fontFamily: 'Menlo',
    fontSize: 13,
    color: palette.accent300,
  },
  divider: {
    height: 1,
    backgroundColor: palette.glassBorder,
  },

  cardTitle: { fontSize: 16, fontWeight: '600', color: palette.text },
  cardCaption: { fontSize: 13, color: palette.textMuted, lineHeight: 19 },

  backLink: {
    alignSelf: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
  },
  link: {
    fontSize: 15,
    color: palette.accent300,
    fontWeight: '600',
  },
});
