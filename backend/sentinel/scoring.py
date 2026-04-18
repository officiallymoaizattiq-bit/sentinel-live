from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Protocol
from uuid import uuid4

import google.generativeai as genai

from sentinel.audio_features import rules_only_score
from sentinel.config import get_settings
from sentinel.db import get_db
from sentinel.models import (
    AudioFeatures,
    RecommendedAction,
    Score,
    SimilarCall,
    TranscriptTurn,
)

RUBRIC = """You are a post-operative abdominal-surgery monitoring assistant.
Given a phone check-in transcript plus voice biomarkers plus prior call history,
emit a structured deterioration score grounded in qSOFA, NEWS2, and ACS NSQIP
post-operative warning signs. Red flags include: tachypnea, hypotension (reported),
confusion, slurred/slow speech, word-finding difficulty, fever, wound drainage
or separation, severe abdominal distension, inability to keep fluids, reduced urine.
You MUST call emit_score(...) exactly once."""


async def _summarize_recent_vitals(
    *, patient_id: str, window_hours: int = 2
) -> dict:
    """Summarize the patient's last N hours of wearable vitals for LLM context.

    Returns a compact dict suitable for JSON-embedding into the Gemini prompt
    and for persistence on the call doc.
    """
    from datetime import datetime, timedelta, timezone
    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=window_hours)
    cur = (
        get_db()
        .vitals.find({"patient_id": patient_id, "t": {"$gte": cutoff}})
        .sort("t", 1)
    )
    buckets: dict[str, list[float]] = {}
    latest: dict[str, tuple[str, float | str]] = {}
    count = 0
    async for d in cur:
        count += 1
        kind = d["kind"]
        val = d["value"]
        latest[kind] = (d["t"].isoformat() if hasattr(d["t"], "isoformat") else str(d["t"]), val)
        if isinstance(val, (int, float)):
            buckets.setdefault(kind, []).append(float(val))

    def agg(vals: list[float]) -> dict:
        if not vals:
            return {}
        s = sorted(vals)
        return {
            "n": len(vals),
            "min": s[0],
            "max": s[-1],
            "mean": sum(vals) / len(vals),
            "median": s[len(s) // 2],
        }

    summary: dict = {
        "window_hours": window_hours,
        "sample_count": count,
        "stats": {k: agg(v) for k, v in buckets.items()},
        "latest": {k: {"t": t, "value": v} for k, (t, v) in latest.items()},
    }
    return summary


class LLM(Protocol):
    async def score(self, *, transcript, features, drift, history, rubric,
                    vitals) -> Score: ...
    async def embed(self, text: str) -> list[float]: ...


class GeminiLLM:
    def __init__(self) -> None:
        genai.configure(api_key=get_settings().gemini_api_key)
        self._model = genai.GenerativeModel(
            "gemini-2.0-flash",
            tools=[{
                "function_declarations": [{
                    "name": "emit_score",
                    "description": "Emit deterioration score.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "deterioration": {"type": "number"},
                            "qsofa": {"type": "integer"},
                            "news2": {"type": "integer"},
                            "red_flags": {"type": "array", "items": {"type": "string"}},
                            "summary": {"type": "string"},
                            "recommended_action": {
                                "type": "string",
                                "enum": [a.value for a in RecommendedAction],
                            },
                        },
                        "required": [
                            "deterioration", "qsofa", "news2",
                            "red_flags", "summary", "recommended_action",
                        ],
                    },
                }]
            }],
            system_instruction=RUBRIC,
        )
        self._embed_model = "text-embedding-004"

    async def score(self, *, transcript, features, drift, history, rubric, vitals) -> Score:
        user = json.dumps({
            "transcript": [t.model_dump() for t in transcript],
            "features": features.model_dump(),
            "drift_z": drift,
            "history_last_3_calls": history,
            "vitals_last_2h": vitals,
        })
        resp = await self._model.generate_content_async(user)
        for part in resp.candidates[0].content.parts:
            fc = getattr(part, "function_call", None)
            if fc and fc.name == "emit_score":
                args = dict(fc.args)
                args["recommended_action"] = RecommendedAction(args["recommended_action"])
                return Score(**args)
        raise RuntimeError("Gemini did not emit_score")

    async def embed(self, text: str) -> list[float]:
        r = await genai.embed_content_async(model=self._embed_model, content=text)
        return r["embedding"]


async def _last_3_calls(patient_id: str) -> list[dict]:
    cur = (
        get_db()
        .calls.find({"patient_id": patient_id})
        .sort("called_at", -1)
        .limit(3)
    )
    out: list[dict] = []
    async for d in cur:
        out.append({
            "called_at": d.get("called_at").isoformat() if d.get("called_at") else None,
            "score": d.get("score"),
            "summary": (d.get("score") or {}).get("summary"),
        })
    return out


async def _vector_search(embedding: list[float], k: int = 3) -> list[SimilarCall]:
    db = get_db()
    try:
        pipeline = [{
            "$vectorSearch": {
                "index": "cohort_vec",
                "path": "embedding",
                "queryVector": embedding,
                "numCandidates": 50,
                "limit": k,
            }
        }, {"$project": {"case_id": 1, "outcome": 1,
                         "score": {"$meta": "vectorSearchScore"}}}]
        cur = db.cohort_outcomes.aggregate(pipeline)
        return [
            SimilarCall(case_id=d["case_id"], similarity=float(d["score"]),
                        outcome=d["outcome"])
            async for d in cur
        ]
    except Exception:
        def dot(a, b): return sum(x * y for x, y in zip(a, b))
        scored: list[tuple[float, dict]] = []
        async for d in db.cohort_outcomes.find({}):
            scored.append((dot(embedding, d["embedding"]), d))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [
            SimilarCall(case_id=d["case_id"], similarity=s, outcome=d["outcome"])
            for s, d in scored[:k]
        ]


async def score_call(
    *,
    patient_id: str,
    transcript: list[TranscriptTurn],
    features: AudioFeatures,
    drift: dict[str, float],
    llm: LLM,
) -> str:
    history = await _last_3_calls(patient_id)
    vitals_summary = await _summarize_recent_vitals(patient_id=patient_id)
    llm_degraded = False
    try:
        score = await llm.score(
            transcript=transcript, features=features, drift=drift,
            history=history, rubric=RUBRIC,
            vitals=vitals_summary,
        )
    except Exception:
        score = rules_only_score(features=features, drift=drift)
        llm_degraded = True

    transcript_text = "\n".join(f"{t.role}: {t.text}" for t in transcript)
    try:
        embedding = await llm.embed(transcript_text or score.summary)
    except Exception:
        embedding = [0.0] * 1536

    similar = await _vector_search(embedding)

    call_id = str(uuid4())
    await get_db().calls.insert_one({
        "_id": call_id,
        "patient_id": patient_id,
        "called_at": datetime.now(tz=timezone.utc),
        "duration_s": max((t.t_end for t in transcript), default=0.0),
        "transcript": [t.model_dump() for t in transcript],
        "audio_url": None,
        "audio_features": features.model_dump(),
        "baseline_drift": drift,
        "score": score.model_dump(),
        "similar_calls": [s.model_dump() for s in similar],
        "embedding": embedding,
        "llm_degraded": llm_degraded,
        "audio_degraded": False,
        "short_call": len(transcript) < 3,
        "vitals_summary": vitals_summary,
    })
    return call_id
