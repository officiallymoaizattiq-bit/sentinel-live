from __future__ import annotations

import logging
from types import SimpleNamespace
from typing import Any

from openai import AsyncOpenAI

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
    """Pull plain text out of a response without crashing on blocked
    or empty responses.

    Fast path matches AsyncMock shape (object with plain .text attr).
    Fallback walks OpenAI chat-completion `choices[0].message.content`.
    """
    try:
        text = getattr(response, "text", None)
        if isinstance(text, str) and text.strip():
            return text.strip()
    except Exception:
        pass

    try:
        choices = getattr(response, "choices", None) or []
        for ch in choices:
            msg = getattr(ch, "message", None)
            if not msg:
                continue
            content = getattr(msg, "content", None)
            if isinstance(content, str) and content.strip():
                return content.strip()
    except Exception:
        pass

    return ""


def _client() -> AsyncOpenAI:
    s = get_settings()
    if not s.openrouter_api_key:
        raise RuntimeError(
            "openrouter_api_key is empty — set OPENROUTER_API_KEY in "
            "backend/.env so post-call summaries can be generated."
        )
    return AsyncOpenAI(api_key=s.openrouter_api_key, base_url=s.openrouter_base_url)


async def _generate(prompt: str) -> Any:
    s = get_settings()
    client = _client()
    resp = await client.chat.completions.create(
        model=s.openrouter_model,
        messages=[{"role": "user", "content": prompt}],
    )
    content = ""
    try:
        content = (resp.choices[0].message.content or "").strip()
    except Exception:
        content = ""
    return SimpleNamespace(text=content, _raw=resp)


async def _extract_or_raise(response: Any) -> str:
    text = _extract_text(response)
    if not text:
        log.warning("OpenRouter returned no text. raw=%s", getattr(response, "_raw", None))
        raise RuntimeError("OpenRouter returned an empty response")
    return text


async def summarize_patient(transcript: str) -> str:
    r = await _generate(_PATIENT_PROMPT.format(transcript=transcript))
    return await _extract_or_raise(r)


async def summarize_nurse(transcript: str, vitals: dict, score: dict) -> str:
    r = await _generate(
        _NURSE_PROMPT.format(transcript=transcript, vitals=vitals, score=score)
    )
    return await _extract_or_raise(r)
