from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sentinel.config import get_settings
from sentinel.db import get_db
from sentinel.models import Caregiver, Consent, SurgeryType


async def enroll_patient(
    *,
    name: str,
    phone: str,
    surgery_type: SurgeryType,
    surgery_date: datetime,
    discharge_date: datetime,
    caregiver: Caregiver,
    consent: Consent | None,
    language: str = "en",
    patient_id: str | None = None,
) -> str:
    if consent is None:
        raise ValueError("consent required to enroll patient")
    now = datetime.now(tz=timezone.utc)
    cadence_h = get_settings().call_cadence_hours
    pid = patient_id if patient_id is not None else str(uuid4())
    doc = {
        "_id": pid,
        "name": name,
        "phone": phone,
        "language": language,
        "surgery_type": surgery_type.value,
        "surgery_date": surgery_date,
        "discharge_date": discharge_date,
        "caregiver": caregiver.model_dump(),
        "assigned_nurse_id": None,
        "enrollment_day": 0,
        "next_call_at": now + timedelta(minutes=5),
        "call_count": 0,
        "consent": consent.model_dump(),
    }
    await get_db().patients.insert_one(doc)
    await get_db().care_plans.insert_one(
        {
            "_id": str(uuid4()),
            "patient_id": pid,
            "meds": [],
            "red_flags": [],
            "allergies": [],
            "goals_of_care": "",
        }
    )
    return pid


async def mark_called(patient_id: str) -> None:
    cadence_h = get_settings().call_cadence_hours
    await get_db().patients.update_one(
        {"_id": patient_id},
        {
            "$inc": {"call_count": 1},
            "$set": {
                "next_call_at": datetime.now(tz=timezone.utc)
                + timedelta(hours=cadence_h)
            },
        },
    )


async def due_patients(limit: int = 50) -> list[dict]:
    now = datetime.now(tz=timezone.utc)
    cur = (
        get_db()
        .patients.find({"next_call_at": {"$lte": now}})
        .limit(limit)
    )
    return [doc async for doc in cur]
