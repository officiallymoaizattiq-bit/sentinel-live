from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from sentinel.config import get_settings

log = logging.getLogger("sentinel.summarization")

_TIMEOUT_S = 30.0

_PATIENT_PROMPT = """You are Sentinel, the patient's post-operative check-in
service, writing directly TO the patient about their just-completed call.

Rules (strict):
- Write in second person ("you", "your"). Never use "[Patient Name]",
  "[Your Name]", "[Doctor's Name]", or any bracketed placeholder.
- Never sign the message with a name. No "Hi [x]" greeting and no sign-off.
- No medical jargon. 6th-grade reading level. 2-3 sentences total.
- Warm and reassuring when the call is fine; clear and direct if something
  warrants follow-up.
- Do not invent vitals or details not in the transcript.

Transcript:
{transcript}

Patient-facing summary (no greeting, no placeholders):"""

_NURSE_PROMPT = """You are writing a clinical SBAR-style summary for a nurse
reviewing a post-operative voice check-in. Use concise clinical language.
Include: subjective complaints, relevant vitals, risk factors, assessment.
3-5 sentences.

Rules (strict):
- Never use bracketed placeholders like "[Patient Name]", "[Doctor's Name]".
- Refer to the patient as "the patient" or "pt".
- Do not invent vitals or findings not present in the transcript / scoring.

Transcript:
{transcript}

Vitals: {vitals}
Scoring: {score}

Clinical summary:"""


async def _openrouter_chat(prompt: str, api_key: str, model: str) -> str:
    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        r = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://sentinel.local",
                "X-Title": "Sentinel",
            },
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        r.raise_for_status()
        data = r.json()
        return (data["choices"][0]["message"]["content"] or "").strip()


async def _gemini_chat(prompt: str, api_key: str, model: str) -> str:
    import google.generativeai as genai
    genai.configure(api_key=api_key)
    m = genai.GenerativeModel(model)
    resp = await asyncio.wait_for(m.generate_content_async(prompt), timeout=_TIMEOUT_S)
    text = getattr(resp, "text", None)
    if isinstance(text, str) and text.strip():
        return text.strip()
    for ch in getattr(resp, "candidates", None) or []:
        for p in getattr(getattr(ch, "content", None), "parts", None) or []:
            t = getattr(p, "text", None)
            if isinstance(t, str) and t.strip():
                return t.strip()
    return ""


async def _generate(prompt: str) -> str:
    s = get_settings()
    if s.openrouter_api_key:
        try:
            return await _openrouter_chat(prompt, s.openrouter_api_key, s.openrouter_model)
        except asyncio.TimeoutError as e:
            raise RuntimeError(f"OpenRouter request timed out after {_TIMEOUT_S}s") from e
    if s.gemini_api_key:
        try:
            return await _gemini_chat(prompt, s.gemini_api_key, s.gemini_model)
        except asyncio.TimeoutError as e:
            raise RuntimeError(f"Gemini request timed out after {_TIMEOUT_S}s") from e
    raise RuntimeError(
        "No LLM key configured — set OPENROUTER_API_KEY or GEMINI_API_KEY in backend/.env"
    )


def _require_text(text: str) -> str:
    if not text.strip():
        log.warning("LLM returned empty text")
        raise RuntimeError("LLM returned an empty response")
    return text.strip()


def _coerce_text(value: Any) -> str:
    """Accept either a plain string (new OpenRouter/Gemini path) or an object
    with a ``.text`` attribute (test fakes and legacy callers)."""
    if isinstance(value, str):
        return value
    text = getattr(value, "text", None)
    if isinstance(text, str):
        return text
    return ""


async def summarize_patient(transcript: str) -> str:
    return _require_text(
        _coerce_text(await _generate(_PATIENT_PROMPT.format(transcript=transcript)))
    )


async def summarize_nurse(transcript: str, vitals: dict, score: dict) -> str:
    return _require_text(
        _coerce_text(
            await _generate(
                _NURSE_PROMPT.format(
                    transcript=transcript, vitals=vitals, score=score
                )
            )
        )
    )


# Back-compat shims for tests that patched `_extract_text` / `_generate` / `_model`.
def _extract_text(response: Any) -> str:
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return text.strip()
    return ""
