export type Patient = {
  id: string;
  name: string;
  surgery_type: string;
  next_call_at: string | null;
  call_count: number;
};

export type CallRecord = {
  id: string;
  called_at: string;
  score: {
    deterioration: number;
    qsofa: number;
    news2: number;
    red_flags: string[];
    summary: string;
    recommended_action:
      | "none" | "patient_check" | "caregiver_alert"
      | "nurse_alert" | "suggest_911";
  } | null;
  similar_calls: { case_id: string; similarity: number; outcome: string }[];
  short_call: boolean;
  llm_degraded: boolean;
};

export type Alert = {
  id: string;
  patient_id: string;
  call_id: string;
  severity: string;
  channel: string[];
  sent_at: string;
};

function isServer() {
  return typeof window === "undefined";
}

function resolve(path: string): string {
  if (!isServer()) return path;
  const base = process.env.BACKEND_URL ?? "http://localhost:8000";
  return `${base}${path}`;
}

function isServer() {
  return typeof window === "undefined";
}

function resolve(path: string): string {
  if (!isServer()) return path;
  const base = process.env.BACKEND_URL ?? "http://localhost:8000";
  return `${base}${path}`;
}

const BASE =
  typeof window === "undefined"
    ? process.env.BACKEND_URL ?? "http://localhost:8000"
    : "";

async function j<T>(path: string): Promise<T> {
  const r = await fetch(resolve(`${BASE}${path)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

export const api = {
  patients: () => j<Patient[]>("/api/patients"),
  calls: (pid: string) => j<CallRecord[]>(`/api/patients/${pid}/calls`),
  alerts: () => j<Alert[]>("/api/alerts"),
};
