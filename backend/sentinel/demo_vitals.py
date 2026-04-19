"""Demo vitals seeder for the web-based vitals simulator.

The Android HealthKit/Health Connect pipeline is the normal source of wearable
vitals for the Gemini scorer to reason over. For hackathon demos without a
paired phone, this module writes a short synthetic deterioration burst
directly into the ``vitals`` collection so the LLM has a trajectory to flag
when it scores the subsequent call.

Writes bypass :func:`sentinel.vitals.ingest_batch` (no auth token, no
device_id). Tagged with ``source="demo_seed"`` so they can be idempotently
cleared before re-seeding.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Literal

DEMO_SOURCE = "demo_seed"

Variant = Literal["mild", "sepsis", "reset"]


def _trajectory(
    variant: str,
) -> tuple[tuple[float, float], tuple[float, float], tuple[float, float], tuple[float, float]]:
    """Return (start, end) pairs for (HR, SpO2, RR, temp) for the given variant.

    HR bpm, SpO2 pct, RR cpm, temp C.
    """
    if variant == "mild":
        # Gentle drift — should nudge scorer toward patient_check but not 911.
        return (78.0, 92.0), (98.0, 95.0), (14.0, 18.0), (36.9, 37.4)
    # Default "sepsis-ish" trajectory from the spec.
    return (80.0, 115.0), (98.0, 92.0), (14.0, 22.0), (37.0, 38.3)


def _lerp(a: float, b: float, frac: float) -> float:
    return a + (b - a) * frac


async def seed_deteriorating_vitals(
    db,
    patient_id: str,
    minutes_back: int = 45,
    variant: str = "sepsis",
) -> dict:
    """Seed a deteriorating-vitals burst for ``patient_id``.

    Writes 12 samples back-dated across the trailing ``minutes_back`` window
    (3 timepoints x 4 kinds). Deterministic jitter via ``random.Random(42)``.

    Idempotent: any prior rows in ``vitals`` for this patient tagged with
    ``source == "demo_seed"`` are deleted before inserting. If ``variant`` is
    ``"reset"``, existing demo rows are cleared and nothing new is written.

    Returns ``{"inserted": N, "deleted": M, "variant": variant}``.
    """
    if minutes_back < 1:
        raise ValueError("minutes_back must be >= 1")

    deleted = (
        await db.vitals.delete_many(
            {"patient_id": patient_id, "source": DEMO_SOURCE}
        )
    ).deleted_count

    if variant == "reset":
        return {"inserted": 0, "deleted": int(deleted), "variant": "reset"}

    hr, spo2, rr, temp = _trajectory(variant)
    rng = random.Random(42)

    now = datetime.now(tz=timezone.utc)
    window_start = now - timedelta(minutes=minutes_back)
    # 3 evenly spaced timepoints across the window (start, mid, end).
    steps = 3
    docs: list[dict] = []
    for i in range(steps):
        frac = i / (steps - 1) if steps > 1 else 1.0
        t = window_start + timedelta(
            seconds=frac * minutes_back * 60.0
        )
        kinds = (
            ("heart_rate", "bpm", _lerp(*hr, frac) + rng.uniform(-1.0, 1.0)),
            ("spo2", "pct", _lerp(*spo2, frac) + rng.uniform(-0.4, 0.4)),
            ("resp_rate", "cpm", _lerp(*rr, frac) + rng.uniform(-0.5, 0.5)),
            ("temp", "c", _lerp(*temp, frac) + rng.uniform(-0.05, 0.05)),
        )
        for kind, unit, raw in kinds:
            value = round(float(raw), 1)
            docs.append({
                "t": t,
                "patient_id": patient_id,
                "device_id": "demo_seed_device",
                "kind": kind,
                "value": value,
                "unit": unit,
                "source": DEMO_SOURCE,
                "confidence": None,
                "clock_skew": False,
            })

    if docs:
        await db.vitals.insert_many(docs)

    return {
        "inserted": len(docs),
        "deleted": int(deleted),
        "variant": variant,
    }
