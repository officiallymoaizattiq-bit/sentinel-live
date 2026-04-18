from __future__ import annotations

import logging
from datetime import datetime, timezone
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


def _twilio_create_call(**kwargs):  # kept for Task 12 test mock seam
    from twilio.rest import Client
    s = get_settings()
    client = Client(s.twilio_account_sid, s.twilio_auth_token)
    return client.calls.create(**kwargs)


def _ulaw_to_pcm(ulaw: bytes) -> bytes:
    try:
        import audioop
    except ModuleNotFoundError:
        import audioop_lts as audioop
    return audioop.ulaw2lin(ulaw, 2)


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
    import os
    return os.environ.get("ELEVENLABS_PHONE_NUMBER_ID") or None


async def place_call(patient_id: str) -> str:
    """Dial the patient via ElevenLabs native Twilio integration.

    Flow:
      1. Load patient from DB.
      2. Call EL outbound_call -> EL dials via Twilio #, runs the agent.
      3. Store a provisional Call doc with conversation_id; post-call
         `finalize_call(conversation_id)` pulls transcript + audio and
         runs the scoring pipeline.
    Demo-mode shortcut (no EL/Twilio creds): write a stub call doc.
    """
    db = get_db()
    patient = await db.patients.find_one({"_id": patient_id})
    if patient is None:
        raise LookupError(patient_id)
    s = get_settings()

    # Demo-mode shortcut when creds absent
    if (
        s.demo_mode
        and (not s.twilio_account_sid.startswith("AC")
             or not s.elevenlabs_api_key
             or not s.elevenlabs_agent_id)
    ):
        return await _demo_stub_call(patient_id)

    phone_number_id = _el_phone_number_id()
    if phone_number_id is None:
        log.warning("No ELEVENLABS_PHONE_NUMBER_ID set - falling back to stub")
        return await _demo_stub_call(patient_id)

    from elevenlabs.client import ElevenLabs
    el = ElevenLabs(api_key=s.elevenlabs_api_key)

    resp = el.conversational_ai.twilio.outbound_call(
        agent_id=s.elevenlabs_agent_id,
        agent_phone_number_id=phone_number_id,
        to_number=patient["phone"],
    )
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

    convo = el.conversational_ai.conversations.get(conversation_id)
    transcript_turns: list[TranscriptTurn] = []
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
    try:
        audio_bytes = el.conversational_ai.conversations.audio.get(conversation_id)
        if audio_bytes:
            tmp = f"/tmp/{conversation_id}.mp3"
            with open(tmp, "wb") as fh:
                fh.write(audio_bytes if isinstance(audio_bytes, (bytes, bytearray))
                        else b"".join(audio_bytes))
            features = extract_features(tmp)
    except Exception as e:
        log.warning("audio fetch failed: %s", e)

    first = await db.calls.find({"patient_id": call_doc["patient_id"]}) \
                          .sort("called_at", 1).limit(1).to_list(1)
    baseline = AudioFeatures(**first[0].get("audio_features") or {}) \
               if first else AudioFeatures()
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
    return new_id
