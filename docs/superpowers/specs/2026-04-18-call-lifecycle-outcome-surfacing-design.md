# Call Lifecycle + Outcome Surfacing — Design

**Date:** 2026-04-18
**Status:** Approved (sections 1–5)
**Scope:** Single bundled spec
**Constraint:** Additive-only changes — no existing behavior removed or modified destructively. All existing tests must stay green untouched.

## Goal

Turn the Sentinel call from a manually-ended voice session into a self-terminating clinical interaction with:

1. Auto-termination via ElevenLabs post-call signal (hard 40s cap as safety net)
2. Dual-audience Gemini summary (patient-simple + nurse-clinical) generated on call end
3. Fake 911 escalation UX for `suggest_911` outcomes
4. Live alert feed wired to new SSE events
5. Real "Open alerts" KPI (was hardcoded)
6. Nurse-side outcome surfacing: status pill + trajectory-chart marker + critical banner

## Non-goals

- Real 911 integration (user specified "fake")
- Real-time transcript streaming mid-call
- Patient-initiated ack (only nurse acks)
- Migration of old CallRecord documents (schemaless Mongo, Pydantic defaults)

## Architecture

```
ElevenLabs agent ─── Twilio call ───────────────── (existing, unchanged)
         │
         ├── conv-end signal ──▶ POST /api/webhooks/elevenlabs/post-call
         │                         (finalize CallRecord,
         │                          Gemini × 2 → dual summaries,
         │                          set escalation_911,
         │                          upsert Alert,
         │                          emit SSE events)
         │
         └── hard 40s timer ───▶ same finalize path with
                                 end_reason="timeout_40s"

SSE bus (additive event types):
  call_completed { patient_id, call_id, outcome_label, escalation_911,
                   summary_patient, summary_nurse }
  alert_opened   { alert_id, patient_id, severity }
  alert_ack      { alert_id }
```

## Data model (additive fields only)

### `CallRecord`

```py
conversation_id: str | None             # ElevenLabs id, indexed, used for dedupe
ended_at: datetime | None
end_reason: Literal["agent_signal","timeout_40s","manual"] | None
summary_patient: str | None             # Gemini, ~6th-grade reading level
summary_nurse: str | None               # Gemini, clinical SBAR-ish
summaries_generated_at: datetime | None
summaries_error: str | None
outcome_label: Literal["fine","schedule_visit","escalated_911"] | None
escalation_911: bool = False
```

### `Alert`

```py
acknowledged: bool = False
acknowledged_at: datetime | None
acknowledged_by: str | None             # session subject
```

### Derivation rules (server-side, on finalize)

- `outcome_label`:
  - `suggest_911` → `escalated_911`
  - `nurse_alert` | `caregiver_alert` → `schedule_visit`
  - else → `fine`
- `escalation_911` ← `outcome_label == "escalated_911"`

### Open-alerts KPI

```py
count = alerts.filter(
    severity ∈ {"nurse_alert", "suggest_911"},
    acknowledged == False,
).count()
```

## Data flow

1. Scheduler / CallNow triggers existing ElevenLabs outbound call (unchanged).
2. Backend spawns async `call_watchdog(conversation_id)` on dial.
3. Watchdog sleeps 40s. If `CallRecord.ended_at is None` after sleep, forces hangup via ElevenLabs/Twilio API and calls `finalize_call(end_reason="timeout_40s")`.
4. ElevenLabs fires post-call webhook → `POST /api/webhooks/elevenlabs/post-call` with `{ conversation_id, transcript, audio_url?, metadata }`. Handler calls `finalize_call(end_reason="agent_signal")`.
5. `finalize_call()`:
   a. Look up `CallRecord` by `conversation_id`.
   b. If `ended_at` already set → return early (idempotent; watchdog + webhook race).
   c. Run existing `scoring.score_call(transcript)`.
   d. Gemini call 1: `summary_patient` (simple, 2–3 sentences, plain English).
   e. Gemini call 2: `summary_nurse` (clinical terms, vitals + risks, SBAR-ish).
   f. Compute `outcome_label`, `escalation_911`.
   g. Upsert `CallRecord`.
   h. If `outcome_label` ∈ {`schedule_visit`, `escalated_911`} → create `Alert` via existing `escalation.create_alert()` (wrapped, not modified).
   i. Emit SSE `call_completed`. If alert created, emit `alert_opened`.
6. Manual "End call" still works; routes through same finalize with `end_reason="manual"`.

## Endpoints (new)

| Verb | Path | Purpose |
|------|------|---------|
| POST | `/api/webhooks/elevenlabs/post-call` | Receive conv end, finalize call |
| POST | `/api/calls/{call_id}/summary/regenerate` | On-demand Gemini retry |
| POST | `/api/alerts/{alert_id}/ack` | Nurse acknowledgement |

## Frontend surfacing (additive components only)

- `components/patient/CallLogCard.tsx` — inside PatientLiveView; shimmer while `summaries_generated_at` null, fade-in reveal when populated. "Generate summary" button calls `/summary/regenerate`.
- `components/patient/Fake911Modal.tsx` — mounts on `call_completed` event when `escalation_911=true`. Full-screen, ring-tone SVG, Web Speech API TTS ("Ambulance dispatched to your location. Stay on the line."). Silent fallback for Safari. Auto-dismiss after 15s, cannot close early.
- `components/admin/Critical911Banner.tsx` — sticky top of admin shell. Listens for `call_completed` events with `escalation_911=true`; stores banner state in React context (not persisted across reloads). Ack button dismisses. On page load, reads `Alert` list, shows banner if any unacknowledged alert has its `CallRecord.escalation_911=true`.
- `components/admin/OutcomePill.tsx` — on PatientCard + PatientLiveView: green `fine`, amber `schedule_visit`, red `911 called`. Derived from last CallRecord.outcome_label. If `null` (no completed call yet) → no pill rendered.
- `components/patient/CallTimeline.tsx` (extend, do not rewrite) — add outcome-colored marker per call.
- `components/TrajectoryChart.tsx` (extend, do not rewrite) — same, colored dot at call timestamp.
- `components/dashboard/KpiStrip.tsx` (extend) — alert count uses new filter; value re-computes on `alert_opened` / `alert_ack` SSE.
- `components/AlertFeed.tsx` (extend) — add dismiss button per alert → `POST /api/alerts/{id}/ack`.

Web Speech API used only in `Fake911Modal` — fallback path is silent animated text + siren SVG loop.

## Error handling + edge cases

- **Dedupe.** Webhook handler keys on `conversation_id`; concurrent watchdog + webhook produce one finalized record.
- **HMAC signature.** Webhook verifies ElevenLabs HMAC header. Reject unsigned unless `DEMO_MODE=true`.
- **Gemini failure.** CallRecord persists with `summary_*=null`, `summaries_error=<msg>`; SSE `call_completed` still emitted. UI shows "Regenerate" button that calls retry endpoint.
- **Scoring failure.** Transcript persisted, `outcome_label="fine"`, event emitted, server logs warning.
- **Hangup API failure.** Watchdog still marks `ended_at` + `end_reason="timeout_40s"` locally; next scheduled call unaffected.
- **SSE disconnect.** Existing `usePolling` reconciles within 5s on reconnect.
- **Web Speech unavailable.** Silent modal fallback.
- **Ack race.** `findOneAndUpdate({_id, acknowledged:false}, {$set:{…}})`. Second ack returns 409 → UI treats as already-acked.
- **Feature flag.** `ENABLE_CALL_SUMMARY` env var. Default `true` in demo_mode. When off, webhook handler short-circuits after persisting basic CallRecord fields (scoring + transcript only).

## Backwards compatibility

- All new fields optional (`None` default on CallRecord, `False`/`None` on Alert).
- Existing Pydantic models deserialize old Mongo docs with defaults for missing fields.
- Existing SSE event types (`alert`, `call_scored`) unchanged. New types additive.
- Existing endpoints unchanged.
- Existing tests must stay green with zero edits.

## Testing

### Backend unit (new files under `backend/tests/`)

- `test_webhook_post_call.py` — idempotency on duplicate `conversation_id`; outcome_label derivation per severity; escalation_911 creates Alert; Gemini failure persists summaries_error; HMAC reject on bad signature.
- `test_watchdog_40s.py` — 40s expiry triggers finalize; late webhook after watchdog is no-op.
- `test_alert_ack.py` — ack mutates fields + emits SSE; concurrent ack returns 409.
- `test_open_alert_count.py` — KPI query matches spec filter.
- `test_summary_regenerate.py` — on-demand endpoint refreshes both summaries.

### Backend integration

- `test_call_lifecycle.py` — dial → webhook → scoring → summaries → both SSE events in order → final DB state correct.

### Frontend

- Snapshot tests for new components (`Fake911Modal`, `Critical911Banner`, `CallLogCard`, `OutcomePill`, `AckButton`) against fixture data.
- Manual demo checklist in `docs/RUNBOOK.md`.

### Regression guards

- Existing `test_call_handler.py`, `test_escalation.py`, `test_events.py` remain green, unmodified.

## Demo verification checklist (added to `docs/RUNBOOK.md`)

1. Trigger CallNow → agent dials patient.
2. Call auto-ends within 40s (agent signal or watchdog).
3. Patient dashboard renders shimmer → fade-in simple summary card.
4. Nurse dashboard renders clinical summary card.
5. `suggest_911` outcome → Fake911Modal on patient side + red banner on nurse side.
6. Open-alert KPI increments; ack button decrements.
7. TrajectoryChart shows outcome-colored marker for the new call.

## Out of scope (explicit)

- Authenticated WebRTC mid-call transcript streaming.
- Real 911 / EMS integration.
- Patient-side ack.
- Mobile app integration (tracked separately).
- Refactoring existing call_handler or escalation internals.
