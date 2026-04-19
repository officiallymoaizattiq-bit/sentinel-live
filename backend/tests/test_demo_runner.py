import numpy as np
import pytest
import soundfile as sf
from mongomock_motor import AsyncMongoMockClient

from sentinel import (
    demo_runner,
    enrollment,
    escalation,
    named_seed,
    replay,
    scoring,
    seed as cohort_seed,
)


@pytest.fixture
def db(monkeypatch):
    client = AsyncMongoMockClient()
    db = client["sentinel_test"]
    # All modules in the demo runner call-graph import `get_db` from sentinel.db
    # and rebind it at import time, so patch each module's local reference.
    for mod in (named_seed, enrollment, replay, scoring, cohort_seed, escalation):
        monkeypatch.setattr(mod, "get_db", lambda d=db: d)
    return db


async def test_trajectory_demo_seeds_three_patients_with_three_calls_each(
    db, monkeypatch, tmp_path,
):
    # Stub send_alert so demo runner doesn't hit real Twilio.
    async def noop(*a, **k):
        return None

    monkeypatch.setattr(demo_runner, "send_alert", noop)
    await cohort_seed.seed_cohort(count=3, seed=42)

    # Build tiny fake script + WAV so replay_file works.
    demo_dir = tmp_path / "demo"
    scripts = demo_dir / "scripts"
    audio = demo_dir / "audio"
    scripts.mkdir(parents=True)
    audio.mkdir(parents=True)
    silent = np.zeros(16000 * 3, dtype="float32")
    for name in ("baseline", "drift", "red"):
        (scripts / f"{name}.txt").write_text("patient 0.0 1.0 hello\n")
        sf.write(str(audio / f"{name}.wav"), silent, 16000, subtype="PCM_16")

    pids = await demo_runner.run_trajectory_demo(root=demo_dir)
    assert len(pids) == 3

    # Each patient should have 3 scored calls.
    for pid in pids:
        calls = [c async for c in db.calls.find({"patient_id": pid})]
        assert len(calls) == 3
