from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from mongomock_motor import AsyncMongoMockClient

from sentinel import vitals


@pytest.fixture
def db(monkeypatch):
    client = AsyncMongoMockClient()
    db = client["sentinel_test"]
    monkeypatch.setattr(vitals, "get_db", lambda: db)
    # Clear rate buckets between tests
    vitals._rate_buckets.clear()
    vitals._day_buckets.clear()
    return db


def _sample(t_iso: str, kind="heart_rate", value=72.0, unit="bpm",
            source="apple_healthkit"):
    return {"t": t_iso, "kind": kind, "value": value, "unit": unit,
            "source": source, "confidence": 0.9}


async def test_batch_happy_path(db):
    now = datetime.now(tz=timezone.utc)
    bid = str(uuid4())
    r = await vitals.ingest_batch(
        patient_id="p1", device_id="d1", batch_id=bid,
        idempotency_key=bid,
        samples=[_sample(now.isoformat().replace("+00:00", "Z"))],
        auth_patient_id="p1", auth_device_id="d1",
    )
    assert r["accepted"] == 1
    assert r["flagged_clock_skew"] == 0
    docs = [d async for d in db.vitals.find({})]
    assert len(docs) == 1 and docs[0]["kind"] == "heart_rate"


async def test_batch_idempotent_replay(db):
    now = datetime.now(tz=timezone.utc)
    bid = str(uuid4())
    s = _sample(now.isoformat().replace("+00:00", "Z"))
    await vitals.ingest_batch(patient_id="p1", device_id="d1", batch_id=bid,
                              idempotency_key=bid, samples=[s],
                              auth_patient_id="p1", auth_device_id="d1")
    r2 = await vitals.ingest_batch(patient_id="p1", device_id="d1", batch_id=bid,
                                   idempotency_key=bid, samples=[s],
                                   auth_patient_id="p1", auth_device_id="d1")
    assert r2["idempotent_replay"] is True
    assert r2["accepted"] == 1


async def test_batch_mismatched_key(db):
    now = datetime.now(tz=timezone.utc)
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        await vitals.ingest_batch(
            patient_id="p1", device_id="d1", batch_id="a", idempotency_key="b",
            samples=[_sample(now.isoformat().replace("+00:00", "Z"))],
            auth_patient_id="p1", auth_device_id="d1",
        )
    assert e.value.status_code == 400
    assert e.value.detail["error"] == "mismatched_batch_id"


async def test_batch_over_cap_413(db):
    now = datetime.now(tz=timezone.utc)
    s = _sample(now.isoformat().replace("+00:00", "Z"))
    bid = str(uuid4())
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        await vitals.ingest_batch(
            patient_id="p1", device_id="d1", batch_id=bid, idempotency_key=bid,
            samples=[s] * 1001,
            auth_patient_id="p1", auth_device_id="d1",
        )
    assert e.value.status_code == 413


async def test_batch_clock_in_future_rejected(db):
    future = datetime.now(tz=timezone.utc) + timedelta(hours=2)
    bid = str(uuid4())
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        await vitals.ingest_batch(
            patient_id="p1", device_id="d1", batch_id=bid, idempotency_key=bid,
            samples=[_sample(future.isoformat().replace("+00:00", "Z"))],
            auth_patient_id="p1", auth_device_id="d1",
        )
    assert e.value.status_code == 400
    assert e.value.detail["error"] == "clock_in_future"


async def test_batch_clock_skew_past_flagged(db):
    past = datetime.now(tz=timezone.utc) - timedelta(hours=30)
    bid = str(uuid4())
    r = await vitals.ingest_batch(
        patient_id="p1", device_id="d1", batch_id=bid, idempotency_key=bid,
        samples=[_sample(past.isoformat().replace("+00:00", "Z"))],
        auth_patient_id="p1", auth_device_id="d1",
    )
    assert r["flagged_clock_skew"] == 1
    assert r["accepted"] == 1


async def test_batch_auth_scope_mismatch(db):
    now = datetime.now(tz=timezone.utc)
    bid = str(uuid4())
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        await vitals.ingest_batch(
            patient_id="p1", device_id="d1", batch_id=bid, idempotency_key=bid,
            samples=[_sample(now.isoformat().replace("+00:00", "Z"))],
            auth_patient_id="p_other", auth_device_id="d1",
        )
    assert e.value.status_code == 401


async def test_batch_schema_invalid_kind(db):
    now = datetime.now(tz=timezone.utc)
    bid = str(uuid4())
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        await vitals.ingest_batch(
            patient_id="p1", device_id="d1", batch_id=bid, idempotency_key=bid,
            samples=[_sample(now.isoformat().replace("+00:00", "Z"), kind="glucose")],
            auth_patient_id="p1", auth_device_id="d1",
        )
    assert e.value.status_code == 400
    assert e.value.detail["error"] == "schema_invalid"


async def test_patient_vitals_binned_caps_buckets_per_kind(db):
    now = datetime.now(tz=timezone.utc)
    docs = []
    for i in range(60):
        docs.append({
            "patient_id": "p1",
            "device_id": "d1",
            "t": now - timedelta(minutes=59 - i),
            "kind": "heart_rate",
            "value": 70 + (i % 5),
            "unit": "bpm",
            "source": "apple_healthkit",
            "clock_skew": False,
        })
    await db.vitals.insert_many(docs)
    points, latest, anchor = await vitals.patient_vitals_binned(
        patient_id="p1",
        hours=1,
        buckets=8,
    )
    hr = [p for p in points if p["kind"] == "heart_rate"]
    assert len(hr) == 8
    assert sum(1 for p in hr if p["value"] is not None) >= 1
    assert "heart_rate" in latest
    assert latest["heart_rate"]["kind"] == "heart_rate"
    assert "anchored_until" in anchor and "anchored_from" in anchor


async def test_patient_vitals_record_anchor_not_wall_clock(db):
    """Old data (days ago) still appears: window ends at latest stored sample."""
    t_max = datetime(2026, 4, 10, 15, 30, tzinfo=timezone.utc)
    await db.vitals.insert_many([
        {
            "patient_id": "p2",
            "device_id": "d1",
            "t": t_max - timedelta(minutes=45),
            "kind": "heart_rate",
            "value": 70.0,
            "unit": "bpm",
            "source": "apple_healthkit",
            "clock_skew": False,
        },
        {
            "patient_id": "p2",
            "device_id": "d1",
            "t": t_max - timedelta(minutes=5),
            "kind": "heart_rate",
            "value": 80.0,
            "unit": "bpm",
            "source": "apple_healthkit",
            "clock_skew": False,
        },
        {
            "patient_id": "p2",
            "device_id": "d1",
            "t": t_max,
            "kind": "heart_rate",
            "value": 79.0,
            "unit": "bpm",
            "source": "apple_healthkit",
            "clock_skew": False,
        },
    ])
    points, latest, anchor = await vitals.patient_vitals_binned(
        patient_id="p2", hours=1, buckets=8,
    )
    assert anchor["anchored_until"] == t_max.isoformat()
    hr_pts = [p for p in points if p["kind"] == "heart_rate"]
    assert len(hr_pts) == 8
    assert sum(1 for p in hr_pts if p["value"] is not None) >= 1
    assert latest["heart_rate"]["value"] == 79.0


async def test_patient_vitals_many_samples_one_bucket_one_point(db):
    """Dense HR in one 5-minute slice still yields one mean per bucket."""
    t_max = datetime(2026, 4, 12, 12, 0, tzinfo=timezone.utc)
    docs = []
    for i in range(50):
        docs.append({
            "patient_id": "p3",
            "device_id": "d1",
            "t": t_max - timedelta(seconds=50 - i),
            "kind": "heart_rate",
            "value": 100.0 + i,
            "unit": "bpm",
            "source": "apple_healthkit",
            "clock_skew": False,
        })
    await db.vitals.insert_many(docs)
    points, _latest, _anchor = await vitals.patient_vitals_binned(
        patient_id="p3", hours=1, buckets=8,
    )
    hr = [p for p in points if p["kind"] == "heart_rate"]
    assert len(hr) == 8
    assert sum(1 for p in hr if p["value"] is not None) == 1
