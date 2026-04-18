from __future__ import annotations

import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Deque

from fastapi import HTTPException

from sentinel.db import get_db

MAX_SAMPLES = 1000
WINDOW_SECONDS = 60
BURST_SECONDS = 60
RATE_PER_MIN = 10
RATE_BURST = 60
RATE_PER_DAY = 500

VALID_KINDS = {"heart_rate", "spo2", "resp_rate", "temp", "steps",
               "sleep_stage", "hrv_sdnn", "hrv_rmssd"}
VALID_UNITS = {"bpm", "pct", "cpm", "c", "count", "enum", "ms"}
VALID_SOURCES = {"apple_healthkit", "health_connect", "manual"}
VALID_SLEEP = {"awake", "light", "deep", "rem", "in_bed"}

# In-process rate-limit bookkeeping. Keyed by device_id.
_rate_buckets: dict[str, Deque[float]] = {}
_day_buckets: dict[str, list[float]] = {}


def _rate_check(device_id: str) -> tuple[bool, int]:
    now = time.time()
    q = _rate_buckets.setdefault(device_id, deque())
    while q and now - q[0] > BURST_SECONDS:
        q.popleft()
    if len(q) >= RATE_BURST:
        retry = max(1, int(BURST_SECONDS - (now - q[0])))
        return False, retry
    # Daily check
    day = _day_buckets.setdefault(device_id, [])
    cutoff = now - 86400
    day[:] = [t for t in day if t > cutoff]
    if len(day) >= RATE_PER_DAY:
        retry = max(1, int(86400 - (now - day[0])))
        return False, retry
    q.append(now)
    day.append(now)
    return True, 0


def _validate_sample(s: dict) -> str | None:
    try:
        t = s["t"]
        kind = s["kind"]
        value = s["value"]
        unit = s["unit"]
        source = s["source"]
    except KeyError:
        return "missing_field"
    if kind not in VALID_KINDS:
        return "invalid_kind"
    if unit not in VALID_UNITS:
        return "invalid_unit"
    if source not in VALID_SOURCES:
        return "invalid_source"
    if kind == "sleep_stage":
        if not isinstance(value, str) or value not in VALID_SLEEP:
            return "invalid_sleep_value"
        if unit != "enum":
            return "invalid_unit"
    else:
        if not isinstance(value, (int, float)):
            return "invalid_value"
    if not isinstance(t, str):
        return "invalid_time"
    return None


def _parse_iso(t: str) -> datetime:
    s = t.rstrip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


async def ingest_batch(
    *,
    patient_id: str,
    device_id: str,
    batch_id: str,
    idempotency_key: str,
    samples: list[dict],
    auth_patient_id: str,
    auth_device_id: str,
) -> dict:
    # Authorization scope - token's patient/device must match body
    if patient_id != auth_patient_id or device_id != auth_device_id:
        raise HTTPException(401, {"error": "invalid_token",
                                  "message": "Token does not match body subject"})

    if idempotency_key != batch_id:
        raise HTTPException(400, {"error": "mismatched_batch_id"})

    if len(samples) > MAX_SAMPLES:
        raise HTTPException(413, {"error": "payload_too_large",
                                  "max_samples": MAX_SAMPLES})

    # Rate limit
    ok, retry = _rate_check(device_id)
    if not ok:
        raise HTTPException(
            429,
            {"error": "rate_limited", "retry_after_s": retry},
            headers={"Retry-After": str(retry)},
        )

    db = get_db()
    prior = await db.processed_batches.find_one({"_id": batch_id})
    if prior is not None:
        return {
            "accepted": prior.get("accepted_count", 0),
            "flagged_clock_skew": prior.get("flagged_clock_skew", 0),
            "idempotent_replay": True,
        }

    now = datetime.now(tz=timezone.utc)
    skew_window_past = now - timedelta(hours=24)
    skew_window_future = now + timedelta(hours=1)

    cleaned: list[dict] = []
    flagged = 0
    for s in samples:
        err = _validate_sample(s)
        if err is not None:
            raise HTTPException(400, {"error": "schema_invalid",
                                      "detail": err})
        t = _parse_iso(s["t"])
        if t > skew_window_future:
            raise HTTPException(400, {"error": "clock_in_future"})
        skew = t < skew_window_past
        if skew:
            flagged += 1
        cleaned.append({
            "t": t,
            "patient_id": patient_id,
            "device_id": device_id,
            "kind": s["kind"],
            "value": s["value"],
            "unit": s["unit"],
            "source": s["source"],
            "confidence": s.get("confidence"),
            "clock_skew": skew,
        })

    if cleaned:
        await db.vitals.insert_many(cleaned)

    if flagged > 0:
        update = {"$set": {"clock_skew_detected_at": now}}
        if flagged / max(len(samples), 1) > 0.5:
            update["$set"]["clock_skew_severe"] = True
        await db.devices.update_one({"_id": device_id}, update)

    await db.processed_batches.insert_one({
        "_id": batch_id,
        "patient_id": patient_id,
        "device_id": device_id,
        "processed_at": now,
        "accepted_count": len(cleaned),
        "flagged_clock_skew": flagged,
    })

    return {
        "accepted": len(cleaned),
        "flagged_clock_skew": flagged,
    }
