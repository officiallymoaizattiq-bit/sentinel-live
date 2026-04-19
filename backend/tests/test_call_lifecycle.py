from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from sentinel.finalize import finalize_call


@pytest.mark.asyncio
async def test_lifecycle_fine_outcome(mongo):
    await mongo.calls.insert_one({
        "_id": "c1", "patient_id": "p1",
        "called_at": datetime(2026, 4, 18),
        "conversation_id": "conv_abc",
        "transcript": [],
    })
    score_dict = {
        "deterioration": 0.05, "qsofa": 0, "news2": 1, "red_flags": [],
        "summary": "ok", "recommended_action": "none",
    }
    with patch("sentinel.finalize._score_if_needed", AsyncMock(return_value=score_dict)), \
         patch("sentinel.finalize.summarize_patient", AsyncMock(return_value="P")), \
         patch("sentinel.finalize.summarize_nurse", AsyncMock(return_value="N")):
        r = await finalize_call("conv_abc", "hi", "agent_signal")
    assert r["already_finalized"] is False
    doc = await mongo.calls.find_one({"_id": "c1"})
    assert doc["outcome_label"] == "fine"
    assert doc["summary_patient"] == "P"
    assert doc["summary_nurse"] == "N"
    assert doc["escalation_911"] is False


@pytest.mark.asyncio
async def test_lifecycle_escalation_creates_alert_and_flags_911(mongo):
    await mongo.calls.insert_one({
        "_id": "c1", "patient_id": "p1",
        "called_at": datetime(2026, 4, 18),
        "conversation_id": "conv_abc",
        "transcript": [],
    })
    score_dict = {
        "deterioration": 0.9, "qsofa": 3, "news2": 15, "red_flags": ["sepsis"],
        "summary": "bad", "recommended_action": "suggest_911",
    }
    with patch("sentinel.finalize._score_if_needed", AsyncMock(return_value=score_dict)), \
         patch("sentinel.finalize.summarize_patient", AsyncMock(return_value="P")), \
         patch("sentinel.finalize.summarize_nurse", AsyncMock(return_value="N")), \
         patch("sentinel.finalize.send_alert", AsyncMock()) as sa:
        await finalize_call("conv_abc", "hi", "agent_signal")
    sa.assert_awaited_once()
    doc = await mongo.calls.find_one({"_id": "c1"})
    assert doc["escalation_911"] is True
    assert doc["outcome_label"] == "escalated_911"


@pytest.mark.asyncio
async def test_lifecycle_watchdog_and_webhook_race_produces_one_finalize(mongo):
    """Simulate watchdog + webhook firing; second should be idempotent no-op."""
    from sentinel.watchdog import start_call_watchdog

    await mongo.calls.insert_one({
        "_id": "c1", "patient_id": "p1",
        "called_at": datetime(2026, 4, 18),
        "conversation_id": "conv_abc",
        "transcript": [{"role": "agent", "text": "hello"}],
    })
    score_dict = {
        "deterioration": 0.1, "qsofa": 0, "news2": 1, "red_flags": [],
        "summary": "ok", "recommended_action": "none",
    }
    with patch("sentinel.watchdog.asyncio.sleep", AsyncMock()), \
         patch("sentinel.finalize._score_if_needed", AsyncMock(return_value=score_dict)), \
         patch("sentinel.finalize.summarize_patient", AsyncMock(return_value="P")), \
         patch("sentinel.finalize.summarize_nurse", AsyncMock(return_value="N")):
        await start_call_watchdog("conv_abc", timeout_s=40)
        r2 = await finalize_call("conv_abc", "agent: hello", "agent_signal")
    assert r2["already_finalized"] is True
    doc = await mongo.calls.find_one({"_id": "c1"})
    # Watchdog wrote timeout_40s first; webhook race arrives after and no-ops.
    assert doc["end_reason"] == "timeout_40s"
