export type Patient = {
  id: string;
  name: string;
  surgery_type: string;
  next_call_at: string | null;
  call_count: number;
  /** ISO datetime from backend; optional for older cached responses */
  discharge_date?: string | null;
};

export type CallRecord = {
  id: string;
  patient_id?: string;
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
  conversation_id?: string | null;
  ended_at?: string | null;
  end_reason?: "agent_signal" | "timeout_40s" | "manual" | null;
  summary_patient?: string | null;
  summary_nurse?: string | null;
  summaries_generated_at?: string | null;
  summaries_error?: string | null;
  outcome_label?: "fine" | "schedule_visit" | "escalated_911" | null;
  escalation_911?: boolean;
};

export type Call = CallRecord;

export type Alert = {
  id: string;
  patient_id: string;
  call_id: string;
  severity: string;
  channel: string[];
  sent_at: string;
  acknowledged?: boolean;
  acknowledged_at?: string | null;
};

function isServer() {
  return typeof window === "undefined";
}

function resolve(path: string): string {
  if (!isServer()) return path;
  const base = process.env.BACKEND_URL ?? "http://localhost:8000";
  return `${base}${path}`;
}

async function j<T>(path: string): Promise<T> {
  const r = await fetch(resolve(path), { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

export const api = {
  patients: () => j<Patient[]>("/api/patients"),
  calls: (pid: string) => j<CallRecord[]>(`/api/patients/${pid}/calls`),
  alerts: () => j<Alert[]>("/api/alerts"),
  ackAlert: (id: string) =>
    fetch(resolve(`/api/alerts/${id}/ack`), { method: "POST" }).then((r) => r.json()),
  openAlertCount: () =>
    fetch(resolve("/api/alerts/open-count"), { cache: "no-store" })
      .then((r) => r.json() as Promise<{ count: number }>),
  regenerateSummary: (id: string) =>
    fetch(resolve(`/api/calls/${id}/summary/regenerate`), { method: "POST" })
      .then((r) => r.json() as Promise<{ summary_patient: string; summary_nurse: string }>),
  widgetEndCall: (patient_id: string, severity?: string) =>
    fetch(resolve("/api/calls/widget-end"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patient_id, severity }),
    }).then((r) => r.json() as Promise<{ call_id: string }>),
};
