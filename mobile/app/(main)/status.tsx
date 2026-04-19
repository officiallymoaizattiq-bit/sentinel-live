import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ApiCallError, api, type CallRecord, type Patient } from '../../src/api/client';
import {
  clearCredentials,
  clearSyncCursor,
  loadCredentials,
  type Credentials,
} from '../../src/auth/storage';
import { getHealthAdapter, type HealthDiagnostics } from '../../src/health';
import { TrajectoryChart, type TrajectoryPoint } from '../../src/components/TrajectoryChart';
import { useEventStream, type StreamEvent } from '../../src/realtime/useEventStream';
import {
  dismissIncomingCallNotification,
  ensureNotificationPermission,
  showIncomingCallNotification,
} from '../../src/notifications/incoming';
import { sendDemoVitals } from '../../src/sync/demo';
import { readLastSyncStatus, runSyncOnce, type LastSyncStatus } from '../../src/sync/task';
import {
  Button,
  Glass,
  LiveBadge,
  Screen,
  SeverityChip,
  font,
  palette,
  radius,
  scoreToSeverity,
  severityMeta,
  space,
} from '../../src/components/ui';

// Foreground auto-sync interval. expo-background-fetch's 15-min minimum is
// way too coarse for a live demo, and iOS may never actually fire it. While
// the dashboard is open we just poll every 30s — cheap, predictable, and
// matches what a clinician demoing the app expects to see.
const FOREGROUND_SYNC_INTERVAL_MS = 30_000;

type IncomingCall = { at: string; mode: 'phone' | 'widget' };

export default function PatientDashboard() {
  const router = useRouter();
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loadingPatient, setLoadingPatient] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [last, setLast] = useState<LastSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [demoSending, setDemoSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [diag, setDiag] = useState<HealthDiagnostics | null>(null);

  const credsRef = useRef<Credentials | null>(null);
  credsRef.current = creds;

  const handleAuthFailure = useCallback(async () => {
    await clearCredentials();
    setCreds(null);
    router.replace('/(onboarding)/pair');
  }, [router]);

  const loadPatient = useCallback(
    async (c: Credentials) => {
      try {
        const p = await api.getPatient(c, c.patientId);
        setPatient(p);
        setLoadError(p ? null : 'Patient record not found on backend.');
      } catch (e) {
        if (e instanceof ApiCallError && e.error.kind === 'auth') {
          await handleAuthFailure();
          return;
        }
        setLoadError(formatError(e));
      } finally {
        setLoadingPatient(false);
      }
    },
    [handleAuthFailure],
  );

  const loadCalls = useCallback(
    async (c: Credentials) => {
      try {
        const cs = await api.getCalls(c, c.patientId);
        setCalls(cs);
      } catch (e) {
        if (e instanceof ApiCallError && e.error.kind === 'auth') {
          await handleAuthFailure();
          return;
        }
      }
    },
    [handleAuthFailure],
  );

  const refreshAll = useCallback(async () => {
    const [c, s] = await Promise.all([loadCredentials(), readLastSyncStatus()]);
    setCreds(c);
    setLast(s);
    if (c) {
      await Promise.all([loadPatient(c), loadCalls(c)]);
    } else {
      setLoadingPatient(false);
    }
  }, [loadPatient, loadCalls]);

  useFocusEffect(
    useCallback(() => {
      refreshAll();
    }, [refreshAll]),
  );

  useEffect(() => {
    if (!creds) return;
    let cancelled = false;
    const tick = async () => {
      try {
        await runSyncOnce();
      } catch {
        // best-effort
      }
      if (cancelled) return;
      const s = await readLastSyncStatus();
      if (!cancelled) setLast(s);
      try {
        const d = await getHealthAdapter().diagnose();
        if (!cancelled) setDiag(d);
      } catch {
        // ignore
      }
    };
    tick();
    const id = setInterval(tick, FOREGROUND_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [creds]);

  useEffect(() => {
    if (!creds) return;
    ensureNotificationPermission().catch(() => {});
  }, [creds]);

  const onEvent = useCallback(
    (e: StreamEvent) => {
      const c = credsRef.current;
      if (!c) return;
      if ('patient_id' in e && e.patient_id !== c.patientId) return;

      if (e.type === 'pending_call') {
        setIncoming({ at: e.at, mode: e.mode });
        showIncomingCallNotification({
          patientId: c.patientId,
          mode: e.mode,
          at: e.at,
        }).catch(() => {});
      } else if (e.type === 'call_scored') {
        loadCalls(c);
      }
    },
    [loadCalls],
  );

  const { connected } = useEventStream(creds, onEvent);

  const points: TrajectoryPoint[] = useMemo(
    () =>
      calls
        .filter(
          (c): c is CallRecord & { score: NonNullable<CallRecord['score']> } =>
            c.score !== null,
        )
        .map((c) => ({
          t: new Date(c.called_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
          deterioration: c.score.deterioration,
        })),
    [calls],
  );
  const last_call = calls.length > 0 ? calls[calls.length - 1] : null;
  const latestScore = last_call?.score ?? null;
  const severity = latestScore ? scoreToSeverity(latestScore.deterioration) : null;
  const isCritical = latestScore?.recommended_action === 'suggest_911';

  const onAnswer = () => {
    const mode = incoming?.mode ?? 'phone';
    setIncoming(null);
    dismissIncomingCallNotification().catch(() => {});
    router.push({ pathname: '/(main)/call', params: { mode } });
  };

  const onDismiss = () => {
    setIncoming(null);
    dismissIncomingCallNotification().catch(() => {});
  };

  const onPullRefresh = async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  };

  const onSyncNow = async () => {
    setSyncing(true);
    try {
      await runSyncOnce().catch(() => {});
      const s = await readLastSyncStatus();
      setLast(s);
    } finally {
      setSyncing(false);
    }
  };

  const onBackfill = async () => {
    setSyncing(true);
    try {
      await clearSyncCursor();
      await runSyncOnce().catch(() => {});
      const s = await readLastSyncStatus();
      setLast(s);
      try {
        const d = await getHealthAdapter().diagnose();
        setDiag(d);
      } catch {
        // ignore
      }
    } finally {
      setSyncing(false);
    }
  };

  const onOpenHealthSettings = () => {
    try {
      getHealthAdapter().openSettings();
    } catch {
      // no-op
    }
  };

  const onSendDemoVitals = async () => {
    if (!creds || demoSending) return;
    setDemoSending(true);
    try {
      const result = await sendDemoVitals(creds);
      const now = new Date().toISOString();
      if (result.ok) {
        setLast({
          at: now,
          result: 'ok',
          acceptedTotal: result.accepted,
          flaggedClockSkewTotal: 0,
          message: 'demo vitals',
        });
      } else {
        setLast({
          at: now,
          result: 'error',
          message: `demo vitals failed: ${result.message}`,
        });
      }
    } finally {
      setDemoSending(false);
    }
  };

  if (!creds) {
    return (
      <Screen scroll={false} padded={false}>
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent400} />
        </View>
      </Screen>
    );
  }

  const initials =
    patient?.name
      .split(' ')
      .map((s) => s[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() ?? '—';

  return (
    <Screen refreshing={refreshing} onRefresh={onPullRefresh}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>YOUR PATIENT PORTAL</Text>
          <Text style={styles.h1}>{patient?.name ?? 'Patient'}</Text>
          {patient?.surgery_type ? (
            <Text style={styles.subtle}>{patient.surgery_type}</Text>
          ) : null}
        </View>
        <LiveBadge connected={connected} />
      </View>

      {loadingPatient && !patient ? (
        <Glass padded>
          <View style={{ alignItems: 'center' }}>
            <ActivityIndicator color={palette.accent400} />
          </View>
        </Glass>
      ) : null}

      {loadError ? (
        <Glass tone="crit" padded>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity onPress={refreshAll} style={{ marginTop: space.sm }}>
            <Text style={styles.linkInline}>Retry</Text>
          </TouchableOpacity>
        </Glass>
      ) : null}

      {/* Incoming call banner — green accented to match the web's answer affordance */}
      {incoming && (
        <Glass tone="calm" padded>
          <View style={styles.incomingHeader}>
            <View style={styles.pulseDot} />
            <Text style={styles.incomingTitle}>Sentinel is calling you</Text>
          </View>
          <Text style={styles.incomingBody}>
            Your care team would like a quick check-in.
          </Text>
          <View style={styles.incomingActions}>
            <Button label="Answer" onPress={onAnswer} variant="success" style={{ flex: 1 }} />
            <Button label="Dismiss" onPress={onDismiss} variant="outline" style={{ flex: 1 }} />
          </View>
        </Glass>
      )}

      {/* Hero status tile — mirrors the web's "Latest check-in" hero */}
      {latestScore && severity && (
        <Glass tone={isCritical ? 'crit' : 'default'} padded>
          <View style={styles.latestHeader}>
            <Text style={styles.label}>LATEST CHECK-IN</Text>
            <SeverityChip
              severity={severity}
              label={
                isCritical
                  ? 'Escalate'
                  : severity === 'warn'
                    ? 'Escalating'
                    : severity === 'watch'
                      ? 'Watch'
                      : 'Stable'
              }
            />
          </View>
          <Text
            style={[styles.summary, isCritical && { color: palette.critText }]}
          >
            {latestScore.summary}
          </Text>
          <View style={styles.scoreRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.scoreLabel}>Deterioration</Text>
              <View style={styles.scoreValueRow}>
                <Text
                  style={[
                    styles.scoreValue,
                    { color: severityMeta(severity).color },
                  ]}
                >
                  {latestScore.deterioration.toFixed(2)}
                </Text>
                <Text style={styles.scoreUnit}>/ 1.00</Text>
              </View>
            </View>
            <View style={styles.scoreMini}>
              <Text style={styles.scoreMiniLabel}>qSOFA</Text>
              <Text style={styles.scoreMiniValue}>{latestScore.qsofa}</Text>
            </View>
            <View style={styles.scoreMini}>
              <Text style={styles.scoreMiniLabel}>NEWS2</Text>
              <Text style={styles.scoreMiniValue}>{latestScore.news2}</Text>
            </View>
          </View>
          <Text style={styles.timestamp}>
            {new Date(last_call!.called_at).toLocaleString()}
          </Text>
          {isCritical ? (
            <Text style={styles.criticalNote}>
              Recommended action: contact emergency services.
            </Text>
          ) : null}
        </Glass>
      )}

      {/* Trajectory */}
      <Glass padded>
        <View style={styles.chartHeader}>
          <Text style={styles.cardTitle}>Trajectory</Text>
          <Text style={styles.cardCaption}>Deterioration score · last check-ins</Text>
        </View>
        <TrajectoryChart points={points} />
        <View style={styles.legendRow}>
          <LegendItem color={palette.calm} label="0 – 0.3 Stable" />
          <LegendItem color={palette.watch} label="0.3 – 0.6 Watch" />
          <LegendItem color={palette.crit} label="0.6+ Escalate" />
        </View>
      </Glass>

      {/* Vitals sync tile */}
      <Glass padded>
        <View style={styles.chartHeader}>
          <Text style={styles.cardTitle}>Vitals sync</Text>
          <Text style={styles.cardCaption}>Auto every 30s</Text>
        </View>
        {last ? (
          <View style={{ gap: 4 }}>
            <Text style={styles.body}>
              Last sync {formatRelative(last.at)}
            </Text>
            <Text style={[styles.body, { color: syncResultColor(last.result) }]}>
              {syncLabel(last.result)}
              {last.acceptedTotal != null
                ? ` — ${last.acceptedTotal} new sample${last.acceptedTotal === 1 ? '' : 's'} uploaded`
                : ''}
              {last.flaggedClockSkewTotal
                ? ` (${last.flaggedClockSkewTotal} clock-skew)`
                : ''}
            </Text>
            {last.message ? <Text style={styles.muted}>{last.message}</Text> : null}
            {last.result === 'ok' && (last.acceptedTotal ?? 0) === 0 ? (
              <Text style={styles.muted}>
                "0 new" just means nothing arrived since the last sync. See Health Connect below
                for what's currently in the store.
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.muted}>No sync has run yet.</Text>
        )}

        {diag ? (
          <View style={styles.diagBox}>
            <Text style={styles.label}>HEALTH CONNECT · LAST 24H</Text>
            <View style={styles.diagRow}>
              <Text style={styles.diagKey}>SDK</Text>
              <Text style={styles.diagVal}>{diag.sdkStatus}</Text>
            </View>
            <View style={styles.diagRow}>
              <Text style={styles.diagKey}>Granted</Text>
              <Text style={styles.diagVal}>
                {diag.grantedScopes.length} permission
                {diag.grantedScopes.length === 1 ? '' : 's'}
              </Text>
            </View>
            {Object.keys(diag.lastQueryCountsByKind).length > 0 ? (
              <View style={styles.diagRow}>
                <Text style={styles.diagKey}>Samples</Text>
                <Text style={[styles.diagVal, { flexShrink: 1 }]}>
                  {Object.entries(diag.lastQueryCountsByKind)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => `${k}=${n}`)
                    .join(', ') || 'nothing visible'}
                </Text>
              </View>
            ) : null}
            {isLikelyBridgeEmpty(last, diag) ? (
              <View style={styles.diagHintBox}>
                <Text style={styles.diagHintText}>
                  Health Connect shows 0 samples in the last 24h. On Samsung, open Samsung
                  Health → Settings → Health Connect and turn on the data types you want
                  shared (Heart rate, Oxygen saturation, etc).
                </Text>
              </View>
            ) : null}
            <TouchableOpacity onPress={onOpenHealthSettings}>
              <Text style={styles.linkInline}>Open Health Connect ↗</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.btnRow}>
          <Button
            label="Sync now"
            onPress={onSyncNow}
            loading={syncing}
            style={{ flex: 1 }}
          />
          <Button
            label="Backfill 24h"
            onPress={onBackfill}
            loading={syncing}
            variant="outline"
            style={{ flex: 1 }}
          />
        </View>

        <Button
          label="Send synthetic test vitals"
          onPress={onSendDemoVitals}
          loading={demoSending}
          variant="ghost"
          fullWidth
        />

        <Text style={styles.muted}>
          "Backfill 24h" resets the sync cursor and pulls everything from Health Connect for
          the last day. "Send synthetic test vitals" injects fake samples for offline demos.
        </Text>
      </Glass>

      <TouchableOpacity
        onPress={() => router.push('/(main)/settings')}
        style={styles.settingsLink}
      >
        <Text style={styles.linkInline}>⚙  Settings</Text>
      </TouchableOpacity>
    </Screen>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function formatError(e: unknown): string {
  if (e instanceof ApiCallError) {
    if (e.error.kind === 'http') return `Backend error (${e.error.status}). Pull to retry.`;
    if (e.error.kind === 'network')
      return 'Could not reach backend. Check your connection.';
  }
  return e instanceof Error ? e.message : 'Unknown error';
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: palette.accent500,
    borderWidth: 1,
    borderColor: palette.accent600,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#F8FAFF', fontWeight: '700', fontSize: 18 },
  kicker: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: palette.accent400,
    marginBottom: 2,
  },
  h1: {
    fontSize: font.h1.size,
    fontWeight: '700',
    color: palette.text,
    letterSpacing: font.h1.letterSpacing,
  },
  subtle: { fontSize: 13, color: palette.textMuted, marginTop: 2 },

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

  errorText: { fontSize: 13, color: palette.critText, lineHeight: 19 },

  incomingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: 4,
  },
  pulseDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: palette.calm,
    shadowColor: palette.calm,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  incomingTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: palette.calmText,
  },
  incomingBody: {
    fontSize: 13,
    color: palette.textMuted,
    marginTop: 2,
    marginBottom: space.md,
  },
  incomingActions: { flexDirection: 'row', gap: space.sm },

  latestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  summary: {
    fontSize: 17,
    color: palette.text,
    lineHeight: 24,
    marginBottom: space.md,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.md,
    paddingVertical: space.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.glassBorder,
    marginBottom: space.sm,
  },
  scoreLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.0,
    color: palette.textDim,
    marginBottom: 2,
  },
  scoreValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  scoreValue: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5 },
  scoreUnit: { fontSize: 13, color: palette.textDim },
  scoreMini: {
    alignItems: 'flex-end',
  },
  scoreMiniLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: palette.textDim,
    marginBottom: 2,
  },
  scoreMiniValue: { fontSize: 20, fontWeight: '700', color: palette.text },
  timestamp: { fontSize: 12, color: palette.textDim },
  criticalNote: {
    marginTop: space.sm,
    fontSize: 13,
    color: palette.critText,
    fontWeight: '600',
  },

  chartHeader: { marginBottom: space.sm },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: palette.text,
  },
  cardCaption: { fontSize: 12, color: palette.textDim, marginTop: 2 },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginTop: space.sm,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontSize: 11, color: palette.textMuted },

  body: { fontSize: 14, color: palette.text },
  muted: { fontSize: 12, color: palette.textDim, lineHeight: 17 },

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

  settingsLink: {
    alignSelf: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
  },
});
