# Sentinel Runbook

End-to-end setup, operation, and deploy. Read top-to-bottom for first run;
jump to sections thereafter.

## 1. Local prerequisites

- Python 3.11+ (`python3 --version`)
- Node 18+ (`node --version`)
- `ffmpeg`, `libsndfile` on PATH (macOS: `brew install ffmpeg libsndfile`)
- `ngrok` for exposing the backend during live-call demos

One-time setup:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .

cd ../frontend
npm install
```

## 2. `.env` fields (backend/.env)

Create `backend/.env` with:

| Key | What | Where to get |
|---|---|---|
| `MONGO_URI` | Mongo connection string | Atlas cluster "Connect" |
| `MONGO_DB` | DB name (default `sentinel`) | you pick |
| `GEMINI_API_KEY` | Google Gemini for scoring + summaries | aistudio.google.com/apikey |
| `GEMINI_MODEL` | (optional) override, default `gemini-2.0-flash` | ai.google.dev/models/gemini |
| `ELEVENLABS_API_KEY` | EL conversational AI | elevenlabs.io -> profile |
| `ELEVENLABS_AGENT_ID` | Agent you created | EL dashboard -> Agents |
| `ELEVENLABS_PHONE_NUMBER_ID` | Twilio # registered with EL | output of step 5 script |
| `TWILIO_ACCOUNT_SID` | Twilio account SID | Twilio console |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | Twilio console |
| `TWILIO_FROM_NUMBER` | Your Twilio voice # (E.164) | Twilio -> Buy a number |
| `PUBLIC_BASE_URL` | ngrok https URL for dev | `ngrok http 8000` output |
| `DEVICE_TOKEN_SECRET` | random 32+ char secret | `openssl rand -hex 32` |
| `DEMO_MODE` | `true` for local / `false` for live | - |

## 3. Mongo Atlas setup

1. Create a free M0 cluster at cloud.mongodb.com.
2. "Network Access" -> add `0.0.0.0/0` for dev (lock down for prod).
3. "Database Access" -> create a DB user, copy the SRV URI into `MONGO_URI`.
4. In Atlas Search, create a **Vector Search index** on
   `cohort_outcomes` collection:
   - Name: `cohort_vec`
   - Field: `embedding`
   - Dimensions: `1536`
   - Similarity: `cosine`

## 4. Twilio setup

1. Sign up at twilio.com (trial gives free credit).
2. Console -> Phone Numbers -> Buy a number with **Voice** capability.
3. On trial: Phone Numbers -> Verified Caller IDs -> verify any number you
   want to call (trial only dials verified numbers).
4. Copy Account SID, Auth Token, and the purchased number into `.env`.

## 5. ElevenLabs setup

1. Sign up at elevenlabs.io; upgrade to a plan that includes Conversational AI.
2. Conversational AI -> Agents -> Create agent. System prompt: paste the
   rubric from `backend/sentinel/scoring.py` (RUBRIC). Voice: any.
   Copy the Agent ID into `ELEVENLABS_AGENT_ID`.
3. Register your Twilio number with EL (this lets the agent dial from it):

```bash
cd backend && source .venv/bin/activate
export ELEVENLABS_API_KEY=... TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=...
python scripts/register_twilio_with_el.py +15551234567 "Sentinel Line"
# prints phone_number_id: phnum_...
```

Paste the printed `phone_number_id` into `ELEVENLABS_PHONE_NUMBER_ID`.

## 6. Gemini key

Go to https://aistudio.google.com/apikey, create a key, paste into
`GEMINI_API_KEY`. Sentinel calls Gemini 2.0 Flash directly via the
`google-generativeai` SDK for both structured scoring (function calling
on `emit_score`) and post-call summaries; embeddings use
`text-embedding-004` for cohort `$vectorSearch`.

## 7. ngrok (for live calls)

ElevenLabs / Twilio need to reach your backend. In one terminal:

```bash
ngrok http 8000
# Forwarding  https://abc123.ngrok-free.app -> http://localhost:8000
```

Put that https URL into `PUBLIC_BASE_URL` in `.env`. Restart the backend
after updating `.env`.

## 8. Start the app

Two terminals.

Backend:
```bash
cd backend && source .venv/bin/activate
uvicorn sentinel.main:app --host 0.0.0.0 --port 8000
```

Frontend:
```bash
cd frontend
npm run dev   # localhost:3000
```

Health check: `curl http://localhost:8000/api/patients` -> `[]` initially.

## 9. Seed the demo patient

```bash
curl -X POST http://localhost:8000/api/demo/run
# {"patient_id":"..."}
```

This creates a patient with a 5-day synthetic trajectory (stable -> early
-> declining -> critical -> baseline) that the frontend renders.

## 10. Trigger a live call

With `DEMO_MODE=false` and all EL/Twilio creds set:

```bash
curl -X POST http://localhost:8000/api/calls/trigger \
     -H 'content-type: application/json' \
     -d '{"patient_id":"<pid>"}'
# {"call_id":"<uuid>"}  -- also has conversation_id in Mongo
```

ElevenLabs rings the patient's phone, the agent runs the check-in, and EL
stores the transcript + audio. Then finalize:

```bash
# grab conversation_id from Mongo or the EL dashboard
curl -X POST http://localhost:8000/api/calls/finalize \
     -H 'content-type: application/json' \
     -d '{"conversation_id":"<convo_id>"}'
# -> {"call_id":"<new_scored_call>"}
```

(Future: wire an EL post-call webhook to auto-hit `/api/calls/finalize`.)

## 11. Deploy (Render)

1. Push your branch to GitHub.
2. render.com -> New -> Blueprint -> pick the repo. Render reads
   `render.yaml` at root.
3. For each service, paste the env vars from your `.env` (Render marks
   `sync: false` keys as "Add secret value").
4. Set `DEMO_MODE=false` and point `PUBLIC_BASE_URL` at the Render
   `sentinel-api` URL.
5. Frontend: `BACKEND_URL=https://sentinel-api.onrender.com`.
6. Re-run step 5 (EL phone register) once per environment.

Health check path is `/api/patients`; Render marks the service healthy when
it returns 200.

## 12. Demo day script

Order of operations, ~6 min:

1. Open frontend dashboard. Run `POST /api/demo/run`, show the 5 replay calls
   painting a deterioration trajectory.
2. Walk through one call: transcript, voice biomarkers, similar-case panel,
   Gemini summary + recommended action.
3. Live call: `POST /api/calls/trigger` on a verified phone. Phone rings,
   agent runs check-in for ~60s, hang up.
4. `POST /api/calls/finalize` with the conversation_id. Dashboard auto-
   refreshes with the real scored call next to the synthetic ones.
5. Show escalation (`GET /api/alerts`) + audit log collection in Mongo.

## 13. Troubleshooting

- Call triggers but phone doesn't ring: check Twilio trial verified caller
  IDs, and that `ELEVENLABS_PHONE_NUMBER_ID` is set (else falls back to stub).
- `finalize_call` returns 404: the conversation_id isn't in Mongo - check
  the `calls` collection for a matching `conversation_id` field.
- Vector search empty: Atlas index still building (~1 min), or name isn't
  exactly `cohort_vec`.
- EL call connects but no transcript: agent ID wrong, or agent has no
  system prompt configured.

## Call Lifecycle Demo Checklist

1. Start backend (`uvicorn sentinel.main:app --port 8000` in `backend/`) and frontend (`next dev -p 3001` in `frontend/`).
2. Trigger `CallNow` for a seeded patient from the admin dashboard.
3. Verify the call auto-terminates within ≤40 seconds (watchdog or ElevenLabs post-call webhook).
4. **Patient dashboard** (`/patient`): simple summary card appears with shimmer → fade-in animation.
5. **Nurse detail page** (`/patients/[id]`): clinical summary card renders above the call timeline.
6. If outcome = `escalated_911`:
   - Patient side: `Fake911Modal` full-screen overlay with TTS ("Ambulance dispatched…"); auto-dismiss ≤15s.
   - Nurse side: sticky red `Critical911Banner` at top of the admin shell until the Acknowledge button is clicked.
7. KPI **Open alerts** count increments on each new `alert_opened` SSE event; decrements on **Ack**.
8. Ack button on each alert row removes the row from `AlertFeed`.
9. `TrajectoryChart` + `CallTimeline` render a colored marker at the new call's timestamp — green (`fine`), amber (`schedule_visit`), or red (`escalated_911`).
10. Reload the admin page: open-alert count reflects real server state via `GET /api/alerts/open-count`.

## Call Lifecycle Regression Matrix

Backend tests to keep green on every change:

- `tests/test_models.py` — Call + Alert field defaults
- `tests/test_outcomes.py` — outcome derivation
- `tests/test_summarization.py` — Gemini patient + nurse prompts
- `tests/test_config.py` — new settings fields
- `tests/test_finalize.py` — idempotency, Gemini failure, 911 escalation paths
- `tests/test_webhook_post_call.py` — HMAC verify, demo bypass, bad/good payloads
- `tests/test_watchdog.py` — 40s timeout, no-op races
- `tests/test_call_handler.py` — `dial_patient_with_watchdog` spawn + no-op
- `tests/test_alert_ack.py` — ack, 409 on dup/missing, SSE emit
- `tests/test_open_alert_count.py` — count filter
- `tests/test_summary_regenerate.py` — on-demand regen, 404 on missing
- `tests/test_call_lifecycle.py` — end-to-end integration + watchdog/webhook race
