from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, Form, Header, HTTPException, Path, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pydantic import BaseModel as _PM
from twilio.twiml.voice_response import VoiceResponse as TwilioVoiceResponse

from sentinel import enrollment
from sentinel import events as event_bus
from sentinel import pairing as pairing_mod
from sentinel import vitals as vitals_mod
from sentinel.auth import require_device_token
from sentinel.call_handler import build_check_in_twiml
from sentinel.db import get_db
from sentinel.models import Caregiver, Consent, SurgeryType
from sentinel.summarization import summarize_nurse, summarize_patient

router = APIRouter(prefix="/api")


class EnrollRequest(BaseModel):
    name: str
    phone: str
    language: str = "en"
    surgery_type: SurgeryType
    surgery_date: datetime
    discharge_date: datetime
    caregiver: Caregiver
    consent: Consent | None = None


@router.post("/patients", status_code=201)
async def enroll(body: EnrollRequest):
    try:
        pid = await enrollment.enroll_patient(
            name=body.name,
            phone=body.phone,
            language=body.language,
            surgery_type=body.surgery_type,
            surgery_date=body.surgery_date,
            discharge_date=body.discharge_date,
            caregiver=body.caregiver,
            consent=body.consent,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"id": pid}


@router.get("/patients")
async def list_patients():
    docs = [d async for d in get_db().patients.find({})]
    out: list[dict[str, Any]] = []
    for d in docs:
        dd = d.get("discharge_date")
        out.append({
            "id": d["_id"],
            "name": d["name"],
            "surgery_type": d["surgery_type"],
            "next_call_at": d.get("next_call_at"),
            "call_count": d.get("call_count", 0),
            "discharge_date": dd.isoformat() if dd else None,
        })
    return out


@router.get("/patients/{pid}/calls")
async def patient_calls(pid: str):
    cur = (
        get_db()
        .calls.find({"patient_id": pid})
        .sort("called_at", 1)
    )
    return [
        {
            "id": d["_id"],
            "patient_id": d.get("patient_id"),
            "called_at": d["called_at"],
            "score": d.get("score"),
            "similar_calls": d.get("similar_calls", []),
            "short_call": d.get("short_call", False),
            "llm_degraded": d.get("llm_degraded", False),
            "summary_patient": d.get("summary_patient"),
            "summary_nurse": d.get("summary_nurse"),
            "summaries_generated_at": d.get("summaries_generated_at"),
            "summaries_error": d.get("summaries_error"),
            "outcome_label": d.get("outcome_label"),
            "escalation_911": d.get("escalation_911", False),
            "conversation_id": d.get("conversation_id"),
            "ended_at": d.get("ended_at"),
            "end_reason": d.get("end_reason"),
        }
        async for d in cur
    ]


@router.get("/alerts")
async def list_alerts():
    cur = get_db().alerts.find({}).sort("sent_at", -1).limit(50)
    return [
        {
            "id": d["_id"],
            "patient_id": d["patient_id"],
            "call_id": d["call_id"],
            "severity": d["severity"],
            "channel": d["channel"],
            "sent_at": d["sent_at"],
        }
        async for d in cur
    ]


@router.post("/alerts/{alert_id}/ack")
async def ack_alert(alert_id: str):
    db = get_db()
    res = await db.alerts.find_one_and_update(
        {"_id": alert_id, "acknowledged": {"$ne": True}},
        {"$set": {
            "acknowledged": True,
            "acknowledged_at": datetime.now(timezone.utc),
            "ack_at": datetime.now(timezone.utc),  # legacy-compat mirror
        }},
        return_document=True,
    )
    if not res:
        raise HTTPException(409, "already acknowledged or missing")
    event_bus.publish({"type": "alert_ack", "alert_id": alert_id})
    return {"id": alert_id, "acknowledged": True}


@router.get("/alerts/open-count")
async def open_alert_count():
    db = get_db()
    count = await db.alerts.count_documents({
        "severity": {"$in": ["nurse_alert", "suggest_911"]},
        "$or": [{"acknowledged": False}, {"acknowledged": {"$exists": False}}],
    })
    return {"count": count}


@router.post("/calls/{call_id}/summary/regenerate")
async def regenerate_summary(call_id: str):
    db = get_db()
    doc = await db.calls.find_one({"_id": call_id})
    if not doc:
        raise HTTPException(404, "call not found")
    transcript = "\n".join(
        f"{t['role']}: {t['text']}" for t in doc.get("transcript", [])
    )
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
        {"$set": {
            "summary_patient": p,
            "summary_nurse": n,
            "summaries_generated_at": now,
            "summaries_error": None,
        }},
    )
    return {"summary_patient": p, "summary_nurse": n}


class WidgetEndBody(BaseModel):
    patient_id: str
    transcript: str | None = None
    severity: str | None = None  # optional override: none|patient_check|nurse_alert|suggest_911


@router.post("/calls/widget-end")
async def widget_end_call(body: WidgetEndBody):
    from uuid import uuid4
    from sentinel.finalize import finalize_call

    db = get_db()
    call_id = str(uuid4())
    conv_id = f"widget-{call_id}"
    action = body.severity or "none"
    det_map = {"none": 0.12, "patient_check": 0.25, "caregiver_alert": 0.35,
               "nurse_alert": 0.55, "suggest_911": 0.85}
    det = det_map.get(action, 0.12)
    news2 = 2 if det < 0.3 else 5 if det < 0.6 else 12
    qsofa = 0 if det < 0.6 else 2
    red_flags = ["sepsis"] if action == "suggest_911" else []
    summary_text = "Simulated widget check-in transcript." if not body.transcript else body.transcript[:200]
    transcript_text = body.transcript or "agent: How are you feeling today?\npatient: I feel okay, a little tired."
    await db.calls.insert_one({
        "_id": call_id,
        "patient_id": body.patient_id,
        "called_at": datetime.now(timezone.utc),
        "conversation_id": conv_id,
        "transcript": [
            {"role": "patient", "text": transcript_text, "t_start": 0.0, "t_end": 20.0}
        ],
        "score": {
            "deterioration": det,
            "qsofa": qsofa,
            "news2": news2,
            "red_flags": red_flags,
            "summary": summary_text,
            "recommended_action": action,
        },
        "similar_calls": [],
        "audio_features": {},
        "baseline_drift": {},
        "llm_degraded": False,
        "audio_degraded": False,
        "short_call": False,
    })
    result = await finalize_call(
        conversation_id=conv_id,
        transcript=transcript_text,
        end_reason="manual",
    )
    return {"call_id": call_id, **result}


@router.get("/calls/twiml")
async def twiml_for_call(patient_id: str):
    patient = await get_db().patients.find_one({"_id": patient_id})
    name = (patient or {}).get("name", "there")
    xml = build_check_in_twiml(
        patient_name=name,
        action_url=f"/api/calls/gather?patient_id={patient_id}",
    )
    return Response(content=xml, media_type="application/xml")


@router.post("/calls/gather")
async def twiml_gather(patient_id: str, SpeechResult: str = Form("")):
    from uuid import uuid4
    call_id = str(uuid4())
    await get_db().calls.insert_one({
        "_id": call_id,
        "patient_id": patient_id,
        "called_at": datetime.utcnow(),
        "transcript": [
            {"role": "patient", "text": SpeechResult,
             "t_start": 0.0, "t_end": 10.0}
        ],
        "score": None, "similar_calls": [], "embedding": [],
        "audio_features": {}, "baseline_drift": {},
        "llm_degraded": False, "audio_degraded": True, "short_call": True,
    })
    resp = TwilioVoiceResponse()
    resp.say("Thank you. A nurse will review your check-in. Goodbye.")
    return Response(content=str(resp), media_type="application/xml")


from sentinel.demo_runner import run_trajectory_demo


@router.post("/demo/run")
async def demo_run():
    pids = await run_trajectory_demo()
    return {"patient_ids": pids}


from pydantic import BaseModel as _BM


class TriggerCallBody(_BM):
    patient_id: str


@router.post("/calls/trigger")
async def trigger_call(body: TriggerCallBody):
    """Admin 'Call Now': dial the patient (native EL+Twilio) OR if Twilio isn't
    configured, emit a `pending_call` event so the patient's browser tab can
    auto-start the Convai widget.

    Also fans out an Expo push to every paired mobile device for the
    patient. The push is what wakes a backgrounded/screen-off phone — SSE
    can't reach a paused JS thread. See sentinel/push.py.
    """
    from sentinel.call_handler import place_call
    from sentinel.config import get_settings
    from sentinel import push

    s = get_settings()
    has_twilio = bool(s.twilio_account_sid.startswith("AC")) and bool(s.twilio_from_number)
    mode = "phone" if has_twilio else "widget"
    at_iso = datetime.now(tz=timezone.utc).isoformat()

    event_bus.publish({
        "type": "pending_call",
        "patient_id": body.patient_id,
        "mode": mode,
        "at": at_iso,
    })

    pushed = await push.send_incoming_call(
        patient_id=body.patient_id, mode=mode, at_iso=at_iso,
    )

    try:
        call_id = await place_call(body.patient_id)
    except LookupError:
        raise HTTPException(404, "patient not found")
    return {"call_id": call_id, "mode": mode, "pushes_sent": pushed}


# ---------------------------------------------------------------------------
# Push token registration (mobile)
# ---------------------------------------------------------------------------


class DevicePushTokenBody(_BM):
    token: str
    platform: str  # "ios" | "android"
    provider: str = "expo"  # "expo" today; reserved for raw fcm/apns later


@router.post("/devices/push-token")
async def devices_push_token(
    body: DevicePushTokenBody,
    token_payload: dict = Depends(require_device_token),
):
    """Mobile registers its Expo push token here so /calls/trigger can ring
    the device when the app is backgrounded or killed. Idempotent — the
    mobile client calls this on every launch.
    """
    from sentinel import push

    try:
        await push.register_push_token(
            device_id=token_payload["sub"],
            token=body.token,
            provider=body.provider,
            platform=body.platform,
        )
    except ValueError as e:
        raise HTTPException(400, {"error": "invalid_token", "message": str(e)})
    return {"ok": True}


class FinalizeBody(_BM):
    conversation_id: str


@router.post("/calls/finalize")
async def finalize(body: FinalizeBody):
    """ElevenLabs post-call webhook (or manual trigger) - pulls transcript
    + audio + runs scoring. Idempotent: re-running on same conversation_id
    creates a new scored call doc.
    """
    from sentinel.call_handler import finalize_call
    new_id = await finalize_call(conversation_id=body.conversation_id)
    if new_id is None:
        raise HTTPException(404, "no call found for conversation_id")
    return {"call_id": new_id}


# ---------------------------------------------------------------------------
# Mobile contract (M2 pairing + M3 vitals ingest)
# ---------------------------------------------------------------------------


@router.post("/patients/{pid}/pair", status_code=201)
async def create_pairing_code(pid: str = Path(...)):
    # Verify patient exists
    exists = await get_db().patients.find_one({"_id": pid})
    if exists is None:
        raise HTTPException(404, "patient not found")
    return await pairing_mod.generate_pairing_code(patient_id=pid)


class PairExchangeBody(_PM):
    code: str
    device_info: dict[str, Any] = {}


@router.post("/pair/exchange")
async def pair_exchange(body: PairExchangeBody):
    return await pairing_mod.exchange_code(code=body.code, device_info=body.device_info)


class MobileDemoLoginBody(_PM):
    patient_id: str
    passkey: str
    device_info: dict[str, Any] = {}


@router.post("/mobile/demo-login")
async def mobile_demo_login(body: MobileDemoLoginBody):
    """Mobile equivalent of the web /api/auth/login flow. Lets a demo user
    skip the 6-digit pairing code by entering the configured passkey, and
    receives a real signed device token so vitals uploads succeed."""
    return await pairing_mod.demo_login(
        patient_id=body.patient_id,
        passkey=body.passkey,
        device_info=body.device_info,
    )


@router.post("/devices/{device_id}/revoke", status_code=204)
async def revoke_device_route(device_id: str = Path(...)):
    await pairing_mod.revoke_device(device_id=device_id)


class VitalsBatchBody(_PM):
    patient_id: str
    device_id: str
    batch_id: str
    samples: list[dict[str, Any]]


@router.post("/vitals/batch")
async def vitals_batch(
    body: VitalsBatchBody,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    token_payload: dict = Depends(require_device_token),
):
    result = await vitals_mod.ingest_batch(
        patient_id=body.patient_id,
        device_id=body.device_id,
        batch_id=body.batch_id,
        idempotency_key=idempotency_key,
        samples=body.samples,
        auth_patient_id=token_payload["pid"],
        auth_device_id=token_payload["sub"],
    )
    import json
    status = 200 if result.get("idempotent_replay") else 202
    return Response(content=json.dumps(result),
                    media_type="application/json", status_code=status)


@router.get("/patients/{pid}/vitals")
async def patient_vitals(pid: str, hours: int = 2):
    from datetime import datetime, timedelta, timezone
    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=hours)
    cur = (
        get_db()
        .vitals.find({"patient_id": pid, "t": {"$gte": cutoff}})
        .sort("t", 1)
    )
    return [
        {
            "t": d["t"].isoformat() if hasattr(d["t"], "isoformat") else d["t"],
            "kind": d["kind"],
            "value": d["value"],
            "unit": d["unit"],
            "source": d["source"],
            "clock_skew": d.get("clock_skew", False),
        }
        async for d in cur
    ]


@router.get("/stream")
async def stream_events():
    q = event_bus.subscribe()
    return StreamingResponse(
        event_bus.stream(q),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/stream/stats")
async def stream_stats():
    return {"subscribers": event_bus.snapshot_subs()}


@router.post("/demo/seed-named")
async def seed_named_route(clean: bool = True):
    from sentinel.named_seed import seed_named_patients
    pids = await seed_named_patients(clean=clean)
    return {"patient_ids": pids}
