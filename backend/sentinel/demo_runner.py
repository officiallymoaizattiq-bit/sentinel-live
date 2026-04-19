"""End-to-end demo trajectory runner for Sentinel.

Seeds 3 named patients and replays 3 distinct trajectories:
- John Chen (lap_chole, day 3): stays recovered — calm vitals.
- Maria Garcia (c-section, day 5): drift — catches mild deterioration early.
- David Patel (appy, day 2): escalates — ends in suggest_911.

Each trajectory is 3 synthetic calls; scripted LLM so no Gemini quota burned.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from sentinel.escalation import send_alert
from sentinel.models import RecommendedAction, Score
from sentinel.named_seed import seed_named_patients
from sentinel.replay import replay_file

# Repo-root-anchored default so `run_trajectory_demo()` works regardless of
# current working directory (tests, uvicorn, CLI).
# backend/sentinel/demo_runner.py -> parents[2] == repo root
_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_DEMO_DIR = _REPO_ROOT / "demo"


class ScriptedLLM:
    """For fully offline demo. Replace with GeminiLLM() for real runs."""

    def __init__(self, score: Score):
        self._scripted = score

    async def score(self, **_):
        return self._scripted

    async def embed(self, _):
        return [0.0] * 1536


def _score(
    det: float,
    action: RecommendedAction,
    summary: str,
    flags: list[str] | None = None,
    qsofa: int = 0,
    news2: int = 1,
) -> Score:
    return Score(
        deterioration=det,
        qsofa=qsofa,
        news2=news2,
        red_flags=flags or [],
        summary=summary,
        recommended_action=action,
    )


# 3 distinct trajectories — keyed by patient name index in DEMO_PATIENTS order.
TRAJECTORIES: list[list[tuple[str, Score]]] = [
    # John Chen — recovered
    [
        ("baseline", _score(0.08, RecommendedAction.NONE,
                            "Patient doing well, walking and eating normally.")),
        ("baseline", _score(0.12, RecommendedAction.NONE,
                            "Mild incision soreness, otherwise normal.")),
        ("baseline", _score(0.10, RecommendedAction.NONE,
                            "Stable, tolerating diet, normal urine output.")),
    ],
    # Maria Garcia — drift (catches it mid-trajectory)
    [
        ("baseline", _score(0.15, RecommendedAction.NONE,
                            "Post-op C-section, comfortable, breastfeeding.")),
        ("drift",    _score(0.48, RecommendedAction.CAREGIVER_ALERT,
                            "Mild fatigue and warmth; temp not checked.",
                            flags=["mild_fever_possible", "fatigue"],
                            qsofa=1, news2=4)),
        ("drift",    _score(0.62, RecommendedAction.NURSE_ALERT,
                            "Fever 38.5, increased pain, requires follow-up.",
                            flags=["fever", "increased_pain"],
                            qsofa=2, news2=6)),
    ],
    # David Patel — red trajectory
    [
        ("baseline", _score(0.18, RecommendedAction.NONE,
                            "Recovering from appendectomy, mild soreness.")),
        ("drift",    _score(0.55, RecommendedAction.CAREGIVER_ALERT,
                            "Breathless climbing stairs, skin warm.",
                            flags=["breathlessness", "warm_skin"],
                            qsofa=1, news2=5)),
        ("red",      _score(0.88, RecommendedAction.SUGGEST_911,
                            "Confusion, tachypnea, fever — sepsis pattern.",
                            flags=["tachypnea", "confusion", "fever"],
                            qsofa=3, news2=9)),
    ],
]


async def run_trajectory_demo(root: str | Path | None = None) -> list[str]:
    demo_dir = Path(root) if root is not None else _DEFAULT_DEMO_DIR
    pids = await seed_named_patients(clean=True)

    for i, pid in enumerate(pids):
        traj = TRAJECTORIES[i]
        for stage, score in traj:
            cid = await replay_file(
                patient_id=pid,
                script_path=demo_dir / "scripts" / f"{stage}.txt",
                wav_path=demo_dir / "audio" / f"{stage}.wav",
                llm=ScriptedLLM(score),
            )
            await send_alert(patient_id=pid, call_id=cid, score=score)
            await asyncio.sleep(0.15)
    return pids
