from __future__ import annotations

from sentinel.models import RecommendedAction


def derive_outcome_label(action: RecommendedAction) -> str:
    if action == RecommendedAction.SUGGEST_911:
        return "escalated_911"
    if action in (RecommendedAction.NURSE_ALERT, RecommendedAction.CAREGIVER_ALERT):
        return "schedule_visit"
    return "fine"
