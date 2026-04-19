import type { Patient } from "@/lib/api";
import { scoreToSeverity, type Severity } from "@/lib/format";

export type SeverityBucket = "stable" | "at_risk" | "severe" | "911";

export type PatientListParams = {
  q?: string;
  surgery_type?: string;
  discharge_from?: string;
  discharge_to?: string;
  severity?: SeverityBucket[];
};

export const SURGERY_TYPES = [
  "lap_chole",
  "appy",
  "csection",
  "ex_lap",
] as const;

export const SEVERITY_FILTER_OPTIONS: { value: SeverityBucket; label: string }[] =
  [
    { value: "stable", label: "Stable" },
    { value: "at_risk", label: "At risk" },
    { value: "severe", label: "Severe" },
    { value: "911", label: "911" },
  ];

export type CallSummaryLite = {
  lastDeterioration: number | null;
};

function effectiveSeverity(s: CallSummaryLite): Severity {
  return scoreToSeverity(s.lastDeterioration);
}

export function severityBucket(s: CallSummaryLite): SeverityBucket {
  switch (effectiveSeverity(s)) {
    case "none":
      return "stable";
    case "patient_check":
    case "caregiver_alert":
      return "at_risk";
    case "nurse_alert":
      return "severe";
    case "suggest_911":
      return "911";
    default:
      return "stable";
  }
}

export function hasActivePatientFilters(p: PatientListParams): boolean {
  return !!(
    (p.q && p.q.trim()) ||
    p.surgery_type ||
    p.discharge_from ||
    p.discharge_to ||
    (p.severity && p.severity.length > 0)
  );
}

export function patientMatchesFilters(
  patient: Patient,
  summary: CallSummaryLite,
  params: PatientListParams
): boolean {
  const q = params.q?.trim().toLowerCase();
  if (q && !patient.name.toLowerCase().includes(q)) return false;

  if (params.surgery_type && patient.surgery_type !== params.surgery_type) {
    return false;
  }

  const dd = patient.discharge_date;
  if (params.discharge_from && dd) {
    if (new Date(dd).getTime() < new Date(params.discharge_from).getTime()) {
      return false;
    }
  } else if (params.discharge_from && !dd) {
    return false;
  }

  if (params.discharge_to && dd) {
    if (new Date(dd).getTime() > new Date(params.discharge_to).getTime()) {
      return false;
    }
  } else if (params.discharge_to && !dd) {
    return false;
  }

  if (params.severity?.length) {
    const b = severityBucket(summary);
    if (!params.severity.includes(b)) return false;
  }

  return true;
}

export function filterPatientsByParams(
  patients: Patient[],
  summaries: Record<string, CallSummaryLite>,
  params: PatientListParams
): Patient[] {
  if (!hasActivePatientFilters(params)) return patients;
  return patients.filter((p) => {
    const s = summaries[p.id] ?? { lastDeterioration: null };
    return patientMatchesFilters(p, s, params);
  });
}

export function parseFromURLSearchParams(sp: URLSearchParams): PatientListParams {
  const q = sp.get("q")?.trim();
  const surgery_type = sp.get("surgery_type")?.trim();
  const discharge_from = sp.get("discharge_from")?.trim();
  const discharge_to = sp.get("discharge_to")?.trim();
  const rawSev = sp.getAll("severity").filter(Boolean) as SeverityBucket[];
  const allowed: SeverityBucket[] = ["stable", "at_risk", "severe", "911"];
  const severity = rawSev.filter((s): s is SeverityBucket =>
    allowed.includes(s)
  );
  const out: PatientListParams = {};
  if (q) out.q = q;
  if (surgery_type) out.surgery_type = surgery_type;
  if (discharge_from) out.discharge_from = discharge_from;
  if (discharge_to) out.discharge_to = discharge_to;
  if (severity.length) out.severity = severity;
  return out;
}

export function serializePatientQuery(p: PatientListParams): string {
  const u = new URLSearchParams();
  if (p.q?.trim()) u.set("q", p.q.trim());
  if (p.surgery_type) u.set("surgery_type", p.surgery_type);
  if (p.discharge_from) u.set("discharge_from", p.discharge_from);
  if (p.discharge_to) u.set("discharge_to", p.discharge_to);
  for (const s of p.severity ?? []) u.append("severity", s);
  return u.toString();
}
