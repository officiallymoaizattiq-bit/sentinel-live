"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";

type Vital = {
  t: string;
  kind: string;
  value: number | string;
  unit: string;
  source: string;
  clock_skew: boolean;
};

const COLORS: Record<string, string> = {
  heart_rate: "#f87171",
  spo2: "#60a5fa",
  resp_rate: "#a78bfa",
  temp: "#fbbf24",
  hrv_sdnn: "#34d399",
  hrv_rmssd: "#34d399",
};

function toSeries(vitals: Vital[], kind: string) {
  return vitals
    .filter((v) => v.kind === kind && typeof v.value === "number")
    .map((v) => ({
      t: new Date(v.t).toLocaleTimeString(),
      value: v.value as number,
    }));
}

export function VitalsPanel({ patientId }: { patientId: string }) {
  const [vitals, setVitals] = useState<Vital[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch(`/api/patients/${patientId}/vitals?hours=24`, {
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`${r.status}`);
        const v = (await r.json()) as Vital[];
        if (alive) { setVitals(v); setError(null); }
      } catch (e) {
        if (alive) setError(String(e));
      }
    };
    pull();
    const id = setInterval(pull, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [patientId]);

  if (error) return <div className="text-sm text-slate-500">Vitals: {error}</div>;
  if (vitals === null) return <div className="text-sm text-slate-500">Loading vitals…</div>;

  if (vitals.length === 0) {
    return (
      <div className="rounded border border-slate-800 p-4 text-sm text-slate-400">
        No vitals yet. Pair a wearable via the mobile app.
      </div>
    );
  }

  const kinds = Array.from(new Set(vitals.map((v) => v.kind)));
  const latest: Record<string, Vital> = {};
  for (const v of vitals) latest[v.kind] = v;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {Object.entries(latest).map(([k, v]) => (
          <div
            key={k}
            className="rounded border border-slate-800 bg-slate-900 p-3"
          >
            <div className="font-mono text-xs text-slate-400">{k}</div>
            <div className="text-lg">
              {String(v.value)}
              <span className="ml-1 text-xs text-slate-500">{v.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {kinds.map((k) => {
        const series = toSeries(vitals, k);
        if (series.length === 0) return null;
        return (
          <div key={k}>
            <h4 className="mb-1 text-xs text-slate-400">{k}</h4>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="t" stroke="#94a3b8" hide />
                <YAxis stroke="#94a3b8" domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: "#0f172a",
                                  border: "1px solid #334155" }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={COLORS[k] ?? "#cbd5e1"}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}
