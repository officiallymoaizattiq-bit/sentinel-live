from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sentinel.config import get_settings
from sentinel.db import get_db
from sentinel.escalation import send_alert
from sentinel.events import publish
from sentinel.models import RecommendedAction, Score
from sentinel.outcomes import derive_outcome_label
from sentinel.summarization import summarize_nurse, summarize_patient

log = logging.getLogger("sentinel.finalize")


async def _score_if_needed(call_doc: dict, transcript: str) -> dict:
    """Return a score dict. Use existing score when present; else compute via scoring.score_call."""
    existing = call_doc.get("score")
    if existing:
        return existing
    from sentinel.scoring import score_call

    s: Score = await score_call(
        patient_id=call_doc["patient_id"], transcript=transcript
    )
    return s.model_dump()


async def finalize_call(
    conversation_id: str,
    transcript: str,
    end_reason: str,
) -> dict:
    settings = get_settings()
    db = get_db()

    doc = await db.calls.find_one({"conversation_id": conversation_id})
    if not doc:
        log.warning("finalize_call: unknown conversation_id=%s", conversation_id)
        return {"already_finalized": False, "skipped": True}

    if doc.get("ended_at") is not None:
        return {"already_finalized": True, "call_id": doc["_id"]}

    score = await _score_if_needed(doc, transcript)
    action = RecommendedAction(score["recommended_action"])
    outcome_label = derive_outcome_label(action)
    escalation_911 = outcome_label == "escalated_911"

    now = datetime.now(timezone.utc)
    update: dict[str, Any] = {
        "ended_at": now,
        "end_reason": end_reason,
        "outcome_label": outcome_label,
        "escalation_911": escalation_911,
        "score": score,
    }

    summary_p: str | None = None
    summary_n: str | None = None
    err: str | None = None
    if settings.enable_call_summary:
        try:
            summary_p = await summarize_patient(transcript=transcript)
            summary_n = await summarize_nurse(
                transcript=transcript,
                vitals={},
                score={k: score[k] for k in ("deterioration", "qsofa", "news2")},
            )
            update["summaries_generated_at"] = now
        except Exception as e:
            err = str(e)
            log.exception("gemini summary failed")

    update["summary_patient"] = summary_p
    update["summary_nurse"] = summary_n
    update["summaries_error"] = err

    await db.calls.update_one({"_id": doc["_id"]}, {"$set": update})

    if outcome_label in ("schedule_visit", "escalated_911"):
        try:
            await send_alert(
                patient_id=doc["patient_id"],
                call_id=doc["_id"],
                score=Score.model_validate(score),
            )
        except Exception:
            log.exception("send_alert failed in finalize_call")

    publish(
        {
            "type": "call_completed",
            "call_id": doc["_id"],
            "patient_id": doc["patient_id"],
            "outcome_label": outcome_label,
            "escalation_911": escalation_911,
            "summary_patient": summary_p,
            "summary_nurse": summary_n,
        }
    )

    return {"already_finalized": False, "call_id": doc["_id"]}
