"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type Alert } from "@/lib/api";
import { useEventStream } from "@/lib/hooks/useEventStream";
import { AckButton } from "@/components/admin/AckButton";

type Props = { initial?: Alert[] };

export function AlertFeed({ initial = [] }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>(initial);

  // Seed on mount (if we were rendered without initial)
  useEffect(() => {
    if (initial.length > 0) return;
    (async () => {
      try {
        setAlerts(await api.alerts());
      } catch { /* transient */ }
    })();
  }, [initial.length]);

  useEventStream((e) => {
    if (e.type === "alert") {
      setAlerts((prev) => {
        // Dedupe: if already present (matching call_id + severity), skip.
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
    if (e.type === "alert_ack") {
      setAlerts((prev) => prev.filter((a) => a.id !== e.alert_id));
    }
  });

  const items = useMemo(
    () =>
      alerts
        .filter((a) => !a.acknowledged)
        .slice()
        .sort((a, b) => b.sent_at.localeCompare(a.sent_at)),
    [alerts]
  );

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white text-on-glass">
          Live alerts
        </h2>
        <span className="text-[10px] text-emerald-400">● live</span>
      </div>
      <ul className="space-y-2">
        {items.map((a) => {
          const red = a.severity === "suggest_911";
          const yellow = a.severity === "nurse_alert";
          const cls = red
            ? "border-red-500/40 bg-red-950/40"
            : yellow
            ? "border-yellow-500/40 bg-yellow-950/30"
            : "border-white/10 bg-white/5";
          return (
            <li key={a.id} className={"rounded-lg border p-3 text-xs " + cls}>
              <div className="flex items-center justify-between">
                <div className="font-mono">{a.severity}</div>
                <AckButton
                  alertId={a.id}
                  onDone={() =>
                    setAlerts((prev) => prev.filter((x) => x.id !== a.id))
                  }
                />
              </div>
              <div className="text-slate-400">
                {new Date(a.sent_at).toLocaleTimeString()}
                {a.channel.length ? ` · ${a.channel.join(", ")}` : ""}
              </div>
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
            No alerts yet.
          </li>
        )}
      </ul>
    </section>
  );
}
