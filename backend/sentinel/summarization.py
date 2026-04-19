from __future__ import annotations

import asyncio
import logging
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


async def _generate(prompt: str) -> Any:
    s = get_settings()
    genai.configure(api_key=s.gemini_api_key)
    model = genai.GenerativeModel("gemini-1.5-flash")
    return await asyncio.to_thread(model.generate_content, prompt)


async def summarize_patient(transcript: str) -> str:
    r = await _generate(_PATIENT_PROMPT.format(transcript=transcript))
    return (r.text or "").strip()


async def summarize_nurse(transcript: str, vitals: dict, score: dict) -> str:
    r = await _generate(
        _NURSE_PROMPT.format(transcript=transcript, vitals=vitals, score=score)
    )
    return (r.text or "").strip()
