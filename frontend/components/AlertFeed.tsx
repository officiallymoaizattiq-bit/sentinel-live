"use client";

import { useEffect, useState } from "react";
import { api, type Alert } from "@/lib/api";

export function AlertFeed() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const a = await api.alerts();
        if (alive) setAlerts(a);
      } catch { /* transient */ }
    };
    pull();
    const id = setInterval(pull, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <ul className="space-y-2">
      {alerts.map((a) => {
        const red = a.severity === "suggest_911";
        return (
          <li
            key={a.id}
            className={
              "rounded border p-3 text-sm " +
              (red
                ? "border-red-600 bg-red-950"
                : "border-slate-800 bg-slate-900")
            }
          >
            <div className="font-mono">{a.severity}</div>
            <div className="text-slate-400">
              {new Date(a.sent_at).toLocaleTimeString()} · {a.channel.join(", ")}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
