from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from sentinel.finalize import finalize_call


@pytest.fixture
async def seed_call(mongo):
    await mongo.calls.insert_one(
        {
            "_id": "c1",
            "patient_id": "p1",
            "called_at": datetime(2026, 4, 18),
            "conversation_id": "conv_abc",
            "transcript": [],
            "short_call": False,
        }
    )
    return "c1"


@pytest.mark.asyncio
async def test_finalize_call_persists_summaries_and_outcome(mongo, seed_call):
    score_dict = {
        "deterioration": 0.1,
        "qsofa": 0,
        "news2": 1,
        "red_flags": [],
        "summary": "stable",
        "recommended_action": "none",
    }
    with patch("sentinel.finalize.summarize_patient", AsyncMock(return_value="OK")), \
         patch("sentinel.finalize.summarize_nurse", AsyncMock(return_value="Stable.")), \
         patch("sentinel.finalize._score_if_needed", AsyncMock(return_value=score_dict)), \
         patch("sentinel.finalize.publish") as pub:
        result = await finalize_call(
            conversation_id="conv_abc",
            transcript="agent: hi\npatient: fine",
            end_reason="agent_signal",
        )

    doc = await mongo.calls.find_one({"_id": "c1"})
    assert doc["summary_patient"] == "OK"
    assert doc["summary_nurse"] == "Stable."
    assert doc["outcome_label"] == "fine"
    assert doc["escalation_911"] is False
    assert doc["end_reason"] == "agent_signal"
    assert doc["ended_at"] is not None
    assert result["already_finalized"] is False
    assert any(
        c.args[0].get("type") == "call_completed" and c.args[0].get("call_id") == "c1"
        for c in pub.call_args_list
    )


@pytest.mark.asyncio
async def test_finalize_call_idempotent(mongo, seed_call):
    await mongo.calls.update_one(
        {"_id": "c1"},
        {"$set": {
            "ended_at": datetime(2026, 4, 18, 0, 0, 30),
            "end_reason": "agent_signal",
            "outcome_label": "fine",
        }},
    )
    result = await finalize_call(
        conversation_id="conv_abc",
        transcript="agent: hi",
        end_reason="timeout_40s",
    )
    assert result["already_finalized"] is True
    doc = await mongo.calls.find_one({"_id": "c1"})
    assert doc["end_reason"] == "agent_signal"  # not overwritten


@pytest.mark.asyncio
async def test_finalize_call_gemini_failure_still_persists(mongo, seed_call):
    score_dict = {
        "deterioration": 0.1,
        "qsofa": 0,
        "news2": 1,
        "red_flags": [],
        "summary": "stable",
        "recommended_action": "none",
    }
    with patch("sentinel.finalize.summarize_patient", AsyncMock(side_effect=RuntimeError("gemini"))), \
         patch("sentinel.finalize.summarize_nurse", AsyncMock(side_effect=RuntimeError("gemini"))), \
         patch("sentinel.finalize._score_if_needed", AsyncMock(return_value=score_dict)), \
         patch("sentinel.finalize.publish"):
        await finalize_call("conv_abc", "x", "agent_signal")

    doc = await mongo.calls.find_one({"_id": "c1"})
    assert doc["summary_patient"] is None
    assert doc["summary_nurse"] is None
    assert doc["summaries_error"] is not None
    assert doc["outcome_label"] == "fine"


@pytest.mark.asyncio
async def test_finalize_call_escalation_911_creates_alert(mongo, seed_call):
    score_dict = {
        "deterioration": 0.9,
        "qsofa": 3,
        "news2": 15,
        "red_flags": ["sepsis"],
        "summary": "bad",
        "recommended_action": "suggest_911",
    }
    with patch("sentinel.finalize.summarize_patient", AsyncMock(return_value="stay calm")), \
         patch("sentinel.finalize.summarize_nurse", AsyncMock(return_value="critical")), \
         patch("sentinel.finalize._score_if_needed", AsyncMock(return_value=score_dict)), \
         patch("sentinel.finalize.send_alert", AsyncMock()) as sa, \
         patch("sentinel.finalize.publish"):
        await finalize_call("conv_abc", "x", "agent_signal")

    doc = await mongo.calls.find_one({"_id": "c1"})
    assert doc["outcome_label"] == "escalated_911"
    assert doc["escalation_911"] is True
    sa.assert_awaited_once()
