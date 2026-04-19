from datetime import datetime

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
async def test_open_alert_count(client):
    c, db = client
    base = {"patient_id": "p1", "call_id": "c1",
            "channel": ["sms"], "sent_at": datetime(2026, 4, 18)}
    await db.alerts.insert_many([
        {"_id": "a1", **base, "severity": "nurse_alert", "acknowledged": False},
        {"_id": "a2", **base, "severity": "suggest_911", "acknowledged": False},
        {"_id": "a3", **base, "severity": "nurse_alert", "acknowledged": True},
        {"_id": "a4", **base, "severity": "patient_check", "acknowledged": False},
    ])
    r = await c.get("/api/alerts/open-count")
    assert r.status_code == 200
    assert r.json() == {"count": 2}


@pytest.mark.asyncio
async def test_open_alert_count_treats_missing_field_as_unacked(client):
    c, db = client
    await db.alerts.insert_one({
        "_id": "a1", "patient_id": "p1", "call_id": "c1",
        "severity": "nurse_alert", "channel": ["sms"],
        "sent_at": datetime(2026, 4, 18),
    })
    r = await c.get("/api/alerts/open-count")
    assert r.json() == {"count": 1}
