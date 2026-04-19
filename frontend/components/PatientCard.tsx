import Link from "next/link";
import type { Patient } from "@/lib/api";
import { Glass } from "@/components/ui/Glass";
import { StatusDot } from "@/components/ui/StatusDot";
import { SeverityChip } from "@/components/ui/SeverityChip";
import { Sparkline } from "@/components/ui/Sparkline";
import { OutcomePill } from "@/components/admin/OutcomePill";
import {
  actionToSeverity,
  formatRelative,
  scoreToSeverity,
  severityMeta,
  surgeryLabel,
  type Severity,
} from "@/lib/format";

export type PatientCardProps = {
  p: Patient;
  series?: number[];
  lastDeterioration?: number | null;
  lastAction?: string | null;
  lastCalledAt?: string | null;
  lastOutcome?: "fine" | "schedule_visit" | "escalated_911" | null;
};

export function PatientCard({
  p,
  series = [],
  lastDeterioration,
  lastAction,
  lastCalledAt,
  lastOutcome,
}: PatientCardProps) {
  const severity: Severity =
    actionToSeverity(lastAction) !== "none"
      ? actionToSeverity(lastAction)
      : scoreToSeverity(lastDeterioration);
  const meta = severityMeta(severity);
  const detText =
    typeof lastDeterioration === "number"
      ? lastDeterioration.toFixed(2)
      : "—";

  return (
    <Link href={`/patients/${p.id}`} className="block focus:outline-none">
      <Glass hover className="group relative overflow-hidden p-4">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-70"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${meta.color} 50%, transparent 100%)`,
          }}
        />

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusDot
                severity={severity}
                pulse={severity === "suggest_911"}
              />
              <div className="truncate text-[15px] font-semibold tracking-tight text-white text-on-glass">
                {p.name}
              </div>
            </div>
            <div className="mt-0.5 truncate text-xs text-slate-400">
              {surgeryLabel(p.surgery_type)}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <OutcomePill outcome={lastOutcome ?? null} />
            <SeverityChip severity={severity} size="sm" pulse />
          </div>
        </div>

        <div className="mt-4 flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              Deterioration
            </div>
            <div
              className="num text-2xl font-semibold tracking-tight"
              style={{ color: meta.color }}
            >
              {detText}
            </div>
          </div>
          <div className="opacity-90">
            <Sparkline
              values={series}
              stroke={meta.color}
              fill={meta.glow}
              width={108}
              height={32}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
          <span>
            {p.call_count} {p.call_count === 1 ? "call" : "calls"}
          </span>
          <span>{lastCalledAt ? formatRelative(lastCalledAt) : "no calls yet"}</span>
        </div>
      </Glass>
    </Link>
  );
}
