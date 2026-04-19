import hashlib
import hmac
import json

import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from sentinel.main import create_app


def _sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


@pytest.mark.asyncio
async def test_post_call_webhook_rejects_bad_signature(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_WEBHOOK_SECRET", "secret")
    monkeypatch.setenv("DEMO_MODE", "false")
    from sentinel.config import get_settings
    get_settings.cache_clear()
    app = create_app(start_scheduler=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post(
            "/api/webhooks/elevenlabs/post-call",
            content=b"{}",
            headers={"X-Elevenlabs-Signature": "bad"},
        )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_post_call_webhook_accepts_valid_signature(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_WEBHOOK_SECRET", "secret")
    monkeypatch.setenv("DEMO_MODE", "false")
    from sentinel.config import get_settings
    get_settings.cache_clear()

    app = create_app(start_scheduler=False)
    body = json.dumps({"conversation_id": "conv_abc", "transcript": "hi"}).encode()
    sig = _sign("secret", body)
    with patch("sentinel.webhooks.finalize_call", AsyncMock(return_value={"ok": True})) as fin:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            r = await c.post(
                "/api/webhooks/elevenlabs/post-call",
                content=body,
                headers={"X-Elevenlabs-Signature": sig, "content-type": "application/json"},
            )
    assert r.status_code == 200
    fin.assert_awaited_once()


@pytest.mark.asyncio
async def test_post_call_webhook_demo_mode_skips_signature(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "true")
    from sentinel.config import get_settings
    get_settings.cache_clear()

    app = create_app(start_scheduler=False)
    with patch("sentinel.webhooks.finalize_call", AsyncMock(return_value={"ok": True})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            r = await c.post(
                "/api/webhooks/elevenlabs/post-call",
                json={"conversation_id": "conv_abc", "transcript": "hi"},
            )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_post_call_webhook_rejects_missing_conversation_id(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "true")
    from sentinel.config import get_settings
    get_settings.cache_clear()
    app = create_app(start_scheduler=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/api/webhooks/elevenlabs/post-call", json={"transcript": "hi"})
    assert r.status_code == 400
