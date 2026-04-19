import { type Severity, severityMeta } from "@/lib/format";

function statusDotHalo(severity: Severity, glow: string): string {
  if (severity === "suggest_911") {
    return `0 0 10px ${glow}`;
  }
  if (severity === "none") {
    return "0 0 8px rgba(110,231,183,0.55)";
  }
  if (severity === "patient_check") {
    return "0 0 8px rgba(147,197,253,0.65)";
  }
  if (severity === "nurse_alert") {
    return "0 0 8px rgba(254,215,170,0.65)";
  }
  if (severity === "caregiver_alert") {
    return "0 0 8px rgba(253,224,71,0.45)";
  }
  return `0 0 10px ${glow}`;
}

export function StatusDot({
  severity,
  size = 8,
  pulse,
  className = "",
}: {
  severity: Severity;
  size?: number;
  pulse?: boolean;
  className?: string;
}) {
  const meta = severityMeta(severity);

  return (
    <span className={`relative inline-flex ${className}`} style={{ width: size, height: size }}>
      {pulse && (
        <span
          className="absolute inset-0 animate-ping rounded-full opacity-60"
          style={{ background: meta.glow }}
        />
      )}
      <span
        className={`relative inline-block rounded-full ${meta.dotClass}`}
        style={{
          width: size,
          height: size,
          boxShadow: statusDotHalo(severity, meta.glow),
        }}
      />
    </span>
  );
}
