"use client";

import { useEffect, useState } from "react";
import { api, type Alert } from "@/lib/api";
import { useEventStream } from "@/lib/hooks/useEventStream";

export function Critical911Banner() {
  const [active, setActive] = useState<{ patient_id: string; call_id: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const alerts = (await api.alerts()) as Alert[];
        const hit = alerts.find((a) => a.severity === "suggest_911" && !a.acknowledged);
        if (hit) setActive({ patient_id: hit.patient_id, call_id: hit.call_id });
      } catch {}
    })();
  }, []);

  useEventStream((e) => {
    if (e.type === "call_completed" && e.escalation_911) {
      setActive({ patient_id: e.patient_id, call_id: e.call_id });
    }
  });

  if (!active) return null;
  return (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-rose-500/40 bg-rose-950/90 px-4 py-2 text-sm text-rose-100 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-400" />
        </span>
        <span className="font-semibold">911 auto-dispatched</span>
        <span className="text-rose-200/80">for patient {active.patient_id}</span>
      </div>
      <button
        onClick={() => setActive(null)}
        className="rounded-md border border-rose-400/40 bg-rose-500/10 px-2 py-0.5 text-xs hover:bg-rose-500/20"
      >
        Acknowledge
      </button>
    </div>
  );
}
