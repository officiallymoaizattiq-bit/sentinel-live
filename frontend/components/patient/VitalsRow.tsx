import { Glass } from "@/components/ui/Glass";
import { type Severity, scoreToSeverity, severityMeta } from "@/lib/format";

function Vital({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent: string;
}) {
  return (
    <Glass className="relative overflow-hidden p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-60"
        style={{
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
        }}
      />
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div
        className="num mt-1.5 text-2xl font-semibold leading-none tracking-tight"
        style={{ color: accent }}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-1.5 text-[11px] text-slate-500">{hint}</div>
      )}
    </Glass>
  );
}

export function VitalsRow({
  deterioration,
  qsofa,
  news2,
  redFlags,
  severity,
}: {
  deterioration: number | null;
  qsofa: number | null;
  news2: number | null;
  redFlags: string[];
  severity: Severity;
}) {
  const meta = severityMeta(severity);
  const detAccent =
    deterioration != null
      ? severityMeta(scoreToSeverity(deterioration)).color
      : severityMeta("none").color;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Vital
          label="Deterioration"
          value={deterioration != null ? deterioration.toFixed(2) : "—"}
          hint="0.00 — 1.00 · bands match trajectory"
          accent={detAccent}
        />
        <Vital
          label="qSOFA"
          value={qsofa != null ? String(qsofa) : "—"}
          hint="≥ 2 = sepsis risk"
          accent="#60A5FA"
        />
        <Vital
          label="NEWS2"
          value={news2 != null ? String(news2) : "—"}
          hint="≥ 5 = clinical concern"
          accent="#818CF8"
        />
        <Vital
          label="Red flags"
          value={String(redFlags.length).padStart(2, "0")}
          hint={redFlags.length ? "Present" : "None reported"}
          accent={redFlags.length ? meta.color : "#34D399"}
        />
      </div>
    </div>
  );
}
