"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Glass } from "@/components/ui/Glass";
import { api, type CallRecord, type Patient } from "@/lib/api";
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

function withinLastHour(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < 60 * 60 * 1000;
}

function KpiTile({ tile }: { tile: Tile }) {
  return (
    <Glass
      backdrop={false}
      className="relative overflow-hidden p-3 transition-[transform,border-color,box-shadow] duration-200 ease-out-expo hover:-translate-y-0.5 hover:border-white/15 hover:shadow-[0_8px_24px_-12px_rgba(2,6,15,0.8)] sm:p-4"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-25 blur-2xl transition-opacity"
        style={{ background: tile.accent }}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted sm:text-[11px]">
          {tile.label}
        </div>
        <div
          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-white sm:h-7 sm:w-7"
          style={{
            background: `linear-gradient(135deg, ${tile.accent} 0%, transparent 120%)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.15)`,
          }}
        >
          {tile.icon}
        </div>
      </div>
      <div className="num mt-2 text-[22px] font-semibold leading-none tracking-tight text-white text-on-glass transition-[color] duration-300 sm:text-[28px]">
        {tile.value}
      </div>
      {tile.hint && (
        <div className="mt-1.5 truncate text-[10px] text-muted sm:text-[11px]">
          {tile.hint}
        </div>
      )}
    </Glass>
  );
}

type PatientCallStats = CallSummaryLite & {
  scoredLastHour: number;
  latestCalledAt: string | null;
};

function toLite(
  initial: Record<string, { lastDeterioration: number | null }> | undefined,
): Record<string, PatientCallStats> {
  if (!initial) return {};
  return Object.fromEntries(
    Object.entries(initial).map(([k, v]) => [
      k,
      {
        lastDeterioration: v.lastDeterioration,
        scoredLastHour: 0,
        latestCalledAt: null,
      },
    ]),
  );
}

function deriveStats(calls: CallRecord[]): PatientCallStats {
  const scored = calls.filter((c) => c.score);
  const lastScored = latestScoredCall(calls);
  const scoredLastHour = scored.filter((c) => withinLastHour(c.called_at)).length;
  const last = calls[calls.length - 1];
  return {
    lastDeterioration: lastScored?.score?.deterioration ?? null,
    scoredLastHour,
    latestCalledAt: last?.called_at ?? null,
  };
}

export function KpiStrip({
  initialPatients,
  initialSummaries,
}: {
  initialPatients: Patient[];
  initialSummaries?: Record<string, { lastDeterioration: number | null }>;
}) {
  const sp = useSearchParams();
  const filterParams = useMemo(
    () => parseFromURLSearchParams(new URLSearchParams(sp.toString())),
    [sp],
  );

  const { data: patients } = usePolling<Patient[]>(
    api.patients,
    10_000,
    initialPatients,
  );

  const ps = patients ?? initialPatients ?? [];

  const [stats, setStats] = useState<Record<string, PatientCallStats>>(() =>
    toLite(initialSummaries),
  );
  const [openAlerts, setOpenAlerts] = useState<number | null>(null);

  const refreshStats = useCallback(async () => {
    const rows = await Promise.all(
      ps.map(async (p) => {
        try {
          const cs = await api.calls(p.id);
          return [p.id, deriveStats(cs)] as const;
        } catch {
          return [
            p.id,
            {
              lastDeterioration: null,
              scoredLastHour: 0,
              latestCalledAt: null,
            } as PatientCallStats,
          ] as const;
        }
      }),
    );
    setStats(Object.fromEntries(rows));
  }, [ps]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        if (!alive) return;
        await refreshStats();
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

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await api.openAlertCount();
        if (alive) setOpenAlerts(r.count ?? 0);
      } catch {
        /* backend may not expose; show dash */
      }
    };
    pull();
    const id = setInterval(pull, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const { connected, reconnectAt } = useEventStream((e) => {
    if (e.type === "alert" || e.type === "alert_ack" || e.type === "alert_opened") {
      api
        .openAlertCount()
        .then((r) => setOpenAlerts(r.count ?? 0))
        .catch(() => void 0);
    }
    if (e.type === "call_scored" || e.type === "call_completed") {
      refreshStats();
    }
  });

  const liteForFilter: Record<string, CallSummaryLite> = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(stats).map(([k, v]) => [
          k,
          { lastDeterioration: v.lastDeterioration },
        ]),
      ),
    [stats],
  );

  const filteredPs = useMemo(
    () => filterPatientsByParams(ps, liteForFilter, filterParams),
    [ps, liteForFilter, filterParams],
  );

  const dueToday = filteredPs.reduce(
    (acc, p) => acc + (isToday(p.next_call_at) ? 1 : 0),
    0,
  );

  const scoredLastHour = filteredPs.reduce(
    (acc, p) => acc + (stats[p.id]?.scoredLastHour ?? 0),
    0,
  );

  const filtering = hasActivePatientFilters(filterParams);

  const openAlertsAccent =
    openAlerts != null && openAlerts > 0
      ? "rgba(244,63,94,0.55)"
      : "rgba(52,211,153,0.5)";

  const tiles: Tile[] = [
    {
      label: "Open alerts",
      value: openAlerts != null ? String(openAlerts).padStart(2, "0") : "—",
      hint:
        openAlerts == null
          ? "—"
          : openAlerts === 0
            ? "No nurse / 911 tickets"
            : `${openAlerts} awaiting ack`,
      accent: openAlertsAccent,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
          <path
            d="M12 3l9 16H3L12 3zm0 6v4m0 3h.01"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      label: "Due today",
      value: dueToday.toString().padStart(2, "0"),
      hint: filtering
        ? `${filteredPs.length} in view`
        : `${ps.length} enrolled`,
      accent: "rgba(99,102,241,0.55)",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
          <path
            d="M8 2v3M16 2v3M3 8h18M5 6h14a2 2 0 012 2v11a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
  ];

  const streamPill = connected
    ? {
        cls: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
        dot: "bg-emerald-300",
        label: "Live",
      }
    : reconnectAt != null
      ? {
          cls: "border-amber-400/40 bg-amber-500/10 text-amber-200",
          dot: "bg-amber-300 animate-pulse",
          label: "Reconnecting",
        }
      : {
          cls: "border-slate-500/40 bg-slate-500/10 text-slate-300",
          dot: "bg-slate-400",
          label: "Offline",
        };

  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white text-on-glass">
            Monitoring overview
          </h1>
          <p className="text-[11px] text-slate-400">
            Post-discharge deterioration surveillance
          </p>
        </div>
        <span
          role="status"
          aria-live="polite"
          className={
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors duration-200 " +
            streamPill.cls
          }
        >
          <span className={"h-1.5 w-1.5 rounded-full " + streamPill.dot} />
          {streamPill.label}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 sm:gap-4">
        {tiles.map((t) => (
          <KpiTile key={t.label} tile={t} />
        ))}
      </div>
    </div>
  );
}
