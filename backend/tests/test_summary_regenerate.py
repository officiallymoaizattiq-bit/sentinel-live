from datetime import datetime
from unittest.mock import AsyncMock, patch

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
async def test_regenerate_summary_calls_gemini_twice_and_updates_doc(client):
    c, db = client
    await db.calls.insert_one({
        "_id": "c1", "patient_id": "p1",
        "called_at": datetime(2026, 4, 18),
        "transcript": [{"role": "agent", "text": "hi", "t_start": 0, "t_end": 1}],
        "score": {"deterioration": 0.1, "qsofa": 0, "news2": 1, "red_flags": [],
                  "summary": "ok", "recommended_action": "none"},
    })
    with patch("sentinel.api.summarize_patient", AsyncMock(return_value="P")), \
         patch("sentinel.api.summarize_nurse", AsyncMock(return_value="N")):
        r = await c.post("/api/calls/c1/summary/regenerate")
    assert r.status_code == 200
    doc = await db.calls.find_one({"_id": "c1"})
    assert doc["summary_patient"] == "P"
    assert doc["summary_nurse"] == "N"
    assert doc["summaries_error"] is None


@pytest.mark.asyncio
async def test_regenerate_summary_404_if_call_missing(client):
    c, _ = client
    r = await c.post("/api/calls/nope/summary/regenerate")
    assert r.status_code == 404
