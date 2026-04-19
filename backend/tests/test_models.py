from datetime import datetime, timezone

from sentinel.models import (
    Alert,
    Call,
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
