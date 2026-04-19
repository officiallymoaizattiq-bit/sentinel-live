import Link from "next/link";
import type { Patient } from "@/lib/api";
import { CallNowButton } from "@/components/admin/CallNowButton";
import { Glass } from "@/components/ui/Glass";
import { SeverityChip } from "@/components/ui/SeverityChip";
import {
  type Severity,
  severityMeta,
  surgeryLabel,
} from "@/lib/format";

function StatusRing({
  severity,
  value,
}: {
  severity: Severity;
  value: number | null;
}) {
  const meta = severityMeta(severity);
  const size = 116;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = typeof value === "number" ? Math.max(0, Math.min(1, value)) : 0;
  const dash = c * v;
  const filterId = `glow-${severity}`;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={meta.color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${dash} ${c}`}
          filter={`url(#${filterId})`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-wider text-slate-400">
          Risk
        </div>
        <div
          className="num text-[26px] font-semibold leading-none"
          style={{ color: meta.color }}
        >
          {typeof value === "number" ? value.toFixed(2) : "—"}
        </div>
      </div>
    </div>
  );
}

export function PatientHero({
  patient,
  severity,
  deterioration,
  callsToday,
  totalCalls,
}: {
  patient: Patient;
  severity: Severity;
  deterioration: number | null;
  callsToday: number;
  totalCalls: number;
}) {
  return (
    <Glass variant="strong" className="relative overflow-hidden p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full opacity-30 blur-3xl"
        style={{ background: severityMeta(severity).color }}
      />

      <div className="mb-3 flex items-center gap-2 text-xs">
        <Link
          href="/admin"
          className="flex items-center gap-1 text-slate-400 hover:text-slate-200"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Dashboard
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-400">Patient</span>
      </div>

      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="text-2xl font-semibold tracking-tight text-white text-on-glass">
              {patient.name}
            </div>
            <SeverityChip severity={severity} pulse />
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-slate-400">
            <span>{surgeryLabel(patient.surgery_type)}</span>
            <span className="text-slate-700">•</span>
            <span className="num">
              {totalCalls} {totalCalls === 1 ? "call" : "calls"} total
            </span>
            <span className="text-slate-700">•</span>
            <span className="num">{callsToday} today</span>
          </div>

          <div className="mt-5 flex flex-wrap items-start gap-2">
            <CallNowButton
              patientId={patient.id}
              label="Trigger call"
              appearance="hero"
            />
          </div>
        </div>

        <StatusRing severity={severity} value={deterioration} />
      </div>
    </Glass>
  );
}
