import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { config } from '../config';
import { clearCredentials } from '../auth/storage';
import { unregisterBackgroundSync } from '../sync/task';
import type { LastSyncStatus } from '../sync/task';
import type { HealthDiagnostics } from '../health';
import { Button, Glass, font, palette, radius, space } from './ui';

export type HealthToolsProps = {
  last: LastSyncStatus | null;
  diag: HealthDiagnostics | null;
  onBackfill: () => void | Promise<void>;
  onSendDemoVitals: () => void | Promise<void>;
  onOpenHealthSettings: () => void;
  syncing: boolean;
  demoSending: boolean;
};

type Props = {
  onClose: () => void;
  /** When set, shows vitals / Health Connect tools (dashboard modal). */
  healthTools?: HealthToolsProps | null;
  closeLabel?: string;
};

export function SettingsPanel({ onClose, healthTools, closeLabel = 'Done' }: Props) {
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
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
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

      {healthTools ? (
        <Glass padded style={{ gap: space.sm }}>
          <Text style={styles.cardTitle}>Vitals & Health Connect</Text>
          <Text style={styles.cardCaption}>
            Manual sync and diagnostics. Background sync still runs on its own schedule.
          </Text>
          {healthTools.last ? (
            <View style={{ gap: 4 }}>
              <Text style={styles.body}>
                Last sync {formatRelative(healthTools.last.at)}
              </Text>
              <Text
                style={[styles.body, { color: syncResultColor(healthTools.last.result) }]}
              >
                {syncLabel(healthTools.last.result)}
                {healthTools.last.acceptedTotal != null
                  ? ` — ${healthTools.last.acceptedTotal} new sample${healthTools.last.acceptedTotal === 1 ? '' : 's'}`
                  : ''}
                {healthTools.last.flaggedClockSkewTotal
                  ? ` (${healthTools.last.flaggedClockSkewTotal} clock-skew)`
                  : ''}
              </Text>
              {healthTools.last.message ? (
                <Text style={styles.muted}>{healthTools.last.message}</Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.muted}>No sync has run yet.</Text>
          )}

          {healthTools.diag ? (
            <View style={styles.diagBox}>
              <Text style={styles.label}>HEALTH CONNECT · LAST 24H</Text>
              <View style={styles.diagRow}>
                <Text style={styles.diagKey}>SDK</Text>
                <Text style={styles.diagVal}>{healthTools.diag.sdkStatus}</Text>
              </View>
              <View style={styles.diagRow}>
                <Text style={styles.diagKey}>Granted</Text>
                <Text style={styles.diagVal}>
                  {healthTools.diag.grantedScopes.length} permission
                  {healthTools.diag.grantedScopes.length === 1 ? '' : 's'}
                </Text>
              </View>
              {Object.keys(healthTools.diag.lastQueryCountsByKind).length > 0 ? (
                <View style={styles.diagRow}>
                  <Text style={styles.diagKey}>Samples</Text>
                  <Text style={[styles.diagVal, { flexShrink: 1 }]}>
                    {Object.entries(healthTools.diag.lastQueryCountsByKind)
                      .filter(([, n]) => n > 0)
                      .map(([k, n]) => `${k}=${n}`)
                      .join(', ') || 'nothing visible'}
                  </Text>
                </View>
              ) : null}
              {isLikelyBridgeEmpty(healthTools.last, healthTools.diag) ? (
                <View style={styles.diagHintBox}>
                  <Text style={styles.diagHintText}>
                    Health Connect shows 0 samples in the last 24h. On Samsung, open Samsung
                    Health → Settings → Health Connect and turn on the data types you want
                    shared (Heart rate, Oxygen saturation, etc).
                  </Text>
                </View>
              ) : null}
              <TouchableOpacity onPress={healthTools.onOpenHealthSettings}>
                <Text style={styles.linkInline}>Open Health Connect ↗</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.btnRow}>
            <Button
              label="Backfill 24h"
              onPress={() => void healthTools.onBackfill()}
              loading={healthTools.syncing}
              variant="outline"
              style={{ flex: 1 }}
            />
            <Button
              label="Synthetic vitals"
              onPress={() => void healthTools.onSendDemoVitals()}
              loading={healthTools.demoSending}
              variant="ghost"
              style={{ flex: 1 }}
            />
          </View>
        </Glass>
      ) : null}

      <Glass padded style={{ gap: space.sm }}>
        <Text style={styles.cardTitle}>Device</Text>
        <Text style={styles.cardCaption}>
          Removes stored credentials and stops background sync. You will need a fresh passkey
          from your care team to pair again.
        </Text>
        <Button
          label="Unpair this device"
          onPress={onUnpair}
          variant="danger"
          fullWidth
          style={{ marginTop: space.sm }}
        />
      </Glass>

      <TouchableOpacity onPress={onClose} style={styles.doneLink}>
        <Text style={styles.link}>{closeLabel}</Text>
      </TouchableOpacity>
    </ScrollView>
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

function syncLabel(r: LastSyncStatus['result']): string {
  switch (r) {
    case 'ok':
      return 'Healthy';
    case 'no_creds':
      return 'Not paired';
    case 'no_perms':
      return 'Health permissions missing';
    case 'partial':
      return 'Partial — some chunks failed';
    case 'rate_limited':
      return 'Rate limited — will retry';
    case 'revoked':
      return 'Device unpaired by care team';
    case 'dev_unsigned':
      return 'Demo session — uploads not authorized';
    case 'error':
      return 'Error';
  }
}

function syncResultColor(r: LastSyncStatus['result']): string {
  if (r === 'ok') return palette.calm;
  if (r === 'partial' || r === 'rate_limited' || r === 'dev_unsigned') return palette.watch;
  return palette.crit;
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isLikelyBridgeEmpty(
  last: LastSyncStatus | null,
  diag: HealthDiagnostics,
): boolean {
  if (!last || last.result !== 'ok') return false;
  if ((last.acceptedTotal ?? 0) > 0) return false;
  if (diag.grantedScopes.length === 0) return false;
  const total = Object.values(diag.lastQueryCountsByKind).reduce((a, b) => a + b, 0);
  return total === 0;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { gap: space.lg, paddingBottom: space.huge },
  header: { gap: space.xs },
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
  body: { fontSize: 14, color: palette.text },
  muted: { fontSize: 12, color: palette.textDim, lineHeight: 17 },
  label: {
    fontSize: 10,
    color: palette.textDim,
    fontWeight: '700',
    letterSpacing: 1.1,
    marginBottom: space.sm,
  },
  linkInline: {
    fontSize: 14,
    color: palette.accent300,
    fontWeight: '600',
  },
  diagBox: {
    marginTop: space.md,
    padding: space.md,
    backgroundColor: 'rgba(10,15,31,0.6)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    gap: space.xs,
  },
  diagRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  diagKey: { fontSize: 12, color: palette.textDim, fontWeight: '600' },
  diagVal: { fontSize: 12, color: palette.text, textAlign: 'right' },
  diagHintBox: {
    marginTop: space.sm,
    padding: space.sm,
    backgroundColor: palette.watchBg,
    borderWidth: 1,
    borderColor: palette.watchBorder,
    borderRadius: radius.sm,
  },
  diagHintText: { fontSize: 12, color: palette.watchText, lineHeight: 17 },
  btnRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.md,
  },
  doneLink: {
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
