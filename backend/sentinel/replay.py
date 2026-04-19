from __future__ import annotations

from pathlib import Path

from sentinel.audio_features import extract_features, zscore_drift
from sentinel.db import get_db
from sentinel.models import AudioFeatures, TranscriptTurn
from sentinel.scoring import score_call


def _parse_script(path: str | Path) -> list[TranscriptTurn]:
    turns: list[TranscriptTurn] = []
    with Path(path).open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            role, t0, t1, *rest = line.split(" ")
            turns.append(
                TranscriptTurn(
                    role=role,
                    text=" ".join(rest),
                    t_start=float(t0),
                    t_end=float(t1),
                )
            )
    return turns


async def _baseline_for(patient_id: str) -> AudioFeatures:
    first = await (
        get_db()
        .calls.find({"patient_id": patient_id})
        .sort("called_at", 1)
        .limit(1)
        .to_list(1)
    )
    if first:
        return AudioFeatures(**first[0]["audio_features"])
    return AudioFeatures()


async def replay_file(
    *, patient_id: str, script_path: str | Path, wav_path: str | Path, llm,
) -> str:
    transcript = _parse_script(script_path)
    features = extract_features(str(wav_path))
    baseline = await _baseline_for(patient_id)
    drift = zscore_drift(current=features, baseline=baseline, stdev=None)
    return await score_call(
        patient_id=patient_id,
        transcript=transcript,
        features=features,
        drift=drift,
        llm=llm,
    )
