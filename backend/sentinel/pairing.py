from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException

from sentinel.auth import issue_device_token
from sentinel.config import get_settings
from sentinel.db import get_db

CODE_TTL_MINUTES = 10


def _new_code() -> str:
    return f"{secrets.randbelow(10**6):06d}"


async def generate_pairing_code(*, patient_id: str) -> dict:
    now = datetime.now(tz=timezone.utc)
    expires_at = now + timedelta(minutes=CODE_TTL_MINUTES)
    db = get_db()
    # Collision-retry (active codes rare; bounded 3 tries)
    for _ in range(3):
        code = _new_code()
        existing = await db.pairing_codes.find_one({"_id": code})
        if existing is None or (existing.get("consumed_at") is None
                                and existing.get("expires_at", now) < now):
            await db.pairing_codes.replace_one(
                {"_id": code},
                {
                    "_id": code,
                    "patient_id": patient_id,
                    "expires_at": expires_at,
                    "consumed_at": None,
                    "consumed_by_device_id": None,
                },
                upsert=True,
            )
            return {
                "pairing_code": code,
                "qr_url": f"sentinel://pair/{code}",
                "expires_at": expires_at.isoformat().replace("+00:00", "Z"),
            }
    raise HTTPException(500, "could not allocate pairing code")


async def exchange_code(*, code: str, device_info: dict) -> dict:
    if not (isinstance(code, str) and code.isdigit() and len(code) == 6):
        raise HTTPException(404, {"error": "code_invalid_or_expired"})

    db = get_db()
    now = datetime.now(tz=timezone.utc)
    doc = await db.pairing_codes.find_one({"_id": code})
    if doc is None:
        raise HTTPException(404, {"error": "code_invalid_or_expired"})

    expires_at = doc.get("expires_at")
    if expires_at is not None and _ensure_tz(expires_at) < now:
        raise HTTPException(404, {"error": "code_invalid_or_expired"})
    if doc.get("consumed_at") is not None:
        raise HTTPException(409, {"error": "code_already_consumed"})

    patient_id = doc["patient_id"]
    device_id = str(uuid4())
    token = issue_device_token(device_id=device_id, patient_id=patient_id)

    await db.devices.insert_one({
        "_id": device_id,
        "patient_id": patient_id,
        "token_hash": "",  # reserved; token validation is signature+revoked_at
        "device_info": {
            "model": device_info.get("model", ""),
            "os": device_info.get("os", ""),
            "app_version": device_info.get("app_version", ""),
        },
        "created_at": now,
        "last_seen_at": None,
        "revoked_at": None,
        "clock_skew_detected_at": None,
        "clock_skew_severe": False,
        "push_token": None,
    })

    # Atomic consume - guards against double-exchange races.
    result = await db.pairing_codes.update_one(
        {"_id": code, "consumed_at": None},
        {"$set": {"consumed_at": now, "consumed_by_device_id": device_id}},
    )
    if result.modified_count == 0:
        # Another request consumed it between our check and update.
        await db.devices.delete_one({"_id": device_id})
        raise HTTPException(409, {"error": "code_already_consumed"})

    return {
        "device_token": token,
        "patient_id": patient_id,
        "device_id": device_id,
        "pair_time": now.isoformat().replace("+00:00", "Z"),
    }


async def revoke_device(*, device_id: str) -> None:
    now = datetime.now(tz=timezone.utc)
    result = await get_db().devices.update_one(
        {"_id": device_id, "revoked_at": None},
        {"$set": {"revoked_at": now}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "device not found")


def _ensure_tz(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
