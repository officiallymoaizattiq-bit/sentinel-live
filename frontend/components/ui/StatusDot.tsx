import { type Severity, severityMeta } from "@/lib/format";

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

  if (severity === "patient_check") {
    return (
      <span
        className={`relative inline-flex ${className}`}
        style={{ width: size, height: size }}
        title="Check-in advised"
      >
        {pulse && (
          <span
            className="absolute inset-0 animate-ping rounded-full opacity-60"
            style={{ background: meta.glow }}
          />
        )}
        <svg
          width={size}
          height={size}
          viewBox="0 0 20 20"
          className="relative drop-shadow-[0_0_6px_rgba(59,130,246,0.45)]"
          aria-hidden
        >
          <circle cx="10" cy="10" r="9" fill="#3B82F6" />
          <path
            d="M5.5 10.2 8.4 13.1 14.5 7"
            fill="none"
            stroke="white"
            strokeWidth="1.85"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

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
          boxShadow: `0 0 ${size + 2}px ${meta.glow}`,
        }}
      />
    </span>
  );
}
