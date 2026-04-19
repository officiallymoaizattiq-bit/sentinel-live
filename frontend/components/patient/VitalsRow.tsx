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
  summary,
  recommendedAction,
}: {
  deterioration: number | null;
  qsofa: number | null;
  news2: number | null;
  redFlags: string[];
  severity: Severity;
  summary?: string | null;
  recommendedAction?: string | null;
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

      {(summary || recommendedAction || redFlags.length > 0) && (
        <Glass variant="accent" className="p-4">
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg"
              style={{
                background: `linear-gradient(135deg, ${meta.color}40, transparent)`,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.1)`,
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-white">
                <path
                  d="M12 2l3 6 6 .9-4.5 4.4 1 6.2-5.5-3-5.5 3 1-6.2L3 8.9 9 8z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
                <span>Latest assessment</span>
                {recommendedAction && (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] tracking-normal text-slate-200">
                    {recommendedAction.replaceAll("_", " ")}
                  </span>
                )}
              </div>
              {summary && (
                <p className="mt-1.5 text-sm leading-relaxed text-slate-100/95 text-on-glass">
                  {summary}
                </p>
              )}
              {redFlags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {redFlags.map((f) => (
                    <span
                      key={f}
                      className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-rose-200"
                    >
                      {f.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Glass>
      )}
    </div>
  );
}
