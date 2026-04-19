from __future__ import annotations

import logging
from types import SimpleNamespace
from typing import Any

import google.generativeai as genai

from sentinel.config import get_settings

log = logging.getLogger("sentinel.summarization")

_PATIENT_PROMPT = """You are explaining a post-surgery phone check-in result
to the patient themself. Use plain, simple English at a 6th-grade reading
level. Be warm and reassuring but honest. 2-3 sentences, no medical jargon.

Transcript:
{transcript}

Patient-facing summary:"""

_NURSE_PROMPT = """You are writing a clinical SBAR-style summary for a nurse
reviewing a post-operative voice check-in. Use concise clinical language.
Include: subjective complaints, relevant vitals, risk factors, and your
assessment. 3-5 sentences.

Transcript:
{transcript}

Vitals: {vitals}
Scoring: {score}

Clinical summary:"""


def _extract_text(response: Any) -> str:
    """Pull plain text out of a Gemini response without crashing on blocked
    or empty responses.

    Fast path matches AsyncMock shape (object with plain `.text` attr) and
    real `GenerativeModel.generate_content_async` responses, which also
    expose `.text`. Falls back to walking `candidates[0].content.parts[*].text`.
    """
    try:
        text = getattr(response, "text", None)
        if isinstance(text, str) and text.strip():
            return text.strip()
    except Exception:
        pass

    try:
        candidates = getattr(response, "candidates", None) or []
        for ch in candidates:
            content = getattr(ch, "content", None)
            parts = getattr(content, "parts", None) or []
            for p in parts:
                t = getattr(p, "text", None)
                if isinstance(t, str) and t.strip():
                    return t.strip()
    except Exception:
        pass

    return ""


def _model() -> genai.GenerativeModel:
    s = get_settings()
    if not s.gemini_api_key:
        raise RuntimeError(
            "gemini_api_key is empty — set GEMINI_API_KEY in "
            "backend/.env so post-call summaries can be generated."
        )
    genai.configure(api_key=s.gemini_api_key)
    return genai.GenerativeModel(s.gemini_model)


async def _generate(prompt: str) -> Any:
    model = _model()
    resp = await model.generate_content_async(prompt)
    text = _extract_text(resp)
    return SimpleNamespace(text=text, _raw=resp)


async def _extract_or_raise(response: Any) -> str:
    text = _extract_text(response)
    if not text:
        log.warning("Gemini returned no text. raw=%s", getattr(response, "_raw", None))
        raise RuntimeError("Gemini returned an empty response")
    return text


async def summarize_patient(transcript: str) -> str:
    r = await _generate(_PATIENT_PROMPT.format(transcript=transcript))
    return await _extract_or_raise(r)


async def summarize_nurse(transcript: str, vitals: dict, score: dict) -> str:
    r = await _generate(
        _NURSE_PROMPT.format(transcript=transcript, vitals=vitals, score=score)
    )
    return await _extract_or_raise(r)
