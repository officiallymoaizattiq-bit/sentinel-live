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
