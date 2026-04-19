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
               "sleep_stage", "hrv_sdnn", "hrv_rmssd", "vo2"}
VALID_UNITS = {"bpm", "pct", "cpm", "c", "count", "enum", "ms", "mL/kg/min"}
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

    from sentinel import events as event_bus
    event_bus.publish({
        "type": "vitals",
        "patient_id": patient_id,
        "device_id": device_id,
        "accepted": len(cleaned),
        "at": datetime.now(tz=timezone.utc).isoformat(),
    })

    return {
        "accepted": len(cleaned),
        "flagged_clock_skew": flagged,
    }


def _vital_public_row(d: dict) -> dict:
    t = d["t"]
    return {
        "t": t.isoformat() if hasattr(t, "isoformat") else t,
        "kind": d["kind"],
        "value": d["value"],
        "unit": d["unit"],
        "source": d["source"],
        "clock_skew": d.get("clock_skew", False),
    }


def _ensure_aware_utc(t: datetime) -> datetime:
    if hasattr(t, "tzinfo") and t.tzinfo is None:
        return t.replace(tzinfo=timezone.utc)
    return t


async def patient_vitals_window_bounds(
    *, patient_id: str, hours: int
) -> tuple[datetime, datetime] | None:
    """Return ``(cutoff, t_max)`` for the patient's **recorded** window.

    The window is the ``hours``-long interval **ending at the latest stored
    sample** for this patient (any kind), not ending at wall-clock "now".
    """
    if hours < 1:
        raise ValueError("hours must be >= 1")
    db = get_db()
    row = await db.vitals.find({"patient_id": patient_id}).sort("t", -1).limit(1).to_list(length=1)
    if not row:
        return None
    t_max = _ensure_aware_utc(row[0]["t"])
    cutoff = t_max - timedelta(hours=hours)
    return cutoff, t_max


async def patient_vitals_binned(
    *,
    patient_id: str,
    hours: int,
    buckets: int = 8,
) -> tuple[list[dict], dict[str, dict], dict[str, str]]:
    """Stream vitals in a **record-anchored** window and bin numeric kinds.

    Window: ``[latest_sample_time - hours, latest_sample_time]`` (any kind
    sets the anchor). The window is split into ``buckets`` equal sub-intervals.
    For each numeric kind that has at least one sample, returns **exactly**
    ``buckets`` rows: bucket **mid** time as ``t``, mean ``value`` when samples
    exist in that bucket, and JSON ``null`` for ``value`` when the bucket is empty
    (so charts stay evenly spaced).

    Returns ``(points, latest_by_kind, anchor_meta)`` where ``anchor_meta``
    has ISO strings ``anchored_from`` and ``anchored_until``.
    """
    if hours < 1:
        raise ValueError("hours must be >= 1")
    if buckets < 1:
        raise ValueError("buckets must be >= 1")

    bounds = await patient_vitals_window_bounds(patient_id=patient_id, hours=hours)
    if bounds is None:
        return [], {}, {}
    cutoff, t_max = bounds
    window_sec = max((t_max - cutoff).total_seconds(), 1.0)
    bucket_sec = window_sec / buckets

    anchor_meta = {
        "anchored_from": cutoff.isoformat(),
        "anchored_until": t_max.isoformat(),
    }

    cur = (
        get_db()
        .vitals.find(
            {"patient_id": patient_id, "t": {"$gte": cutoff, "$lte": t_max}},
        )
        .sort("t", 1)
    )

    # (kind, bucket_index) -> aggregator for numeric samples
    acc: dict[tuple[str, int], dict] = {}
    latest_raw: dict[str, dict] = {}

    async for d in cur:
        kind = d["kind"]
        latest_raw[kind] = d
        val = d.get("value")
        if not isinstance(val, (int, float)):
            continue
        t = _ensure_aware_utc(d["t"])
        rel = (t - cutoff).total_seconds()
        if rel < 0:
            continue
        bi = min(buckets - 1, max(0, int(rel / bucket_sec)))
        key = (kind, bi)
        slot = acc.setdefault(
            key,
            {
                "sum": 0.0,
                "n": 0,
                "max_t": t,
                "unit": d["unit"],
                "source": d["source"],
                "clock_skew": bool(d.get("clock_skew", False)),
            },
        )
        slot["sum"] += float(val)
        slot["n"] += 1
        if t > slot["max_t"]:
            slot["max_t"] = t
            slot["unit"] = d["unit"]
            slot["source"] = d["source"]
            slot["clock_skew"] = bool(d.get("clock_skew", False))

    kinds_ordered = sorted({k for (k, _bi) in acc.keys()})
    kind_meta: dict[str, dict[str, str]] = {}
    for (kind, _bi), slot in acc.items():
        if kind not in kind_meta:
            kind_meta[kind] = {
                "unit": slot["unit"],
                "source": slot["source"],
            }

    points: list[dict] = []
    for kind in kinds_ordered:
        meta = kind_meta[kind]
        for bi in range(buckets):
            t_mid = cutoff + timedelta(seconds=(bi + 0.5) * bucket_sec)
            key = (kind, bi)
            if key in acc:
                slot = acc[key]
                n = slot["n"]
                avg = slot["sum"] / n if n else None
                points.append(
                    _vital_public_row({
                        "t": t_mid,
                        "kind": kind,
                        "value": avg,
                        "unit": slot["unit"],
                        "source": slot["source"],
                        "clock_skew": slot["clock_skew"],
                    })
                )
            else:
                points.append(
                    _vital_public_row({
                        "t": t_mid,
                        "kind": kind,
                        "value": None,
                        "unit": str(meta["unit"]),
                        "source": str(meta["source"]),
                        "clock_skew": False,
                    })
                )

    latest_out = {k: _vital_public_row(v) for k, v in latest_raw.items()}
    points.sort(key=lambda r: (r["kind"], r["t"]))
    return points, latest_out, anchor_meta


DEMO_CLINICIAN_VITALS_PID = "e6da3b19-c2c2-47fd-902d-04ec03bb78da"
DEMO_CLINICIAN_VITALS_SOURCE = "demo_clinician_ui"


async def ensure_demo_clinician_vitals(db=None) -> None:
    """Insert demo wearable samples for the fixed John Chen UUID (clinician UI).

    Idempotent: replaces only rows tagged with ``demo_clinician_ui`` for that
    patient so restarts do not duplicate points.

    ``db`` may be injected (e.g. mongomock in tests); defaults to ``get_db()``.
    """
    conn = db if db is not None else get_db()
    await conn.vitals.delete_many({
        "patient_id": DEMO_CLINICIAN_VITALS_PID,
        "source": DEMO_CLINICIAN_VITALS_SOURCE,
    })
    now = datetime.now(tz=timezone.utc)
    # Eight samples in the trailing hour (matches binned chart slots) so 1h/4h/24h
    # windows all show a full HR curve for the demo patient.
    cutoff = now - timedelta(hours=1)
    bucket_sec = 3600.0 / 8
    times = [
        cutoff + timedelta(seconds=(bi + 0.5) * bucket_sec) for bi in range(8)
    ]
    heart_rates = [72, 74, 76, 78, 80, 78, 76, 74]
    vo2_vals = [31.5, 32.0, 32.5, 33.0, 33.2, 32.8, 32.4, 32.0]
    base = {
        "patient_id": DEMO_CLINICIAN_VITALS_PID,
        "device_id": "demo_clinician_device",
        "source": DEMO_CLINICIAN_VITALS_SOURCE,
        "confidence": None,
        "clock_skew": False,
    }
    docs: list[dict] = []
    for i, t in enumerate(times):
        docs.append({
            **base,
            "t": t,
            "kind": "heart_rate",
            "value": heart_rates[i],
            "unit": "bpm",
        })
    for i, t in enumerate(times):
        docs.append({
            **base,
            "t": t,
            "kind": "vo2",
            "value": vo2_vals[i],
            "unit": "mL/kg/min",
        })
    if docs:
        await conn.vitals.insert_many(docs)
