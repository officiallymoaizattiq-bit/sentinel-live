"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Customized,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  deteriorationScoreBands,
  formatTrajectoryAxisLabel,
  scoreToSeverity,
  severityMeta,
} from "@/lib/format";

export type TrajectoryPoint = {
  t: string;
  deterioration: number;
  /** ISO time for tooltip (axis uses `t`). */
  at?: string;
  outcome_label?: "fine" | "schedule_visit" | "escalated_911";
};

/**
 * Indices of x-axis ticks to show (spread across the series, max `maxTicks`).
 * Index-based (not by `t` string) so duplicate date labels on many rows do not
 * each render a tick at a different x position.
 */
function evenAxisTickIndices(length: number, maxTicks: number): number[] {
  if (length <= 0) return [];
  const cap = Math.min(maxTicks, length);
  if (length === 1) return [0];
  const idx = new Set<number>();
  for (let i = 0; i < cap; i++) {
    idx.add(Math.round((i * (length - 1)) / (cap - 1)));
  }
  return Array.from(idx).sort((a, b) => a - b);
}

const OUTCOME_COLOR: Record<string, string> = {
  fine: "#34D399",
  schedule_visit: "#FBBF24",
  escalated_911: "#F43F5E",
};

function OutcomeMarkers({
  data,
  xAxisMap,
  yAxisMap,
  offset,
  width,
}: {
  data?: TrajectoryPoint[];
  xAxisMap?: Record<string, { scale: (v: string) => number }>;
  yAxisMap?: Record<string, { scale: (v: number) => number }>;
  offset?: { left: number; right: number; top: number; bottom: number };
  width?: number;
}) {
  if (!data || !xAxisMap || !yAxisMap) return null;
  const xScale = Object.values(xAxisMap)[0]?.scale;
  const yScale = Object.values(yAxisMap)[0]?.scale;
  if (!xScale || !yScale) return null;
  const plotLeft = offset?.left ?? 0;
  const plotRight =
    width != null && width > 0 ? width - (offset?.right ?? 0) : null;
  return (
    <>
      {data.map((p, i) => {
        if (!p.outcome_label || !OUTCOME_COLOR[p.outcome_label]) return null;
        const cx = xScale(p.t);
        const cy = yScale(p.deterioration);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
        if (
          plotRight != null &&
          (cx < plotLeft + 4 || cx > plotRight - 4)
        ) {
          return null;
        }
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={5}
            fill={OUTCOME_COLOR[p.outcome_label]}
            stroke="#0A0F1F"
            strokeWidth={1.5}
          />
        );
      })}
    </>
  );
}

function GlassTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; payload: TrajectoryPoint }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const v = row.deterioration;
  const color = severityMeta(scoreToSeverity(v)).color;
  const title = row.at ? formatTrajectoryAxisLabel(row.at) : label;
  return (
    <div className="rounded-xl border border-white/12 bg-slate-950 px-3 py-2 text-xs shadow-lg">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">
        {title}
      </div>
      <div className="num mt-0.5 text-sm font-semibold" style={{ color }}>
        {v.toFixed(3)}
      </div>
      <div className="mt-1 text-[10px] text-slate-500">
        {severityMeta(scoreToSeverity(v)).label} band
      </div>
    </div>
  );
}

export function TrajectoryChart({ points }: { points: TrajectoryPoint[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const bands = deteriorationScoreBands();
  const last = points[points.length - 1];
  const strokeColor =
    last != null
      ? severityMeta(scoreToSeverity(last.deterioration)).color
      : "#94a3b8";
  const xTickIndexSet = useMemo(
    () => new Set(evenAxisTickIndices(points.length, 5)),
    [points],
  );

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 12, right: 8, left: 4, bottom: 8 }}>
          <CartesianGrid
            strokeDasharray="3 6"
            stroke="rgba(148,163,184,0.08)"
            vertical={false}
          />

          {bands.map((b) => (
            <ReferenceArea
              key={`${b.y0}-${b.y1}`}
              y1={b.y0}
              y2={b.y1}
              fill={severityMeta(b.severity).color}
              fillOpacity={0.07}
              stroke="none"
            />
          ))}
          {[0.2, 0.4, 0.6, 0.8].map((y) => (
            <ReferenceLine
              key={y}
              y={y}
              stroke="rgba(255,255,255,0.14)"
              strokeDasharray="3 3"
            />
          ))}

          <XAxis
            dataKey="t"
            type="category"
            stroke="rgba(148,163,184,0.6)"
            tickLine={false}
            axisLine={{ stroke: "rgba(148,163,184,0.1)" }}
            height={36}
            interval={0}
            tick={(props: {
              x: number;
              y: number;
              payload: { value: string };
              index: number;
            }) => {
              const { x, y, payload, index } = props;
              if (!xTickIndexSet.has(index)) {
                return <g key={`tick-skip-${index}`} />;
              }
              return (
                <text
                  key={`tick-${index}`}
                  x={x}
                  y={y}
                  dy={14}
                  fill="rgba(148,163,184,0.7)"
                  fontSize={10}
                  textAnchor="middle"
                >
                  {payload.value}
                </text>
              );
            }}
          />
          <YAxis
            domain={[0, 1]}
            stroke="rgba(148,163,184,0.6)"
            tick={{ fontSize: 10, fill: "rgba(148,163,184,0.7)" }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            content={<GlassTooltip />}
            cursor={{ stroke: "rgba(148,163,184,0.35)", strokeDasharray: "3 3" }}
          />
          <Area
            type="monotone"
            dataKey="deterioration"
            stroke={strokeColor}
            strokeWidth={2.5}
            fill={strokeColor}
            fillOpacity={0.12}
            dot={(props) => {
              const { cx, cy, payload } = props;
              if (payload == null || cx == null || cy == null) return <g />;
              const c = severityMeta(scoreToSeverity(payload.deterioration)).color;
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={3.5}
                  fill="#0a0f1f"
                  stroke={c}
                  strokeWidth={2}
                />
              );
            }}
            activeDot={{
              r: 5,
              fill: strokeColor,
              stroke: "#0a0f1f",
              strokeWidth: 2,
            }}
            isAnimationActive
          />
          {mounted && <Customized component={OutcomeMarkers} />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
