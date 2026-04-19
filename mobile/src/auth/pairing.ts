import { config } from '../config';
import { saveCredentials, type Credentials } from './storage';

export type ExchangeError =
  | { kind: 'code_invalid_or_expired' }
  | { kind: 'code_already_consumed' }
  | { kind: 'network'; message: string }
  | { kind: 'server'; status: number; message: string };

export type ExchangeResult = { ok: true; creds: Credentials } | { ok: false; error: ExchangeError };

const CODE_RE = /^\d{6}$/;

// Mirrors the web app's "fake auth" pattern (frontend/app/login + backend/sentinel/web_auth.py).
// Typing this passkey on the pair screen short-circuits /api/pair/exchange and writes a
// synthetic device token, so demos / local dev don't need a real pairing code.
export const DEV_PATIENT_PASSKEY = 'm';

/**
 * Accepts either a raw 6-digit code or a sentinel://pair/<code> deep link
 * and returns the normalized 6-digit code. Returns null if not parseable.
 */
export function parsePairingInput(input: string): string | null {
  const trimmed = input.trim();
  if (CODE_RE.test(trimmed)) return trimmed;
  const match = trimmed.match(/^sentinel:\/\/pair\/(\d{6})$/i);
  return match ? match[1] : null;
}

/**
 * True when the user typed the demo passkey instead of a real 6-digit code.
 * We accept it case-insensitively for parity with the web login.
 */
export function isDevPasskey(input: string): boolean {
  return input.trim().toLowerCase() === DEV_PATIENT_PASSKEY;
}

/**
 * Demo / local-dev path. Calls the backend's /api/mobile/demo-login, which
 * mints a *real* signed device token for the chosen patient when the
 * passkey matches `Settings.mobile_demo_passkey`. This means uploads to
 * /api/vitals/batch succeed end-to-end against the real MongoDB Atlas, with
 * no need to manually generate a 6-digit pairing code first.
 */
export async function devLogin(
  patientId: string,
  passkey: string = DEV_PATIENT_PASSKEY,
): Promise<ExchangeResult> {
  if (!patientId) {
    return { ok: false, error: { kind: 'code_invalid_or_expired' } };
  }

  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}/api/mobile/demo-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_id: patientId,
        passkey,
        device_info: {
          model: config.deviceModel,
          os: config.osVersion,
          app_version: config.appVersion,
        },
      }),
    });
  } catch (e) {
    return {
      ok: false,
      error: { kind: 'network', message: e instanceof Error ? e.message : String(e) },
    };
  }

  if (res.status === 401) return { ok: false, error: { kind: 'code_invalid_or_expired' } };
  if (res.status === 404) return { ok: false, error: { kind: 'code_invalid_or_expired' } };
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: { kind: 'server', status: res.status, message: text } };
  }

  const body = (await res.json()) as {
    device_token: string;
    patient_id: string;
    device_id: string;
    pair_time: string;
  };

  const creds: Credentials = {
    deviceToken: body.device_token,
    patientId: body.patient_id,
    deviceId: body.device_id,
    pairTime: body.pair_time,
  };
  await saveCredentials(creds);
  return { ok: true, creds };
}

export async function exchangePairingCode(code: string): Promise<ExchangeResult> {
  if (!CODE_RE.test(code)) {
    return { ok: false, error: { kind: 'code_invalid_or_expired' } };
  }

  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}/api/pair/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        device_info: {
          model: config.deviceModel,
          os: config.osVersion,
          app_version: config.appVersion,
        },
      }),
    });
  } catch (e) {
    return {
      ok: false,
      error: { kind: 'network', message: e instanceof Error ? e.message : String(e) },
    };
  }

  if (res.status === 404) return { ok: false, error: { kind: 'code_invalid_or_expired' } };
  if (res.status === 409) return { ok: false, error: { kind: 'code_already_consumed' } };

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: { kind: 'server', status: res.status, message: text } };
  }

  const body = (await res.json()) as {
    device_token: string;
    patient_id: string;
    device_id: string;
    pair_time: string;
  };

  const creds: Credentials = {
    deviceToken: body.device_token,
    patientId: body.patient_id,
    deviceId: body.device_id,
    pairTime: body.pair_time,
  };
  await saveCredentials(creds);
  return { ok: true, creds };
}
