import type { ReactNode } from "react";
import Link from "next/link";
import type { Patient } from "@/lib/api";
import { Glass } from "@/components/ui/Glass";
import { StatusDot } from "@/components/ui/StatusDot";
import { SeverityChip } from "@/components/ui/SeverityChip";
import { Sparkline } from "@/components/ui/Sparkline";
import {
  formatRelative,
  scoreToSeverity,
  severityMeta,
  surgeryLabel,
  type Severity,
} from "@/lib/format";

export type PatientCardProps = {
  p: Patient;
  series?: number[];
  /** Latest scored call deterioration (same source as sparkline end). */
  lastDeterioration?: number | null;
  lastCalledAt?: string | null;
  /** Renders in the footer row (e.g. Call now). Must not overlap footer text. */
  footerAction?: ReactNode;
};

export function PatientCard({
  p,
  series = [],
  lastDeterioration,
  lastCalledAt,
  footerAction,
}: PatientCardProps) {
  const severity: Severity = scoreToSeverity(lastDeterioration);
  const meta = severityMeta(severity);
  const detText =
    typeof lastDeterioration === "number"
      ? lastDeterioration.toFixed(2)
      : "—";

  return (
    <Link href={`/patients/${p.id}`} className="block focus:outline-none">
      <Glass backdrop={false} solidTone="lower" className="relative overflow-hidden p-4">
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
          <SeverityChip severity={severity} size="sm" pulse />
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
          <div className="shrink-0 overflow-hidden rounded-sm opacity-90">
            <Sparkline
              values={series}
              stroke={meta.color}
              width={108}
              height={32}
            />
          </div>
        </div>

        <div className="mt-3 flex items-end justify-between gap-3 text-[11px] text-slate-500">
          <span className="shrink-0 pb-0.5">
            {p.call_count} {p.call_count === 1 ? "call" : "calls"}
          </span>
          <div className="flex min-w-0 flex-1 items-end justify-end gap-2">
            <span
              className={
                "min-w-0 truncate pb-0.5 text-right " +
                (footerAction ? "max-w-[42%] sm:max-w-[50%] " : "")
              }
            >
              {lastCalledAt ? formatRelative(lastCalledAt) : "no calls yet"}
            </span>
            {footerAction}
          </div>
        </div>
      </Glass>
    </Link>
  );
}
