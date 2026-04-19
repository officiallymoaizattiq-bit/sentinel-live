import { config } from '../config';
import type { Credentials } from '../auth/storage';

export type Patient = {
  id: string;
  name: string;
  surgery_type: string;
  next_call_at: string | null;
  call_count: number;
};

export type RecommendedAction =
  | 'none'
  | 'patient_check'
  | 'caregiver_alert'
  | 'nurse_alert'
  | 'suggest_911';

export type CallScore = {
  deterioration: number;
  qsofa: number;
  news2: number;
  red_flags: string[];
  summary: string;
  recommended_action: RecommendedAction;
};

export type CallRecord = {
  id: string;
  called_at: string;
  score: CallScore | null;
  similar_calls: { case_id: string; similarity: number; outcome: string }[];
  short_call: boolean;
  llm_degraded: boolean;
  ended_at?: string | null;
  end_reason?: 'agent_signal' | 'timeout_40s' | 'manual' | null;
  summary_patient?: string | null;
  summary_nurse?: string | null;
  summaries_generated_at?: string | null;
  summaries_error?: string | null;
  outcome_label?: 'fine' | 'schedule_visit' | 'escalated_911' | null;
};

export type ApiError =
  | { kind: 'auth'; code: 'device_revoked' | 'invalid_token' | 'malformed_token' }
  | { kind: 'http'; status: number; message: string }
  | { kind: 'network'; message: string };

export class ApiCallError extends Error {
  readonly error: ApiError;
  constructor(error: ApiError) {
    super(describeError(error));
    this.error = error;
  }
}

function describeError(e: ApiError): string {
  switch (e.kind) {
    case 'auth':
      return `auth_error:${e.code}`;
    case 'http':
      return `http_${e.status}:${e.message}`;
    case 'network':
      return `network:${e.message}`;
  }
}

// Mirrors readErrorCode in src/sync/client.ts. Backend wraps errors via FastAPI
// HTTPException as { detail: { error: "..." } }; older/local responses may return
// a flat { error: "..." }. Accept either.
async function readErrorCode(res: Response): Promise<string | undefined> {
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    detail?: string | { error?: string };
  };
  if (typeof json.detail === 'object' && json.detail?.error) return json.detail.error;
  if (typeof json.detail === 'string') return json.detail;
  return json.error;
}

async function request<T>(
  path: string,
  creds: Credentials | null,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (creds) headers.Authorization = `Bearer ${creds.deviceToken}`;
  const method = init.method ?? 'GET';
  const hasBody = init.body !== undefined;
  if (hasBody) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    throw new ApiCallError({
      kind: 'network',
      message: e instanceof Error ? e.message : String(e),
    });
  }

  if (res.status === 401) {
    const code = await readErrorCode(res);
    const authCode =
      code === 'device_revoked' || code === 'malformed_token'
        ? code
        : 'invalid_token';
    throw new ApiCallError({ kind: 'auth', code: authCode });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiCallError({ kind: 'http', status: res.status, message: text });
  }

  // 204 No Content / empty body — return undefined-as-T rather than failing
  // JSON.parse on the empty string.
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

const fetchJson = <T,>(path: string, creds: Credentials | null) =>
  request<T>(path, creds);

export type DevicePushTokenBody = {
  token: string;
  platform: 'ios' | 'android';
  /** "expo" for ExponentPushToken[...], "fcm"/"apns" for raw native tokens. */
  provider: 'expo' | 'fcm' | 'apns';
};

export const api = {
  // GET /api/patients returns the full list. Mobile only needs its own patient,
  // so we filter client-side rather than introduce a new backend endpoint.
  // (See HANDOFF §3.4 question 2 — list endpoint reuse is the agreed answer.)
  patients: (creds: Credentials | null) => fetchJson<Patient[]>('/api/patients', creds),
  getPatient: async (creds: Credentials, pid: string): Promise<Patient | null> => {
    const all = await api.patients(creds);
    return all.find((p) => p.id === pid) ?? null;
  },
  getCalls: (creds: Credentials, pid: string) =>
    fetchJson<CallRecord[]>(`/api/patients/${pid}/calls`, creds),
  registerPushToken: (creds: Credentials, body: DevicePushTokenBody) =>
    request<{ ok: true }>('/api/devices/push-token', creds, {
      method: 'POST',
      body,
    }),
  mobileEndCall: (creds: Credentials, conversation_id: string) =>
    request<{ call_id: string }>('/api/calls/mobile-end', creds, {
      method: 'POST',
      body: { conversation_id },
    }),
};
