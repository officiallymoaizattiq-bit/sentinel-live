import type { Call } from "@/lib/api";

export function OutcomePill({ outcome }: { outcome: Call["outcome_label"] }) {
  if (!outcome) return null;
  const map = {
    fine: {
      label: "Fine",
      cls: "bg-emerald-500/15 text-emerald-200 ring-emerald-400/40",
    },
    schedule_visit: {
      label: "Schedule visit",
      cls: "bg-amber-500/15 text-amber-200 ring-amber-400/40",
    },
    escalated_911: {
      label: "911 called",
      cls: "bg-rose-500/20 text-rose-200 ring-rose-400/50",
    },
  } as const;
  const m = map[outcome];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${m.cls}`}
    >
      {m.label}
    </span>
  );
}
