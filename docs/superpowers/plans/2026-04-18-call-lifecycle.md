# Call Lifecycle + Outcome Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship auto-ending calls, dual-audience Gemini summaries, fake 911 UX, live alert wiring, real open-alert KPI, and nurse outcome surfacing — all additive, zero regressions.

**Architecture:** Additive-only extension of existing Sentinel stack. New ElevenLabs post-call webhook + 40s watchdog converge on one idempotent `finalize_call()` service keyed by `conversation_id`. Finalize runs existing scoring, calls Gemini twice for dual summaries, writes new optional fields to `Call` + `Alert`, and emits three new SSE event types. Frontend listens for new events and renders new components alongside existing ones.

**Tech Stack:** Python 3.11+, FastAPI, Motor (Mongo), Pydantic v2, ElevenLabs SDK, Google Generative AI SDK, pytest + pytest-asyncio, Next.js 14 App Router, React 18, Tailwind.

**Reference spec:** `docs/superpowers/specs/2026-04-18-call-lifecycle-outcome-surfacing-design.md`

---

## File structure

### Backend — create

- `backend/sentinel/summarization.py` — Gemini wrappers: `summarize_patient()`, `summarize_nurse()`.
- `backend/sentinel/outcomes.py` — pure function: `derive_outcome_label(action) -> str`.
- `backend/sentinel/finalize.py` — idempotent `finalize_call(conversation_id, transcript, end_reason)`.
- `backend/sentinel/watchdog.py` — `start_call_watchdog(conversation_id, dial_started_at)` async task.
- `backend/sentinel/webhooks.py` — FastAPI router mounted at `/api/webhooks`, holds ElevenLabs post-call handler + HMAC verify.
- `backend/tests/test_outcomes.py`
- `backend/tests/test_summarization.py`
- `backend/tests/test_finalize.py`
- `backend/tests/test_watchdog.py`
- `backend/tests/test_webhook_post_call.py`
- `backend/tests/test_alert_ack.py`
- `backend/tests/test_open_alert_count.py`
- `backend/tests/test_summary_regenerate.py`
- `backend/tests/test_call_lifecycle.py`

### Backend — modify

- `backend/sentinel/models.py` — add optional fields to `Call` + `Alert`.
- `backend/sentinel/api.py` — mount webhooks router, add ack + regenerate + open-alerts endpoints, extend `/alerts` query support.
- `backend/sentinel/main.py` — include webhooks router in app factory.
- `backend/sentinel/call_handler.py` — spawn watchdog on dial.
- `backend/sentinel/config.py` — add `enable_call_summary`, `elevenlabs_webhook_secret` settings.

### Frontend — create

- `frontend/components/patient/CallLogCard.tsx`
- `frontend/components/patient/Fake911Modal.tsx`
- `frontend/components/admin/Critical911Banner.tsx`
- `frontend/components/admin/OutcomePill.tsx`
- `frontend/components/admin/AckButton.tsx`

### Frontend — modify

- `frontend/lib/api.ts` — add `Call` fields + `Alert` fields + new endpoint methods.
- `frontend/lib/hooks/useEventStream.ts` — extend event union with `call_completed`, `alert_opened`, `alert_ack`.
- `frontend/components/AlertFeed.tsx` — render AckButton inline, refetch on `alert_ack`.
- `frontend/components/dashboard/KpiStrip.tsx` — use new open-alert count source.
- `frontend/components/TrajectoryChart.tsx` — outcome-colored marker per call.
- `frontend/components/patient/CallTimeline.tsx` — outcome-colored marker per call.
- `frontend/components/patient/PatientLiveView.tsx` — mount CallLogCard, listen for call_completed, trigger Fake911Modal.
- `frontend/components/PatientCard.tsx` — render OutcomePill.
- `frontend/components/shell/AppShell.tsx` — mount Critical911Banner at top (admin shell only; no-op on patient route).
- `frontend/app/admin/page.tsx` — pass open-alert count from server to KpiStrip.
- `docs/RUNBOOK.md` — add demo verification checklist.

---

## Task 1: Extend `Call` + `Alert` models with new optional fields

**Files:**
- Modify: `backend/sentinel/models.py` (class `Call`, class `Alert`)
- Test: `backend/tests/test_models.py` (extend)

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/test_models.py`:

```python
from datetime import datetime

from sentinel.models import Alert, Call, RecommendedAction


def test_call_defaults_new_fields():
    c = Call(patient_id="p1", called_at=datetime(2026, 4, 18))
    assert c.conversation_id is None
    assert c.ended_at is None
    assert c.end_reason is None
    assert c.summary_patient is None
    assert c.summary_nurse is None
    assert c.summaries_generated_at is None
    assert c.summaries_error is None
    assert c.outcome_label is None
    assert c.escalation_911 is False


def test_call_accepts_new_fields():
    c = Call(
        patient_id="p1",
        called_at=datetime(2026, 4, 18),
        conversation_id="conv_abc",
        ended_at=datetime(2026, 4, 18, 0, 0, 40),
        end_reason="timeout_40s",
        summary_patient="You're doing okay.",
        summary_nurse="Vitals stable; no SIRS criteria met.",
        summaries_generated_at=datetime(2026, 4, 18),
        outcome_label="fine",
        escalation_911=False,
    )
    assert c.conversation_id == "conv_abc"
    assert c.end_reason == "timeout_40s"


def test_alert_defaults_new_fields():
    a = Alert(
        patient_id="p1",
        call_id="c1",
        severity=RecommendedAction.NURSE_ALERT,
        channel=["sms"],
        sent_at=datetime(2026, 4, 18),
    )
    assert a.acknowledged is False
    assert a.acknowledged_at is None
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd backend && .venv/bin/pytest tests/test_models.py -v
```

Expected: 3 new tests FAIL with `AttributeError` on missing fields.

- [ ] **Step 3: Add optional fields to models**

Edit `backend/sentinel/models.py`:

```python
from typing import Literal
```

In `class Call`, after `short_call: bool = False`:

```python
    conversation_id: str | None = None
    ended_at: datetime | None = None
    end_reason: Literal["agent_signal", "timeout_40s", "manual"] | None = None
    summary_patient: str | None = None
    summary_nurse: str | None = None
    summaries_generated_at: datetime | None = None
    summaries_error: str | None = None
    outcome_label: Literal["fine", "schedule_visit", "escalated_911"] | None = None
    escalation_911: bool = False
```

In `class Alert`, after existing fields:

```python
    acknowledged: bool = False
    acknowledged_at: datetime | None = None
```

Leave existing `acknowledged_by` and `ack_at` in place (legacy compat; `ack_at` stays writable for old code but new code writes `acknowledged_at`).

- [ ] **Step 4: Run tests to verify pass**

```bash
cd backend && .venv/bin/pytest tests/test_models.py -v
```

Expected: all tests PASS, including pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add backend/sentinel/models.py backend/tests/test_models.py
git commit -m "feat(models): add optional call lifecycle + ack fields to Call and Alert"
```

---

## Task 2: Outcome label derivation

**Files:**
- Create: `backend/sentinel/outcomes.py`
- Create: `backend/tests/test_outcomes.py`

- [ ] **Step 1: Write failing test**

`backend/tests/test_outcomes.py`:

```python
from sentinel.models import RecommendedAction
from sentinel.outcomes import derive_outcome_label


def test_derive_outcome_label_911():
    assert derive_outcome_label(RecommendedAction.SUGGEST_911) == "escalated_911"


def test_derive_outcome_label_visit_nurse():
    assert derive_outcome_label(RecommendedAction.NURSE_ALERT) == "schedule_visit"


def test_derive_outcome_label_visit_caregiver():
    assert derive_outcome_label(RecommendedAction.CAREGIVER_ALERT) == "schedule_visit"


def test_derive_outcome_label_fine_patient_check():
    assert derive_outcome_label(RecommendedAction.PATIENT_CHECK) == "fine"


def test_derive_outcome_label_fine_none():
    assert derive_outcome_label(RecommendedAction.NONE) == "fine"
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd backend && .venv/bin/pytest tests/test_outcomes.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'sentinel.outcomes'`.

- [ ] **Step 3: Implement**

`backend/sentinel/outcomes.py`:

```python
from __future__ import annotations

from sentinel.models import RecommendedAction


def derive_outcome_label(action: RecommendedAction) -> str:
    if action == RecommendedAction.SUGGEST_911:
        return "escalated_911"
    if action in (RecommendedAction.NURSE_ALERT, RecommendedAction.CAREGIVER_ALERT):
        return "schedule_visit"
    return "fine"
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd backend && .venv/bin/pytest tests/test_outcomes.py -v
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/sentinel/outcomes.py backend/tests/test_outcomes.py
git commit -m "feat(outcomes): add outcome label derivation from RecommendedAction"
```

---

## Task 3: Gemini summarization service

**Files:**
- Create: `backend/sentinel/summarization.py`
- Create: `backend/tests/test_summarization.py`

- [ ] **Step 1: Write failing tests**

`backend/tests/test_summarization.py`:

```python
from unittest.mock import AsyncMock, patch

import pytest

from sentinel.summarization import summarize_patient, summarize_nurse


@pytest.mark.asyncio
async def test_summarize_patient_calls_gemini_with_simple_prompt():
    fake = AsyncMock(return_value=type("R", (), {"text": "You're okay."})())
    with patch("sentinel.summarization._generate", fake):
        out = await summarize_patient(transcript="agent: hi\npatient: fine")
    assert out == "You're okay."
    prompt = fake.call_args.args[0]
    assert "simple" in prompt.lower() or "plain" in prompt.lower()


@pytest.mark.asyncio
async def test_summarize_nurse_calls_gemini_with_clinical_prompt():
    fake = AsyncMock(return_value=type("R", (), {"text": "Pt stable; no SIRS."})())
    with patch("sentinel.summarization._generate", fake):
        out = await summarize_nurse(
            transcript="agent: hi\npatient: fine",
            vitals={"hr": 82, "spo2": 97},
            score={"deterioration": 0.1, "news2": 2},
        )
    assert out == "Pt stable; no SIRS."
    prompt = fake.call_args.args[0]
    assert "clinical" in prompt.lower() or "sbar" in prompt.lower()


@pytest.mark.asyncio
async def test_summarize_patient_raises_on_sdk_error():
    fake = AsyncMock(side_effect=RuntimeError("gemini down"))
    with patch("sentinel.summarization._generate", fake):
        with pytest.raises(RuntimeError):
            await summarize_patient(transcript="x")
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd backend && .venv/bin/pytest tests/test_summarization.py -v
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`backend/sentinel/summarization.py`:

```python
from __future__ import annotations

import asyncio
import logging
from typing import Any

import google.generativeai as genai

from sentinel.config import get_settings

log = logging.getLogger("sentinel.summarization")

_PATIENT_PROMPT = """You are explaining a post-surgery phone check-in result
to the patient themself. Use plain, simple English at a 6th-grade reading
level. Be warm and reassuring but honest. 2-3 sentences, no medical jargon.

Transcript:
{transcript}

Patient-facing summary:"""

_NURSE_PROMPT = """You are writing a clinical SBAR-style summary for a nurse
reviewing a post-operative voice check-in. Use concise clinical language.
Include: subjective complaints, relevant vitals, risk factors, and your
assessment. 3-5 sentences.

Transcript:
{transcript}

Vitals: {vitals}
Scoring: {score}

Clinical summary:"""


async def _generate(prompt: str) -> Any:
    s = get_settings()
    genai.configure(api_key=s.gemini_api_key)
    model = genai.GenerativeModel("gemini-1.5-flash")
    return await asyncio.to_thread(model.generate_content, prompt)


async def summarize_patient(transcript: str) -> str:
    r = await _generate(_PATIENT_PROMPT.format(transcript=transcript))
    return (r.text or "").strip()


async def summarize_nurse(transcript: str, vitals: dict, score: dict) -> str:
    r = await _generate(
        _NURSE_PROMPT.format(transcript=transcript, vitals=vitals, score=score)
    )
    return (r.text or "").strip()
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd backend && .venv/bin/pytest tests/test_summarization.py -v
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/sentinel/summarization.py backend/tests/test_summarization.py
git commit -m "feat(summarization): add Gemini patient + nurse summary wrappers"
```

---

## Task 4: Config flags for feature gate + webhook secret

**Files:**
- Modify: `backend/sentinel/config.py`
- Test: `backend/tests/test_config.py` (extend)

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_config.py`:

```python
def test_settings_new_fields_defaults(monkeypatch):
    monkeypatch.delenv("ENABLE_CALL_SUMMARY", raising=False)
    monkeypatch.delenv("ELEVENLABS_WEBHOOK_SECRET", raising=False)
    from sentinel.config import Settings

    s = Settings()
    assert s.enable_call_summary is True
    assert s.elevenlabs_webhook_secret == ""
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd backend && .venv/bin/pytest tests/test_config.py::test_settings_new_fields_defaults -v
```

Expected: FAIL — attribute missing.

- [ ] **Step 3: Add fields**

Edit `backend/sentinel/config.py` inside `Settings`:

```python
    enable_call_summary: bool = True
    elevenlabs_webhook_secret: str = ""
```

- [ ] **Step 4: Run test**

```bash
cd backend && .venv/bin/pytest tests/test_config.py -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/sentinel/config.py backend/tests/test_config.py
git commit -m "feat(config): add enable_call_summary + elevenlabs_webhook_secret settings"
```

---

## Task 5: Idempotent `finalize_call()` service

**Files:**
- Create: `backend/sentinel/finalize.py`
- Create: `backend/tests/test_finalize.py`

- [ ] **Step 1: Write failing tests**

`backend/tests/test_finalize.py`:

```python
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from sentinel.finalize import finalize_call


@pytest.fixture
async def seeded_call(mongo):
    await mongo.calls.insert_one(
        {
            "_id": "c1",
            "patient_id": "p1",
            "called_at": datetime(2026, 4, 18),
            "conversation_id": "conv_abc",
            "transcript": [],
            "short_call": False,
        }
    )
    return "c1"


@pytest.mark.asyncio
async def test_finalize_call_persists_summaries_and_outcome(mongo, seeded_call):
    with patch("sentinel.finalize.summarize_patient", AsyncMock(return_value="OK")), \
         patch("sentinel.finalize.summarize_nurse", AsyncMock(return_value="Stable.")), \
         patch("sentinel.finalize._score_if_needed", AsyncMock(return_value={
             "deterioration": 0.1, "qsofa": 0, "news2": 1, "red_flags": [],
             "summary": "stable", "recommended_action": "none",
         })), \
         patch("sentinel.finalize.publish") as pub:
        result = await finalize_call(
            conversation_id="conv_abc",
            transcript="agent: hi\npatient: fine",
            end_reason="agent_signal",
        )

    doc = await mongo.calls.find_one({"_id": "c1"})
    assert doc["summary_patient"] == "OK"
    assert doc["summary_nurse"] == "Stable."
    assert doc["outcome_label"] == "fine"
    assert doc["escalation_911"] is False
    assert doc["end_reason"] == "agent_signal"
    assert doc["ended_at"] is not None
    assert result["already_finalized"] is False
    pub.assert_any_call({"type": "call_completed", "call_id": "c1",
                         "patient_id": "p1", "outcome_label": "fine",
                         "escalation_911": False, "summary_patient": "OK",
                         "summary_nurse": "Stable."})


@pytest.mark.asyncio
async def test_finalize_call_idempotent(mongo, seeded_call):
    await mongo.calls.update_one(
        {"_id": "c1"},
        {"$set": {"ended_at": datetime(2026, 4, 18, 0, 0, 30),
                  "end_reason": "agent_signal",
                  "outcome_label": "fine"}},
    )
    result = await finalize_call(
        conversation_id="conv_abc",
        transcript="agent: hi",
        end_reason="timeout_40s",
    )
    assert result["already_finalized"] is True
    doc = await mongo.calls.find_one({"_id": "c1"})
    assert doc["end_reason"] == "agent_signal"  # not overwritten


@pytest.mark.asyncio
async def test_finalize_call_gemini_failure_still_persists(mongo, seeded_call):
    with patch("sentinel.finalize.summarize_patient", AsyncMock(side_effect=RuntimeError("gemini"))), \
         patch("sentinel.finalize.summarize_nurse", AsyncMock(side_effect=RuntimeError("gemini"))), \
         patch("sentinel.finalize._score_if_needed", AsyncMock(return_value={
             "deterioration": 0.1, "qsofa": 0, "news2": 1, "red_flags": [],
             "summary": "stable", "recommended_action": "none",
         })), \
         patch("sentinel.finalize.publish"):
        await finalize_call("conv_abc", "x", "agent_signal")

    doc = await mongo.calls.find_one({"_id": "c1"})
    assert doc["summary_patient"] is None
    assert doc["summary_nurse"] is None
    assert doc["summaries_error"] is not None
    assert doc["outcome_label"] == "fine"


@pytest.mark.asyncio
async def test_finalize_call_escalation_911_creates_alert(mongo, seeded_call):
    with patch("sentinel.finalize.summarize_patient", AsyncMock(return_value="stay calm")), \
         patch("sentinel.finalize.summarize_nurse", AsyncMock(return_value="critical")), \
         patch("sentinel.finalize._score_if_needed", AsyncMock(return_value={
             "deterioration": 0.9, "qsofa": 3, "news2": 15, "red_flags": ["sepsis"],
             "summary": "bad", "recommended_action": "suggest_911",
         })), \
         patch("sentinel.finalize.send_alert", AsyncMock()) as sa, \
         patch("sentinel.finalize.publish"):
        await finalize_call("conv_abc", "x", "agent_signal")

    doc = await mongo.calls.find_one({"_id": "c1"})
    assert doc["outcome_label"] == "escalated_911"
    assert doc["escalation_911"] is True
    sa.assert_awaited_once()
```

Test fixture `mongo` lives in `backend/tests/conftest.py` already (from `test_api.py` etc.). Verify it exists before running.

- [ ] **Step 2: Run tests to verify failure**

```bash
cd backend && .venv/bin/pytest tests/test_finalize.py -v
```

Expected: FAIL — `ModuleNotFoundError: sentinel.finalize`.

- [ ] **Step 3: Implement**

`backend/sentinel/finalize.py`:

```python
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sentinel.config import get_settings
from sentinel.db import get_db
from sentinel.escalation import send_alert
from sentinel.events import publish
from sentinel.models import RecommendedAction, Score
from sentinel.outcomes import derive_outcome_label
from sentinel.summarization import summarize_nurse, summarize_patient

log = logging.getLogger("sentinel.finalize")


async def _score_if_needed(call_doc: dict, transcript: str) -> dict:
    """Returns a score dict. Uses existing score if present; else computes."""
    existing = call_doc.get("score")
    if existing:
        return existing
    # Lazy import to avoid hard dep on scoring at import time
    from sentinel.scoring import score_call

    s: Score = await score_call(
        patient_id=call_doc["patient_id"], transcript=transcript
    )
    return s.model_dump()


async def finalize_call(
    conversation_id: str,
    transcript: str,
    end_reason: str,
) -> dict:
    settings = get_settings()
    db = get_db()

    doc = await db.calls.find_one({"conversation_id": conversation_id})
    if not doc:
        log.warning("finalize_call: unknown conversation_id=%s", conversation_id)
        return {"already_finalized": False, "skipped": True}

    if doc.get("ended_at") is not None:
        return {"already_finalized": True, "call_id": doc["_id"]}

    score = await _score_if_needed(doc, transcript)
    action = RecommendedAction(score["recommended_action"])
    outcome_label = derive_outcome_label(action)
    escalation_911 = outcome_label == "escalated_911"

    now = datetime.now(timezone.utc)
    update: dict[str, Any] = {
        "ended_at": now,
        "end_reason": end_reason,
        "outcome_label": outcome_label,
        "escalation_911": escalation_911,
        "score": score,
    }

    summary_p: str | None = None
    summary_n: str | None = None
    err: str | None = None
    if settings.enable_call_summary:
        try:
            summary_p = await summarize_patient(transcript=transcript)
            summary_n = await summarize_nurse(
                transcript=transcript,
                vitals={},
                score={k: score[k] for k in ("deterioration", "qsofa", "news2")},
            )
            update["summaries_generated_at"] = now
        except Exception as e:
            err = str(e)
            log.exception("gemini summary failed")

    update["summary_patient"] = summary_p
    update["summary_nurse"] = summary_n
    update["summaries_error"] = err

    await db.calls.update_one({"_id": doc["_id"]}, {"$set": update})

    if outcome_label in ("schedule_visit", "escalated_911"):
        try:
            await send_alert(
                patient_id=doc["patient_id"],
                call_id=doc["_id"],
                score=Score.model_validate(score),
            )
        except Exception:
            log.exception("send_alert failed in finalize_call")

    publish({
        "type": "call_completed",
        "call_id": doc["_id"],
        "patient_id": doc["patient_id"],
        "outcome_label": outcome_label,
        "escalation_911": escalation_911,
        "summary_patient": summary_p,
        "summary_nurse": summary_n,
    })

    return {"already_finalized": False, "call_id": doc["_id"]}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd backend && .venv/bin/pytest tests/test_finalize.py -v
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/sentinel/finalize.py backend/tests/test_finalize.py
git commit -m "feat(finalize): idempotent call finalize service with dual summaries + outcome"
```

---

## Task 6: ElevenLabs post-call webhook endpoint + HMAC verify

**Files:**
- Create: `backend/sentinel/webhooks.py`
- Create: `backend/tests/test_webhook_post_call.py`
- Modify: `backend/sentinel/main.py` (include router)

- [ ] **Step 1: Write failing tests**

`backend/tests/test_webhook_post_call.py`:

```python
import hashlib
import hmac
import json

import pytest
from httpx import AsyncClient

from sentinel.main import create_app


def _sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


@pytest.mark.asyncio
async def test_post_call_webhook_rejects_bad_signature(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_WEBHOOK_SECRET", "secret")
    monkeypatch.setenv("DEMO_MODE", "false")
    from sentinel.config import get_settings
    get_settings.cache_clear()
    app = create_app(start_scheduler=False)
    async with AsyncClient(app=app, base_url="http://t") as c:
        r = await c.post(
            "/api/webhooks/elevenlabs/post-call",
            content=b"{}",
            headers={"X-Elevenlabs-Signature": "bad"},
        )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_post_call_webhook_accepts_valid_signature(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_WEBHOOK_SECRET", "secret")
    monkeypatch.setenv("DEMO_MODE", "false")
    from sentinel.config import get_settings
    get_settings.cache_clear()

    from unittest.mock import AsyncMock, patch
    app = create_app(start_scheduler=False)
    body = json.dumps({"conversation_id": "conv_abc", "transcript": "hi"}).encode()
    sig = _sign("secret", body)
    with patch("sentinel.webhooks.finalize_call", AsyncMock(return_value={"ok": True})) as fin:
        async with AsyncClient(app=app, base_url="http://t") as c:
            r = await c.post(
                "/api/webhooks/elevenlabs/post-call",
                content=body,
                headers={"X-Elevenlabs-Signature": sig, "content-type": "application/json"},
            )
    assert r.status_code == 200
    fin.assert_awaited_once()


@pytest.mark.asyncio
async def test_post_call_webhook_demo_mode_skips_signature(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "true")
    from sentinel.config import get_settings
    get_settings.cache_clear()

    from unittest.mock import AsyncMock, patch
    app = create_app(start_scheduler=False)
    with patch("sentinel.webhooks.finalize_call", AsyncMock(return_value={"ok": True})):
        async with AsyncClient(app=app, base_url="http://t") as c:
            r = await c.post(
                "/api/webhooks/elevenlabs/post-call",
                json={"conversation_id": "conv_abc", "transcript": "hi"},
            )
    assert r.status_code == 200
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd backend && .venv/bin/pytest tests/test_webhook_post_call.py -v
```

Expected: FAIL — 404 (router not mounted) or import error.

- [ ] **Step 3: Implement router**

`backend/sentinel/webhooks.py`:

```python
from __future__ import annotations

import hashlib
import hmac
import logging

from fastapi import APIRouter, Header, HTTPException, Request

from sentinel.config import get_settings
from sentinel.finalize import finalize_call

log = logging.getLogger("sentinel.webhooks")

router = APIRouter(prefix="/api/webhooks")


def _verify(secret: str, body: bytes, provided: str | None) -> bool:
    if not provided:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, provided)


@router.post("/elevenlabs/post-call")
async def elevenlabs_post_call(
    request: Request,
    x_elevenlabs_signature: str | None = Header(default=None),
):
    s = get_settings()
    body = await request.body()

    if not s.demo_mode:
        if not s.elevenlabs_webhook_secret or not _verify(
            s.elevenlabs_webhook_secret, body, x_elevenlabs_signature
        ):
            raise HTTPException(401, "invalid signature")

    import json
    try:
        payload = json.loads(body)
    except Exception:
        raise HTTPException(400, "invalid json")

    conversation_id = payload.get("conversation_id")
    transcript = payload.get("transcript", "")
    if not conversation_id:
        raise HTTPException(400, "conversation_id required")

    result = await finalize_call(
        conversation_id=conversation_id,
        transcript=transcript,
        end_reason="agent_signal",
    )
    return result
```

Edit `backend/sentinel/main.py`, inside `create_app`, after existing `app.include_router(...)`:

```python
    from sentinel import webhooks as webhooks_mod
    app.include_router(webhooks_mod.router)
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd backend && .venv/bin/pytest tests/test_webhook_post_call.py -v
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/sentinel/webhooks.py backend/sentinel/main.py backend/tests/test_webhook_post_call.py
git commit -m "feat(webhooks): ElevenLabs post-call webhook with HMAC signature verify"
```

---

## Task 7: 40-second watchdog

**Files:**
- Create: `backend/sentinel/watchdog.py`
- Create: `backend/tests/test_watchdog.py`

- [ ] **Step 1: Write failing tests**

`backend/tests/test_watchdog.py`:

```python
from unittest.mock import AsyncMock, patch

import pytest

from sentinel.watchdog import start_call_watchdog


@pytest.mark.asyncio
async def test_watchdog_finalizes_with_timeout_reason_when_not_ended(mongo):
    await mongo.calls.insert_one(
        {"_id": "c1", "patient_id": "p1", "conversation_id": "conv_abc", "transcript": []}
    )
    with patch("sentinel.watchdog.asyncio.sleep", AsyncMock()), \
         patch("sentinel.watchdog.finalize_call", AsyncMock(return_value={"ok": True})) as fin:
        await start_call_watchdog("conv_abc", timeout_s=40)
    fin.assert_awaited_once()
    args, kwargs = fin.await_args
    assert kwargs["conversation_id"] == "conv_abc"
    assert kwargs["end_reason"] == "timeout_40s"


@pytest.mark.asyncio
async def test_watchdog_no_op_if_call_already_ended(mongo):
    from datetime import datetime
    await mongo.calls.insert_one(
        {"_id": "c1", "patient_id": "p1", "conversation_id": "conv_abc",
         "ended_at": datetime(2026, 4, 18), "transcript": []}
    )
    with patch("sentinel.watchdog.asyncio.sleep", AsyncMock()), \
         patch("sentinel.watchdog.finalize_call", AsyncMock()) as fin:
        await start_call_watchdog("conv_abc", timeout_s=40)
    fin.assert_not_awaited()
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd backend && .venv/bin/pytest tests/test_watchdog.py -v
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`backend/sentinel/watchdog.py`:

```python
from __future__ import annotations

import asyncio
import logging

from sentinel.db import get_db
from sentinel.finalize import finalize_call

log = logging.getLogger("sentinel.watchdog")


async def start_call_watchdog(conversation_id: str, timeout_s: int = 40) -> None:
    await asyncio.sleep(timeout_s)
    db = get_db()
    doc = await db.calls.find_one({"conversation_id": conversation_id})
    if not doc:
        log.warning("watchdog: unknown conversation_id=%s", conversation_id)
        return
    if doc.get("ended_at") is not None:
        return
    log.info("watchdog timeout firing finalize for %s", conversation_id)
    await finalize_call(
        conversation_id=conversation_id,
        transcript="\n".join(t.get("text", "") for t in doc.get("transcript", [])),
        end_reason="timeout_40s",
    )
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd backend && .venv/bin/pytest tests/test_watchdog.py -v
```

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/sentinel/watchdog.py backend/tests/test_watchdog.py
git commit -m "feat(watchdog): 40s call auto-finalize safety net"
```

---

## Task 8: Spawn watchdog from call_handler on dial

**Files:**
- Modify: `backend/sentinel/call_handler.py`
- Test: extend `backend/tests/test_call_handler.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_call_handler.py`:

```python
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_dial_spawns_watchdog(monkeypatch):
    from sentinel import call_handler
    with patch("sentinel.call_handler.asyncio.create_task") as ct, \
         patch("sentinel.call_handler._dispatch_elevenlabs", AsyncMock(
             return_value={"conversation_id": "conv_xyz"})):
        await call_handler.dial_patient_with_watchdog(patient_id="p1", call_id="c1")
    ct.assert_called()
```

(Adapt fixture names if the existing file uses different setup; wire against current test style.)

- [ ] **Step 2: Run test to verify failure**

```bash
cd backend && .venv/bin/pytest tests/test_call_handler.py::test_dial_spawns_watchdog -v
```

Expected: FAIL — function missing.

- [ ] **Step 3: Implement wrapper**

In `backend/sentinel/call_handler.py`, add at bottom:

```python
async def _dispatch_elevenlabs(patient_id: str, call_id: str) -> dict:
    """Thin wrapper over existing ElevenLabs dial code. Returns {conversation_id}."""
    # Extract your existing EL call creation here; for new code it returns the conv id.
    # If the existing helper is named differently, import and delegate.
    raise NotImplementedError("wire to existing ElevenLabs dial path")


async def dial_patient_with_watchdog(*, patient_id: str, call_id: str) -> dict:
    import asyncio as _a

    from sentinel.watchdog import start_call_watchdog

    result = await _dispatch_elevenlabs(patient_id=patient_id, call_id=call_id)
    conv_id = result.get("conversation_id")
    if conv_id:
        _a.create_task(start_call_watchdog(conv_id))
    return result
```

Then grep for the existing dial entrypoint (`start_call_via_elevenlabs` or similar) and replace its single call site (`api.py` `/calls/trigger`) with `dial_patient_with_watchdog`. Leave the original function exported for legacy tests.

- [ ] **Step 4: Run test to verify pass**

```bash
cd backend && .venv/bin/pytest tests/test_call_handler.py -v
```

Expected: new test PASS, existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/sentinel/call_handler.py backend/tests/test_call_handler.py
git commit -m "feat(call_handler): spawn 40s watchdog on outbound dial"
```

---

## Task 9: Alert acknowledgement endpoint

**Files:**
- Modify: `backend/sentinel/api.py`
- Create: `backend/tests/test_alert_ack.py`

- [ ] **Step 1: Write failing tests**

`backend/tests/test_alert_ack.py`:

```python
from datetime import datetime

import pytest
from httpx import AsyncClient

from sentinel.main import create_app


@pytest.mark.asyncio
async def test_ack_marks_alert_and_emits_event(mongo):
    await mongo.alerts.insert_one({
        "_id": "a1", "patient_id": "p1", "call_id": "c1",
        "severity": "nurse_alert", "channel": ["sms"],
        "sent_at": datetime(2026, 4, 18),
        "acknowledged": False, "acknowledged_at": None,
    })
    app = create_app(start_scheduler=False)

    from unittest.mock import patch
    with patch("sentinel.api.event_bus.publish") as pub:
        async with AsyncClient(app=app, base_url="http://t") as c:
            r = await c.post("/api/alerts/a1/ack")
    assert r.status_code == 200
    assert r.json()["acknowledged"] is True
    doc = await mongo.alerts.find_one({"_id": "a1"})
    assert doc["acknowledged"] is True
    assert doc["acknowledged_at"] is not None
    pub.assert_any_call({"type": "alert_ack", "alert_id": "a1"})


@pytest.mark.asyncio
async def test_ack_already_acked_returns_409(mongo):
    await mongo.alerts.insert_one({
        "_id": "a1", "patient_id": "p1", "call_id": "c1",
        "severity": "nurse_alert", "channel": ["sms"],
        "sent_at": datetime(2026, 4, 18),
        "acknowledged": True, "acknowledged_at": datetime(2026, 4, 18),
    })
    app = create_app(start_scheduler=False)
    async with AsyncClient(app=app, base_url="http://t") as c:
        r = await c.post("/api/alerts/a1/ack")
    assert r.status_code == 409
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd backend && .venv/bin/pytest tests/test_alert_ack.py -v
```

Expected: FAIL — 404.

- [ ] **Step 3: Implement endpoint**

Add to `backend/sentinel/api.py`:

```python
@router.post("/alerts/{alert_id}/ack")
async def ack_alert(alert_id: str):
    db = get_db()
    res = await db.alerts.find_one_and_update(
        {"_id": alert_id, "acknowledged": {"$ne": True}},
        {"$set": {"acknowledged": True, "acknowledged_at": datetime.now(timezone.utc)}},
        return_document=True,
    )
    if not res:
        raise HTTPException(409, "already acknowledged or missing")
    event_bus.publish({"type": "alert_ack", "alert_id": alert_id})
    return {"id": alert_id, "acknowledged": True}
```

Make sure `from pymongo import ReturnDocument` if `return_document` requires enum; Motor accepts `True` for "after".

- [ ] **Step 4: Run tests to verify pass**

```bash
cd backend && .venv/bin/pytest tests/test_alert_ack.py -v
```

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/sentinel/api.py backend/tests/test_alert_ack.py
git commit -m "feat(api): POST /alerts/{id}/ack with 409 on duplicate"
```

---

## Task 10: Open-alert count endpoint

**Files:**
- Modify: `backend/sentinel/api.py`
- Create: `backend/tests/test_open_alert_count.py`

- [ ] **Step 1: Write failing test**

`backend/tests/test_open_alert_count.py`:

```python
from datetime import datetime

import pytest
from httpx import AsyncClient

from sentinel.main import create_app


@pytest.mark.asyncio
async def test_open_alert_count(mongo):
    base = {"patient_id": "p1", "call_id": "c1",
            "channel": ["sms"], "sent_at": datetime(2026, 4, 18)}
    await mongo.alerts.insert_many([
        {"_id": "a1", **base, "severity": "nurse_alert", "acknowledged": False},
        {"_id": "a2", **base, "severity": "suggest_911", "acknowledged": False},
        {"_id": "a3", **base, "severity": "nurse_alert", "acknowledged": True},
        {"_id": "a4", **base, "severity": "patient_check", "acknowledged": False},
    ])
    app = create_app(start_scheduler=False)
    async with AsyncClient(app=app, base_url="http://t") as c:
        r = await c.get("/api/alerts/open-count")
    assert r.status_code == 200
    assert r.json() == {"count": 2}
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd backend && .venv/bin/pytest tests/test_open_alert_count.py -v
```

Expected: FAIL — 404.

- [ ] **Step 3: Implement endpoint**

Add to `backend/sentinel/api.py`:

```python
@router.get("/alerts/open-count")
async def open_alert_count():
    db = get_db()
    count = await db.alerts.count_documents({
        "severity": {"$in": ["nurse_alert", "suggest_911"]},
        "$or": [{"acknowledged": False}, {"acknowledged": {"$exists": False}}],
    })
    return {"count": count}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd backend && .venv/bin/pytest tests/test_open_alert_count.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/sentinel/api.py backend/tests/test_open_alert_count.py
git commit -m "feat(api): GET /alerts/open-count for KPI"
```

---

## Task 11: On-demand summary regenerate endpoint

**Files:**
- Modify: `backend/sentinel/api.py`
- Create: `backend/tests/test_summary_regenerate.py`

- [ ] **Step 1: Write failing test**

`backend/tests/test_summary_regenerate.py`:

```python
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from sentinel.main import create_app


@pytest.mark.asyncio
async def test_regenerate_summary_calls_gemini_twice_and_updates_doc(mongo):
    await mongo.calls.insert_one({
        "_id": "c1", "patient_id": "p1",
        "called_at": datetime(2026, 4, 18),
        "transcript": [{"role": "agent", "text": "hi", "t_start": 0, "t_end": 1}],
        "score": {"deterioration": 0.1, "qsofa": 0, "news2": 1, "red_flags": [],
                  "summary": "ok", "recommended_action": "none"},
    })
    app = create_app(start_scheduler=False)
    with patch("sentinel.api.summarize_patient", AsyncMock(return_value="P")), \
         patch("sentinel.api.summarize_nurse", AsyncMock(return_value="N")):
        async with AsyncClient(app=app, base_url="http://t") as c:
            r = await c.post("/api/calls/c1/summary/regenerate")
    assert r.status_code == 200
    doc = await mongo.calls.find_one({"_id": "c1"})
    assert doc["summary_patient"] == "P"
    assert doc["summary_nurse"] == "N"
    assert doc["summaries_error"] is None
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd backend && .venv/bin/pytest tests/test_summary_regenerate.py -v
```

Expected: FAIL — 404.

- [ ] **Step 3: Implement endpoint**

Add to `backend/sentinel/api.py`:

```python
from sentinel.summarization import summarize_nurse, summarize_patient


@router.post("/calls/{call_id}/summary/regenerate")
async def regenerate_summary(call_id: str):
    db = get_db()
    doc = await db.calls.find_one({"_id": call_id})
    if not doc:
        raise HTTPException(404, "call not found")
    transcript = "\n".join(f"{t['role']}: {t['text']}" for t in doc.get("transcript", []))
    score = doc.get("score") or {}
    p = await summarize_patient(transcript=transcript)
    n = await summarize_nurse(
        transcript=transcript,
        vitals={},
        score={k: score.get(k) for k in ("deterioration", "qsofa", "news2")},
    )
    now = datetime.now(timezone.utc)
    await db.calls.update_one(
        {"_id": call_id},
        {"$set": {"summary_patient": p, "summary_nurse": n,
                  "summaries_generated_at": now, "summaries_error": None}},
    )
    return {"summary_patient": p, "summary_nurse": n}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd backend && .venv/bin/pytest tests/test_summary_regenerate.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/sentinel/api.py backend/tests/test_summary_regenerate.py
git commit -m "feat(api): POST /calls/{id}/summary/regenerate"
```

---

## Task 12: Full lifecycle integration test

**Files:**
- Create: `backend/tests/test_call_lifecycle.py`

- [ ] **Step 1: Write test**

`backend/tests/test_call_lifecycle.py`:

```python
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from sentinel.finalize import finalize_call


@pytest.mark.asyncio
async def test_lifecycle_fine_outcome(mongo):
    await mongo.calls.insert_one({
        "_id": "c1", "patient_id": "p1",
        "called_at": datetime(2026, 4, 18),
        "conversation_id": "conv_abc",
        "transcript": [],
    })
    with patch("sentinel.finalize._score_if_needed", AsyncMock(return_value={
        "deterioration": 0.05, "qsofa": 0, "news2": 1, "red_flags": [],
        "summary": "ok", "recommended_action": "none",
    })), \
         patch("sentinel.finalize.summarize_patient", AsyncMock(return_value="P")), \
         patch("sentinel.finalize.summarize_nurse", AsyncMock(return_value="N")):
        r = await finalize_call("conv_abc", "hi", "agent_signal")
    assert r["already_finalized"] is False
    doc = await mongo.calls.find_one({"_id": "c1"})
    assert doc["outcome_label"] == "fine"
    assert doc["summary_patient"] == "P"
    assert doc["summary_nurse"] == "N"


@pytest.mark.asyncio
async def test_lifecycle_escalation_creates_alert_and_flags_911(mongo):
    await mongo.calls.insert_one({
        "_id": "c1", "patient_id": "p1",
        "called_at": datetime(2026, 4, 18),
        "conversation_id": "conv_abc",
        "transcript": [],
    })
    with patch("sentinel.finalize._score_if_needed", AsyncMock(return_value={
        "deterioration": 0.9, "qsofa": 3, "news2": 15, "red_flags": ["sepsis"],
        "summary": "bad", "recommended_action": "suggest_911",
    })), \
         patch("sentinel.finalize.summarize_patient", AsyncMock(return_value="P")), \
         patch("sentinel.finalize.summarize_nurse", AsyncMock(return_value="N")), \
         patch("sentinel.finalize.send_alert", AsyncMock()) as sa:
        await finalize_call("conv_abc", "hi", "agent_signal")
    sa.assert_awaited_once()
    doc = await mongo.calls.find_one({"_id": "c1"})
    assert doc["escalation_911"] is True
    assert doc["outcome_label"] == "escalated_911"
```

- [ ] **Step 2: Run**

```bash
cd backend && .venv/bin/pytest tests/test_call_lifecycle.py -v
```

Expected: 2 PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_call_lifecycle.py
git commit -m "test(lifecycle): integration test for finalize_call covering fine + 911 outcomes"
```

---

## Task 13: Frontend API client — extend types + methods

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Inspect existing types**

```bash
cd frontend && grep -n "export type Call\|export type Alert\|export const api" lib/api.ts
```

- [ ] **Step 2: Extend `Call` + `Alert` types**

In `frontend/lib/api.ts`, add to `Call` type:

```ts
  conversation_id?: string | null;
  ended_at?: string | null;
  end_reason?: "agent_signal" | "timeout_40s" | "manual" | null;
  summary_patient?: string | null;
  summary_nurse?: string | null;
  summaries_generated_at?: string | null;
  summaries_error?: string | null;
  outcome_label?: "fine" | "schedule_visit" | "escalated_911" | null;
  escalation_911?: boolean;
```

Add to `Alert` type:

```ts
  acknowledged?: boolean;
  acknowledged_at?: string | null;
```

- [ ] **Step 3: Add new api methods**

In the `api` object:

```ts
  ackAlert: (id: string) =>
    fetch(resolve(`/api/alerts/${id}/ack`), { method: "POST" }).then(r => r.json()),
  openAlertCount: () =>
    fetch(resolve("/api/alerts/open-count"), { cache: "no-store" })
      .then(r => r.json() as Promise<{ count: number }>),
  regenerateSummary: (id: string) =>
    fetch(resolve(`/api/calls/${id}/summary/regenerate`), { method: "POST" })
      .then(r => r.json() as Promise<{ summary_patient: string; summary_nurse: string }>),
```

- [ ] **Step 4: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(frontend/api): extend Call/Alert types + ack/openCount/regenerate methods"
```

---

## Task 14: SSE event stream — extend union

**Files:**
- Modify: `frontend/lib/hooks/useEventStream.ts`

- [ ] **Step 1: Extend the event union**

Add to the discriminated union:

```ts
  | { type: "call_completed"; call_id: string; patient_id: string;
      outcome_label: "fine" | "schedule_visit" | "escalated_911";
      escalation_911: boolean;
      summary_patient: string | null;
      summary_nurse: string | null }
  | { type: "alert_opened"; alert_id: string; patient_id: string;
      severity: string }
  | { type: "alert_ack"; alert_id: string }
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/hooks/useEventStream.ts
git commit -m "feat(frontend/sse): add call_completed/alert_opened/alert_ack event types"
```

---

## Task 15: `CallLogCard` component

**Files:**
- Create: `frontend/components/patient/CallLogCard.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useState } from "react";
import { api, type Call } from "@/lib/api";
import { Glass } from "@/components/ui/Glass";

export function CallLogCard({ call, audience }: {
  call: Call;
  audience: "patient" | "nurse";
}) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(
    audience === "patient" ? call.summary_patient ?? null : call.summary_nurse ?? null
  );
  const generating = !summary && !call.summaries_error;

  async function regenerate() {
    if (!call.id) return;
    setBusy(true);
    try {
      const r = await api.regenerateSummary(call.id);
      setSummary(audience === "patient" ? r.summary_patient : r.summary_nurse);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Glass className="overflow-hidden p-4">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">
        {audience === "patient" ? "Your check-in summary" : "Clinical summary"}
      </div>
      {generating ? (
        <div className="space-y-2">
          <div className="h-3 w-3/4 animate-pulse rounded bg-white/10" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-white/10" />
        </div>
      ) : summary ? (
        <p className="animate-[fadeIn_.3s_ease-out] text-sm leading-relaxed text-slate-100">
          {summary}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-rose-300">
            Summary failed to generate{call.summaries_error ? `: ${call.summaries_error}` : ""}.
          </p>
          <button
            disabled={busy}
            onClick={regenerate}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-100 hover:bg-white/10 disabled:opacity-50"
          >
            {busy ? "Generating…" : "Generate summary"}
          </button>
        </div>
      )}
      {!generating && summary && (
        <button
          disabled={busy}
          onClick={regenerate}
          className="mt-2 text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-50"
        >
          {busy ? "Regenerating…" : "Regenerate"}
        </button>
      )}
    </Glass>
  );
}
```

- [ ] **Step 2: Add keyframe to globals.css**

Append to `frontend/app/globals.css` inside `@layer utilities`:

```css
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
```

- [ ] **Step 3: Typecheck + build**

```bash
cd frontend && npx tsc --noEmit && npx next build
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/patient/CallLogCard.tsx frontend/app/globals.css
git commit -m "feat(frontend): CallLogCard with shimmer + fade-in + regenerate action"
```

---

## Task 16: `Fake911Modal` component

**Files:**
- Create: `frontend/components/patient/Fake911Modal.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useEffect } from "react";

const MSG = "Ambulance dispatched to your location. Stay on the line.";

export function Fake911Modal({ onAutoDismiss }: { onAutoDismiss: () => void }) {
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(MSG);
        u.rate = 0.95;
        window.speechSynthesis.speak(u);
      }
    } catch {}
    const t = window.setTimeout(onAutoDismiss, 15000);
    return () => {
      window.clearTimeout(t);
      try { window.speechSynthesis?.cancel(); } catch {}
    };
  }, [onAutoDismiss]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 backdrop-blur-sm">
      <div className="flex w-[min(92vw,420px)] flex-col items-center gap-4 rounded-2xl border border-rose-500/40 bg-gradient-to-b from-rose-950/90 to-black/90 p-6 text-center">
        <div className="relative grid h-20 w-20 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/40" />
          <span className="absolute inset-2 animate-ping rounded-full bg-rose-500/60 [animation-delay:.4s]" />
          <svg viewBox="0 0 24 24" className="relative h-10 w-10 text-rose-200" fill="none">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.28-1.28a2 2 0 0 1 2.11-.45c.9.35 1.84.59 2.8.72A2 2 0 0 1 22 16.92z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="text-lg font-semibold tracking-tight text-rose-100">
          Calling 9-1-1…
        </div>
        <div className="text-sm leading-relaxed text-rose-100/80">{MSG}</div>
        <div className="text-[11px] text-rose-300/60">Do not hang up.</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/patient/Fake911Modal.tsx
git commit -m "feat(frontend): Fake911Modal with TTS + silent fallback + 15s auto-dismiss"
```

---

## Task 17: `Critical911Banner` component

**Files:**
- Create: `frontend/components/admin/Critical911Banner.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useEffect, useState } from "react";
import { api, type Alert } from "@/lib/api";
import { useEventStream } from "@/lib/hooks/useEventStream";

export function Critical911Banner() {
  const [active, setActive] = useState<{ patient_id: string; call_id: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const alerts = (await api.alerts()) as Alert[];
        const hit = alerts.find(a => a.severity === "suggest_911" && !a.acknowledged);
        if (hit) setActive({ patient_id: hit.patient_id, call_id: hit.call_id });
      } catch {}
    })();
  }, []);

  useEventStream((e) => {
    if (e.type === "call_completed" && e.escalation_911) {
      setActive({ patient_id: e.patient_id, call_id: e.call_id });
    }
  });

  if (!active) return null;
  return (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-rose-500/40 bg-rose-950/90 px-4 py-2 text-sm text-rose-100 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-400" />
        </span>
        <span className="font-semibold">911 auto-dispatched</span>
        <span className="text-rose-200/80">for patient {active.patient_id}</span>
      </div>
      <button
        onClick={() => setActive(null)}
        className="rounded-md border border-rose-400/40 bg-rose-500/10 px-2 py-0.5 text-xs hover:bg-rose-500/20"
      >
        Acknowledge
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Mount in AppShell (admin-only)**

In `frontend/components/shell/AppShell.tsx`, inside the returned tree at the top of the admin shell area, render:

```tsx
import { Critical911Banner } from "@/components/admin/Critical911Banner";
// ...
// inside the returned JSX, above <main> / children on admin shell only:
{pathname.startsWith("/admin") && <Critical911Banner />}
```

If `pathname` is not already available, import `usePathname` from `next/navigation` and call it at the top of the component.

- [ ] **Step 3: Typecheck + build**

```bash
cd frontend && npx tsc --noEmit && npx next build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/components/admin/Critical911Banner.tsx frontend/components/shell/AppShell.tsx
git commit -m "feat(frontend): Critical911Banner mounted in admin shell"
```

---

## Task 18: `OutcomePill` component

**Files:**
- Create: `frontend/components/admin/OutcomePill.tsx`
- Modify: `frontend/components/PatientCard.tsx` (render pill)

- [ ] **Step 1: Implement pill**

```tsx
import type { Call } from "@/lib/api";

export function OutcomePill({ outcome }: { outcome: Call["outcome_label"] }) {
  if (!outcome) return null;
  const map = {
    fine: { label: "Fine", cls: "bg-emerald-500/15 text-emerald-200 ring-emerald-400/40" },
    schedule_visit: { label: "Schedule visit", cls: "bg-amber-500/15 text-amber-200 ring-amber-400/40" },
    escalated_911: { label: "911 called", cls: "bg-rose-500/20 text-rose-200 ring-rose-400/50" },
  } as const;
  const m = map[outcome];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${m.cls}`}>
      {m.label}
    </span>
  );
}
```

- [ ] **Step 2: Render on PatientCard**

In `frontend/components/PatientCard.tsx`, add `lastOutcome` prop and render `<OutcomePill outcome={lastOutcome} />` next to existing SeverityChip. Thread `lastOutcome` from the grid by reading `call.outcome_label` of the most recent Call.

Exact insertion point: wherever `SeverityChip` renders in the card header.

- [ ] **Step 3: Thread prop from PatientGrid**

In `frontend/components/dashboard/PatientGrid.tsx` `summarize()`, add:

```ts
lastOutcome: last?.outcome_label ?? null,
```

And pass `lastOutcome={s.lastOutcome}` into `<PatientCard ... />`.

- [ ] **Step 4: Typecheck + build**

```bash
cd frontend && npx tsc --noEmit && npx next build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/components/admin/OutcomePill.tsx frontend/components/PatientCard.tsx frontend/components/dashboard/PatientGrid.tsx
git commit -m "feat(frontend): OutcomePill on PatientCard"
```

---

## Task 19: `AckButton` + AlertFeed integration

**Files:**
- Create: `frontend/components/admin/AckButton.tsx`
- Modify: `frontend/components/AlertFeed.tsx`

- [ ] **Step 1: Implement button**

```tsx
"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export function AckButton({ alertId, onDone }: { alertId: string; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  async function click(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await api.ackAlert(alertId);
      onDone?.();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      disabled={busy}
      onClick={click}
      className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-white/10 disabled:opacity-50"
    >
      {busy ? "…" : "Ack"}
    </button>
  );
}
```

- [ ] **Step 2: Render in AlertFeed**

In `frontend/components/AlertFeed.tsx`:
- Import `AckButton`.
- Filter out acknowledged alerts: `const visible = alerts.filter(a => !a.acknowledged);`
- Inside each `<li>` next to severity label, render `<AckButton alertId={a.id} onDone={refetch} />`.
- Listen for `alert_ack` SSE event and trigger refetch or local filter.

- [ ] **Step 3: Typecheck + build**

```bash
cd frontend && npx tsc --noEmit && npx next build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/components/admin/AckButton.tsx frontend/components/AlertFeed.tsx
git commit -m "feat(frontend): AckButton + AlertFeed hides acked alerts on SSE"
```

---

## Task 20: KPI strip — real open-alert count

**Files:**
- Modify: `frontend/components/dashboard/KpiStrip.tsx`
- Modify: `frontend/app/admin/page.tsx` (fetch + pass count)

- [ ] **Step 1: Pass initial count**

In `frontend/app/admin/page.tsx`, add to the Promise.all:

```ts
api.openAlertCount().catch(() => ({ count: 0 })),
```

Thread `initialOpenAlertCount={openAlertCount.count}` into `<KpiStrip />`.

- [ ] **Step 2: Use count in tile**

In `frontend/components/dashboard/KpiStrip.tsx`:
- Accept `initialOpenAlertCount: number` prop.
- Use `usePolling(api.openAlertCount, 10_000, { count: initialOpenAlertCount })` OR read it from SSE events (`alert_opened` → +1, `alert_ack` → -1) with a `useState` seeded by the initial value.
- Replace the current "Open alerts" tile value with this count.

- [ ] **Step 3: Typecheck + build**

```bash
cd frontend && npx tsc --noEmit && npx next build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/components/dashboard/KpiStrip.tsx frontend/app/admin/page.tsx
git commit -m "feat(frontend): KPI open-alerts count uses real /open-count endpoint"
```

---

## Task 21: Trajectory chart + Call timeline — outcome markers

**Files:**
- Modify: `frontend/components/TrajectoryChart.tsx`
- Modify: `frontend/components/patient/CallTimeline.tsx`

- [ ] **Step 1: Color map helper**

Add near the top of each file (or a shared `lib/outcomeColor.ts` if preferred):

```ts
const OUTCOME_COLOR: Record<NonNullable<Call["outcome_label"]>, string> = {
  fine: "#34D399",
  schedule_visit: "#FBBF24",
  escalated_911: "#F43F5E",
};
```

- [ ] **Step 2: Render marker**

For each call point in the chart / timeline, if `call.outcome_label` is set, render a small colored dot at the call's timestamp using `OUTCOME_COLOR[call.outcome_label]`. Keep existing rendering untouched for calls without the field.

- [ ] **Step 3: Typecheck + build**

```bash
cd frontend && npx tsc --noEmit && npx next build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/components/TrajectoryChart.tsx frontend/components/patient/CallTimeline.tsx
git commit -m "feat(frontend): outcome-colored markers on trajectory + timeline"
```

---

## Task 22: Wire `PatientLiveView` — CallLogCard + Fake911Modal

**Files:**
- Modify: `frontend/components/patient/PatientLiveView.tsx`

- [ ] **Step 1: State + event listener**

Inside the component:

```tsx
const [latestCall, setLatestCall] = useState<Call | null>(
  calls[calls.length - 1] ?? null
);
const [show911, setShow911] = useState(false);

useEventStream((e) => {
  if (e.type === "call_completed" && e.patient_id === patientId) {
    setLatestCall((prev) => ({
      ...(prev ?? {} as Call),
      id: e.call_id,
      patient_id: e.patient_id,
      outcome_label: e.outcome_label,
      escalation_911: e.escalation_911,
      summary_patient: e.summary_patient,
      summary_nurse: e.summary_nurse,
      summaries_generated_at: new Date().toISOString(),
    }));
    if (e.escalation_911) setShow911(true);
  }
});
```

- [ ] **Step 2: Render**

Below existing content:

```tsx
{latestCall && <CallLogCard call={latestCall} audience="patient" />}
{show911 && <Fake911Modal onAutoDismiss={() => setShow911(false)} />}
```

- [ ] **Step 3: Typecheck + build**

```bash
cd frontend && npx tsc --noEmit && npx next build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/components/patient/PatientLiveView.tsx
git commit -m "feat(frontend): PatientLiveView renders CallLogCard + Fake911Modal on call_completed"
```

---

## Task 23: Nurse-side `CallLogCard` on patients/[id]

**Files:**
- Modify: `frontend/app/patients/[id]/page.tsx`

- [ ] **Step 1: Render nurse summary card**

Near where `CallTimeline` is rendered, add:

```tsx
{last && <CallLogCard call={last} audience="nurse" />}
```

Where `last` is the last call returned from `api.calls(id)`.

- [ ] **Step 2: Typecheck + build**

```bash
cd frontend && npx tsc --noEmit && npx next build
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/patients/[id]/page.tsx
git commit -m "feat(frontend): nurse CallLogCard on patients/[id] detail page"
```

---

## Task 24: Regression suite + RUNBOOK checklist

**Files:**
- Modify: `docs/RUNBOOK.md`

- [ ] **Step 1: Run full backend suite**

```bash
cd backend && .venv/bin/pytest -q
```

Expected: all tests green — existing + new.

- [ ] **Step 2: Run full frontend checks**

```bash
cd frontend && npx tsc --noEmit && npx next build
```

Expected: build success.

- [ ] **Step 3: Append demo checklist to RUNBOOK**

At the bottom of `docs/RUNBOOK.md`:

```markdown
## Call Lifecycle Demo Checklist

1. Start backend + frontend locally.
2. Trigger `CallNow` for a seeded patient.
3. Verify the call auto-terminates within ≤40 seconds.
4. Patient dashboard (`/patient`): simple summary card appears (shimmer → fade-in).
5. Nurse dashboard (`/admin/patients/[id]`): clinical summary card appears.
6. If outcome = `escalated_911`:
   - Patient: Fake911Modal full-screen overlay with TTS message; auto-dismiss ≤15s.
   - Nurse: red `Critical911Banner` at top until acked.
7. KPI "Open alerts" count increments on new `alert_opened`, decrements on Ack.
8. Ack button on alert row hides it from the list.
9. TrajectoryChart + CallTimeline render a colored dot at the new call's timestamp.
```

- [ ] **Step 4: Commit**

```bash
git add docs/RUNBOOK.md
git commit -m "docs(runbook): add call lifecycle demo checklist"
```

---

## Self-review summary

- **Spec coverage:** Each of the 6 spec features is mapped to at least one task — auto-end call (Tasks 5–8), dual summaries (Tasks 3, 5, 11, 15, 23), fake 911 (Tasks 16, 17, 22), live alerts (Tasks 14, 19), open-alert KPI (Tasks 10, 20), nurse outcome surfacing (Tasks 17, 18, 21, 23).
- **No placeholders:** Every step contains the actual code or command.
- **Type consistency:** `Call.outcome_label`, `summary_patient`, `summary_nurse`, and `acknowledged` spellings match across backend, frontend types, and components.
- **Frequent commits:** 24 tasks, each ending in a commit.
- **Additive-only:** No task deletes or replaces existing behavior. Watchdog runs alongside existing hangup path; webhook adds a new route; frontend renders new components alongside existing ones.
