import numpy as np
import pytest
import soundfile as sf
from mongomock_motor import AsyncMongoMockClient

from sentinel import replay, scoring, seed
from sentinel.models import RecommendedAction, Score


@pytest.fixture
def db(monkeypatch):
    client = AsyncMongoMockClient()
    db = client["sentinel_test"]
    monkeypatch.setattr(seed, "get_db", lambda: db)
    monkeypatch.setattr(scoring, "get_db", lambda: db)
    monkeypatch.setattr(replay, "get_db", lambda: db)
    return db


class StubLLM:
    def __init__(self, action):
        self.action = action

    async def score(self, **_):
        return Score(
            deterioration=0.9 if self.action == RecommendedAction.SUGGEST_911 else 0.2,
            qsofa=2,
            news2=6,
            red_flags=["tachypnea"],
            summary="stub",
            recommended_action=self.action,
        )

    async def embed(self, _):
        return [0.0] * 1536


def _write_silent_wav(path, seconds: int, sr: int = 16000) -> None:
    sf.write(str(path), np.zeros(seconds * sr, dtype="float32"), sr, subtype="PCM_16")


async def test_replay_parses_transcript_and_scores(db, tmp_path):
    await seed.seed_cohort(count=3, seed=1)
    script = tmp_path / "s.txt"
    script.write_text("patient 0.0 1.0 hello\nagent 1.0 2.0 hi\n")
    wav = tmp_path / "s.wav"
    _write_silent_wav(wav, 3)
    await db.patients.insert_one(
        {"_id": "p1", "name": "A", "caregiver": {"phone": "+1"}}
    )
    cid = await replay.replay_file(
        patient_id="p1",
        script_path=str(script),
        wav_path=str(wav),
        llm=StubLLM(RecommendedAction.NONE),
    )
    doc = await db.calls.find_one({"_id": cid})
    assert len(doc["transcript"]) == 2
