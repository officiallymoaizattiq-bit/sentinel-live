import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api, type CallRecord } from '../api/client';
import type { Credentials } from '../auth/storage';
import { Glass, palette, space } from './ui';

type Props = {
  creds: Credentials;
  call: CallRecord;
};

/**
 * Patient-facing check-in summary. Mirrors the web CallLogCard:
 *   1. Prefer the Gemini `summary_patient` (plain-language LLM write-up).
 *   2. Fall back to `score.summary` (short clinical note) and flag the fallback.
 *   3. Offer a Regenerate button so the patient can retry when generation fails.
 */
export function CheckInSummaryCard({ creds, call }: Props) {
  const fromCall = useMemo(
    () =>
      call.summary_patient?.trim() ||
      call.score?.summary?.trim() ||
      null,
    [call.summary_patient, call.score?.summary],
  );
  const [summary, setSummary] = useState<string | null>(fromCall);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setSummary(fromCall);
  }, [fromCall]);

  const usedScoreFallback =
    !call.summary_patient?.trim() &&
    Boolean(call.score?.summary?.trim()) &&
    !call.summaries_error;

  const awaitingSummary =
    !summary &&
    !call.summaries_error &&
    call.ended_at == null &&
    call.score != null;

  const onRegenerate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.regenerateSummary(creds, call.id);
      setSummary(r.summary_patient?.trim() || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to regenerate');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Glass padded>
      <Text style={styles.kicker}>YOUR CHECK-IN SUMMARY</Text>

      {awaitingSummary ? (
        <View style={styles.inline}>
          <ActivityIndicator size="small" color={palette.accent400} />
          <Text style={styles.muted}>Generating summary…</Text>
        </View>
      ) : call.summaries_error ? (
        <View>
          <Text style={styles.body}>
            We couldn&apos;t generate a summary for this visit.
          </Text>
          <RegenerateButton busy={busy} onPress={onRegenerate} />
        </View>
      ) : summary ? (
        <View>
          <Text style={styles.body}>{summary}</Text>
          {usedScoreFallback ? (
            <Text style={styles.footnote}>
              Plain-language summary is not available yet; this is the short
              clinical note from your check-in score.
            </Text>
          ) : null}
          <RegenerateButton busy={busy} onPress={onRegenerate} subtle />
        </View>
      ) : (
        <View>
          <Text style={styles.muted}>No summary for this visit yet.</Text>
          <RegenerateButton busy={busy} onPress={onRegenerate} />
        </View>
      )}

      {err ? <Text style={styles.error}>{err}</Text> : null}
    </Glass>
  );
}

function RegenerateButton({
  busy,
  onPress,
  subtle,
}: {
  busy: boolean;
  onPress: () => void;
  subtle?: boolean;
}) {
  return (
    <TouchableOpacity
      disabled={busy}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy }}
      style={[styles.regen, subtle && styles.regenSubtle, busy && styles.regenDisabled]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={palette.accent300} />
      ) : (
        <Text style={styles.regenLabel}>
          {subtle ? 'Regenerate' : 'Generate summary'}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  kicker: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: palette.textDim,
    marginBottom: space.sm,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: palette.text,
  },
  muted: {
    fontSize: 13,
    color: palette.textMuted,
  },
  footnote: {
    marginTop: space.sm,
    fontSize: 11,
    color: palette.textDim,
    lineHeight: 15,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  error: {
    marginTop: space.sm,
    fontSize: 12,
    color: palette.critText,
  },
  regen: {
    alignSelf: 'flex-start',
    marginTop: space.md,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.glassBorderStrong,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  regenSubtle: {
    borderColor: palette.glassBorder,
  },
  regenDisabled: {
    opacity: 0.55,
  },
  regenLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.accent300,
    letterSpacing: 0.2,
  },
});
