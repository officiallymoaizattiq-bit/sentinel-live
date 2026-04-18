from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Body, Depends, Form, Header, HTTPException, Path, Response
from pydantic import BaseModel
from pydantic import BaseModel as _PM
from twilio.twiml.voice_response import VoiceResponse as TwilioVoiceResponse

from sentinel import enrollment
from sentinel import pairing as pairing_mod
from sentinel import vitals as vitals_mod
from sentinel.auth import require_device_token
from sentinel.call_handler import build_check_in_twiml
from sentinel.db import get_db
from sentinel.models import Caregiver, Consent, SurgeryType

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
    return [
        {
            "id": d["_id"],
            "name": d["name"],
            "surgery_type": d["surgery_type"],
            "next_call_at": d.get("next_call_at"),
            "call_count": d.get("call_count", 0),
        }
        for d in docs
    ]


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
            "called_at": d["called_at"],
            "score": d.get("score"),
            "similar_calls": d.get("similar_calls", []),
            "short_call": d.get("short_call", False),
            "llm_degraded": d.get("llm_degraded", False),
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
    pid = await run_trajectory_demo()
    return {"patient_id": pid}


from pydantic import BaseModel as _BM


class TriggerCallBody(_BM):
    patient_id: str


@router.post("/calls/trigger")
async def trigger_call(body: TriggerCallBody):
    """On-demand: dial a patient now. Used for live-call demo and testing."""
    from sentinel.call_handler import place_call
    try:
        call_id = await place_call(body.patient_id)
    except LookupError:
        raise HTTPException(404, "patient not found")
    return {"call_id": call_id}


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
