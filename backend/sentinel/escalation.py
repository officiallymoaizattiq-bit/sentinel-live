from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import uuid4

from twilio.rest import Client as TwilioClient

from sentinel.config import get_settings
from sentinel.db import get_db
from sentinel.models import RecommendedAction, Score


@dataclass
class ActionBundle:
    channels: list[str] = field(default_factory=list)


_POLICY: dict[RecommendedAction, list[str]] = {
    RecommendedAction.NONE: [],
    RecommendedAction.PATIENT_CHECK: [],
    RecommendedAction.CAREGIVER_ALERT: ["sms_caregiver"],
    RecommendedAction.NURSE_ALERT: ["sms_nurse", "dashboard_banner"],
    RecommendedAction.SUGGEST_911: [
        "sms_caregiver", "sms_nurse", "dashboard_911_prompt"
    ],
}


def decide_actions(*, score: Score) -> ActionBundle:
    return ActionBundle(channels=list(_POLICY[score.recommended_action]))


def _sms_send(to: str, body: str) -> None:
    s = get_settings()
    if (
        not s.twilio_account_sid
        or not s.twilio_from_number
        or (s.demo_mode and not to.startswith("+1"))
    ):
        print(f"[DEMO SMS] to={to} body={body}")
        return
    client = TwilioClient(s.twilio_account_sid, s.twilio_auth_token)
    client.messages.create(from_=s.twilio_from_number, to=to, body=body)


def _compose(patient: dict, score: Score, who: str) -> str:
    name = patient.get("name", "patient")
    flags = ", ".join(score.red_flags) or "no specific flags"
    return (
        f"[Sentinel] {who} alert for {name}. "
        f"Deterioration score {score.deterioration:.2f}. "
        f"Flags: {flags}. Summary: {score.summary}"
    )


async def send_alert(*, patient_id: str, call_id: str, score: Score) -> None:
    db = get_db()
    patient = await db.patients.find_one({"_id": patient_id})
    if patient is None:
        raise LookupError(f"unknown patient {patient_id}")

    bundle = decide_actions(score=score)
    for ch in bundle.channels:
        if ch == "sms_caregiver":
            phone = patient["caregiver"]["phone"]
            _sms_send(phone, _compose(patient, score, "Caregiver"))
        elif ch == "sms_nurse":
            phone = patient.get("assigned_nurse_id") or ""
            if phone:
                _sms_send(phone, _compose(patient, score, "Nurse"))

    await db.alerts.insert_one({
        "_id": str(uuid4()),
        "patient_id": patient_id,
        "call_id": call_id,
        "severity": score.recommended_action.value,
        "channel": bundle.channels,
        "sent_at": datetime.now(tz=timezone.utc),
        "acknowledged_by": None,
        "ack_at": None,
    })
