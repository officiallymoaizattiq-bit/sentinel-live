"use client";

import {
  CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";

export function TrajectoryChart({
  points,
}: {
  points: { t: string; deterioration: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={points}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="t" stroke="#94a3b8" />
        <YAxis domain={[0, 1]} stroke="#94a3b8" />
        <Tooltip
          contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
        />
        <Line
          type="monotone"
          dataKey="deterioration"
          stroke="#f87171"
          strokeWidth={2}
          dot
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
