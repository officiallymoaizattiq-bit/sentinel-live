from datetime import datetime, timedelta, timezone
from uuid import uuid4

from pymongo.errors import DuplicateKeyError

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
    """Insert a patient + blank care plan. Idempotent when `patient_id` is
    supplied: if a row with that id already exists, return it unchanged
    rather than raising a duplicate-key error. Auto-generated ids use uuid4
    and collide with cryptographic improbability, so that path always
    inserts.
    """
    if consent is None:
        raise ValueError("consent required to enroll patient")
    now = datetime.now(tz=timezone.utc)
    pid = patient_id if patient_id is not None else str(uuid4())
    db = get_db()

    # Idempotency: caller-supplied pid may already exist (e.g. seed script
    # reruns). Skip insert in that case instead of 500ing the request.
    if patient_id is not None:
        existing = await db.patients.find_one({"_id": pid})
        if existing is not None:
            return pid

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
    try:
        await db.patients.insert_one(doc)
    except DuplicateKeyError:
        # Race: another request enrolled this pid between our check and
        # insert. Treat as success — the row exists either way.
        return pid

    await db.care_plans.insert_one(
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
