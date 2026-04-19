import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { CallRecord } from '../api/client';
import { Glass, palette, space } from './ui';

type Props = {
  call: CallRecord;
};

/**
 * Patient-facing check-in summary. Mirrors the web CallLogCard:
 *   1. Prefer the Gemini `summary_patient` (plain-language LLM write-up).
 *   2. Fall back to `score.summary` (short clinical note) and flag the fallback.
 *
 * Generation is driven by the backend call-finalize pipeline — when the call
 * ends, the server writes summary_patient/summary_nurse and emits a
 * `call_scored` SSE event, which triggers loadCalls() on the dashboard. So
 * the card auto-updates in place; no manual Regenerate affordance.
 */
export function CheckInSummaryCard({ call }: Props) {
  const gemini = call.summary_patient?.trim() ?? '';
  const fallback = call.score?.summary?.trim() ?? '';
  const summary = gemini || fallback || null;
  const usedScoreFallback = !gemini && Boolean(fallback) && !call.summaries_error;

  const awaitingSummary =
    !summary &&
    !call.summaries_error &&
    call.ended_at == null &&
    call.score != null;

  return (
    <Glass padded>
      <Text style={styles.kicker}>YOUR CHECK-IN SUMMARY</Text>

      {awaitingSummary ? (
        <View style={styles.inline}>
          <ActivityIndicator size="small" color={palette.accent400} />
          <Text style={styles.muted}>Generating summary…</Text>
        </View>
      ) : call.summaries_error ? (
        <Text style={styles.muted}>
          We couldn&apos;t generate a summary for this visit.
        </Text>
      ) : summary ? (
        <View>
          <Text style={styles.body}>{summary}</Text>
          {usedScoreFallback ? (
            <Text style={styles.footnote}>
              Plain-language summary is not available yet; this is the short
              clinical note from your check-in score.
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.muted}>
          Your summary will appear here after your next check-in.
        </Text>
      )}
    </Glass>
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
});
