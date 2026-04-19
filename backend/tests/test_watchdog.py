from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from sentinel.watchdog import start_call_watchdog


@pytest.mark.asyncio
async def test_watchdog_finalizes_with_timeout_reason_when_not_ended(mongo):
    await mongo.calls.insert_one(
        {
            "_id": "c1",
            "patient_id": "p1",
            "conversation_id": "conv_abc",
            "transcript": [],
        }
    )
    with patch("sentinel.watchdog.asyncio.sleep", AsyncMock()), \
         patch("sentinel.watchdog.finalize_call", AsyncMock(return_value={"ok": True})) as fin:
        await start_call_watchdog("conv_abc", timeout_s=40)
    fin.assert_awaited_once()
    kwargs = fin.await_args.kwargs
    assert kwargs["conversation_id"] == "conv_abc"
    assert kwargs["end_reason"] == "timeout_40s"


@pytest.mark.asyncio
async def test_watchdog_no_op_if_call_already_ended(mongo):
    await mongo.calls.insert_one(
        {
            "_id": "c1",
            "patient_id": "p1",
            "conversation_id": "conv_abc",
            "ended_at": datetime(2026, 4, 18),
            "transcript": [],
        }
    )
    with patch("sentinel.watchdog.asyncio.sleep", AsyncMock()), \
         patch("sentinel.watchdog.finalize_call", AsyncMock()) as fin:
        await start_call_watchdog("conv_abc", timeout_s=40)
    fin.assert_not_awaited()


@pytest.mark.asyncio
async def test_watchdog_no_op_if_unknown_conversation(mongo):
    with patch("sentinel.watchdog.asyncio.sleep", AsyncMock()), \
         patch("sentinel.watchdog.finalize_call", AsyncMock()) as fin:
        await start_call_watchdog("conv_unknown", timeout_s=40)
    fin.assert_not_awaited()
