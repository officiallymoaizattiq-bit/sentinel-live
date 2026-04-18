"""Named demo patients for hackathon. Replaces generic 'Demo Patient' seed."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sentinel.db import get_db
from sentinel.enrollment import enroll_patient
from sentinel.models import Caregiver, Consent, SurgeryType

DEMO_PATIENTS = [
    {
        "name": "John Chen",
        "phone": "+15555550101",
        "surgery_type": SurgeryType.LAP_CHOLE,
        "caregiver_name": "Grace Chen",
        "caregiver_phone": "+15555550102",
        "days_post_op": 3,
    },
    {
        "name": "Maria Garcia",
        "phone": "+15555550103",
        "surgery_type": SurgeryType.CSECTION,
        "caregiver_name": "Luis Garcia",
        "caregiver_phone": "+15555550104",
        "days_post_op": 5,
    },
    {
        "name": "David Patel",
        "phone": "+15555550105",
        "surgery_type": SurgeryType.APPY,
        "caregiver_name": "Asha Patel",
        "caregiver_phone": "+15555550106",
        "days_post_op": 2,
    },
]


async def seed_named_patients(*, clean: bool = True) -> list[str]:
    db = get_db()
    if clean:
        await db.patients.delete_many({})
        await db.calls.delete_many({})
        await db.alerts.delete_many({})
        await db.care_plans.delete_many({})

    now = datetime.now(tz=timezone.utc)
    pids: list[str] = []
    for p in DEMO_PATIENTS:
        surgery_date = now - timedelta(days=p["days_post_op"] + 2)
        discharge_date = now - timedelta(days=p["days_post_op"])
        pid = await enroll_patient(
            name=p["name"],
            phone=p["phone"],
            surgery_type=p["surgery_type"],
            surgery_date=surgery_date,
            discharge_date=discharge_date,
            caregiver=Caregiver(name=p["caregiver_name"], phone=p["caregiver_phone"]),
            consent=Consent(recorded_at=now, ip="127.0.0.1", version="v1"),
        )
        pids.append(pid)
    return pids
