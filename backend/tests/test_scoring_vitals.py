import pytest
from datetime import datetime, timedelta, timezone

from mongomock_motor import AsyncMongoMockClient

from sentinel import scoring
from sentinel.models import AudioFeatures, RecommendedAction, Score, TranscriptTurn


@pytest.fixture
def db(monkeypatch):
    client = AsyncMongoMockClient()
    db = client["sentinel_test"]
    monkeypatch.setattr(scoring, "get_db", lambda: db)
    return db


class RecordingLLM:
    def __init__(self):
        self.last_vitals = None

    async def score(self, *, transcript, features, drift, history, rubric, vitals):
        self.last_vitals = vitals
        return Score(deterioration=0.2, qsofa=0, news2=1, red_flags=[],
                     summary="stub", recommended_action=RecommendedAction.NONE)

    async def embed(self, _):
        return [0.0] * 1536


async def test_scoring_injects_vitals_summary(db):
    now = datetime.now(tz=timezone.utc)
    await db.vitals.insert_many([
        {"t": now - timedelta(minutes=30), "patient_id": "p1", "device_id": "d1",
         "kind": "heart_rate", "value": 72, "unit": "bpm",
         "source": "apple_healthkit", "clock_skew": False},
        {"t": now - timedelta(minutes=10), "patient_id": "p1", "device_id": "d1",
         "kind": "heart_rate", "value": 118, "unit": "bpm",
         "source": "apple_healthkit", "clock_skew": False},
        {"t": now - timedelta(minutes=5), "patient_id": "p1", "device_id": "d1",
         "kind": "spo2", "value": 88, "unit": "pct",
         "source": "apple_healthkit", "clock_skew": False},
    ])
    llm = RecordingLLM()
    cid = await scoring.score_call(
        patient_id="p1",
        transcript=[TranscriptTurn(role="patient", text="ok", t_start=0, t_end=1)],
        features=AudioFeatures(),
        drift={},
        llm=llm,
    )
    assert llm.last_vitals is not None
    assert llm.last_vitals["sample_count"] == 3
    assert "heart_rate" in llm.last_vitals["stats"]
    assert llm.last_vitals["stats"]["heart_rate"]["max"] == 118.0
    doc = await db.calls.find_one({"_id": cid})
    assert doc["vitals_summary"]["sample_count"] == 3


async def test_scoring_empty_vitals(db):
    llm = RecordingLLM()
    await scoring.score_call(
        patient_id="p1", transcript=[], features=AudioFeatures(),
        drift={}, llm=llm,
    )
    assert llm.last_vitals["sample_count"] == 0
    assert llm.last_vitals["stats"] == {}
