import { type Severity, severityMeta } from "@/lib/format";

type Size = "sm" | "md";

const SIZE_CLASS: Record<Size, string> = {
  sm: "px-2 py-0.5 text-[10px]",
  md: "px-2.5 py-1 text-xs",
};

/** Dot sits on a same-hue tinted chip — avoid deep glow that washes the disk out. */
function chipDotBoxShadow(severity: Severity, glow: string): string {
  if (severity === "suggest_911") {
    return `0 0 8px ${glow}`;
  }
  if (severity === "none") {
    return "0 0 6px rgba(110,231,183,0.8), 0 0 0 1px rgba(255,255,255,0.14)";
  }
  if (severity === "patient_check") {
    return "0 0 6px rgba(147,197,253,0.88), 0 0 0 1px rgba(255,255,255,0.15)";
  }
  if (severity === "nurse_alert") {
    return "0 0 6px rgba(254,215,170,0.92), 0 0 0 1px rgba(255,255,255,0.14)";
  }
  if (severity === "caregiver_alert") {
    return "0 0 6px rgba(253,224,71,0.55), 0 0 0 1px rgba(255,255,255,0.12)";
  }
  return `0 0 8px ${glow}`;
}

export function SeverityChip({
  severity,
  size = "md",
  pulse,
  label,
  className = "",
}: {
  severity: Severity;
  size?: Size;
  pulse?: boolean;
  label?: string;
  className?: string;
}) {
  const meta = severityMeta(severity);
  const isCrit = severity === "suggest_911";
  return (
    <span
      className={
        `inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-wider ` +
        `${SIZE_CLASS[size]} ${meta.chipClass} ` +
        (isCrit && pulse ? "ring-pulse-crit " : "") +
        className
      }
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dotClass}`}
        style={{ boxShadow: chipDotBoxShadow(severity, meta.glow) }}
      />
      <span style={{ color: meta.color }}>{label ?? meta.label}</span>
    </span>
  );
}
