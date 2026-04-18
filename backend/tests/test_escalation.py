import pytest
from mongomock_motor import AsyncMongoMockClient

from sentinel import escalation as esc
from sentinel.models import RecommendedAction, Score


@pytest.fixture
def db(monkeypatch):
    client = AsyncMongoMockClient()
    db = client["sentinel_test"]
    monkeypatch.setattr(esc, "get_db", lambda: db)
    return db


def _score(action: RecommendedAction) -> Score:
    return Score(
        deterioration=0.7, qsofa=2, news2=6,
        red_flags=[], summary="", recommended_action=action,
    )


def test_policy_none_no_channels():
    actions = esc.decide_actions(score=_score(RecommendedAction.NONE))
    assert actions.channels == []


def test_policy_caregiver_alert_sms_caregiver():
    actions = esc.decide_actions(score=_score(RecommendedAction.CAREGIVER_ALERT))
    assert actions.channels == ["sms_caregiver"]


def test_policy_nurse_alert_sms_nurse_and_banner():
    actions = esc.decide_actions(score=_score(RecommendedAction.NURSE_ALERT))
    assert set(actions.channels) == {"sms_nurse", "dashboard_banner"}


def test_policy_911_all_channels():
    actions = esc.decide_actions(score=_score(RecommendedAction.SUGGEST_911))
    assert set(actions.channels) == {
        "sms_caregiver", "sms_nurse", "dashboard_911_prompt"
    }


async def test_send_alert_writes_alert_doc(db, monkeypatch):
    sent: list[tuple[str, str]] = []

    def fake_send(to: str, body: str) -> None:
        sent.append((to, body))

    monkeypatch.setattr(esc, "_sms_send", fake_send)

    patient = {
        "_id": "p1",
        "name": "A",
        "phone": "+1555000",
        "caregiver": {"name": "B", "phone": "+1555001"},
        "assigned_nurse_id": "+1555002",
    }
    await db.patients.insert_one(patient)
    score = _score(RecommendedAction.NURSE_ALERT)
    await esc.send_alert(patient_id="p1", call_id="c1", score=score)
    assert any("+1555002" == t[0] for t in sent)
    alert_doc = await db.alerts.find_one({"patient_id": "p1"})
    assert alert_doc["severity"] == "nurse_alert"
