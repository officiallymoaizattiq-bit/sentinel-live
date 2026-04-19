import type { ReactNode } from "react";
import Link from "next/link";
import type { Patient } from "@/lib/api";
import { Glass } from "@/components/ui/Glass";
import { StatusDot } from "@/components/ui/StatusDot";
import { SeverityChip } from "@/components/ui/SeverityChip";
import { Sparkline } from "@/components/ui/Sparkline";
import { OutcomePill } from "@/components/admin/OutcomePill";
import {
  formatNextCall,
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
  lastOutcome?: "fine" | "schedule_visit" | "escalated_911" | null;
};

export function PatientCard({
  p,
  series = [],
  lastDeterioration,
  lastCalledAt,
  footerAction,
  lastOutcome,
}: PatientCardProps) {
  const severity: Severity = scoreToSeverity(lastDeterioration);
  const meta = severityMeta(severity);
  const detText =
    typeof lastDeterioration === "number"
      ? lastDeterioration.toFixed(2)
      : "—";

  return (
    <Link
      href={`/patients/${p.id}`}
      aria-label={`Open patient ${p.name}`}
      className="group block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
    >
      <Glass
        backdrop={false}
        solidTone="lower"
        className="relative overflow-hidden p-4 transition-[transform,border-color,box-shadow] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:border-white/15 group-hover:shadow-[0_8px_24px_-12px_rgba(2,6,15,0.8)]"
      >
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
              className="num text-2xl font-semibold leading-none tracking-tight transition-colors duration-300"
              style={{ color: meta.color }}
            >
              {detText}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              last {lastCalledAt ? formatRelative(lastCalledAt) : "—"}
            </div>
          </div>
          <div className="shrink-0 overflow-hidden rounded-sm opacity-95 transition-opacity duration-200 group-hover:opacity-100">
            <Sparkline
              values={series}
              stroke={meta.color}
              width={108}
              height={32}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/5 pt-3 text-[11px] text-slate-500">
          <div className="flex min-w-0 flex-col">
            <span className="truncate">
              <span className="text-slate-400">Next:</span>{" "}
              <span className="text-slate-300">
                {formatNextCall(p.next_call_at)}
              </span>
            </span>
            <span className="text-[10px] text-slate-500">
              {p.call_count} {p.call_count === 1 ? "call" : "calls"} total
            </span>
          </div>
          {footerAction}
        </div>
      </Glass>
    </Link>
  );
}
