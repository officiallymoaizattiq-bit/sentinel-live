from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol
from uuid import uuid4

import httpx

from sentinel import events as event_bus
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

log = logging.getLogger("sentinel.scoring")

_EMBED_DIM = 768  # text-embedding-004
_HTTP_TIMEOUT_S = 30.0

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
        t = d.get("t")
        t_iso = t.isoformat() if hasattr(t, "isoformat") else str(t)
        latest[kind] = (t_iso, val)
        if isinstance(val, (int, float)):
            buckets.setdefault(kind, []).append(float(val))

    def agg(vals: list[float]) -> dict:
        if not vals:
            return {}
        s = sorted(vals)
        n = len(s)
        mid = n // 2
        median = s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2
        return {
            "n": n,
            "min": s[0],
            "max": s[-1],
            "mean": sum(vals) / n,
            "median": median,
        }

    return {
        "window_hours": window_hours,
        "sample_count": count,
        "stats": {k: agg(v) for k, v in buckets.items()},
        "latest": {k: {"t": t, "value": v} for k, (t, v) in latest.items()},
    }


class LLM(Protocol):
    async def score(self, *, transcript, features, drift, history, rubric,
                    vitals) -> Score: ...
    async def embed(self, text: str) -> list[float]: ...


# JSON-schema emitted via OpenAI-compatible "tools" field (OpenRouter) or
# Gemini native "function_declarations" (google-generativeai).
_EMIT_SCORE_PARAMS: dict[str, Any] = {
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
}

_EMIT_SCORE_TOOL = {
    "function_declarations": [{
        "name": "emit_score",
        "description": "Emit deterioration score.",
        "parameters": _EMIT_SCORE_PARAMS,
    }],
}

_OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"


def _score_from_args(args: dict[str, Any]) -> Score:
    args = dict(args)
    args["recommended_action"] = RecommendedAction(args["recommended_action"])
    return Score(**args)


async def _openrouter_score(*, user_payload: str, api_key: str, model: str) -> Score:
    """Function-call scoring via OpenRouter (OpenAI-compatible tools API)."""
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": RUBRIC},
            {"role": "user", "content": user_payload},
        ],
        "tools": [{
            "type": "function",
            "function": {
                "name": "emit_score",
                "description": "Emit deterioration score.",
                "parameters": _EMIT_SCORE_PARAMS,
            },
        }],
        "tool_choice": {"type": "function", "function": {"name": "emit_score"}},
    }
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
        r = await client.post(
            _OPENROUTER_CHAT_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://sentinel.local",
                "X-Title": "Sentinel",
            },
            json=body,
        )
        r.raise_for_status()
        data = r.json()
    try:
        choice = data["choices"][0]
        tool_calls = choice["message"].get("tool_calls") or []
        for tc in tool_calls:
            fn = tc.get("function") or {}
            if fn.get("name") == "emit_score":
                raw = fn.get("arguments") or "{}"
                args = json.loads(raw) if isinstance(raw, str) else dict(raw)
                return _score_from_args(args)
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise RuntimeError(f"OpenRouter returned malformed tool call: {e}") from e
    raise RuntimeError("OpenRouter did not emit_score")


async def _openrouter_embed(*, text: str, api_key: str) -> list[float]:
    """Embeddings via OpenRouter (OpenAI-compatible /embeddings).

    We prefix the embed model with ``google/`` so OpenRouter routes it through
    Google's backend with the same API key. Falls back to Gemini-direct when
    OpenRouter does not have embeddings available for the caller.
    """
    body = {
        "model": "google/text-embedding-004",
        "input": text,
    }
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
        r = await client.post(
            "https://openrouter.ai/api/v1/embeddings",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://sentinel.local",
                "X-Title": "Sentinel",
            },
            json=body,
        )
        r.raise_for_status()
        data = r.json()
    try:
        return list(data["data"][0]["embedding"])
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"OpenRouter returned malformed embedding: {e}") from e


async def _gemini_direct_score(*, user_payload: str, api_key: str, model: str) -> Score:
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    m = genai.GenerativeModel(
        model,
        tools=[_EMIT_SCORE_TOOL],
        system_instruction=RUBRIC,
    )
    resp = await asyncio.wait_for(
        m.generate_content_async(user_payload), timeout=_HTTP_TIMEOUT_S,
    )
    for part in resp.candidates[0].content.parts:
        fc = getattr(part, "function_call", None)
        if fc and fc.name == "emit_score":
            return _score_from_args(dict(fc.args))
    raise RuntimeError("Gemini did not emit_score")


async def _gemini_direct_embed(*, text: str, api_key: str, model: str) -> list[float]:
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    r = await asyncio.wait_for(
        genai.embed_content_async(model=model, content=text),
        timeout=_HTTP_TIMEOUT_S,
    )
    return r["embedding"]


class GeminiLLM:
    """Scoring LLM. Name retained for API compatibility; transport routes
    through OpenRouter when ``OPENROUTER_API_KEY`` is set (preferred), with
    a Gemini-direct fallback. Public method signatures are stable:
    ``score(...)`` and ``embed(text)``.
    """

    def __init__(self) -> None:
        s = get_settings()
        if not s.openrouter_api_key and not s.gemini_api_key:
            raise RuntimeError(
                "No LLM key configured - set OPENROUTER_API_KEY or GEMINI_API_KEY in backend/.env"
            )
        self._openrouter_key = s.openrouter_api_key
        self._openrouter_model = s.openrouter_model
        self._gemini_key = s.gemini_api_key
        self._gemini_model = s.gemini_model
        self._gemini_embed_model = s.gemini_embed_model

    async def score(self, *, transcript, features, drift, history, rubric, vitals) -> Score:
        user = json.dumps({
            "transcript": [t.model_dump() for t in transcript],
            "features": features.model_dump(),
            "drift_z": drift,
            "history_last_3_calls": history,
            "vitals_last_2h": vitals,
        })
        if self._openrouter_key:
            try:
                return await _openrouter_score(
                    user_payload=user,
                    api_key=self._openrouter_key,
                    model=self._openrouter_model,
                )
            except Exception as e:
                if not self._gemini_key:
                    raise
                log.warning(
                    "OpenRouter scoring failed (%s); falling back to Gemini-direct", e,
                )
        return await _gemini_direct_score(
            user_payload=user,
            api_key=self._gemini_key,
            model=self._gemini_model,
        )

    async def embed(self, text: str) -> list[float]:
        if self._openrouter_key:
            try:
                return await _openrouter_embed(
                    text=text, api_key=self._openrouter_key,
                )
            except Exception as e:
                if not self._gemini_key:
                    raise
                log.warning(
                    "OpenRouter embed failed (%s); falling back to Gemini-direct", e,
                )
        return await _gemini_direct_embed(
            text=text, api_key=self._gemini_key, model=self._gemini_embed_model,
        )


async def _last_3_calls(patient_id: str) -> list[dict]:
    cur = (
        get_db()
        .calls.find({"patient_id": patient_id})
        .sort("called_at", -1)
        .limit(3)
    )
    out: list[dict] = []
    async for d in cur:
        called_at = d.get("called_at")
        out.append({
            "called_at": called_at.isoformat() if hasattr(called_at, "isoformat") else None,
            "score": d.get("score"),
            "summary": (d.get("score") or {}).get("summary"),
        })
    return out


async def _vector_search(embedding: list[float], k: int = 3) -> list[SimilarCall]:
    # Skip lookup when embedding is the zero-vector fallback; result is
    # meaningless (all dot products are 0) and we'd scan the whole cohort.
    if not any(embedding):
        return []
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
    except Exception as e:
        log.warning("vectorSearch unavailable, using dot-product fallback: %s", e)

        def dot(a, b):
            return sum(x * y for x, y in zip(a, b))

        scored: list[tuple[float, dict]] = []
        async for d in db.cohort_outcomes.find({}):
            emb = d.get("embedding")
            if not emb:
                continue
            scored.append((dot(embedding, emb), d))
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
    except Exception as e:
        log.warning("LLM scoring failed, falling back to rules: %s", e)
        score = rules_only_score(features=features, drift=drift)
        llm_degraded = True

    transcript_text = "\n".join(f"{t.role}: {t.text}" for t in transcript)
    try:
        embedding = await llm.embed(transcript_text or score.summary)
    except Exception as e:
        log.warning("LLM embedding failed, using zero-vector: %s", e)
        embedding = [0.0] * _EMBED_DIM

    similar = await _vector_search(embedding)

    call_id = str(uuid4())
    now = datetime.now(tz=timezone.utc)
    await get_db().calls.insert_one({
        "_id": call_id,
        "patient_id": patient_id,
        "called_at": now,
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
    event_bus.publish({
        "type": "call_scored",
        "call_id": call_id,
        "patient_id": patient_id,
        "score": score.model_dump(mode="json"),
        "at": now.isoformat(),
    })
    return call_id
