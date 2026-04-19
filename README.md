<div align="center">

# Sentinel

**Post-discharge deterioration detection, in real time.**

Voice check-ins · Wearable vitals · Live risk trajectory · Human-in-the-loop escalation

</div>

---

## Why Sentinel

Sepsis is fast, quiet, and often missed until it's too late. ~270,000 Americans die of sepsis annually, and ~80% of cases begin **outside** the hospital — after discharge, when formal monitoring stops but physiology has not stabilised. Families frequently say in retrospect that their loved one *"sounded off"* the day before: breathless, confused, slower to find words.

Sentinel lives in that gap. A focused triage surface for a clear cohort (post-op, days 0–14), grounded in published clinical rubrics (qSOFA, NEWS2, ACS NSQIP post-op), with an escalation ladder that **always hands off to a human**.

---

## What it does

- **Calls the patient** on a recurring schedule — browser widget today, real outbound phone via Twilio + ElevenLabs tomorrow.
- The call is driven by an **ElevenLabs Conversational AI agent** with a strict nurse persona: breathing → fever → pain → wound → eating → confusion, in about a minute.
- When the call ends, Sentinel pulls the transcript from ElevenLabs and scores it via **Gemini 2.0 Flash through OpenRouter** against qSOFA / NEWS2 red flags. Voice biomarkers (jitter, shimmer, pause ratio, estimated breaths per minute) are extracted via **openSMILE eGeMAPS**.
- **Wearable vitals** (HR, SpO₂, respiratory rate, HRV, temp) are ingested from the paired mobile app *or* seeded from the in-app demo panel, and folded into scoring.
- Results are persisted to **MongoDB** and pushed live to connected dashboards via **Server-Sent Events**.
- If the deterioration score crosses a threshold, Sentinel **escalates**: SMS to caregiver, SMS to on-call nurse, dashboard banner, and a push notification on the patient's mobile device. A dead-man's-switch audit job flags any case where an alert should have fired but didn't.

---

## Surfaces

| Surface | Audience | What it is |
|---|---|---|
| **`/admin`** | Clinician | Patient grid, KPI strip (open alerts / due today), live alert stream, **Call now** on each card. |
| **`/patient`** | Patient (web fallback) | Incoming-call card with pulse ring, ElevenLabs Convai widget, live trajectory, plain-language AI summary. Mic-priming for iOS Safari. |
| **Mobile (`mobile/`)** | Patient | Native Expo app. Pair code + device JWT, HealthKit / Health Connect background sync, Expo push for incoming calls, in-app voice. |

Two roles, one passkey each. `/admin/*` and `/patient/*` are gated at the Next.js edge middleware with HMAC-signed session cookies (14-day TTL, `HttpOnly`, `Secure` on HTTPS origins).

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Backend API | **FastAPI** (Python 3.11+) | Async, typed, fits Motor/Mongo + OpenRouter/ElevenLabs. |
| Database | **MongoDB** (Atlas or local) | Time-series collection for vitals, aggregation pipelines for the dashboard, native vector search for cohort similarity. |
| Scoring / summaries | **Gemini 2.0 Flash via OpenRouter** | Unified API, one key, Gemini-direct fallback. |
| Voice agent | **ElevenLabs Conversational AI** | Natural, interruptible dialogue; self-serve agent config. |
| Telephony (optional) | **Twilio** | Real outbound dialling via ElevenLabs' Twilio integration. |
| Audio features | **openSMILE (eGeMAPSv02)** | Published clinical voice-biomarker set — no training needed. |
| Scheduler | **APScheduler** | Cron for call triggering + auto-finalise + audit job. |
| Web frontend | **Next.js 14 (App Router) + Tailwind + Recharts** | SSR, split `/admin` ↔ `/patient`, Recharts trajectories. |
| Realtime | **Server-Sent Events** | Simpler than WebSockets, works through Next rewrites. |
| Mobile | **Expo 52 + Expo Router** (`mobile/`) | HealthKit / Health Connect → background sync → `POST /api/vitals/batch`, Expo push, LiveKit voice. |

No Redis, no broker, no Celery. Hand-rolled HMAC JWT, in-process SSE pub/sub, in-process rate limiter.

---

## Demo in 60 seconds (laptop-only)

1. Start the stack (below).
2. Open two browser windows — one normal, one incognito.
3. **Window 1** — `http://localhost:3000/login` → passkey `a` → `/admin`.
4. **Window 2** (incognito) — `http://localhost:3000/login` → passkey `b` → pick **David Patel** → `/patient`. Tap **Enable microphone**.
5. *(Optional)* append `?demo=1` to the /patient URL → **Simulate sepsis trajectory** → backend seeds deteriorating HR/SpO₂/RR/temp over the last 45 min.
6. Window 1 — **Call now** on David's card.
7. Window 2 — pulsing incoming card → **Answer** → ElevenLabs nurse agent starts.
8. Talk for a minute → hang up → score + patient summary + clinical summary arrive via SSE within **~3 seconds**.

---

## iPhone demo (Safari)

The patient surface works on iPhone Safari with a self-signed HTTPS cert. iOS requires HTTPS for `getUserMedia`, so we generate a cert for the LAN IP with `mkcert` and trust the CA on the device.

1. Start iPhone Personal Hotspot; laptop joins it. Note laptop's LAN IP (typically `172.20.10.x`).
2. Generate cert for that IP (see `certs/` + `mkcert` instructions below), run the frontend with `--experimental-https`.
3. On iPhone Safari:
   - Open `http://<LAN-IP>:8888/rootCA.pem` (a small http.server hosting the CA).
   - Install the downloaded profile → **Settings → VPN & Device Management** → **Install**.
   - **Settings → General → About → Certificate Trust Settings** → enable **mkcert development CA**.
4. Safari → `https://<LAN-IP>:3000/login` → green lock → passkey `b` → David.
5. Laptop admin clicks **Call now** → iPhone rings → Answer → widget mounts. Safari needs a real tap on the widget orb (not an auto-start) to satisfy the mic-permission gesture requirement.

Note: iOS Safari buffers ~2 KB before flushing the first SSE frame. The backend prepends a padding prelude so the stream is usable without a proxy doing it for you.

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
 └────────────────┘                         │    │             │
                                            │    │  patients,  │
 ┌────────────────┐                         │    │  calls,     │
 │ Patient (phone)│◀───── SSE /api/stream ──┤    │  alerts,    │
 │   /patient     │                         │    │  vitals,    │
 │  + Convai mic  │─── answers call ────────┤    │  devices    │
 └────────────────┘                         │    └─────▲───────┘
                                            ▼          │
                                ┌───────────────────────┴─────┐
                                │  FastAPI (sentinel.main)    │
                                │                             │
                                │  ┌──────────┐ ┌──────────┐  │
                                │  │Scheduler │ │ SSE bus  │  │
                                │  │(APS)     │ │ (pub/sub)│  │
                                │  └──────────┘ └──────────┘  │
                                │  ┌──────────────────────┐   │
                                │  │ ElevenLabs Convai    │   │
                                │  └──────────────────────┘   │
                                │  ┌──────────────────────┐   │
                                │  │ OpenRouter ↘ Gemini  │   │
                                │  │  (score + summary)   │   │
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
- MongoDB (Atlas or local — see "Local Mongo without Docker" below)
- An ElevenLabs account + Conversational AI agent (allowlist empty = open, or set a specific origin)
- An OpenRouter API key (and optionally a Google Gemini API key as fallback)
- *(Optional)* Twilio account for real outbound calls

### 1. Install

```bash
git clone https://github.com/officiallymoaizattiq-bit/sentinel-live.git
cd sentinel-live

# Backend
python -m venv backend/.venv
source backend/.venv/bin/activate
pip install -e backend
# Dev extras (pytest + mongomock-motor + respx)
pip install -e "backend[dev]"

# Frontend
cd frontend && npm install && cd ..
```

### 2. Configure

Copy examples and fill in:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

`backend/.env`:

| Key | Notes |
|---|---|
| `MONGO_URI` | Atlas connect string or `mongodb://localhost:27017`. |
| `MONGO_DB` | Database name, e.g. `sentinel`. |
| `OPENROUTER_API_KEY` | `sk-or-v1-...` from openrouter.ai. |
| `OPENROUTER_MODEL` | Default `google/gemini-2.0-flash-001`. |
| `GEMINI_API_KEY` | Optional — used as fallback if OpenRouter is down. |
| `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID` | From elevenlabs.io → Conversational AI. |
| `ADMIN_PASSKEY` / `PATIENT_PASSKEY` | Anything you want. |
| `SESSION_SECRET` / `DEVICE_TOKEN_SECRET` | Long random strings. |
| `CORS_ORIGINS` | Comma-separated list of allowed browser origins. |
| `DEMO_MODE` | `true` unlocks `/api/demo/*` endpoints and a few dev shortcuts. |

`frontend/.env.local`:

| Key | Value |
|---|---|
| `BACKEND_URL` | Server-side fetch target, e.g. `http://localhost:8000`. |
| `NEXT_PUBLIC_BACKEND_URL` | Browser SSE target. Leave empty to use Next rewrites. |
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | Same agent ID as backend (exposed to the browser for the widget). |

### 3. Run

```bash
# terminal 1 — Mongo (if local)
mongod --dbpath /tmp/mongo-data --bind_ip 127.0.0.1 --port 27017

# terminal 2 — backend
cd backend && source .venv/bin/activate
set -a && source .env && set +a
uvicorn sentinel.main:app --host 0.0.0.0 --port 8000 --app-dir .

# terminal 3 — frontend
cd frontend && npm run dev

# terminal 4 — seed demo data (once)
curl -X POST http://localhost:8000/api/demo/run
```

Open http://localhost:3000/login.

### 3b. HTTPS dev (for iPhone demo)

Generate a LAN cert + run Next over HTTPS:

```bash
# Install mkcert binary (no brew needed)
curl -fsSL -o /tmp/mkcert https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-darwin-arm64
chmod +x /tmp/mkcert

# Create a local CA and cert for LAN IP + localhost
mkdir -p certs && CAROOT=./certs /tmp/mkcert -install || true
CAROOT=./certs /tmp/mkcert -cert-file certs/cert.pem -key-file certs/key.pem \
  $(ipconfig getifaddr en0) localhost 127.0.0.1

# Run Next with the cert
cd frontend && npx next dev -p 3000 -H 0.0.0.0 \
  --experimental-https \
  --experimental-https-key ../certs/key.pem \
  --experimental-https-cert ../certs/cert.pem

# Serve rootCA.pem so the iPhone can fetch it
python3 -m http.server 8888 --directory certs --bind 0.0.0.0
```

On the iPhone, fetch `http://<LAN-IP>:8888/rootCA.pem`, install the profile, enable full trust in Certificate Trust Settings, then visit `https://<LAN-IP>:3000/login`.

### 4. (Optional) Mobile dev client

```bash
cd mobile
cp .env.example .env
# edit .env: EXPO_PUBLIC_API_URL=<your backend>
npm install --legacy-peer-deps
# Mobile uses native modules (HealthKit, LiveKit, WebRTC) — Expo Go does NOT work.
# You must use a dev-client build:
npx expo prebuild
npm run ios         # or: npm run android
```

### 5. (Optional) Real phone calling

Twilio + verified caller ID → register the number with ElevenLabs:

```bash
cd backend && source .venv/bin/activate
set -a && source .env && set +a
python scripts/register_twilio_with_el.py +1XXXXXXXXXX "Sentinel Line"
```

Paste the printed `phone_number_id` into `ELEVENLABS_PHONE_NUMBER_ID`, set `DEMO_MODE=false`, restart. *Call now* now dials for real.

---

## Local Mongo without Docker (macOS arm64)

If Homebrew is blocked (outdated Xcode) and Docker isn't available, use the Mongo tarball directly:

```bash
curl -fsSL -o /tmp/mongo.tgz https://fastdl.mongodb.org/osx/mongodb-macos-arm64-8.0.4.tgz
mkdir -p /tmp/mongo && tar -xzf /tmp/mongo.tgz -C /tmp/mongo
mkdir -p /tmp/mongo-data
/tmp/mongo/mongodb-macos-aarch64-8.0.4/bin/mongod --dbpath /tmp/mongo-data --bind_ip 127.0.0.1 --port 27017 &
```

Point `MONGO_URI=mongodb://localhost:27017` in `backend/.env`.

---

## API surface

Routes prefixed with `/api`.

### Read

| Route | Purpose |
|---|---|
| `GET /api/health` | `{ok, mongo_ok, llm_ready, uptime_s}`. |
| `GET /api/patients` | Patient list. |
| `GET /api/patients/with-summary` | Patient list + last-10 score series + latest outcome (one round-trip; replaces N+1). |
| `GET /api/patients/{id}` | Patient detail. |
| `GET /api/patients/{id}/calls` | Call history. |
| `GET /api/patients/{id}/vitals?hours=N` | Vitals series. |
| `GET /api/stream` | Server-Sent Events for `hello`, `pending_call`, `call_completed`, `call_scored`, `alert`, `alert_opened`, `alert_ack`, `vitals`. |
| `GET /api/alerts` / `GET /api/alerts/open-count` | Alert feed + KPI. |

### Write

| Route | Purpose |
|---|---|
| `POST /api/calls/trigger` | Admin "Call now". Emits `pending_call` + Expo push; in phone mode dials via Twilio. |
| `POST /api/calls/widget-end` | Web-fallback end: insert pre-scored call, **return immediately** with `{background: true}`, finalize + summarize in a strong-ref'd background task. |
| `POST /api/calls/finalize` | Webhook-driven finalize. |
| `POST /api/vitals/batch` | Idempotent wearable ingestion (device JWT, clock-skew aware). |
| `POST /api/devices/push-token` | Mobile push-token registration. |
| `POST /api/patients` | Enroll patient (idempotent for supplied `patient_id`). |
| `POST /api/pairing/code` | Generate 6-digit code. |
| `POST /api/pairing/exchange` | Exchange code → device JWT. 429 after 5 bad attempts per code. |
| `POST /api/demo/run` | Seed 3 demo trajectories. Rate-limited 3/min/IP. |
| `POST /api/demo/seed-vitals` | Seed deteriorating HR/SpO₂/RR/temp for a patient. Rate-limited 10/min/IP. |

### Auth

| Route | Purpose |
|---|---|
| `POST /api/auth/login` | Dashboard passkey login, sets `sentinel_session` cookie. |
| `POST /api/auth/logout` | Clears session cookie. |
| `GET /api/auth/me` | `{role, patient_id?}`. |

All passkey compares are constant-time (`hmac.compare_digest`). Session cookies enforce `Secure` on HTTPS origins and carry a 14-day server-side age check.

---

## SSE event vocabulary

```
hello                                         # connect
pending_call      {patient_id, mode, at}      # ring patient
call_completed    {call_id, patient_id,       # fires TWICE per widget-end:
                    outcome_label,            #  once immediately with null summaries,
                    escalation_911,           #  then again when summaries resolve
                    summary_patient|null,
                    summary_nurse|null}
call_scored       {call_id, patient_id,       # Gemini function-call landed
                    score, at}
alert             {patient_id, call_id,       # escalation fired
                    severity, summary, at}
alert_opened / alert_ack                      # admin side-effects
vitals            {patient_id, device_id,     # batch accepted
                    accepted, at}
```

SSE responses include a 4 KB `: padding` prelude so iOS Safari's internal buffer flushes the first event immediately. `X-Accel-Buffering: no` + `Cache-Control: no-transform` are set to keep intermediate proxies honest.

---

## Testing

```bash
# backend
cd backend && source .venv/bin/activate
pytest                                    # 117 tests

# frontend
cd frontend && npx tsc --noEmit && npm run build

# mobile
cd mobile && npx tsc --noEmit && npm test
```

End-to-end smoke against a running stack:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/api/health
curl -s -X POST http://localhost:8000/api/calls/trigger \
     -H "content-type: application/json" \
     -d '{"patient_id":"<uuid>"}'
```

---

## Performance

- **Widget-end → dashboard score**: < 100 ms (immediate `call_completed` with null summaries).
- **Widget-end → dashboard summary**: ~2–3 s (OpenRouter call, parallel patient + nurse summary via `asyncio.gather`).
- **Patient grid load**: 1 aggregation query (`/api/patients/with-summary`) vs. the prior N+1 pattern.
- **Background finalize**: strong-ref task set so the bg task is not GC'd mid-flight — a bug that previously orphaned occasional calls.

---

## Structure

```
sentinel-live/
├── backend/                       # FastAPI service
│   ├── sentinel/
│   │   ├── api.py                 # REST + SSE routes, rate limiter, bg-task registry
│   │   ├── main.py                # app factory, lifespan, access-log middleware, /api/health
│   │   ├── config.py              # pydantic-settings
│   │   ├── db.py                  # Motor client + index bootstrap (race-safe)
│   │   ├── models.py              # Pydantic v2 domain models
│   │   ├── scheduler.py           # APScheduler jobs (UTC-pinned)
│   │   ├── scoring.py             # OpenRouter-first LLM + Gemini fallback + openSMILE + cohort vector search
│   │   ├── summarization.py       # summary_patient / summary_nurse via OpenRouter (placeholder-guarded prompts)
│   │   ├── finalize.py            # post-call finalize (parallel summaries, atomic ended_at)
│   │   ├── audio_features.py      # openSMILE eGeMAPS + rules-only fallback
│   │   ├── escalation.py          # policy + Twilio SMS + SSE publish
│   │   ├── push.py                # Expo push (dedup, retry, rate-limited)
│   │   ├── webhooks.py            # ElevenLabs / Twilio inbound (HMAC verify, 1 MiB cap)
│   │   ├── call_handler.py        # outbound dialing (async, non-blocking EL SDK)
│   │   ├── events.py              # in-process SSE pub/sub (iOS-Safari padding, keepalive)
│   │   ├── pairing.py             # 6-digit code pairing (brute-force lockout)
│   │   ├── vitals.py              # wearable ingestion + idempotency + clock skew
│   │   ├── auth.py                # device JWT (constant-time compare)
│   │   ├── web_auth.py            # dashboard sessions (Secure cookie on HTTPS)
│   │   ├── watchdog.py            # dead-man's-switch audit
│   │   ├── outcomes.py            # outcome labelling
│   │   ├── demo_vitals.py         # seed sepsis/mild trajectories
│   │   └── seed.py / named_seed.py / demo_runner.py / replay.py
│   ├── tests/                     # pytest + mongomock-motor
│   └── scripts/register_twilio_with_el.py
├── frontend/                      # Next.js 14 App Router
│   ├── app/
│   │   ├── admin/                 # clinician dashboard (KPI strip + patient grid)
│   │   ├── patient/               # patient web surface (iOS-polished)
│   │   ├── patients/[id]/         # clinician deep-dive
│   │   ├── login/                 # role-picker
│   │   ├── diag/                  # SSE debug page
│   │   ├── not-found.tsx  error.tsx  global-error.tsx  loading.tsx
│   │   └── layout.tsx             # PWA manifest, viewport, safe-area
│   ├── components/
│   │   ├── shell/  dashboard/  patient/  admin/  ui/
│   │   └── patient/PatientLiveView.tsx   # widget mount with customElements guard + mic primer + audio-unlock
│   ├── lib/
│   │   ├── api.ts  format.ts  latestScoredCall.ts  patientQuery.ts
│   │   └── hooks/  (useEventStream, usePolling)
│   ├── public/
│   │   ├── manifest.webmanifest  icon.svg  apple-touch-icon.svg
│   └── middleware.ts              # auth-gate /admin + /patient
├── mobile/                        # Expo dev client
│   ├── app/                       # (onboarding), (main), _layout (deep-link pairing)
│   ├── src/
│   │   ├── api/      # typed client incl. summary_patient
│   │   ├── auth/     # SecureStore + localStorage shim for web preview
│   │   ├── components/
│   │   ├── health/   # HealthKit + Health Connect adapters
│   │   ├── sync/     # background task + cursor + clock-skew detection
│   │   ├── realtime/ # SSE hook
│   │   └── notifications/   # push token (retry w/ backoff)
│   └── plugins/with-health-connect-delegate.js
├── docs/
│   ├── RUNBOOK.md                 # operational playbook
│   ├── backend-contract.md        # mobile ↔ backend wire contract (v1)
│   └── curl-smoke.sh              # end-to-end contract test
├── demo/
│   ├── scripts/*.txt              # transcripts for offline replay
│   └── audio/*.wav                # placeholder recordings
├── certs/                         # mkcert-generated (gitignored in practice)
├── render.yaml                    # one-click Render deploy blueprint
└── README.md
```

---

## Scope, honestly

Sentinel is a demo. It is **not a medical device**. It does not diagnose. It does not replace a clinician. All escalation paths terminate at a human, and the `recommended_action` field caps at *"suggest a 911 call"* — the system never autonomously dials 911.

Clinical rubrics are grounded in published scores (qSOFA, NEWS2, ACS NSQIP post-op). Voice biomarkers use openSMILE's eGeMAPSv02 feature set. Cohort embeddings are seeded synthetically for the demo; a real deployment would backfill from MIMIC-IV / eICU-CRD under credentialed access and involve clinical validation before any patient-facing use.

---

## License

MIT. Copy, fork, ship.
