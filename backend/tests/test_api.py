from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

from sentinel import api, enrollment, escalation, scoring, vitals as vitals_mod
from sentinel.main import create_app


@pytest.fixture
async def client(monkeypatch):
    mock = AsyncMongoMockClient()
    db = mock["sentinel_test"]
    for mod in (api, enrollment, escalation, scoring, vitals_mod):
        monkeypatch.setattr(mod, "get_db", lambda d=db: d)
    app = create_app(start_scheduler=False)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://t"
    ) as c:
        yield c


async def test_patient_vitals_max_points_returns_points_and_latest(
    client, monkeypatch,
):
    mock = AsyncMongoMockClient()
    db = mock["sentinel_test"]
    for mod in (api, enrollment, escalation, scoring, vitals_mod):
        monkeypatch.setattr(mod, "get_db", lambda d=db: d)
    now = datetime.now(tz=timezone.utc)
    await db.vitals.insert_many([
        {
            "patient_id": "pv1",
            "device_id": "d1",
            "t": now - timedelta(minutes=m),
            "kind": "heart_rate",
            "value": 70 + m,
            "unit": "bpm",
            "source": "apple_healthkit",
            "clock_skew": False,
        }
        for m in range(30)
    ])
    r = await client.get(
        "/api/patients/pv1/vitals?hours=1&max_points=12",
    )
    assert r.status_code == 200
    body = r.json()
    assert "points" in body and "latest" in body
    assert body.get("anchored_until") and body.get("anchored_from")
    hr_pts = [p for p in body["points"] if p["kind"] == "heart_rate"]
    assert len(hr_pts) <= 12
    assert body["latest"]["heart_rate"]["kind"] == "heart_rate"


async def test_enroll_and_list(client):
    r = await client.post("/api/patients", json={
        "name": "A", "phone": "+15555550010", "language": "en",
        "surgery_type": "lap_chole",
        "surgery_date": "2026-04-15T00:00:00Z",
        "discharge_date": "2026-04-17T00:00:00Z",
        "caregiver": {"name": "B", "phone": "+15555550011"},
        "consent": {"recorded_at": "2026-04-17T00:00:00Z",
                    "ip": "1.1.1.1", "version": "v1"},
    })
    assert r.status_code == 201
    pid = r.json()["id"]

    r2 = await client.get("/api/patients")
    assert r2.status_code == 200
    assert any(p["id"] == pid for p in r2.json())
