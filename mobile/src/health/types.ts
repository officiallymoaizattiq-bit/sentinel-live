// Mirrors the kind enum in docs/backend-contract.md.
export type SampleKind =
  | 'heart_rate'
  | 'spo2'
  | 'resp_rate'
  | 'temp'
  | 'steps'
  | 'sleep_stage'
  | 'hrv_sdnn'
  | 'hrv_rmssd';

export type SampleUnit = 'bpm' | 'pct' | 'cpm' | 'c' | 'count' | 'enum' | 'ms';

export type Source = 'apple_healthkit' | 'health_connect' | 'manual';

export type SleepStage = 'awake' | 'light' | 'deep' | 'rem' | 'in_bed';

export type Sample = {
  t: string; // ISO8601 UTC
  kind: SampleKind;
  value: number | SleepStage;
  unit: SampleUnit;
  source: Source;
  confidence: number | null;
};

/** Per-platform query window. End is exclusive. */
export type Window = { startIso: string; endIso: string };

/**
 * Snapshot of the platform health store's state from this app's perspective.
 * Used by the dashboard to show *why* sync is returning 0 samples instead of
 * silently saying "OK — 0 samples". On Samsung devices the most common cause
 * is that the user installed Sentinel before flipping the "sync to Health
 * Connect" toggle in Samsung Health, so Health Connect itself has no data
 * even though we hold all the right read permissions.
 */
export type HealthDiagnostics = {
  /** "available" | "unavailable" | "needs_provider_update" | "ios" | "unknown". */
  sdkStatus: string;
  /** Permission strings the OS reports as currently granted to Sentinel. */
  grantedScopes: string[];
  /**
   * Sample counts the LAST query() call observed, per `kind`. Empty if no
   * query has been performed yet in this session. Useful for distinguishing
   * "watch isn't pushing HR" from "we have no SpO2 permission".
   */
  lastQueryCountsByKind: Record<string, number>;
  /** ISO of the last query window's end, or null if no query has run. */
  lastQueryEndIso: string | null;
};

export interface HealthAdapter {
  /** Request all read permissions we need. Returns true if all granted. */
  requestPermissions(): Promise<boolean>;
  /** Whether we currently hold all required permissions. */
  hasPermissions(): Promise<boolean>;
  /** Pull every sample of every kind in [start, end). May return [] if device unworn. */
  query(window: Window): Promise<Sample[]>;
  /** Snapshot of platform state for the dashboard's diagnostics card. */
  diagnose(): Promise<HealthDiagnostics>;
  /**
   * Open the platform's permission/data UI so the user can fix a "0 samples"
   * problem (Samsung Health -> sync toggle, Health Connect -> permissions).
   * No-op on platforms that don't support a deep link.
   */
  openSettings(): void;
}
