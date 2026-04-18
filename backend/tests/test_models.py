from datetime import datetime, timezone

from sentinel.models import (
    Caregiver,
    Consent,
    Patient,
    Score,
    RecommendedAction,
    SurgeryType,
)


def test_patient_roundtrip():
    p = Patient(
        name="J Doe",
        phone="+15555550001",
        language="en",
        surgery_type=SurgeryType.LAP_CHOLE,
        surgery_date=datetime(2026, 4, 15, tzinfo=timezone.utc),
        discharge_date=datetime(2026, 4, 17, tzinfo=timezone.utc),
        caregiver=Caregiver(name="K Doe", phone="+15555550002"),
        consent=Consent(recorded_at=datetime.now(tz=timezone.utc), ip="1.2.3.4", version="v1"),
    )
    as_doc = p.model_dump(mode="json")
    restored = Patient.model_validate(as_doc)
    assert restored.surgery_type == SurgeryType.LAP_CHOLE


def test_score_action_enum():
    s = Score(
        deterioration=0.7,
        qsofa=2,
        news2=6,
        red_flags=["tachypnea"],
        summary="pt reports SOB",
        recommended_action=RecommendedAction.NURSE_ALERT,
    )
    assert s.recommended_action is RecommendedAction.NURSE_ALERT
