# Sentinel

**Sentinel** extends clinical awareness beyond the hospital wall: post-op patients get scheduled **voice check-ins** (conversational AI), **wearable vitals** stream from a paired phone (HealthKit / Health Connect), and deterioration is scored into a **live trajectory** the care team sees in real time—before a small problem becomes an emergency.

Built for the **Hook Em Hack** hackathon. Patient-centered, not provider-centered.

---

## Why

Sepsis is **fast, quiet, and often missed until it is too late**—and a large share of cases begin **after discharge**, when formal monitoring stops but risk does not. Roughly **270,000 Americans** die from sepsis each year; about **80% starts outside the hospital**. Families often say in retrospect that their loved one *“sounded off”* the day before—breathless, confused, slower to find words. That gap between “something is quietly wrong” and a crisis is where Sentinel lives.

This is not a generic symptom chatbot. It is a focused triage surface for a clear cohort (post-op, days 0–14), clinical rubrics (qSOFA, NEWS2, ACS NSQIP), and an escalation ladder that always hands off to **humans**.

---

## Problem & approach (from the Devpost)

- **Inspiration:** Catch deterioration when monitoring has stopped but physiology has not stabilized.
- **Signals:** Voice (respiration, speech rate, latency, confusion cues in the agent transcript) plus **continuous wearable data** (heart rate, HRV, activity, etc.) strengthen detection.
- **Trajectory:** Early signals are fused into a continuous risk view; thresholds drive escalation to **patients, caregivers, and clinicians** in real time.
- **Personalization:** The pipeline establishes a **patient-specific baseline** on day one and tracks **deviation over time** instead of one-size-fits-all cutoffs.
- **Reality of the build:** Noisy, incomplete voice + wearable streams required normalization and fusion; the team prioritized **reliability and clarity** over extra complexity.
- **What’s next:** Clinical validation, deeper wearable integration, and deployment into real post-discharge workflows.

---

## What it does

- **Calls the patient** (browser widget today, real phone via Twilio/ElevenLabs tomorrow) on a recurring schedule.
- The call is driven by an **ElevenLabs Conversational AI agent** given a strict nurse persona: breathing → fever → pain → wound → eating → confusion, in one minute.
- After the call ends, the transcript is pulled from ElevenLabs and scored by **Gemini** against qSOFA / NEWS2 red flags. Voice biomarkers (jitter, shimmer, pause ratio, estimated breaths per minute) are extracted via openSMILE and compared to the patient's own day-1 baseline.
- **Recent wearable vitals** (heart rate, SpO2, respiratory rate, HRV, sleep) ingested from a paired phone are folded into the scoring prompt so Gemini sees the full picture.
- Results are written to MongoDB and **pushed live** to connected dashboards over Server-Sent Events.
- If the deterioration score crosses a threshold, the system **escalates**: SMS to caregiver, SMS to on-call nurse, and **live dashboard updates** (SSE). A dead-man's-switch audit job flags any case where an alert should have fired but didn't.

## Clinician + patient surfaces

- **`/admin`** — Clinician home: patient grid, KPI strip, filters, **Call now** on each card (queues `/api/calls/trigger`).
- **`/patients/[id]`** — Patient overview: hero, trajectory, **wearable vitals** (binned windows + gap-filled chart), **Trigger call** (same trigger API as Call now), call log.
- **`/patient`** — Patient phone view: SSE “incoming call” toast, **Answer** opens the ElevenLabs widget, same stream as the grid.

No polling. No refresh. State moves around in real time.

## Two login roles, one passkey each

- Admin: passkey `a` (default — change in `.env`)
- Patient: passkey `b` + pick the patient name

Sessions are HMAC-signed cookies, 14-day TTL, `HttpOnly`. Middleware gates `/admin/*` and `/patient/*` at the edge.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Backend API | **FastAPI** (Python 3.11+) | Async, typed, fits the Motor/Mongo + Gemini/EL stacks. |
| Database | **MongoDB Atlas** | Time-series collection for vitals + native vector search for cohort similarity, in one store. |
| Scoring LLM | **Google Gemini 2.x Flash** | Long-context reasoning over transcript + voice biomarkers + wearable vitals + prior calls. Native function-calling for structured scores. |
| Voice agent | **ElevenLabs Conversational AI** | The agent that runs the call itself. Natural, interruptible, low-latency. |
| Telephony (optional) | **Twilio** | Real outbound dialing via ElevenLabs' native Twilio integration. |
| Audio features | **openSMILE (eGeMAPS)** | Published clinical voice-biomarker set; no training needed. |
| Scheduler | **APScheduler** | Cron-equivalent for call triggering + auto-finalize + dead-man's-switch audit, on the captured event loop. |
| Frontend | **Next.js 14 (App Router) + Tailwind + Recharts** | Fast SSR, App Router for clean `/admin` vs `/patient` split, Recharts for trajectory + vitals charts. |
| Realtime | **Server-Sent Events** | Simpler than WebSockets; no backchannel needed. Bypasses Next's dev proxy to avoid SSE buffering. |
| Mobile companion | **Expo 52 + Expo Router** (`mobile/`) | Pair-code + device JWT; HealthKit / Health Connect → background sync → `POST /api/vitals/batch` (idempotency + clock skew). See `mobile/README.md`. |

Everything zero-dependency where it could be (hand-rolled HMAC JWT, in-process SSE pub/sub) — no Redis, no broker, no Celery.

---

## Live demo, in 60 seconds

Two browser windows (one normal, one incognito — different cookie jars):

1. **Window 1** — sign in as admin (`a`). Land on `/admin`.
2. **Window 2** — sign in as patient (`b`), pick **David Patel**. Land on `/patient`. Green **● live** badge appears — the page is subscribed to the event stream.
3. In Window 1, click **Call now** on David's card (or open `/patients/<id>` and use **Trigger call**).
4. Window 2 **immediately** shows *"Sentinel is calling you"*.
5. Click **Answer**. The ElevenLabs Convai widget mounts and the agent greets you: *"Hi, this is Sentinel, your post-operative check-in nurse. Do you have a minute?"*
6. Answer a few questions. End the call.
7. Within 30 seconds, a background poller pulls the transcript + audio from ElevenLabs, scores it, and emits a `call_scored` event over SSE. Window 1's alert feed updates without a refresh.

If the patient describes something urgent, the agent immediately says "please hang up and call 911." That's not a prompt trick — that's a rule in the system prompt.

---

## Quick start

You need:
- Python 3.11+
- Node 18+
- MongoDB (Atlas or local `mongodb://localhost:27017`)
- An ElevenLabs account + a Conversational AI agent
- A Gemini API key
- (Optional) Twilio account for real phone calls

### 1. Clone + install

```bash
git clone <your-fork-url> sentinel
cd sentinel

# Backend
python -m venv backend/.venv
source backend/.venv/bin/activate
pip install -e backend

# Frontend
cd frontend && npm install && cd ..
```

### 2. Configure

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Fill in `backend/.env`:
- `MONGO_URI` — Atlas connection string, or `mongodb://localhost:27017` if running Mongo locally
- `GEMINI_API_KEY` — from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID` — create an agent at [elevenlabs.io/app/conversational-ai](https://elevenlabs.io/app/conversational-ai)
- `ADMIN_PASSKEY` + `PATIENT_PASSKEY` — anything you want
- `SESSION_SECRET` + `DEVICE_TOKEN_SECRET` — replace with long random values before prod

And `frontend/.env.local`:
- `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` — same agent ID as above, exposed to the browser for the widget

### 3. Run

```bash
# terminal 1 — backend on :8000
cd backend && source .venv/bin/activate
export $(grep -v '^#' .env | xargs)
uvicorn sentinel.main:app --host 0.0.0.0 --port 8000 --reload

# terminal 2 — frontend on :3000
cd frontend && npm run dev

# terminal 3 — seed demo data
curl -X POST http://localhost:8000/api/demo/run
```

Open http://localhost:3000/login.

### 4. (Optional) Mobile dev client

The **`mobile/`** app pairs to the same backend and streams vitals. Quick path: `cd mobile && cp .env.example .env`, set `EXPO_PUBLIC_API_URL`, then `npm install` and `npx expo prebuild` — full steps in [`mobile/README.md`](./mobile/README.md).

### 5. (Optional) Real phone calling

You'll need a Twilio number and a verified caller ID on trial. Then:

```bash
cd backend && source .venv/bin/activate
export $(grep -v '^#' .env | xargs)
python scripts/register_twilio_with_el.py +1XXXXXXXXXX "Sentinel Line"
```

Paste the printed `phone_number_id` into `ELEVENLABS_PHONE_NUMBER_ID` in `.env`. Set `DEMO_MODE=false`. Restart. Now admin's **Call Now** dials for real.

---

## Architecture in one diagram

```
 ┌────────────────┐     ┌────────────────────────────────────┐
 │ mobile/ (Expo) │───▶ │  POST /api/vitals/batch            │
 │ HK + Health C. │     │  (device JWT, idempotency, skew)   │
 └────────────────┘     └────────────────┬───────────────────┘
                                          │
 ┌────────────────┐                       ▼
 │ Admin (laptop) │◀───── SSE /api/stream ──┐    ┌─────────────┐
 │   /admin       │                         │    │  MongoDB    │
 └────────────────┘                         │    │  Atlas      │
                                            │    │  (patients, │
 ┌────────────────┐                         │    │   calls,    │
 │ Patient (phone)│◀───── SSE /api/stream ──┤    │   alerts,   │
 │   /patient     │                         │    │   vitals,   │
 │  + Convai mic  │─── answers call ────────┤    │   devices,  │
 └────────────────┘                         │    │   cohort)   │
                                            ▼    └─────▲───────┘
                                ┌───────────────────────┴─────┐
                                │  FastAPI (sentinel.main)    │
                                │                             │
                                │  ┌──────────┐ ┌──────────┐  │
                                │  │Scheduler │ │ SSE bus  │  │
                                │  │(APS)     │ │ (pub/sub)│  │
                                │  └──────────┘ └──────────┘  │
                                │  ┌──────────────────────┐   │
                                │  │ ElevenLabs Convai    │   │
                                │  │ (agent dialog)       │   │
                                │  └──────────────────────┘   │
                                │  ┌──────────────────────┐   │
                                │  │ Gemini score_call    │   │
                                │  │ openSMILE features   │   │
                                │  │ Cohort $vectorSearch │   │
                                │  └──────────────────────┘   │
                                │  ┌──────────────────────┐   │
                                │  │ Escalation (Twilio   │   │
                                │  │   SMS + dashboard)   │   │
                                │  └──────────────────────┘   │
                                └─────────────────────────────┘
```

---

## Layout

```
sentinel/
├── backend/
│   ├── sentinel/           # FastAPI app + all business logic
│   │   ├── api.py          # REST + SSE routes
│   │   ├── main.py         # app factory + CORS + lifespan
│   │   ├── config.py       # pydantic-settings
│   │   ├── db.py           # Motor client + indexes
│   │   ├── models.py       # Pydantic models (one domain file)
│   │   ├── scheduler.py    # cron + auto-finalize + audit
│   │   ├── enrollment.py   # patient create
│   │   ├── named_seed.py   # 3 named demo patients
│   │   ├── demo_runner.py  # 3 distinct trajectories
│   │   ├── replay.py       # offline-scoring pipeline
│   │   ├── scoring.py      # Gemini function-calling + vitals fusion
│   │   ├── audio_features.py  # openSMILE + rules-only fallback
│   │   ├── escalation.py   # policy table + Twilio SMS + SSE publish
│   │   ├── call_handler.py # Twilio outbound via ElevenLabs
│   │   ├── events.py       # in-process pub/sub
│   │   ├── pairing.py      # 6-digit code pairing
│   │   ├── vitals.py       # wearable ingestion + idempotency
│   │   ├── auth.py         # device JWT
│   │   ├── web_auth.py     # admin/patient dashboard session
│   │   └── seed.py         # cohort fixture
│   ├── tests/              # pytest + mongomock-motor
│   ├── scripts/
│   │   └── register_twilio_with_el.py
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/
│   │   ├── page.tsx        # redirect → /login
│   │   ├── login/          # passkey form (role toggle)
│   │   ├── admin/          # clinician dashboard
│   │   ├── patient/        # patient phone view
│   │   └── patients/[id]/  # clinician deep-dive
│   ├── components/
│   │   ├── shell/          # AppShell + Aurora background
│   │   ├── dashboard/      # KpiStrip + PatientGrid
│   │   ├── patient/        # PatientLiveView, PatientHero, VitalsPanel, Deterioration…
│   │   ├── admin/          # CallNowButton (also used on /patients/[id] hero)
│   │   └── ui/             # Glass, Sparkline, SeverityChip
│   ├── lib/
│   │   ├── api.ts
│   │   ├── format.ts
│   │   └── hooks/
│   │       ├── useEventStream.ts
│   │       └── usePolling.ts
│   ├── middleware.ts       # auth-gate /admin + /patient
│   ├── next.config.mjs
│   └── .env.local.example
├── demo/
│   ├── scripts/*.txt       # transcripts for replay
│   └── audio/*.wav         # placeholder recordings
├── mobile/                 # Expo dev client (iOS + Android) — vitals sync, pairing, EL voice call
│   ├── app/                # Expo Router: onboarding, status, settings, in-app call
│   ├── src/                # API client, health adapters, sync, UI tokens, SSE hook
│   ├── docs/backend-contract.md  # mirror of ../docs/backend-contract.md
│   └── README.md           # native setup, Health Connect / HealthKit notes
├── docs/
│   ├── RUNBOOK.md          # step-by-step prod setup
│   ├── backend-contract.md # mobile ↔ backend contract (v1 locked)
│   └── curl-smoke.sh       # 8-step end-to-end mobile contract test
├── devpost.md              # hackathon narrative (inspiration, formula, challenges, next)
├── render.yaml             # one-click Render deploy (api + ui)
└── README.md
```

---

## Deploy

### Render (recommended)

1. Push this repo to GitHub.
2. Go to [render.com](https://render.com) → **New Blueprint Instance** → connect this repo.
3. Render reads `render.yaml` and provisions `sentinel-api` (Docker) + `sentinel-ui` (Node) on the free tier.
4. Paste your env vars when prompted.
5. After first deploy, set `PUBLIC_BASE_URL=https://sentinel-api.onrender.com` on the API service (triggers one last redeploy).

Free tier sleeps after 15 minutes idle — keep alive with an UptimeRobot ping in production.

### Anywhere else

The API is a plain `uvicorn` server. The UI is a plain `next start` server. Both read env vars from the environment. Deploy wherever you're comfortable.

---

## Scope honest box

Sentinel is a demo. It is not a medical device. It does not diagnose. It does not replace a clinician. Alerts escalate *to a human*, and the `recommended_action` field caps at "suggest a 911 call" — the system never autonomously dials 911.

Clinical rubrics are grounded in published scores (qSOFA, NEWS2, ACS NSQIP post-op). Voice biomarkers use openSMILE's eGeMAPSv02 feature set. Cohort embeddings are seeded synthetically for the demo; a real deployment would backfill from MIMIC-IV / eICU-CRD under credentialed access.

---

## License

MIT. See `LICENSE` if you need formal text — for hackathon purposes, copy freely.
