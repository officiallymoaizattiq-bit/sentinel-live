<div align="center">

# Sentinel

**Post-discharge deterioration detection, in real time.**

Voice check-ins · Wearable vitals · Live risk trajectory · Human-in-the-loop escalation

[Live demo script](#live-demo-in-60-seconds) · [Architecture](#architecture) · [Quick start](#quick-start) · [Mobile app](#mobile-companion) · [Runbook](./docs/RUNBOOK.md) · [Backend ↔ mobile contract](./docs/backend-contract.md)

</div>

---

## Why Sentinel

Sepsis is fast, quiet, and often missed until it's too late. Roughly **270,000 Americans die of sepsis each year, and ~80% of cases begin outside the hospital** — after discharge, when formal monitoring stops but physiology has not stabilised. Families frequently say in retrospect that their loved one *"sounded off"* the day before: breathless, confused, slower to find words.

Sentinel lives in that gap. A focused triage surface for a clear cohort (post-op, days 0–14), grounded in published clinical rubrics (qSOFA, NEWS2, ACS NSQIP post-op), with an escalation ladder that **always hands off to a human**.

Built for **Hook Em Hack**. Patient-centred, not provider-centred.

---

## What it does

- **Calls the patient** on a recurring schedule — browser widget today, real outbound phone via Twilio + ElevenLabs tomorrow.
- The call is driven by an **ElevenLabs Conversational AI agent** with a strict nurse persona: breathing → fever → pain → wound → eating → confusion, in about a minute.
- When the call ends, Sentinel pulls the transcript + audio from ElevenLabs and scores it with **Gemini 2.x Flash** against qSOFA / NEWS2 red flags. Voice biomarkers (jitter, shimmer, pause ratio, estimated breaths per minute) are extracted via **openSMILE eGeMAPS** and compared to the patient's day-1 baseline.
- **Wearable vitals** (heart rate, SpO₂, respiratory rate, HRV, sleep, activity) ingested from the paired mobile app are folded into the same scoring prompt so Gemini reasons over the full picture.
- Results are persisted to **MongoDB Atlas** and **pushed live** to connected dashboards via **Server-Sent Events** — no polling, no refresh.
- If the deterioration score crosses a threshold, Sentinel **escalates**: SMS to caregiver, SMS to on-call nurse, dashboard banner, and a heads-up notification on the patient's mobile device. A dead-man's-switch audit job flags any case where an alert should have fired but didn't.

---

## Surfaces

| Surface | Audience | What it is |
|---|---|---|
| **`/admin`** | Clinician | Patient grid, KPI strip, filters, **Call now** on each card. |
| **`/patients/[id]`** | Clinician | Patient hero, live trajectory, wearable-vitals panel, call log, **Trigger call**. |
| **`/patient`** | Patient (web fallback) | SSE "incoming call" toast, Answer opens the ElevenLabs widget. |
| **Mobile (`mobile/`)** | Patient | Native Expo app. Pairs to the backend, syncs HealthKit / Health Connect vitals in the background, receives push calls, shows the same live dashboard as the web patient view — plus a plain-language AI summary after each check-in. |

Two roles, one passkey each. `/admin/*` and `/patient/*` are gated at the Next.js edge middleware with HMAC-signed session cookies (14-day TTL, `HttpOnly`).

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Backend API | **FastAPI** (Python 3.11+) | Async, typed, fits the Motor/Mongo + Gemini/EL stacks. |
| Database | **MongoDB Atlas** | Time-series collection for vitals + native vector search for cohort similarity, in one store. |
| Scoring LLM | **Google Gemini 2.x Flash** | Long-context reasoning over transcript + voice biomarkers + wearable vitals + prior calls. Native function-calling for structured scores. |
| Voice agent | **ElevenLabs Conversational AI** | Natural, interruptible, low-latency dialogue. |
| Telephony (optional) | **Twilio** | Real outbound dialling via ElevenLabs' native Twilio integration. |
| Audio features | **openSMILE (eGeMAPSv02)** | Published clinical voice-biomarker set — no training needed. |
| Scheduler | **APScheduler** | Cron for call triggering + auto-finalise + dead-man's-switch audit, on the captured event loop. |
| Web frontend | **Next.js 14 (App Router) + Tailwind + Recharts** | SSR, clean `/admin` ↔ `/patient` split, Recharts for trajectory + vitals. |
| Realtime | **Server-Sent Events** | Simpler than WebSockets, no backchannel, bypasses Next's dev proxy to avoid SSE buffering. |
| Mobile companion | **Expo 52 + Expo Router** (`mobile/`) | Pair-code + device JWT, HealthKit / Health Connect → background sync → `POST /api/vitals/batch` (idempotent, clock-skew aware), Expo push for incoming calls, LiveKit/WebRTC for in-app voice. |

No Redis, no broker, no Celery. Hand-rolled HMAC JWT, in-process SSE pub/sub.

---

## Live demo in 60 seconds

Open two browser windows — one normal, one incognito, so cookie jars don't collide.

1. **Window 1** — sign in as admin (`ADMIN_PASSKEY`). Land on `/admin`.
2. **Window 2** — sign in as patient (`PATIENT_PASSKEY`), pick **David Patel**. Land on `/patient`. The green **● live** badge shows the SSE stream is attached.
3. Window 1 — hit **Call now** on David's card (or open his detail page and **Trigger call**).
4. Window 2 — *"Sentinel is calling you"* banner appears immediately.
5. Click **Answer**. The ElevenLabs widget mounts and the agent greets: *"Hi, this is Sentinel, your post-operative check-in nurse. Do you have a minute?"*
6. Answer a few questions. End the call.
7. Within 30 seconds the finalize pipeline pulls the transcript + audio, scores it, writes `summary_patient` / `summary_nurse`, and emits a `call_scored` event. Window 1's alert feed updates — no refresh.

If the patient describes anything urgent (severe chest pain, can't breathe, losing consciousness), the agent immediately says *"please hang up and call 911."* That's a system-prompt rule, not a prompt-engineering trick.

---

## Architecture

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
                                │  │   SMS + Expo push    │   │
                                │  │   + SSE dashboard)   │   │
                                │  └──────────────────────┘   │
                                └─────────────────────────────┘
```

---

## Quick start

### Prerequisites

- Python 3.11+
- Node 18+
- `ffmpeg`, `libsndfile` on PATH (`brew install ffmpeg libsndfile`)
- MongoDB (Atlas or `mongodb://localhost:27017`)
- An ElevenLabs account + Conversational AI agent
- A Gemini API key
- *(Optional)* Twilio account for real outbound calls

### 1. Install

```bash
git clone https://github.com/officiallymoaizattiq-bit/sentinel-live.git
cd sentinel-live

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

| Key | Get it from |
|---|---|
| `MONGO_URI` | Atlas cluster *Connect* string, or `mongodb://localhost:27017` |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID` | [elevenlabs.io → Conversational AI](https://elevenlabs.io/app/conversational-ai) |
| `ADMIN_PASSKEY` + `PATIENT_PASSKEY` | Anything you want |
| `SESSION_SECRET` + `DEVICE_TOKEN_SECRET` | Long random strings (`openssl rand -hex 32`) |

And `frontend/.env.local`:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | Same agent ID as above (browser-exposed for the widget) |
| `BACKEND_URL` | `http://localhost:8000` |

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

Open **http://localhost:3000/login**.

### 4. (Optional) Mobile dev client

```bash
cd mobile
cp .env.example .env
# edit .env: EXPO_PUBLIC_API_URL=<your backend>
npm install --legacy-peer-deps
npx expo prebuild
npm run ios         # or: npm run android
```

Full setup — HealthKit entitlements, Health Connect client, push certificates, pairing-code deep links — in [`mobile/README.md`](./mobile/README.md).

### 5. (Optional) Real phone calling

You need a Twilio number plus a verified caller ID (trial accounts require this).

```bash
cd backend && source .venv/bin/activate
export $(grep -v '^#' .env | xargs)
python scripts/register_twilio_with_el.py +1XXXXXXXXXX "Sentinel Line"
```

Paste the printed `phone_number_id` into `ELEVENLABS_PHONE_NUMBER_ID`, set `DEMO_MODE=false`, restart. *Call now* now dials for real.

---

## Mobile companion

The `mobile/` app is the patient-facing surface on iOS and Android, and the production path for vitals ingestion. Built with **Expo SDK 52 + Expo Router** and typed end-to-end against the locked [backend contract](./docs/backend-contract.md).

Features:

- **Secure pairing**: 6-digit code or `sentinel://pair/<code>` deep link, device-scoped HS256 JWT persisted in `expo-secure-store`.
- **Background vitals sync**: `expo-background-fetch` + `expo-task-manager` every ~15 min. `POST /api/vitals/batch` is idempotent, clock-skew aware, and resumes from a server-held cursor across app kills.
- **Live dashboard**: SSE attaches in foreground; shows latest check-in, deterioration trajectory, plain-language AI summary of the most recent call, and a KPI strip (status / stream / sync / calls).
- **Incoming-call ring**: Expo push → heads-up notification → tap to launch the in-app call screen (LiveKit + ElevenLabs).
- **Web preview**: `expo start --web` mounts the same UI in a browser — handy for quick design iteration without a device.

Design tokens mirror the web dashboard's Tailwind palette so a clinician switching between the `/admin` dashboard and the patient's phone sees one coherent surface. Glass surfaces are pre-tinted in `accent-400` to recreate the web's `backdrop-filter: saturate(155%)` frost on platforms that don't support backdrop filters natively.

---

## Repository layout

```
sentinel-live/
├── backend/                       # FastAPI service
│   ├── sentinel/
│   │   ├── api.py                 # REST + SSE routes
│   │   ├── main.py                # app factory, CORS, lifespan
│   │   ├── config.py              # pydantic-settings
│   │   ├── db.py                  # Motor client + index bootstrap
│   │   ├── models.py              # Pydantic domain models
│   │   ├── scheduler.py           # APScheduler: calls, finalize, audit
│   │   ├── scoring.py             # Gemini function-calling + vitals fusion
│   │   ├── summarization.py       # summary_patient / summary_nurse
│   │   ├── finalize.py            # post-call finalize pipeline
│   │   ├── audio_features.py     # openSMILE + rules-only fallback
│   │   ├── escalation.py          # policy table + Twilio SMS + SSE publish
│   │   ├── push.py                # Expo push delivery
│   │   ├── webhooks.py            # ElevenLabs / Twilio inbound
│   │   ├── call_handler.py       # outbound dialing
│   │   ├── events.py              # in-process pub/sub
│   │   ├── pairing.py             # 6-digit code pairing
│   │   ├── vitals.py              # wearable ingestion + idempotency
│   │   ├── auth.py                # device JWT
│   │   ├── web_auth.py            # admin/patient dashboard session
│   │   ├── watchdog.py            # dead-man's-switch audit
│   │   ├── outcomes.py            # outcome labelling
│   │   └── seed.py / named_seed.py / demo_runner.py / replay.py
│   ├── tests/                     # pytest + mongomock-motor
│   └── scripts/register_twilio_with_el.py
├── frontend/                      # Next.js 14 App Router
│   ├── app/
│   │   ├── admin/                 # clinician dashboard
│   │   ├── patient/               # patient web fallback
│   │   ├── patients/[id]/         # clinician deep-dive
│   │   └── login/
│   ├── components/
│   │   ├── shell/  dashboard/  patient/  admin/  ui/
│   ├── lib/
│   │   ├── api.ts  format.ts  latestScoredCall.ts  patientQuery.ts
│   │   └── hooks/  (useEventStream, usePolling)
│   └── middleware.ts              # auth-gate /admin + /patient
├── mobile/                        # Expo dev client
│   ├── app/                       # (onboarding), (main), _layout
│   ├── src/
│   │   ├── api/      # typed client, CallRecord incl. summary_patient
│   │   ├── auth/     # SecureStore + localStorage shim for web preview
│   │   ├── components/
│   │   ├── health/   # HealthKit + Health Connect adapters
│   │   ├── sync/     # background task + cursor
│   │   ├── realtime/ # SSE hook
│   │   └── notifications/
│   └── plugins/with-health-connect-delegate.js
├── docs/
│   ├── RUNBOOK.md                 # operational playbook
│   ├── backend-contract.md        # mobile ↔ backend wire contract (v1)
│   └── curl-smoke.sh              # 8-step end-to-end contract test
├── demo/
│   ├── scripts/*.txt              # transcripts for offline replay
│   └── audio/*.wav                # placeholder recordings
├── render.yaml                    # one-click Render deploy blueprint
└── README.md
```

---

## Deploy

### Render (one-click)

1. Push this repo to GitHub.
2. On [render.com](https://render.com) → **New Blueprint Instance** → connect the repo.
3. Render reads `render.yaml` and provisions `sentinel-api` (Docker) + `sentinel-ui` (Node) on the free tier.
4. Paste the secrets when prompted.
5. After the first deploy, set `PUBLIC_BASE_URL=https://sentinel-api.onrender.com` on the API service. That triggers one last redeploy.

Free-tier services sleep after 15 min idle — keep an UptimeRobot ping pointed at `/api/patients` in production.

### Anywhere else

- **API**: plain `uvicorn sentinel.main:app`. Any container or VM works. Bring your own Mongo.
- **UI**: plain `next start` after `next build`. Any Node host works.
- **Mobile**: EAS Build for TestFlight / Play Store (`eas.json` already configured).

See [`docs/RUNBOOK.md`](./docs/RUNBOOK.md) for the full operational playbook, including ngrok for live-call demos, Twilio registration, and the webhook URLs ElevenLabs needs.

---

## Testing

```bash
# backend
cd backend && source .venv/bin/activate
pytest                                    # unit + integration (mongomock-motor)

# frontend
cd frontend && npm run build && npm run lint

# mobile
cd mobile && npx tsc --noEmit && npm test

# end-to-end mobile ↔ backend smoke
./docs/curl-smoke.sh http://localhost:8000
```

---

## Scope, honestly

Sentinel is a demo. It is **not a medical device**. It does not diagnose. It does not replace a clinician. All escalation paths terminate at a human, and the `recommended_action` field caps at *"suggest a 911 call"* — the system never autonomously dials 911.

Clinical rubrics are grounded in published scores (qSOFA, NEWS2, ACS NSQIP post-op). Voice biomarkers use openSMILE's eGeMAPSv02 feature set. Cohort embeddings are seeded synthetically for the demo; a real deployment would backfill from MIMIC-IV / eICU-CRD under credentialed access and involve clinical validation before any patient-facing use.

---

## License

MIT. Copy, fork, ship. See `LICENSE` if a formal file is needed.
