"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Glass } from "@/components/ui/Glass";
import { EmptyState } from "@/components/ui/EmptyState";
import { VitalsPanelSkeleton } from "@/components/ui/Skeleton";

type Vital = {
  t: string;
  kind: string;
  value: number | string | null;
  unit: string;
  source: string;
  clock_skew: boolean;
};

/** Raw bucket from API (null = no sample in that bucket). */
type ChartPointRaw = { ts: number; label: string; value: number | null };
/** After gap-fill for drawing; `interpolated` = no real sample at this bucket. */
type ChartPoint = {
  ts: number;
  label: string;
  value: number;
  interpolated: boolean;
};

/**
 * Linear interpolation in time between measured points; leading/trailing nulls
 * use the nearest measured value so the line spans the full window.
 */
function fillGapLinear(points: ChartPointRaw[]): ChartPoint[] {
  const n = points.length;
  if (n === 0) return [];
  const orig = points.map((p) => p.value);
  const filled: (number | null)[] = [...orig];

  let firstKnown = -1;
  let lastKnown = -1;
  for (let i = 0; i < n; i++) {
    if (orig[i] !== null) {
      if (firstKnown < 0) firstKnown = i;
      lastKnown = i;
    }
  }
  if (firstKnown < 0) return [];

  const vFirst = orig[firstKnown] as number;
  const vLast = orig[lastKnown] as number;
  for (let i = 0; i < firstKnown; i++) filled[i] = vFirst;
  for (let i = lastKnown + 1; i < n; i++) filled[i] = vLast;

  let i = 0;
  while (i < n) {
    if (filled[i] !== null) {
      i++;
      continue;
    }
    const j0 = i - 1;
    let j1 = i;
    while (j1 < n && filled[j1] === null) j1++;
    const v0 = filled[j0] as number;
    const v1 = filled[j1] as number;
    const t0 = points[j0].ts;
    const t1 = points[j1].ts;
    const denom = t1 - t0;
    for (let k = j0 + 1; k < j1; k++) {
      const t = points[k].ts;
      const alpha = denom === 0 ? 0 : (t - t0) / denom;
      filled[k] = v0 + alpha * (v1 - v0);
    }
    i = j1;
  }

  return points.map((p, idx) => ({
    ts: p.ts,
    label: p.label,
    value: filled[idx] as number,
    interpolated: orig[idx] === null,
  }));
}

const STROKE: Record<string, string> = {
  heart_rate: "#f87171",
  vo2: "#60a5fa",
  spo2: "#38bdf8",
  resp_rate: "#a78bfa",
  temp: "#fbbf24",
  hrv_sdnn: "#34d399",
  hrv_rmssd: "#2dd4bf",
  steps: "#94a3b8",
};

const PREFERRED_ORDER = [
  "heart_rate",
  "vo2",
  "spo2",
  "resp_rate",
  "temp",
  "hrv_sdnn",
  "hrv_rmssd",
  "steps",
];

function kindLabel(kind: string): string {
  switch (kind) {
    case "heart_rate":
      return "Heart rate";
    case "vo2":
      return "VO₂";
    case "spo2":
      return "SpO₂";
    case "resp_rate":
      return "Respiratory rate";
    case "temp":
      return "Temperature";
    case "hrv_sdnn":
      return "HRV (SDNN)";
    case "hrv_rmssd":
      return "HRV (RMSSD)";
    case "steps":
      return "Steps";
    default:
      return kind.replace(/_/g, " ");
  }
}

function toChartPointsRaw(vitals: Vital[], kind: string): ChartPointRaw[] {
  return vitals
    .filter(
      (v) =>
        v.kind === kind &&
        (typeof v.value === "number" || v.value === null),
    )
    .map((v) => {
      const d = new Date(v.t);
      return {
        ts: d.getTime(),
        label: d.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        value: typeof v.value === "number" ? v.value : null,
      };
    })
    .sort((a, b) => a.ts - b.ts);
}

function latestNumeric(
  vitals: Vital[],
  kind: string,
  latestByKind: Record<string, Vital> | null,
): Vital | null {
  const fromApi = latestByKind?.[kind];
  if (fromApi && typeof fromApi.value === "number") return fromApi;
  const rows = vitals.filter(
    (v) => v.kind === kind && typeof v.value === "number",
  );
  if (!rows.length) return null;
  return rows.reduce((a, b) =>
    new Date(a.t).getTime() >= new Date(b.t).getTime() ? a : b,
  );
}

const selectClass =
  "w-full max-w-[220px] cursor-pointer appearance-none rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 pr-10 text-sm text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition focus:border-accent-400/45 focus:outline-none scheme-dark";

const WINDOW_HOURS = [1, 4, 24] as const;
/** Binned vitals: one mean per equal-width slice; same bucket count for 1h / 4h / 24h windows. */
const VITAL_CHART_BUCKETS = 8;

type WrappedVitalsPayload = {
  points: Vital[];
  latest: Record<string, Vital>;
  window_hours: number;
  buckets: number;
  anchored_from?: string;
  anchored_until?: string;
};

function isWrappedVitals(data: unknown): data is WrappedVitalsPayload {
  if (data === null || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  return Array.isArray(o.points) && typeof o.latest === "object";
}

function VitalsTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: ChartPoint; color?: string }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  if (!row) return null;
  return (
    <div
      className="rounded-xl border border-white/15 bg-slate-950/90 px-3 py-2 text-xs shadow-lg"
      style={{
        backdropFilter: "blur(16px) saturate(160%)",
        WebkitBackdropFilter: "blur(16px) saturate(160%)",
      }}
    >
      <div className="text-[10px] uppercase tracking-wider text-slate-400">
        {row.label}
      </div>
      <div
        className="num mt-0.5 text-sm font-semibold text-white"
        style={{ color: payload[0].color }}
      >
        {Math.round(row.value)}
      </div>
      {row.interpolated ? (
        <div className="mt-1 text-[10px] text-slate-500">
          Estimated between readings (not a direct measurement)
        </div>
      ) : null}
    </div>
  );
}

export function VitalsPanel({ patientId }: { patientId: string }) {
  const [vitals, setVitals] = useState<Vital[] | null>(null);
  const [latestByKind, setLatestByKind] = useState<Record<
    string,
    Vital
  > | null>(null);
  const [windowHours, setWindowHours] =
    useState<(typeof WINDOW_HOURS)[number]>(4);
  /** ISO time of newest sample used to anchor the window (record time, not "now"). */
  const [anchorUntilIso, setAnchorUntilIso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<string>("");

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const params = new URLSearchParams({
          hours: String(windowHours),
          max_points: String(VITAL_CHART_BUCKETS),
        });
        const r = await fetch(
          `/api/patients/${patientId}/vitals?${params.toString()}`,
          { cache: "no-store" },
        );
        if (!r.ok) throw new Error(`${r.status}`);
        const raw: unknown = await r.json();
        if (alive) {
          if (Array.isArray(raw)) {
            setVitals(raw);
            setLatestByKind(null);
            setAnchorUntilIso(null);
          } else if (isWrappedVitals(raw)) {
            setVitals(raw.points);
            setLatestByKind(raw.latest);
            setAnchorUntilIso(
              typeof raw.anchored_until === "string"
                ? raw.anchored_until
                : null,
            );
          } else {
            setVitals([]);
            setLatestByKind(null);
            setAnchorUntilIso(null);
          }
          setError(null);
        }
      } catch (e) {
        if (alive) setError(String(e));
      }
    };
    pull();
    const id = setInterval(pull, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [patientId, windowHours]);

  const numericKinds = useMemo(() => {
    if (!vitals) return [];
    const kinds = new Set<string>();
    for (const v of vitals) {
      if (typeof v.value === "number" || v.value === null) {
        kinds.add(v.kind);
      }
    }
    if (latestByKind) {
      for (const [k, v] of Object.entries(latestByKind)) {
        if (typeof v.value === "number") kinds.add(k);
      }
    }
    const ranked = PREFERRED_ORDER.filter((k) => kinds.has(k));
    const rest = [...kinds]
      .filter((k) => !PREFERRED_ORDER.includes(k))
      .sort();
    return [...ranked, ...rest];
  }, [vitals, latestByKind]);

  useEffect(() => {
    if (!numericKinds.length) return;
    setSelectedKind((prev) =>
      prev && numericKinds.includes(prev) ? prev : numericKinds[0]
    );
  }, [numericKinds]);

  const series = useMemo(() => {
    if (!vitals || !selectedKind) return [];
    return fillGapLinear(toChartPointsRaw(vitals, selectedKind));
  }, [vitals, selectedKind]);

  if (error) {
    return (
      <EmptyState
        tone="muted"
        title="Vitals could not be loaded"
        description={`The wearable feed returned an error (${error}). It will retry automatically.`}
        icon={
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
            <path
              d="M12 9v4m0 4h.01M10.3 3.3L2.3 17a2 2 0 001.7 3h16a2 2 0 001.7-3L13.7 3.3a2 2 0 00-3.4 0z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        }
      />
    );
  }
  if (vitals === null) {
    return <VitalsPanelSkeleton />;
  }
  const hasAnyLatest =
    latestByKind != null && Object.keys(latestByKind).length > 0;
  if (vitals.length === 0 && !hasAnyLatest) {
    return (
      <EmptyState
        tone="muted"
        title="No wearable data yet"
        description="Pair a wearable from the mobile app to stream heart rate, SpO₂, and activity into this view."
        icon={
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
            <path
              d="M3 12h3l2-5 4 10 2-6 2 4h5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        }
      />
    );
  }

  if (!numericKinds.length) {
    return (
      <EmptyState
        tone="muted"
        title="No numeric vitals in this window"
        description="Try a wider time window — numeric samples haven't landed for this range yet."
      />
    );
  }

  const latest = selectedKind
    ? latestNumeric(vitals, selectedKind, latestByKind)
    : null;
  const stroke = STROKE[selectedKind] ?? "#93c5fd";

  return (
    <Glass className="overflow-hidden p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-sm font-semibold tracking-tight text-white text-on-glass">
            Wearable vitals
          </div>
          <div className="text-[11px] text-slate-400">
            Last {windowHours}h of recorded data (window ends at latest upload,
            not the wall clock) · {VITAL_CHART_BUCKETS}{" "}
            equal buckets (~{Math.round((windowHours * 60) / VITAL_CHART_BUCKETS)}{" "}
            min wide); empty buckets use a straight-line estimate between real samples
          </div>
          {anchorUntilIso ? (
            <div className="mt-0.5 text-[10px] text-slate-500">
              Newest sample in this view:{" "}
              {new Date(anchorUntilIso).toLocaleString([], {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <span className="text-[11px] text-slate-400">Window</span>
          <div
            className="flex rounded-xl border border-white/10 bg-slate-950/70 p-0.5"
            role="group"
            aria-label="Vitals time window"
          >
            {WINDOW_HOURS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setWindowHours(h)}
                className={
                  "rounded-lg px-2.5 py-1.5 text-xs font-medium transition " +
                  (windowHours === h
                    ? "bg-white/10 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200")
                }
              >
                {h}h
              </button>
            ))}
          </div>
          <label className="text-[11px] text-slate-400">Metric</label>
          <div className="relative">
            <select
              className={selectClass}
              value={selectedKind}
              onChange={(e) => setSelectedKind(e.target.value)}
              aria-label="Vital metric"
            >
              {numericKinds.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
            <span
              className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500"
              aria-hidden
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-4 w-4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </div>
        </div>
      </div>

      {latest && (
        <div className="mb-4 flex items-baseline gap-2 border-b border-white/10 pb-4">
          <span className="num text-3xl font-semibold tracking-tight text-white">
            {String(latest.value)}
          </span>
          <span className="text-sm text-slate-400">{latest.unit}</span>
          <span className="ml-auto text-[11px] text-slate-500">
            Latest ·{" "}
            {new Date(latest.t).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      )}

      {series.length === 0 ? (
        <p className="text-sm text-slate-500">
          No numeric samples for this metric.
        </p>
      ) : (
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={series}
              margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
            >
              <CartesianGrid
                strokeDasharray="3 6"
                stroke="rgba(148,163,184,0.08)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "rgba(148,163,184,0.15)" }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                domain={["auto", "auto"]}
                width={44}
              />
              <Tooltip content={<VitalsTooltip />} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={stroke}
                strokeWidth={2}
                dot={(props) => {
                  const p = props.payload as ChartPoint | undefined;
                  const r = p?.interpolated ? 2 : 3;
                  const opacity = p?.interpolated ? 0.35 : 1;
                  const { cx, cy } = props;
                  if (cx == null || cy == null) return <g key={`dot-skip-${props.index ?? 0}`} />;
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill={stroke}
                      strokeWidth={0}
                      opacity={opacity}
                    />
                  );
                }}
                activeDot={{ r: 5, stroke: stroke, strokeWidth: 2, fill: "#0f172a" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Glass>
  );
}
