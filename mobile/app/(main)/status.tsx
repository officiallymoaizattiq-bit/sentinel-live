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
  loadCredentials,
  type Credentials,
} from '../../src/auth/storage';
import { TrajectoryChart, type TrajectoryPoint } from '../../src/components/TrajectoryChart';
import { useEventStream, type StreamEvent } from '../../src/realtime/useEventStream';
import {
  dismissIncomingCallNotification,
  ensureNotificationPermission,
} from '../../src/notifications/incoming';
import { readLastSyncStatus, runSyncOnce, type LastSyncStatus } from '../../src/sync/task';
import { DashboardTopBar } from '../../src/components/DashboardTopBar';
import { CheckInSummaryCard } from '../../src/components/CheckInSummaryCard';
import {
  Button,
  Glass,
  Screen,
  SeverityChip,
  palette,
  radius,
  scoreToSeverity,
  severityMeta,
  space,
  type Severity,
} from '../../src/components/ui';

// Foreground auto-sync interval. expo-background-fetch's 15-min minimum is
// way too coarse for a live demo, and iOS may never actually fire it. While
// the dashboard is open we just poll every 30s.
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
  const [refreshing, setRefreshing] = useState(false);

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
      } else if (e.type === 'call_scored' || e.type === 'call_completed') {
        // `call_scored` lands first (score computed, no summary yet);
        // `call_completed` lands after Gemini writes summary_patient /
        // summary_nurse. Both require a calls-refetch so the dashboard shows
        // the freshest state — without the call_completed branch the AI
        // summary card stays on "Generating summary…" forever.
        setIncoming(null);
        dismissIncomingCallNotification().catch(() => {});
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

  const totalCalls = calls.length;
  const callsToday = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return calls.filter((c) => new Date(c.called_at) >= start).length;
  }, [calls]);

  const heroSeverity: Severity = severity ?? 'calm';

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
      <DashboardTopBar connected={connected} profileInitials={initials} />

      <KpiStrip
        connected={connected}
        lastSync={last}
        total={totalCalls}
        today={callsToday}
        severity={severity}
      />

      {patient && !loadError ? (
        <Glass tone="strong" padded>
          <View style={styles.heroRow}>
            <View style={styles.heroMain}>
              <View style={styles.heroTitleRow}>
                <Text style={styles.heroName} numberOfLines={2}>
                  {patient.name}
                </Text>
                <SeverityChip
                  severity={heroSeverity}
                  pulse={!!isCritical}
                  label={severityLabel(heroSeverity, isCritical)}
                />
              </View>
              <Text style={styles.heroMeta} numberOfLines={2}>
                {patient.surgery_type ? `${patient.surgery_type} · ` : ''}
                {totalCalls} {totalCalls === 1 ? 'call' : 'calls'} total · {callsToday} today
              </Text>
            </View>
            {latestScore ? (
              <View style={styles.heroRisk}>
                <Text style={styles.heroRiskLabel}>RISK</Text>
                <Text
                  style={[
                    styles.heroRiskNum,
                    { color: severityMeta(heroSeverity).color },
                  ]}
                >
                  {latestScore.deterioration.toFixed(2)}
                </Text>
              </View>
            ) : null}
          </View>
        </Glass>
      ) : null}

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

      {latestScore && severity && (
        <Glass tone={isCritical ? 'crit' : 'default'} padded>
          <View style={styles.latestHeader}>
            <Text style={styles.label}>LATEST CHECK-IN</Text>
            <SeverityChip
              severity={severity}
              label={severityLabel(severity, isCritical)}
            />
          </View>
          <Text
            style={[styles.summary, isCritical && { color: palette.critText }]}
          >
            {latestScore.summary}
          </Text>
          <View style={styles.scoreRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.scoreLabel}>DETERIORATION</Text>
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

      {last_call ? <CheckInSummaryCard call={last_call} /> : null}

      <Glass padded>
        <View style={styles.chartHeader}>
          <Text style={styles.cardTitle}>Trajectory</Text>
          <Text style={styles.cardCaption}>Deterioration score · last check-ins</Text>
        </View>
        <TrajectoryChart points={points} />
      </Glass>
    </Screen>
  );
}

function severityLabel(s: Severity, critical?: boolean): string {
  if (critical) return 'Escalate';
  switch (s) {
    case 'warn':
      return 'Escalating';
    case 'watch':
      return 'Watch';
    case 'crit':
      return 'Escalate';
    default:
      return 'Stable';
  }
}

function KpiStrip({
  connected,
  lastSync,
  total,
  today,
  severity,
}: {
  connected: boolean;
  lastSync: LastSyncStatus | null;
  total: number;
  today: number;
  severity: Severity | null;
}) {
  const statusLabel = severity ? severityLabel(severity) : 'Stable';
  const statusColor = severity ? severityMeta(severity).color : palette.calm;
  const syncText = lastSync ? formatRelative(lastSync.at) : 'never';
  const syncResult = lastSync ? syncLabel(lastSync.result) : 'Waiting';

  return (
    <View style={kpiStyles.row}>
      <KpiTile label="STATUS" value={statusLabel} valueColor={statusColor} />
      <KpiTile
        label="STREAM"
        value={connected ? 'Live' : 'Connecting'}
        valueColor={connected ? palette.calm : palette.watch}
      />
      <KpiTile label="SYNC" value={syncText} hint={syncResult} />
      <KpiTile label="CALLS" value={`${total}`} hint={`${today} today`} />
    </View>
  );
}

function KpiTile({
  label,
  value,
  hint,
  valueColor,
}: {
  label: string;
  value: string;
  hint?: string;
  valueColor?: string;
}) {
  return (
    <View style={kpiStyles.tile}>
      <Text style={kpiStyles.kicker}>{label}</Text>
      <Text
        style={[kpiStyles.value, valueColor ? { color: valueColor } : null]}
        numberOfLines={1}
      >
        {value}
      </Text>
      {hint ? (
        <Text style={kpiStyles.hint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
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
      return 'Permissions';
    case 'partial':
      return 'Partial';
    case 'rate_limited':
      return 'Rate limited';
    case 'revoked':
      return 'Revoked';
    case 'dev_unsigned':
      return 'Demo';
    case 'error':
      return 'Error';
  }
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

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
  },
  heroMain: { flex: 1, minWidth: 0 },
  heroTitleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.xs,
  },
  heroName: {
    fontSize: 22,
    fontWeight: '700',
    color: palette.text,
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  heroMeta: {
    fontSize: 13,
    color: palette.textMuted,
    lineHeight: 18,
  },
  heroRisk: {
    alignItems: 'flex-end',
    paddingTop: 2,
  },
  heroRiskLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: palette.textDim,
    marginBottom: 2,
  },
  heroRiskNum: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },

  label: {
    fontSize: 10,
    color: palette.textDim,
    fontWeight: '700',
    letterSpacing: 1.4,
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
    paddingTop: space.sm,
    marginBottom: space.sm,
  },
  scoreLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
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
    letterSpacing: 1.0,
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
});

const kpiStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.sm,
  },
  tile: {
    flex: 1,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.glassBorder,
    backgroundColor: palette.glassBg,
    minWidth: 0,
  },
  kicker: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.3,
    color: palette.textDim,
    marginBottom: 4,
  },
  value: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.text,
    letterSpacing: -0.2,
  },
  hint: {
    fontSize: 10,
    color: palette.textMuted,
    marginTop: 2,
  },
});
