import { type Severity, severityMeta } from "@/lib/format";

type Size = "sm" | "md";

const SIZE_CLASS: Record<Size, string> = {
  sm: "px-2 py-0.5 text-[10px]",
  md: "px-2.5 py-1 text-xs",
};

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
  const isCheck = severity === "patient_check";
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
        style={{
          // Same-hue glow as the chip makes the dot disappear; use a lighter halo.
          boxShadow: isCheck
            ? "0 0 6px rgba(147,197,253,0.85), 0 0 0 1px rgba(255,255,255,0.15)"
            : `0 0 8px ${meta.glow}`,
        }}
      />
      <span>{label ?? meta.label}</span>
    </span>
  );
}
