from __future__ import annotations

import asyncio
import logging
from typing import Any

import google.generativeai as genai

from sentinel.config import get_settings

log = logging.getLogger("sentinel.summarization")

# Model id. `gemini-2.5-flash` was hit-or-miss depending on the installed
# google-generativeai version and whether the account has preview access; a
# 404/400 bubbled back as `summaries_error` and left `summary_patient` null.
# `gemini-2.0-flash` is the stable, broadly available Flash tier and matches
# what sentinel.scoring uses.
_MODEL_ID = "gemini-2.0-flash"

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
    or function-call-only responses.

    `response.text` is a property that RAISES on some SDK versions when there
    are no text parts (safety block, function call, empty response). We want
    "no summary" semantics, not a propagated error, so walk the candidate
    structure when the fast path fails.
    """
    # Fast path — matches the SDK's own accessor, and also matches the
    # AsyncMock shape used by the unit tests (object with a plain .text attr).
    try:
        text = getattr(response, "text", None)
        if isinstance(text, str) and text.strip():
            return text.strip()
    except Exception:
        pass

    try:
        candidates = getattr(response, "candidates", None) or []
        for cand in candidates:
            content = getattr(cand, "content", None)
            if not content:
                continue
            parts = getattr(content, "parts", None) or []
            for part in parts:
                t = getattr(part, "text", None)
                if isinstance(t, str) and t.strip():
                    return t.strip()
    except Exception:
        pass

    try:
        d = response.to_dict() if hasattr(response, "to_dict") else {}
        for cand in d.get("candidates", []):
            for part in cand.get("content", {}).get("parts", []):
                t = part.get("text")
                if isinstance(t, str) and t.strip():
                    return t.strip()
    except Exception:
        pass

    return ""


async def _generate(prompt: str) -> Any:
    s = get_settings()
    if not s.gemini_api_key:
        raise RuntimeError(
            "gemini_api_key is empty — set GEMINI_API_KEY in backend/.env "
            "so post-call summaries can be generated."
        )
    genai.configure(api_key=s.gemini_api_key)
    model = genai.GenerativeModel(_MODEL_ID)
    return await asyncio.to_thread(model.generate_content, prompt)


async def _extract_or_raise(response: Any) -> str:
    text = _extract_text(response)
    if not text:
        try:
            feedback = getattr(response, "prompt_feedback", None)
            if feedback:
                log.warning(
                    "Gemini returned no text. prompt_feedback=%s", feedback
                )
        except Exception:
            pass
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
