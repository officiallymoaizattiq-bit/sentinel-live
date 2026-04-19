"use client";

import { useEffect, useState } from "react";
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

type Point = { t: string; deterioration: number; outcome_label?: string };

const OUTCOME_COLOR: Record<string, string> = {
  fine: "#34D399",
  schedule_visit: "#FBBF24",
  escalated_911: "#F43F5E",
};

function GlassTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  let color = "#34D399";
  if (v >= 0.6) color = "#F43F5E";
  else if (v >= 0.4) color = "#FB923C";
  else if (v >= 0.2) color = "#FBBF24";
  return (
    <div
      className="rounded-xl border border-white/15 bg-slate-950/85 px-3 py-2 text-xs shadow-glass-strong"
      style={{
        backdropFilter: "blur(16px) saturate(160%)",
        WebkitBackdropFilter: "blur(16px) saturate(160%)",
      }}
    >
      <div className="text-[10px] uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className="num mt-0.5 text-sm font-semibold" style={{ color }}>
        {v.toFixed(3)}
      </div>
    </div>
  );
}

function OutcomeMarkers({
  data,
  xAxisMap,
  yAxisMap,
}: {
  data?: Point[];
  xAxisMap?: Record<string, { scale: (v: string) => number }>;
  yAxisMap?: Record<string, { scale: (v: number) => number }>;
}) {
  if (!data || !xAxisMap || !yAxisMap) return null;
  const xScale = Object.values(xAxisMap)[0]?.scale;
  const yScale = Object.values(yAxisMap)[0]?.scale;
  if (!xScale || !yScale) return null;
  return (
    <>
      {data.map((p, i) => {
        if (!p.outcome_label || !OUTCOME_COLOR[p.outcome_label]) return null;
        const cx = xScale(p.t);
        const cy = yScale(p.deterioration);
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

export function TrajectoryChart({ points }: { points: Point[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60A5FA" stopOpacity={0.55} />
              <stop offset="60%" stopColor="#3B82F6" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#93C5FD" />
              <stop offset="50%" stopColor="#60A5FA" />
              <stop offset="100%" stopColor="#3B82F6" />
            </linearGradient>
            <filter id="glowStroke" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <CartesianGrid
            strokeDasharray="3 6"
            stroke="rgba(148,163,184,0.08)"
            vertical={false}
          />

          <ReferenceArea
            y1={0}
            y2={0.3}
            fill="rgba(52,211,153,0.04)"
            stroke="none"
          />
          <ReferenceArea
            y1={0.3}
            y2={0.6}
            fill="rgba(251,191,36,0.05)"
            stroke="none"
          />
          <ReferenceArea
            y1={0.6}
            y2={1}
            fill="rgba(244,63,94,0.05)"
            stroke="none"
          />
          <ReferenceLine y={0.6} stroke="rgba(244,63,94,0.35)" strokeDasharray="3 3" />
          <ReferenceLine y={0.3} stroke="rgba(251,191,36,0.3)" strokeDasharray="3 3" />

          <XAxis
            dataKey="t"
            stroke="rgba(148,163,184,0.6)"
            tick={{ fontSize: 10, fill: "rgba(148,163,184,0.7)" }}
            tickLine={false}
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
            cursor={{ stroke: "rgba(96,165,250,0.4)", strokeDasharray: "3 3" }}
          />
          <Area
            type="monotone"
            dataKey="deterioration"
            stroke="url(#gradStroke)"
            strokeWidth={2.5}
            fill="url(#gradArea)"
            filter="url(#glowStroke)"
            dot={{
              r: 3,
              fill: "#0A0F1F",
              stroke: "#60A5FA",
              strokeWidth: 1.5,
            }}
            activeDot={{
              r: 5,
              fill: "#60A5FA",
              stroke: "#0A0F1F",
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
