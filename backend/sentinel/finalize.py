from __future__ import annotations

import asyncio
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
    """Return the call's score dict.

    All production entry points (``call_handler.finalize_call`` and
    ``/api/calls/widget-end``) insert the call doc with a precomputed
    ``score`` before invoking this finalize step, so this helper's only
    job is to return that existing score. If it's missing we fall back
    to a conservative ``none`` action rather than invoking the full
    scoring pipeline from here (which would need audio features, drift,
    and the Gemini LLM — none of which are plumbed through the webhook
    path).
    """
    existing = call_doc.get("score")
    if existing:
        return existing
    log.warning(
        "finalize_call: no prior score for call=%s; defaulting to 'none'",
        call_doc.get("_id"),
    )
    return {
        "deterioration": 0.0,
        "qsofa": 0,
        "news2": 0,
        "red_flags": [],
        "summary": (transcript[:200] if transcript else ""),
        "recommended_action": RecommendedAction.NONE.value,
    }


async def finalize_call(
    conversation_id: str,
    transcript: str,
    end_reason: str,
) -> dict:
    """Post-call finalize: write summary_patient + summary_nurse via Gemini,
    send escalation alerts, publish `call_completed` for live dashboards.

    Idempotent: if `ended_at` is already set, re-broadcast `call_completed`
    and short-circuit. To retry a failed summary, use
    `POST /api/calls/{id}/summary/regenerate`.
    """
    settings = get_settings()
    db = get_db()

    doc = await db.calls.find_one({"conversation_id": conversation_id})
    if not doc:
        log.warning("finalize_call: unknown conversation_id=%s", conversation_id)
        return {"already_finalized": False, "skipped": True}

    if doc.get("ended_at") is not None:
        publish(
            {
                "type": "call_completed",
                "call_id": doc["_id"],
                "patient_id": doc["patient_id"],
                "outcome_label": doc.get("outcome_label"),
                "escalation_911": bool(doc.get("escalation_911")),
                "summary_patient": doc.get("summary_patient"),
                "summary_nurse": doc.get("summary_nurse"),
            }
        )
        return {
            "already_finalized": True,
            "call_id": doc["_id"],
            "summary_ok": bool((doc.get("summary_patient") or "").strip()),
        }

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
            summary_p, summary_n = await asyncio.gather(
                summarize_patient(transcript=transcript),
                summarize_nurse(
                    transcript=transcript,
                    vitals={},
                    score={k: score[k] for k in ("deterioration", "qsofa", "news2")},
                ),
            )
            update["summaries_generated_at"] = now
        except Exception as e:
            err = str(e)
            log.exception("summary failed for %s: %s", conversation_id, e)

    update["summary_patient"] = summary_p
    update["summary_nurse"] = summary_n
    update["summaries_error"] = err

    # Atomic check-and-set on ended_at: if a racing finalize
    # (watchdog vs webhook) already set it, our write is a no-op and we
    # short-circuit as if we had observed the prior finalize. Prevents
    # double send_alert / double call_completed with stale data.
    result = await db.calls.update_one(
        {"_id": doc["_id"], "ended_at": None},
        {"$set": update},
    )
    if result.modified_count == 0:
        latest = await db.calls.find_one({"_id": doc["_id"]}) or doc
        publish(
            {
                "type": "call_completed",
                "call_id": latest["_id"],
                "patient_id": latest["patient_id"],
                "outcome_label": latest.get("outcome_label"),
                "escalation_911": bool(latest.get("escalation_911")),
                "summary_patient": latest.get("summary_patient"),
                "summary_nurse": latest.get("summary_nurse"),
            }
        )
        return {
            "already_finalized": True,
            "call_id": latest["_id"],
            "summary_ok": bool((latest.get("summary_patient") or "").strip()),
        }

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

    return {
        "already_finalized": False,
        "call_id": doc["_id"],
        "summary_ok": bool((summary_p or "").strip()),
    }
