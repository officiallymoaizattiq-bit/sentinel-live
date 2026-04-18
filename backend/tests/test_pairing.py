from datetime import datetime, timedelta, timezone

import pytest
from mongomock_motor import AsyncMongoMockClient

from sentinel import pairing


@pytest.fixture
def db(monkeypatch):
    client = AsyncMongoMockClient()
    db = client["sentinel_test"]
    monkeypatch.setattr(pairing, "get_db", lambda: db)
    return db


async def test_generate_code_creates_doc(db):
    out = await pairing.generate_pairing_code(patient_id="p1")
    assert len(out["pairing_code"]) == 6 and out["pairing_code"].isdigit()
    assert out["qr_url"] == f"sentinel://pair/{out['pairing_code']}"
    doc = await db.pairing_codes.find_one({"_id": out["pairing_code"]})
    assert doc["patient_id"] == "p1"
    assert doc["consumed_at"] is None


async def test_exchange_happy_path(db, monkeypatch):
    await db.pairing_codes.insert_one({
        "_id": "123456", "patient_id": "p1",
        "expires_at": datetime.now(tz=timezone.utc) + timedelta(minutes=10),
        "consumed_at": None, "consumed_by_device_id": None,
    })
    out = await pairing.exchange_code(code="123456",
                                      device_info={"model": "iPhone 15",
                                                   "os": "iOS 18.2",
                                                   "app_version": "0.1.0"})
    assert out["patient_id"] == "p1"
    assert out["device_token"].count(".") == 2
    assert out["device_id"]
    d = await db.devices.find_one({"_id": out["device_id"]})
    assert d["device_info"]["model"] == "iPhone 15"
    pc = await db.pairing_codes.find_one({"_id": "123456"})
    assert pc["consumed_at"] is not None


async def test_exchange_expired_code_rejected(db):
    await db.pairing_codes.insert_one({
        "_id": "111111", "patient_id": "p1",
        "expires_at": datetime.now(tz=timezone.utc) - timedelta(minutes=1),
        "consumed_at": None, "consumed_by_device_id": None,
    })
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        await pairing.exchange_code(code="111111", device_info={})
    assert e.value.status_code == 404


async def test_exchange_consumed_code_rejected(db):
    await db.pairing_codes.insert_one({
        "_id": "222222", "patient_id": "p1",
        "expires_at": datetime.now(tz=timezone.utc) + timedelta(minutes=10),
        "consumed_at": datetime.now(tz=timezone.utc),
        "consumed_by_device_id": "d1",
    })
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        await pairing.exchange_code(code="222222", device_info={})
    assert e.value.status_code == 409


async def test_exchange_malformed_code(db):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        await pairing.exchange_code(code="abc", device_info={})
    assert e.value.status_code == 404


async def test_revoke_sets_revoked_at(db):
    await db.devices.insert_one({"_id": "d1", "patient_id": "p1",
                                 "revoked_at": None, "created_at": datetime.now(tz=timezone.utc)})
    await pairing.revoke_device(device_id="d1")
    d = await db.devices.find_one({"_id": "d1"})
    assert d["revoked_at"] is not None


async def test_revoke_unknown_404(db):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        await pairing.revoke_device(device_id="ghost")
    assert e.value.status_code == 404
