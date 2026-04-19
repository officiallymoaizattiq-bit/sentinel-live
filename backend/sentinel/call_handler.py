from __future__ import annotations

import asyncio
import logging
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from twilio.twiml.voice_response import Gather, VoiceResponse

from sentinel.config import get_settings
from sentinel.db import get_db

log = logging.getLogger("sentinel.call_handler")


def build_check_in_twiml(*, patient_name: str, action_url: str) -> str:
    """Used by Twilio TwiML fallback path (no EL). Retained for tests."""
    resp = VoiceResponse()
    resp.say(
        f"Hi {patient_name}, this is Sentinel, your post-op check-in. "
        "After the beep, please describe how you're feeling today. "
        "Any shortness of breath, fever, confusion, or worsening pain?"
    )
    g = Gather(
        input="speech", speech_timeout="auto",
        action=action_url, method="POST", timeout=10,
    )
    resp.append(g)
    resp.say("We didn't catch that - a nurse will follow up.")
    return str(resp)


async def _demo_stub_call(patient_id: str) -> str:
    call_id = str(uuid4())
    await get_db().calls.insert_one({
        "_id": call_id,
        "patient_id": patient_id,
        "called_at": datetime.now(tz=timezone.utc),
        "duration_s": 0.0,
        "transcript": [], "audio_features": {}, "baseline_drift": {},
        "score": None, "similar_calls": [], "embedding": [],
        "llm_degraded": False, "audio_degraded": True, "short_call": True,
    })
    return call_id


def _el_phone_number_id() -> str | None:
    """Return the EL-registered Twilio phone_number_id, if configured.
    We store it in Mongo after first import; otherwise env var ELEVENLABS_PHONE_NUMBER_ID.
    """
    return os.environ.get("ELEVENLABS_PHONE_NUMBER_ID") or None


def _el_creds_ready(s) -> bool:
    """True when all ElevenLabs-native outbound dialing creds are present."""
    return bool(
        s.elevenlabs_api_key
        and s.elevenlabs_agent_id
        and s.twilio_account_sid.startswith("AC")
    )


async def place_call(patient_id: str) -> str:
    """Dial the patient via ElevenLabs native Twilio integration.

    Flow:
      1. Load patient from DB.
      2. Call EL outbound_call -> EL dials via Twilio #, runs the agent.
      3. Store a provisional Call doc with conversation_id; post-call
         `finalize_call(conversation_id)` pulls transcript + audio and
         runs the scoring pipeline.
    Fall back to a stub call doc when any required cred is missing (covers
    both demo-mode and misconfigured-prod).
    """
    db = get_db()
    patient = await db.patients.find_one({"_id": patient_id})
    if patient is None:
        raise LookupError(patient_id)
    s = get_settings()

    if not _el_creds_ready(s):
        if not s.demo_mode:
            log.warning("place_call: EL/Twilio creds missing, using stub (not demo_mode)")
        return await _demo_stub_call(patient_id)

    phone_number_id = _el_phone_number_id()
    if phone_number_id is None:
        log.warning("No ELEVENLABS_PHONE_NUMBER_ID set - falling back to stub")
        return await _demo_stub_call(patient_id)

    from elevenlabs.client import ElevenLabs
    el = ElevenLabs(api_key=s.elevenlabs_api_key)

    # EL SDK is synchronous; dispatch to a thread so we don't block the loop.
    try:
        resp = await asyncio.to_thread(
            el.conversational_ai.twilio.outbound_call,
            agent_id=s.elevenlabs_agent_id,
            agent_phone_number_id=phone_number_id,
            to_number=patient["phone"],
        )
    except Exception:
        log.exception("EL outbound_call failed for patient %s", patient_id)
        return await _demo_stub_call(patient_id)

    conversation_id = getattr(resp, "conversation_id", None) or getattr(
        resp, "conversation_sid", None
    )

    call_id = str(uuid4())
    await db.calls.insert_one({
        "_id": call_id,
        "patient_id": patient_id,
        "called_at": datetime.now(tz=timezone.utc),
        "duration_s": 0.0,
        "transcript": [], "audio_features": {}, "baseline_drift": {},
        "score": None, "similar_calls": [], "embedding": [],
        "llm_degraded": False, "audio_degraded": False, "short_call": False,
        "conversation_id": conversation_id,
        "status": "in_progress",
    })
    return call_id


async def finalize_call(
    *, conversation_id: str, patient_id_fallback: str | None = None,
) -> str | None:
    """Pull transcript + audio from EL post-call, run scoring, persist.

    If a prior `calls` doc with this `conversation_id` exists (backend-initiated
    outbound call), update it. Otherwise create a new doc using
    `patient_id_fallback` (widget-initiated browser call path).
    """
    from sentinel.audio_features import extract_features, zscore_drift
    from sentinel.models import AudioFeatures, TranscriptTurn
    from sentinel.scoring import GeminiLLM, score_call

    db = get_db()
    call_doc = await db.calls.find_one({"conversation_id": conversation_id})
    if call_doc is None:
        pid = patient_id_fallback
        if pid is None:
            log.warning("finalize_call: no prior doc + no patient_id fallback for %s",
                        conversation_id)
            return None
        call_doc = {
            "_id": str(uuid4()),
            "patient_id": pid,
            "called_at": datetime.now(tz=timezone.utc),
            "conversation_id": conversation_id,
            "status": "in_progress",
            "audio_features": {},
        }
        await db.calls.insert_one(call_doc)

    s = get_settings()
    from elevenlabs.client import ElevenLabs
    el = ElevenLabs(api_key=s.elevenlabs_api_key)

    transcript_turns: list[TranscriptTurn] = []
    try:
        convo = await asyncio.to_thread(
            el.conversational_ai.conversations.get, conversation_id
        )
    except Exception as e:
        log.warning("EL conversation fetch failed for %s: %s", conversation_id, e)
        convo = None

    for m in getattr(convo, "transcript", []) or []:
        role = getattr(m, "role", "agent")
        text = getattr(m, "message", "") or getattr(m, "text", "")
        t_start = getattr(m, "time_in_call_secs", 0.0) or 0.0
        transcript_turns.append(TranscriptTurn(
            role="patient" if role == "user" else "agent",
            text=text or "",
            t_start=float(t_start),
            t_end=float(t_start) + 2.0,
        ))

    # Audio retrieval is best-effort; if SDK shape differs, skip features
    features = AudioFeatures()
    tmp_path: Path | None = None
    try:
        audio_bytes = await asyncio.to_thread(
            el.conversational_ai.conversations.audio.get, conversation_id
        )
        if audio_bytes:
            raw = (
                audio_bytes
                if isinstance(audio_bytes, (bytes, bytearray))
                else b"".join(audio_bytes)
            )
            if raw:
                safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", conversation_id)[:200]
                tmp_path = Path(tempfile.gettempdir()) / f"sentinel_{safe_id}.mp3"
                tmp_path.write_bytes(raw)
                features = extract_features(str(tmp_path))
    except Exception as e:
        log.warning("audio fetch failed: %s", e)
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass

    first = await (
        db.calls.find({"patient_id": call_doc["patient_id"]})
        .sort("called_at", 1)
        .limit(1)
        .to_list(1)
    )
    baseline_feats = (first[0].get("audio_features") if first else None) or {}
    baseline = AudioFeatures(**baseline_feats)
    drift = zscore_drift(current=features, baseline=baseline, stdev=None)

    await db.calls.update_one(
        {"_id": call_doc["_id"]},
        {"$set": {
            "transcript": [t.model_dump() for t in transcript_turns],
            "audio_features": features.model_dump(),
            "baseline_drift": drift,
            "status": "scored",
        }},
    )
    new_id = await score_call(
        patient_id=call_doc["patient_id"],
        transcript=transcript_turns,
        features=features,
        drift=drift,
        llm=GeminiLLM(),
    )

    # Trigger the summary + escalation pipeline. Without this, the
    # scheduler's auto_finalize path (EL widget calls that never hit the
    # post-call webhook) never writes summary_patient / summary_nurse and
    # never publishes `call_completed`, so dashboards stay on
    # "Generating summary…" indefinitely. sentinel.finalize.finalize_call
    # is idempotent: it reuses the existing score and short-circuits when
    # `ended_at` is already set.
    try:
        from sentinel.finalize import finalize_call as finalize_with_summary
        flat_transcript = "\n".join(
            f"{t.role}: {t.text}" for t in transcript_turns if t.text
        )
        await finalize_with_summary(
            conversation_id=conversation_id,
            transcript=flat_transcript,
            end_reason="agent_signal",
        )
    except Exception:
        log.exception("summary finalize failed for %s", conversation_id)

    return new_id


async def _dispatch_elevenlabs(*, patient_id: str, call_id: str) -> dict:
    """Delegate to the existing ElevenLabs outbound dial.

    Returns at least {"conversation_id": <str>} when available. Override in tests.
    This is a thin indirection to enable watchdog spawning without modifying
    the existing dial path.
    """
    # Delegate to the existing place_call path; it returns a call_id (str), not
    # a conversation_id. We look up the stored conversation_id from the DB doc
    # that place_call persists so that dial_patient_with_watchdog can obtain it.
    result_call_id = await place_call(patient_id)
    db = get_db()
    doc = await db.calls.find_one({"_id": result_call_id})
    conversation_id = (doc or {}).get("conversation_id")
    return {"conversation_id": conversation_id} if conversation_id else {}


async def dial_patient_with_watchdog(*, patient_id: str, call_id: str) -> dict:
    from sentinel.watchdog import start_call_watchdog

    result = await _dispatch_elevenlabs(patient_id=patient_id, call_id=call_id)
    conversation_id = result.get("conversation_id") if isinstance(result, dict) else None
    if conversation_id:
        asyncio.create_task(start_call_watchdog(conversation_id))
    return result if isinstance(result, dict) else {"conversation_id": None}
