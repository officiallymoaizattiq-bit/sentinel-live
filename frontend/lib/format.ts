export type Severity =
  | "none"
  | "patient_check"
  | "caregiver_alert"
  | "nurse_alert"
  | "suggest_911";

export type SeverityMeta = {
  label: string;
  shortLabel: string;
  rank: number;
  color: string;
  glow: string;
  dotClass: string;
  chipClass: string;
  ringClass: string;
};

export function severityMeta(s: string | null | undefined): SeverityMeta {
  switch (s) {
    case "suggest_911":
      return {
        label: "911",
        shortLabel: "Critical",
        rank: 4,
        color: "#F43F5E",
        glow: "rgba(244,63,94,0.55)",
        dotClass: "bg-rose-500",
        chipClass: "bg-rose-500/15 text-rose-200 ring-1 ring-inset ring-rose-400/40",
        ringClass: "ring-rose-400/60",
      };
    case "nurse_alert":
      return {
        label: "Nurse",
        shortLabel: "Warn",
        rank: 3,
        color: "#FB923C",
        glow: "rgba(251,146,60,0.5)",
        dotClass: "bg-orange-400",
        chipClass: "bg-orange-500/15 text-orange-200 ring-1 ring-inset ring-orange-400/40",
        ringClass: "ring-orange-400/60",
      };
    case "caregiver_alert":
      return {
        label: "Caregiver",
        shortLabel: "Watch",
        rank: 2,
        color: "#FBBF24",
        glow: "rgba(251,191,36,0.5)",
        dotClass: "bg-amber-400",
        chipClass: "bg-amber-500/15 text-amber-200 ring-1 ring-inset ring-amber-400/40",
        ringClass: "ring-amber-400/60",
      };
    case "patient_check":
      return {
        label: "Check",
        shortLabel: "Check",
        rank: 1,
        color: "#3B82F6",
        glow: "rgba(59,130,246,0.55)",
        // Lighter fill + ring reads like Stable’s emerald dot on a blue-tinted chip.
        dotClass: "bg-blue-400 ring-1 ring-white/35",
        chipClass:
          "bg-blue-500/20 text-blue-300 ring-1 ring-inset ring-blue-400/50",
        ringClass: "ring-blue-400/60",
      };
    case "none":
    default:
      return {
        label: "Stable",
        shortLabel: "Stable",
        rank: 0,
        color: "#34D399",
        glow: "rgba(52,211,153,0.45)",
        dotClass: "bg-emerald-400",
        chipClass: "bg-emerald-500/15 text-emerald-200 ring-1 ring-inset ring-emerald-400/40",
        ringClass: "ring-emerald-400/60",
      };
  }
}

/** Ordered high → low; must stay in sync with `deteriorationScoreBands`. */
const DETERIORATION_RULES: { min: number; severity: Severity }[] = [
  { min: 0.8, severity: "suggest_911" },
  { min: 0.6, severity: "nurse_alert" },
  { min: 0.4, severity: "caregiver_alert" },
  { min: 0.2, severity: "patient_check" },
];

export function scoreToSeverity(deterioration: number | null | undefined): Severity {
  if (deterioration == null) return "none";
  for (const { min, severity } of DETERIORATION_RULES) {
    if (deterioration >= min) return severity;
  }
  return "none";
}

/** Y-intervals for trajectory chart — same cut points as `scoreToSeverity`. */
export function deteriorationScoreBands(): {
  y0: number;
  y1: number;
  severity: Severity;
}[] {
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;
  const severities: Severity[] = [
    "none",
    "patient_check",
    "caregiver_alert",
    "nurse_alert",
    "suggest_911",
  ];
  return severities.map((severity, i) => ({
    y0: edges[i],
    y1: edges[i + 1],
    severity,
  }));
}

/** Axis tick text; includes seconds so nearby demo calls do not collapse to one label. */
export function formatTrajectoryAxisLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function actionToSeverity(action: string | null | undefined): Severity {
  switch (action) {
    case "suggest_911":
    case "nurse_alert":
    case "caregiver_alert":
    case "patient_check":
    case "none":
      return action;
    default:
      return "none";
  }
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function surgeryLabel(code: string | null | undefined): string {
  switch (code) {
    case "lap_chole":
      return "Lap. cholecystectomy";
    case "appy":
      return "Appendectomy";
    case "csection":
      return "C-section";
    case "ex_lap":
      return "Exploratory laparotomy";
    default:
      return code ?? "Unknown surgery";
  }
}
