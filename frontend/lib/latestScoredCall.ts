import type { CallRecord } from "@/lib/api";

/** Most recent call that already has a `score` (API returns calls sorted by `called_at` ascending). */
export function latestScoredCall(calls: CallRecord[]): CallRecord | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].score) return calls[i];
  }
  return null;
}
