from sentinel.models import RecommendedAction
from sentinel.outcomes import derive_outcome_label


def test_derive_outcome_label_911():
    assert derive_outcome_label(RecommendedAction.SUGGEST_911) == "escalated_911"


def test_derive_outcome_label_visit_nurse():
    assert derive_outcome_label(RecommendedAction.NURSE_ALERT) == "schedule_visit"


def test_derive_outcome_label_visit_caregiver():
    assert derive_outcome_label(RecommendedAction.CAREGIVER_ALERT) == "schedule_visit"


def test_derive_outcome_label_fine_patient_check():
    assert derive_outcome_label(RecommendedAction.PATIENT_CHECK) == "fine"


def test_derive_outcome_label_fine_none():
    assert derive_outcome_label(RecommendedAction.NONE) == "fine"
