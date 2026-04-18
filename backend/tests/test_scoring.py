import pytest
from mongomock_motor import AsyncMongoMockClient

from sentinel import scoring
from sentinel.models import (
    AudioFeatures,
    Call,
    RecommendedAction,
    Score,
    TranscriptTurn,
)


class StubLLM:
    def __init__(self, response: Score):
        self.response = response
        self.calls = 0

    async def score(self, *, transcript, features, drift, history, rubric, vitals) -> Score:
        self.calls += 1
        return self.response

    async def embed(self, text: str) -> list[float]:
        return [0.0] * 1536


@pytest.fixture
def db(monkeypatch):
    client = AsyncMongoMockClient()
    db = client["sentinel_test"]
    monkeypatch.setattr(scoring, "get_db", lambda: db)
    return db


async def test_score_call_persists_result(db):
    stub = StubLLM(
        Score(
            deterioration=0.6,
            qsofa=2,
            news2=6,
            red_flags=["tachypnea"],
            summary="SOB reported",
            recommended_action=RecommendedAction.NURSE_ALERT,
        )
    )
    transcript = [TranscriptTurn(role="patient", text="I'm short of breath",
                                 t_start=0, t_end=2)]
    features = AudioFeatures(breaths_per_min=24, f0_mean=180)
    call_id = await scoring.score_call(
        patient_id="p1",
        transcript=transcript,
        features=features,
        drift={"breaths_per_min": 3.0},
        llm=stub,
    )
    doc = await db.calls.find_one({"_id": call_id})
    assert doc["score"]["recommended_action"] == "nurse_alert"
    assert doc["embedding"]
    assert stub.calls == 1


async def test_score_call_falls_back_on_llm_failure(db):
    class Failing:
        async def score(self, **_): raise RuntimeError("boom")
        async def embed(self, _): return [0.0] * 1536
    features = AudioFeatures(breaths_per_min=26, pause_ratio=0.55)
    call_id = await scoring.score_call(
        patient_id="p1",
        transcript=[],
        features=features,
        drift={"speech_rate": -3.0},
        llm=Failing(),
    )
    doc = await db.calls.find_one({"_id": call_id})
    assert doc["llm_degraded"] is True
    assert doc["score"]["recommended_action"] in (
        "nurse_alert", "suggest_911", "caregiver_alert"
    )
