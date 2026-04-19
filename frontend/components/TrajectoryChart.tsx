"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
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
};

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
  const bands = deteriorationScoreBands();
  const last = points[points.length - 1];
  const strokeColor =
    last != null
      ? severityMeta(scoreToSeverity(last.deterioration)).color
      : "#94a3b8";

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
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
            stroke="rgba(148,163,184,0.6)"
            tick={{ fontSize: 10, fill: "rgba(148,163,184,0.7)" }}
            tickLine={false}
            interval={0}
            axisLine={{ stroke: "rgba(148,163,184,0.1)" }}
          />
          <YAxis
            domain={[0, 1]}
            stroke="rgba(148,163,184,0.6)"
            tick={{ fontSize: 10, fill: "rgba(148,163,184,0.7)" }}
            tickLine={false}
            axisLine={false}
            width={40}
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
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
