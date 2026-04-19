"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Glass } from "@/components/ui/Glass";
import { EmptyState } from "@/components/ui/EmptyState";
import { AlertFeedSkeleton } from "@/components/ui/Skeleton";
import { api, type AlertRecord } from "@/lib/api";
import { useEventStream } from "@/lib/hooks/useEventStream";
import {
  actionToSeverity,
  formatRelative,
  severityMeta,
} from "@/lib/format";

type FeedItem = AlertRecord & {
  acknowledged?: boolean;
  pending?: boolean;
  /** When true, the row was injected by an SSE event and not yet re-hydrated. */
  optimistic?: boolean;
  summary?: string;
};

const MAX_ROWS = 8;

function dedupe(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const x of items) {
    const key = x.id || `${x.patient_id}:${x.call_id}:${x.sent_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  return out;
}

export function AlertFeed() {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [nameById, setNameById] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const [alerts, patients] = await Promise.all([
        api.alerts(),
        api.patients().catch(() => []),
      ]);
      setItems(alerts);
      const map: Record<string, string> = {};
      for (const p of patients) map[p.id] = p.name;
      setNameById(map);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEventStream((e) => {
    if (e.type === "alert") {
      const optimistic: FeedItem = {
        id: `pending-${e.call_id}-${e.at}`,
        patient_id: e.patient_id,
        call_id: e.call_id,
        severity: e.severity,
        channel: "sse",
        sent_at: e.at,
        summary: e.summary,
        optimistic: true,
      };
      setItems((prev) =>
        dedupe([optimistic, ...(prev ?? [])]).slice(0, MAX_ROWS * 2),
      );
      // Rehydrate canonical rows (with stable IDs) shortly after.
      window.setTimeout(refresh, 600);
    }
    if (e.type === "alert_ack") {
      setItems((prev) =>
        (prev ?? []).map((r) =>
          r.id === e.alert_id ? { ...r, acknowledged: true } : r,
        ),
      );
    }
  });

  const ack = useCallback(async (id: string) => {
    setItems((prev) =>
      (prev ?? []).map((r) =>
        r.id === id ? { ...r, pending: true } : r,
      ),
    );
    const ok = await api.ackAlert(id).catch(() => false);
    if (ok) {
      setItems((prev) =>
        (prev ?? []).map((r) =>
          r.id === id ? { ...r, pending: false, acknowledged: true } : r,
        ),
      );
    } else {
      setItems((prev) =>
        (prev ?? []).map((r) =>
          r.id === id ? { ...r, pending: false } : r,
        ),
      );
    }
  }, []);

  const rows = useMemo(() => (items ?? []).slice(0, MAX_ROWS), [items]);

  if (items === null) {
    return <AlertFeedSkeleton rows={3} />;
  }

  return (
    <Glass backdrop={false} className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-white text-on-glass">
            Alert feed
          </h2>
          <p className="text-[11px] text-slate-400">
            Live nurse / 911 notifications — acknowledge to clear
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {rows.length} recent
        </span>
      </div>

      {!rows.length ? (
        <EmptyState
          embedded
          tone="muted"
          title="All clear"
          description="No open alerts. Severe call outcomes will appear here for acknowledgement."
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-5 w-5"
              aria-hidden
            >
              <path
                d="M5 12.5l4.5 4.5L19 7.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => {
            const sev = actionToSeverity(a.severity);
            const meta = severityMeta(sev);
            const name = nameById[a.patient_id];
            return (
              <li
                key={a.id}
                className={
                  "group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 transition-all duration-200 " +
                  (a.acknowledged
                    ? "opacity-55"
                    : "hover:border-white/15 hover:bg-white/[0.06]")
                }
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: meta.color,
                    boxShadow: `0 0 8px ${meta.glow}`,
                  }}
                />
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset"
                  style={{
                    color: meta.color,
                    background: `${meta.color}14`,
                    boxShadow: `inset 0 0 0 1px ${meta.color}55`,
                  }}
                >
                  {meta.shortLabel}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-slate-100">
                    {name ? (
                      <Link
                        href={`/patients/${a.patient_id}`}
                        className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300/70"
                      >
                        {name}
                      </Link>
                    ) : (
                      <span className="font-mono text-[11px] text-slate-400">
                        {a.patient_id.slice(0, 8)}…
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-slate-500">
                    {a.summary ?? `${a.channel} alert`}
                    <span className="text-slate-600"> · </span>
                    <span className="num">{formatRelative(a.sent_at)}</span>
                  </div>
                </div>
                {a.acknowledged ? (
                  <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                    Acked
                  </span>
                ) : a.optimistic ? (
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-500">
                    incoming…
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => ack(a.id)}
                    disabled={a.pending}
                    aria-label={`Acknowledge alert for ${name ?? "patient"}`}
                    className="shrink-0 rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-200 transition-colors duration-150 hover:border-white/25 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:opacity-50"
                  >
                    {a.pending ? "…" : "Ack"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Glass>
  );
}
