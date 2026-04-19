from datetime import datetime
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

from sentinel import api, escalation, enrollment, scoring
from sentinel.main import create_app


@pytest.fixture
async def client(monkeypatch):
    mock = AsyncMongoMockClient()
    db = mock["sentinel_test"]
    for mod in (api, escalation, enrollment, scoring):
        monkeypatch.setattr(mod, "get_db", lambda d=db: d)
    app = create_app(start_scheduler=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c, db


@pytest.mark.asyncio
async def test_ack_marks_alert_and_emits_event(client):
    c, db = client
    await db.alerts.insert_one({
        "_id": "a1", "patient_id": "p1", "call_id": "c1",
        "severity": "nurse_alert", "channel": ["sms"],
        "sent_at": datetime(2026, 4, 18),
        "acknowledged": False, "acknowledged_at": None,
    })
    with patch("sentinel.api.event_bus.publish") as pub:
        r = await c.post("/api/alerts/a1/ack")
    assert r.status_code == 200
    assert r.json()["acknowledged"] is True
    doc = await db.alerts.find_one({"_id": "a1"})
    assert doc["acknowledged"] is True
    assert doc["acknowledged_at"] is not None
    assert any(
        call.args[0].get("type") == "alert_ack" and call.args[0].get("alert_id") == "a1"
        for call in pub.call_args_list
    )


@pytest.mark.asyncio
async def test_ack_already_acked_returns_409(client):
    c, db = client
    await db.alerts.insert_one({
        "_id": "a1", "patient_id": "p1", "call_id": "c1",
        "severity": "nurse_alert", "channel": ["sms"],
        "sent_at": datetime(2026, 4, 18),
        "acknowledged": True, "acknowledged_at": datetime(2026, 4, 18),
    })
    r = await c.post("/api/alerts/a1/ack")
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_ack_missing_alert_returns_409(client):
    c, _ = client
    r = await c.post("/api/alerts/nope/ack")
    assert r.status_code == 409
