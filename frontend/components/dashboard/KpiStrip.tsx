"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Glass } from "@/components/ui/Glass";
import { api, type Alert, type Patient } from "@/lib/api";
import {
  filterPatientsByParams,
  hasActivePatientFilters,
  parseFromURLSearchParams,
  type CallSummaryLite,
} from "@/lib/patientQuery";
import { usePolling } from "@/lib/hooks/usePolling";
import { useEventStream } from "@/lib/hooks/useEventStream";
import { latestScoredCall } from "@/lib/latestScoredCall";

type Tile = {
  label: string;
  value: string;
  hint?: string;
  accent: string;
  icon: React.ReactNode;
};

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function Tile({ tile }: { tile: Tile }) {
  return (
    <Glass backdrop={false} className="relative overflow-hidden p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-25 blur-2xl"
        style={{ background: tile.accent }}
      />
      <div className="flex items-start justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          {tile.label}
        </div>
        <div
          className="grid h-7 w-7 place-items-center rounded-lg text-white"
          style={{
            background: `linear-gradient(135deg, ${tile.accent} 0%, transparent 120%)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.15)`,
          }}
        >
          {tile.icon}
        </div>
      </div>
      <div className="num mt-2 text-[28px] font-semibold leading-none tracking-tight text-white text-on-glass">
        {tile.value}
      </div>
      {tile.hint && (
        <div className="mt-1.5 text-[11px] text-slate-400">{tile.hint}</div>
      )}
    </Glass>
  );
}

function toLiteSummaries(
  initial: Record<string, { lastDeterioration: number | null }> | undefined
): Record<string, CallSummaryLite> {
  if (!initial) return {};
  return Object.fromEntries(
    Object.entries(initial).map(([k, v]) => [
      k,
      { lastDeterioration: v.lastDeterioration },
    ])
  );
}

export function KpiStrip({
  initialPatients,
  initialAlerts,
  initialSummaries,
  initialOpenAlertCount,
}: {
  initialPatients: Patient[];
  initialAlerts?: Alert[];
  initialSummaries?: Record<string, { lastDeterioration: number | null }>;
  initialOpenAlertCount?: number;
}) {
  const sp = useSearchParams();
  const filterParams = useMemo(
    () => parseFromURLSearchParams(new URLSearchParams(sp.toString())),
    [sp]
  );

  const { data: patients } = usePolling<Patient[]>(
    api.patients,
    10_000,
    initialPatients
  );
  const { data: alerts } = usePolling<Alert[]>(
    api.alerts,
    5_000,
    initialAlerts ?? []
  );

  const ps = patients ?? initialPatients ?? [];
  const pollAlerts = alerts ?? initialAlerts ?? [];

  const [liteSummaries, setLiteSummaries] = useState<Record<string, CallSummaryLite>>(
    () => toLiteSummaries(initialSummaries)
  );

  // Live-extend poll-derived alerts with any SSE-pushed alerts in between polls.
  const [liveAlerts, setLiveAlerts] = useState<Alert[]>([]);
  const [openCount, setOpenCount] = useState<number>(initialOpenAlertCount ?? 0);
  useEventStream((e) => {
    if (e.type === "alert") {
      setLiveAlerts((prev) => {
        if (prev.some((a) => a.call_id === e.call_id && a.severity === e.severity)) {
          return prev;
        }
        const next: Alert = {
          id: `${e.call_id}-${e.severity}-${e.at}`,
          patient_id: e.patient_id,
          call_id: e.call_id,
          severity: e.severity,
          channel: [],
          sent_at: e.at,
        };
        return [next, ...prev].slice(0, 50);
      });
    }
    if (e.type === "alert_opened") setOpenCount((n) => n + 1);
    else if (e.type === "alert_ack") setOpenCount((n) => Math.max(0, n - 1));
  });
  // Merge, deduping on call_id+severity so polling eventually reconciles live-only.
  const as: Alert[] = (() => {
    const seen = new Set(pollAlerts.map((a) => `${a.call_id}|${a.severity}`));
    const extras = liveAlerts.filter(
      (a) => !seen.has(`${a.call_id}|${a.severity}`)
    );
    return [...extras, ...pollAlerts];
  })();

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const rows = await Promise.all(
          ps.map(async (p) => {
            try {
              const cs = await api.calls(p.id);
              const lastScored = latestScoredCall(cs);
              return [
                p.id,
                {
                  lastDeterioration: lastScored?.score?.deterioration ?? null,
                },
              ] as const;
            } catch {
              return [p.id, { lastDeterioration: null }] as const;
            }
          })
        );
        if (alive) {
          setLiteSummaries(Object.fromEntries(rows));
        }
      } catch {
        /* noop */
      }
    };
    tick();
    const id = setInterval(tick, 12_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ps.map((p) => p.id).join(",")]);

  const filteredPs = useMemo(
    () => filterPatientsByParams(ps, liteSummaries, filterParams),
    [ps, liteSummaries, filterParams]
  );

  const avg = useMemo(() => {
    const dets = filteredPs
      .map((p) => liteSummaries[p.id]?.lastDeterioration)
      .filter((v): v is number => typeof v === "number");
    return dets.length ? dets.reduce((a, b) => a + b, 0) / dets.length : null;
  }, [filteredPs, liteSummaries]);

  const callsToday = filteredPs.reduce(
    (acc, p) => acc + (isToday(p.next_call_at) ? 1 : 0),
    0
  );

  const cohortAlerts = useMemo(() => {
    if (!hasActivePatientFilters(filterParams)) return as;
    const ids = new Set(filteredPs.map((p) => p.id));
    return as.filter((a) => ids.has(a.patient_id));
  }, [as, filteredPs, filterParams]);

  const open = cohortAlerts.length;
  const crit = cohortAlerts.filter((a) => a.severity === "suggest_911").length;

  const tiles: Tile[] = [
    {
      label: "Active patients",
      value: filteredPs.length.toString().padStart(2, "0"),
      hint: hasActivePatientFilters(filterParams)
        ? `${filteredPs.length} in view · ${ps.length} enrolled`
        : ps.length === 1
          ? "1 enrolled"
          : `${ps.length} enrolled`,
      accent: "rgba(96,165,250,0.55)",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
          <path
            d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3.5 0-8 1.8-8 5v2h16v-2c0-3.2-4.5-5-8-5z"
            fill="currentColor"
          />
        </svg>
      ),
    },
    {
      label: "Calls due today",
      value: callsToday.toString().padStart(2, "0"),
      hint: "Auto-scheduled",
      accent: "rgba(99,102,241,0.55)",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
          <path
            d="M6.6 10.8a15 15 0 006.6 6.6l2.2-2.2a1 1 0 011-.25 11.4 11.4 0 003.6.6 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.4 11.4 0 00.6 3.6 1 1 0 01-.25 1l-2.25 2.2z"
            fill="currentColor"
          />
        </svg>
      ),
    },
    {
      label: "Open alerts",
      value: openCount.toString().padStart(2, "0"),
      hint: crit ? `${crit} critical` : "None critical",
      accent:
        crit > 0
          ? "rgba(244,63,94,0.6)"
          : open > 0
          ? "rgba(251,146,60,0.55)"
          : "rgba(52,211,153,0.5)",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
          <path
            d="M12 22a2 2 0 002-2h-4a2 2 0 002 2zm6-6V11a6 6 0 10-12 0v5l-2 2v1h16v-1l-2-2z"
            fill="currentColor"
          />
        </svg>
      ),
    },
    {
      label: "Avg deterioration",
      value: avg != null ? avg.toFixed(2) : "—",
      hint:
        avg != null
          ? hasActivePatientFilters(filterParams)
            ? "Across patients in view"
            : "Across active patients"
          : "No scored calls yet",
      accent:
        avg != null && avg >= 0.6
          ? "rgba(244,63,94,0.55)"
          : avg != null && avg >= 0.3
          ? "rgba(251,191,36,0.55)"
          : "rgba(34,211,238,0.55)",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
          <path
            d="M3 17l5-5 4 4 8-8M21 8h-5M21 8v5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <Tile key={t.label} tile={t} />
      ))}
    </div>
  );
}
