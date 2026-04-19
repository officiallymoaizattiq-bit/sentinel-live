# Sentinel — Mobile ↔ Backend Contract

**Status:** Locked v1 (2026-04-18)
**Owners:** Backend repo + SentinelMobile repo. Both repos mirror this file. Diff before each PR.

---

## 1. Auth model

- One device → one patient. Device pairs once via 6-digit code, then holds a long-lived JWT.
- Token: HS256 JWT, no `exp`. Revocation enforced server-side via `devices.revoked_at` lookup on every request.
- Signing secret: `DEVICE_TOKEN_SECRET` (backend-only env).

JWT payload:
```json
{ "sub": "<device_id>", "pid": "<patient_id>", "iat": 1713456789, "typ": "device" }
```

All authed endpoints respond on auth failure with:
```json
401 { "error": "device_revoked" | "invalid_token" | "malformed_token", "message": "..." }
```

Mobile mapping:
- `device_revoked` → clear SecureStore, return to pairing screen, show "This device was unpaired by your care team."
- `invalid_token` / `malformed_token` → clear SecureStore, return to pairing, show "Please re-pair."

---

## 2. Pairing

### `POST /api/patients/{pid}/pair`
Clinician-initiated. (Hackathon: open endpoint. Real auth added later.)

**Response 201:**
```json
{
  "pairing_code": "123456",
  "qr_url": "sentinel://pair/123456",
  "expires_at": "2026-04-18T14:42:11Z"
}
```
- 6-digit numeric, zero-padded.
- 10-min TTL, single-use.

### `POST /api/pair/exchange`
**Body:**
```json
{
  "code": "123456",
  "device_info": { "model": "iPhone 15", "os": "iOS 18.2", "app_version": "0.1.0" }
}
```

**Response 200:**
```json
{
  "device_token": "<jwt>",
  "patient_id": "uuid",
  "device_id": "uuid",
  "pair_time": "2026-04-18T14:33:11Z"
}
```
Mobile uses `pair_time` as the initial sync cursor (forward-only — no backfill in v1).

**Errors:**
- `404 { "error": "code_invalid_or_expired" }`
- `409 { "error": "code_already_consumed" }`

### `POST /api/devices/{device_id}/revoke`
Clinician auth. Returns `204`.

---

## 3. Vitals ingestion

### `POST /api/vitals/batch`

**Headers:**
```
Authorization: Bearer <device_token>
Idempotency-Key: <uuid-v4>
Content-Type: application/json
```

**Body:**
```json
{
  "patient_id": "uuid",
  "device_id": "uuid",
  "batch_id": "<same uuid as Idempotency-Key>",
  "samples": [
    {
      "t": "2026-04-18T14:32:11Z",
      "kind": "heart_rate",
      "value": 78,
      "unit": "bpm",
      "source": "apple_healthkit",
      "confidence": null
    }
  ]
}
```

**`kind` enum (final):**
| kind | unit | value type | notes |
|---|---|---|---|
| `heart_rate` | `bpm` | number | |
| `spo2` | `pct` | number | 0–100 |
| `resp_rate` | `cpm` | number | breaths/min |
| `temp` | `c` | number | wrist (HK) or body (HC) |
| `steps` | `count` | number | per sample interval |
| `sleep_stage` | `enum` | string | `awake \| light \| deep \| rem \| in_bed` |
| `hrv_sdnn` | `ms` | number | iOS only — not interchangeable with rmssd |
| `hrv_rmssd` | `ms` | number | Android only |

`source`: `apple_healthkit | health_connect | manual`
`confidence`: `0.0–1.0` if known, else `null`.

**Responses:**
- `202 { "accepted": N, "flagged_clock_skew": M }` — fresh batch processed.
- `200 { "accepted": N, "flagged_clock_skew": M, "idempotent_replay": true }` — replay of prior `batch_id`.
- `400 { "error": "mismatched_batch_id" | "clock_in_future" | "schema_invalid" }`
- `401` — see auth section.
- `413 { "error": "payload_too_large", "max_samples": 1000 }`
- `429 { "error": "rate_limited", "retry_after_s": N }`

**Limits:**
- Max 1000 samples per batch. Mobile chunks above.
- Rate: 10 batches/min/device, 500 batches/day/device. Burst to 60/min tolerated, then 429.

**Idempotency:**
- `Idempotency-Key` header MUST equal body `batch_id`. Mismatch → 400.
- Backend stores `processed_batches` with TTL 7 days; replays return 200 with original `accepted` count.

**Clock skew:**
- Accept samples where `now - 24h <= t <= now + 1h`.
- Samples with `t < now - 24h` are accepted but flagged.
- Any sample with `t > now + 1h` → entire batch rejected (`400 clock_in_future`).
- Mobile should sanity-check device clock before sending; surface a warning if `Date.now()` deviates from server `Date` header.

---

## 4. Cadence

- Background sync: every ~15 min via `expo-background-fetch` (iOS minimum). Android similar.
- Foreground: sync on app open + manual "Sync now" button.
- Forward-only from `pair_time`. Backfill is v2.

---

## 5. URL scheme & deep link

- Scheme: `sentinel://`
- Pair link: `sentinel://pair/<6-digit-code>`
- Registered in `app.json` → `"scheme": "sentinel"`.

---

## 6. Patient dashboard reads (mobile-only)

The mobile app's patient dashboard reuses three endpoints originally built for the
clinician web view. They are unauthenticated today and return JSON.

### `GET /api/patients`
Mobile filters the returned list client-side to find its own `patient_id`. We
intentionally do **not** add a per-patient `GET /api/patients/{pid}` endpoint —
the list is small enough that one fetch on dashboard mount is fine, and adding
the route would mean a second contract surface to keep in sync.

### `GET /api/patients/{pid}/calls`
Returns the patient's `CallRecord[]` ordered ascending by `called_at`.

Mobile uses this for two things:
1. Initial render of the dashboard (latest summary + trajectory chart).
2. Refetch on every `call_scored` SSE event for `patient_id` (see §7).

### `GET /api/alerts`
Optional. Mobile may surface clinician-facing alerts in a future build; not
used by the v1 dashboard.

---

## 7. Server-Sent Events stream (`GET /api/stream`)

Mobile subscribes to the same SSE feed the web `/patient` and `/admin` views
use. Implementation detail: this endpoint is **unauthenticated** in v1 and is
**not** filtered per-patient — every subscriber gets every event. Mobile filters
client-side by `patient_id`. If/when per-patient filtering or auth lands, the
mobile contract is to send `Authorization: Bearer <device_token>` (already
included by the mobile client today as a forward-compat measure) and to read
filtered events.

### Event envelope

Each SSE `data:` line is a single JSON object with a `type` discriminator:

```ts
type StreamEvent =
  | { type: "hello" }
  | { type: "alert";       patient_id: string; call_id: string; severity: string; summary: string; at: string }
  | { type: "call_scored"; call_id: string; patient_id: string; score: object; at: string }
  | { type: "pending_call"; patient_id: string; mode: "phone" | "widget"; at: string }
  | { type: "vitals";       patient_id: string; device_id: string; accepted: number; at: string };
```

### Mobile client behavior

- Connection: `react-native-sse` (browser `EventSource` is not available in
  Hermes). Custom header `Authorization: Bearer <device_token>` is set on the
  initial fetch.
- Reconnect: exponential backoff capped at 30 s, retry counter resets on every
  successful `open`. Mirrors the web `useEventStream` hook.
- Foreground reconnect: SSE pauses while the app is backgrounded on both iOS
  and Android, and the underlying socket is usually dead by the time we come
  back. The mobile hook listens to `AppState` and force-cycles the connection
  on `active`.
- Per-patient filter: any event with a `patient_id` field that doesn't match
  the device's paired `patient_id` is dropped before reaching the UI. Events
  without a `patient_id` (e.g. `hello`) are passed through.

### Event semantics for the mobile dashboard

- `pending_call` → render the green "Sentinel is calling you" banner with
  Answer / Dismiss. On Answer, mobile mounts the `@elevenlabs/react-native`
  conversation (LiveKit + WebRTC) using `EXPO_PUBLIC_ELEVENLABS_AGENT_ID`,
  mirroring the web's Convai widget.
- `call_scored` → refetch `GET /api/patients/{pid}/calls` and re-render the
  latest summary + trajectory chart.
- `alert` → reserved for v2 (no mobile UI today).
- `vitals` → ignored on mobile (the device generated it).

### Open backend questions (still open)

These were flagged in `mobile/HANDOFF.md` §3.4 and are not blocking the
hackathon flow. Document them here when answered:

1. **Per-patient filter / device auth on `/api/stream`.** Mobile filters
   client-side today. If we later want to drop the broadcast model, decide
   between:
   - Accept `Authorization: Bearer <device_token>` and filter to that device's
     `patient_id` on the existing `/api/stream`, OR
   - New `/api/stream/device` route that does the same thing and leaves the
     admin broadcast feed untouched.
2. **Friendly patient name in pairing response.** `POST /api/pair/exchange`
   currently returns `patient_id` only. Mobile would benefit from `name` so
   the dashboard doesn't need a follow-up `/api/patients` fetch on first launch.
   If added, document the field shape here and bump v1 → v1.1.

---

## 8. v2 / out of scope (documented for later)

- Backfill on first pair (last N hours of HK/HC history).
- Push token registration (`POST /api/devices/{id}/push_token`) — backend-triggered nudges.
- Backend-pushed config (sync interval, kind allowlist).
- Per-patient OAuth instead of device JWT.
- Blood pressure, ECG, VO2max sample kinds.
