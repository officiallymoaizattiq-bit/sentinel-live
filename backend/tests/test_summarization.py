from unittest.mock import AsyncMock, patch

import pytest

from sentinel.summarization import summarize_patient, summarize_nurse


@pytest.mark.asyncio
async def test_summarize_patient_calls_gemini_with_simple_prompt():
    fake = AsyncMock(return_value=type("R", (), {"text": "You're okay."})())
    with patch("sentinel.summarization._generate", fake):
        out = await summarize_patient(transcript="agent: hi\npatient: fine")
    assert out == "You're okay."
    prompt = fake.call_args.args[0]
    assert "simple" in prompt.lower() or "plain" in prompt.lower()


@pytest.mark.asyncio
async def test_summarize_nurse_calls_gemini_with_clinical_prompt():
    fake = AsyncMock(return_value=type("R", (), {"text": "Pt stable; no SIRS."})())
    with patch("sentinel.summarization._generate", fake):
        out = await summarize_nurse(
            transcript="agent: hi\npatient: fine",
            vitals={"hr": 82, "spo2": 97},
            score={"deterioration": 0.1, "news2": 2},
        )
    assert out == "Pt stable; no SIRS."
    prompt = fake.call_args.args[0]
    assert "clinical" in prompt.lower() or "sbar" in prompt.lower()


@pytest.mark.asyncio
async def test_summarize_patient_raises_on_sdk_error():
    fake = AsyncMock(side_effect=RuntimeError("gemini down"))
    with patch("sentinel.summarization._generate", fake):
        with pytest.raises(RuntimeError):
            await summarize_patient(transcript="x")
