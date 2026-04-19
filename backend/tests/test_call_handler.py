import pytest
from mongomock_motor import AsyncMongoMockClient

from sentinel import call_handler as ch


@pytest.fixture
def db(monkeypatch):
    client = AsyncMongoMockClient()
    db = client["sentinel_test"]
    monkeypatch.setattr(ch, "get_db", lambda: db)
    return db


async def test_place_call_demo_mode_stores_placeholder(db, monkeypatch):
    """With no ELEVENLABS_PHONE_NUMBER_ID set, demo mode writes a stub call doc."""
    monkeypatch.setenv("DEMO_MODE", "true")
    monkeypatch.delenv("ELEVENLABS_PHONE_NUMBER_ID", raising=False)
    await db.patients.insert_one({
        "_id": "p1", "name": "A", "phone": "+15555550010",
        "caregiver": {"phone": "+1"}, "call_count": 0,
    })
    call_id = await ch.place_call("p1")
    assert call_id
    doc = await db.calls.find_one({"_id": call_id})
    assert doc is not None
    assert doc["patient_id"] == "p1"
    assert doc["short_call"] is True


async def test_place_call_missing_patient_raises(db):
    with pytest.raises(LookupError):
        await ch.place_call("nope")


def test_twiml_prompt_contains_patient_name():
    xml = ch.build_check_in_twiml(patient_name="Alex",
                                  action_url="http://x/api/calls/gather")
    assert "Alex" in xml and "<Gather" in xml


import asyncio
from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_dial_with_watchdog_spawns_watchdog_task():
    from sentinel import call_handler

    with patch.object(call_handler, "_dispatch_elevenlabs",
                      AsyncMock(return_value={"conversation_id": "conv_xyz"})), \
         patch.object(call_handler.asyncio, "create_task") as ct:
        result = await call_handler.dial_patient_with_watchdog(
            patient_id="p1", call_id="c1"
        )
    assert result["conversation_id"] == "conv_xyz"
    ct.assert_called_once()


@pytest.mark.asyncio
async def test_dial_with_watchdog_skips_watchdog_if_no_conversation_id():
    from sentinel import call_handler

    with patch.object(call_handler, "_dispatch_elevenlabs",
                      AsyncMock(return_value={})), \
         patch.object(call_handler.asyncio, "create_task") as ct:
        await call_handler.dial_patient_with_watchdog(patient_id="p1", call_id="c1")
    ct.assert_not_called()
