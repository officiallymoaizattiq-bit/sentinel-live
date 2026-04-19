import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
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
        // Calls failure is non-fatal — keep the previous list.
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

  // Foreground auto-sync. Runs runSyncOnce() on a fixed interval while the
  // dashboard is mounted, plus immediately on mount, so the demo doesn't
  // depend on the user remembering to tap "Sync now". expo-background-fetch
  // still handles the killed-app case (registered in _layout.tsx).
  useEffect(() => {
    if (!creds) return;
    let cancelled = false;
    const tick = async () => {
      try {
        await runSyncOnce();
      } catch {
        // best-effort; runSyncOnce already writes a status entry on error
      }
      if (cancelled) return;
      const s = await readLastSyncStatus();
      if (!cancelled) setLast(s);
      // Refresh the per-type diagnostics alongside the sync status. This is
      // the bit that turns "OK — 0 samples" into something actionable
      // ("Health Connect has 0 heart_rate, 0 SpO2 — check Samsung Health
      // sync"). diagnose() is cheap (no record reads), safe to call on
      // every tick.
      try {
        const d = await getHealthAdapter().diagnose();
        if (!cancelled) setDiag(d);
      } catch {
        // ignore; the dashboard handles a null diag.
      }
    };
    tick(); // immediate
    const id = setInterval(tick, FOREGROUND_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [creds]);

  // Ask for notification permission once we know the user has paired. This
  // is independent of the call flow itself — we want the heads-up
  // notification ready BEFORE the first incoming call arrives, otherwise
  // the SSE event fires and the OS silently drops the notification.
  useEffect(() => {
    if (!creds) return;
    ensureNotificationPermission().catch(() => {});
  }, [creds]);

  // SSE event handler. Filter to this patient_id client-side, mirroring the
  // web /patient view (the /api/stream endpoint is not per-patient today).
  const onEvent = useCallback(
    (e: StreamEvent) => {
      const c = credsRef.current;
      if (!c) return;
      if ('patient_id' in e && e.patient_id !== c.patientId) return;

      if (e.type === 'pending_call') {
        setIncoming({ at: e.at, mode: e.mode });
        // Fire the heads-up notification regardless of foreground state.
        // The notification handler we set in incoming.ts forces the banner
        // to display even when the dashboard is open, so the user gets
        // the same "ringing" affordance whether they're looking at the
        // app or have it backgrounded.
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
        .filter((c): c is CallRecord & { score: NonNullable<CallRecord['score']> } => c.score !== null)
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
  const isCritical = last_call?.score?.recommended_action === 'suggest_911';

  const onAnswer = () => {
    const mode = incoming?.mode ?? 'phone';
    setIncoming(null);
    dismissIncomingCallNotification().catch(() => {});
    // Push the dedicated full-screen call route. The route owns the
    // ConversationProvider lifecycle from here, including the post-call
    // vitals batch flush, so the dashboard doesn't need to track call
    // state itself any more.
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

  // Wipes the sync cursor and immediately re-runs sync. The next pass
  // starts from `now - initialLookbackMinutes` (24h by default), so any
  // historical data sitting in Health Connect that arrived after the
  // cursor advanced will get backfilled. Useful when the user can see
  // 7000+ HR samples in the diagnostics line but "Last sync — 0 samples"
  // because the cursor has already moved past them.
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
      // No-op: adapter may not be available on simulator/preview.
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
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />}
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>{patient?.name ?? 'Patient'}</Text>
          <Text style={styles.subtle}>Your recent check-ins</Text>
        </View>
        <View style={[styles.badge, connected ? styles.badgeLive : styles.badgeConnecting]}>
          <Text style={connected ? styles.badgeLiveText : styles.badgeConnectingText}>
            {connected ? '● live' : '● connecting'}
          </Text>
        </View>
      </View>

      {loadingPatient && !patient ? (
        <View style={[styles.card, { alignItems: 'center' }]}>
          <ActivityIndicator />
        </View>
      ) : null}

      {loadError ? (
        <View style={[styles.card, styles.cardWarn]}>
          <Text style={styles.warnText}>{loadError}</Text>
          <TouchableOpacity onPress={refreshAll}>
            <Text style={styles.linkInline}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Incoming call banner. The OS-level heads-up notification is the
          primary affordance — this in-app panel is the redundant fallback
          for when the dashboard is already open and you'd rather tap a
          green button than reach for the notification shade. */}
      {incoming && (
        <View style={styles.incomingCard}>
          <Text style={styles.incomingTitle}>Sentinel is calling you</Text>
          <Text style={styles.incomingBody}>
            Your care team would like a quick check-in.
          </Text>
          <View style={styles.incomingActions}>
            <TouchableOpacity
              style={styles.answerBtn}
              onPress={onAnswer}
              accessibilityRole="button"
            >
              <Text style={styles.answerBtnText}>Answer</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dismissBtn}
              onPress={onDismiss}
              accessibilityRole="button"
            >
              <Text style={styles.dismissBtnText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Latest check-in */}
      {last_call?.score && (
        <View style={[styles.card, isCritical && styles.cardCritical]}>
          <Text style={styles.cardLabel}>Latest check-in</Text>
          <Text style={[styles.summary, isCritical && styles.summaryCritical]}>
            {last_call.score.summary}
          </Text>
          <Text style={styles.subtle}>
            {new Date(last_call.called_at).toLocaleString()}
          </Text>
          {isCritical ? (
            <Text style={styles.criticalNote}>
              Recommended action: contact emergency services.
            </Text>
          ) : null}
        </View>
      )}

      {/* Trajectory */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Trend</Text>
        <TrajectoryChart points={points} />
      </View>

      {/* Sync status (smaller, debug-ish) */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Vitals sync (auto every 30s)</Text>
        {last ? (
          <>
            <Text style={styles.body}>
              Last sync: {new Date(last.at).toLocaleString()}
            </Text>
            <Text style={[styles.body, syncResultColor(last.result)]}>
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
                "0 new" just means nothing arrived since the last sync —
                see the Health Connect totals below for the full picture.
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.muted}>No sync has run yet.</Text>
        )}

        {/* Health Connect diagnostics. Shows what's actually present in
            the local Health Connect store over the last 24h, independent
            of the sync cursor. This is the source-of-truth view: if these
            counts are non-zero, the Samsung Health → Health Connect bridge
            is working; if "Last sync" still shows 0, the cursor has just
            moved past those records and a Backfill will pull them. */}
        {diag ? (
          <View style={styles.diagBox}>
            <Text style={styles.diagHeading}>Health Connect (last 24h)</Text>
            <Text style={styles.diagLine}>SDK: {diag.sdkStatus}</Text>
            <Text style={styles.diagLine}>
              Granted: {diag.grantedScopes.length} permission
              {diag.grantedScopes.length === 1 ? '' : 's'}
            </Text>
            {Object.keys(diag.lastQueryCountsByKind).length > 0 ? (
              <Text style={styles.diagLine}>
                Samples by type:{' '}
                {Object.entries(diag.lastQueryCountsByKind)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => `${k}=${n}`)
                  .join(', ') || 'nothing visible'}
              </Text>
            ) : null}
            {isLikelyBridgeEmpty(last, diag) ? (
              <Text style={styles.diagHint}>
                Health Connect shows 0 samples in the last 24h. On Samsung,
                open Samsung Health → Settings → Health Connect and turn on
                the data types you want shared (Heart rate, Oxygen
                saturation, etc).
              </Text>
            ) : null}
            <TouchableOpacity onPress={onOpenHealthSettings}>
              <Text style={styles.linkInline}>Open Health Connect</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={styles.btnRow}>
          <TouchableOpacity
            onPress={onSyncNow}
            disabled={syncing}
            style={[styles.syncBtn, styles.btnFlex, syncing && styles.syncBtnDisabled]}
          >
            {syncing ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.syncBtnText}>Sync now</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onBackfill}
            disabled={syncing}
            style={[styles.demoBtn, styles.btnFlex, syncing && styles.syncBtnDisabled]}
          >
            {syncing ? (
              <ActivityIndicator color="#0a84ff" />
            ) : (
              <Text style={styles.demoBtnText}>Backfill 24h</Text>
            )}
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={onSendDemoVitals}
          disabled={demoSending}
          style={[styles.ghostBtn, demoSending && styles.syncBtnDisabled]}
        >
          {demoSending ? (
            <ActivityIndicator color="#0a84ff" />
          ) : (
            <Text style={styles.ghostBtnText}>Send synthetic test vitals</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.muted}>
          "Backfill 24h" resets the sync cursor and pulls everything from
          Health Connect for the last day — useful when there's data in
          Health Connect but the cursor has moved past it. "Send synthetic
          test vitals" injects fake samples for offline / no-watch demos.
        </Text>
      </View>

      <TouchableOpacity onPress={() => router.push('/(main)/settings')}>
        <Text style={styles.link}>Settings</Text>
      </TouchableOpacity>
    </ScrollView>
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
      return 'OK';
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

function syncResultColor(r: LastSyncStatus['result']) {
  if (r === 'ok') return { color: '#1a7f37' };
  if (r === 'partial' || r === 'rate_limited' || r === 'dev_unsigned')
    return { color: '#bf8700' };
  return { color: '#cf222e' };
}

/**
 * Heuristic: the platform thinks everything is fine (sync succeeded, we
 * have permissions) but the last query window came back empty. On Samsung,
 * this nearly always means Samsung Health hasn't bridged the relevant
 * record types into Health Connect yet.
 */
function isLikelyBridgeEmpty(
  last: LastSyncStatus | null,
  diag: HealthDiagnostics,
): boolean {
  if (!last || last.result !== 'ok') return false;
  if ((last.acceptedTotal ?? 0) > 0) return false;
  if (diag.grantedScopes.length === 0) return false;
  const total = Object.values(diag.lastQueryCountsByKind).reduce(
    (a, b) => a + b,
    0,
  );
  return total === 0;
}

const styles = StyleSheet.create({
  scroll: { backgroundColor: '#f5f5f7' },
  container: { padding: 16, paddingTop: 64, paddingBottom: 48, gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  h1: { fontSize: 24, fontWeight: '700', color: '#0F172A' },
  subtle: { fontSize: 13, color: '#64748B' },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeLive: { borderColor: 'rgba(16,185,129,0.4)' },
  badgeConnecting: { borderColor: 'rgba(245,158,11,0.4)' },
  badgeLiveText: { fontSize: 10, color: '#059669', fontWeight: '600' },
  badgeConnectingText: { fontSize: 10, color: '#B45309', fontWeight: '600' },

  card: { backgroundColor: 'white', borderRadius: 14, padding: 16, gap: 6 },
  cardWarn: { backgroundColor: '#FEF3C7' },
  cardCritical: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
  },
  cardLabel: {
    fontSize: 11,
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  summary: { fontSize: 16, color: '#0F172A', lineHeight: 22 },
  summaryCritical: { color: '#7F1D1D' },
  criticalNote: {
    marginTop: 6,
    fontSize: 13,
    color: '#991B1B',
    fontWeight: '600',
  },
  warnText: { fontSize: 13, color: '#92400E' },
  linkInline: {
    marginTop: 6,
    fontSize: 13,
    color: '#0a84ff',
    textDecorationLine: 'underline',
  },

  incomingCard: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.4)',
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  incomingTitle: { fontSize: 15, fontWeight: '600', color: '#065F46' },
  incomingBody: { fontSize: 13, color: '#047857' },
  incomingActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  answerBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  answerBtnText: { color: 'white', fontWeight: '600', fontSize: 14 },
  dismissBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.2)',
  },
  dismissBtnText: { color: '#475569', fontSize: 14 },

  diagBox: {
    marginTop: 10,
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
    gap: 4,
  },
  diagHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  diagLine: { fontSize: 12, color: '#475569' },
  diagHint: {
    marginTop: 6,
    fontSize: 12,
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    padding: 8,
    borderRadius: 6,
    lineHeight: 17,
  },

  body: { fontSize: 14, color: '#222' },
  muted: { fontSize: 12, color: '#888' },

  syncBtn: {
    backgroundColor: '#0a84ff',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  syncBtnDisabled: { opacity: 0.5 },
  syncBtnText: { color: 'white', fontWeight: '600' },
  demoBtn: {
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#0a84ff',
  },
  demoBtnText: { color: '#0a84ff', fontWeight: '600' },
  btnRow: { flexDirection: 'row', gap: 8 },
  btnFlex: { flex: 1 },

  ghostBtn: {
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  ghostBtnText: { color: '#0a84ff', fontWeight: '500', fontSize: 14 },

  link: { fontSize: 14, color: '#0a84ff', textAlign: 'center', padding: 12 },
});
