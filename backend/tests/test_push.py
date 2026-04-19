"""Tests for sentinel.push (Expo Push API client) + the
/api/devices/push-token endpoint."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

from sentinel import api, push
from sentinel.auth import issue_device_token
from sentinel.main import create_app


@pytest.fixture
async def client(monkeypatch):
    mock = AsyncMongoMockClient()
    db = mock["sentinel_test"]
    for mod in (api, push):
        monkeypatch.setattr(mod, "get_db", lambda d=db: d)
    app = create_app(start_scheduler=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c, db


# ---------------------------------------------------------------------------
# send_incoming_call
# ---------------------------------------------------------------------------


def _expo_ok_response(n: int) -> dict[str, Any]:
    return {"data": [{"status": "ok", "id": f"r{i}"} for i in range(n)]}


@pytest.mark.asyncio
async def test_send_incoming_call_no_tokens_returns_zero(client):
    _, db = client
    n = await push.send_incoming_call(
        patient_id="p1", mode="widget", at_iso="2026-04-18T00:00:00Z",
    )
    assert n == 0


@pytest.mark.asyncio
async def test_send_incoming_call_skips_revoked_devices(client, monkeypatch):
    _, db = client
    await db.devices.insert_many([
        {"_id": "d-active", "patient_id": "p1", "revoked_at": None,
         "push_token": "ExponentPushToken[active]"},
        {"_id": "d-revoked", "patient_id": "p1",
         "revoked_at": datetime.now(tz=timezone.utc),
         "push_token": "ExponentPushToken[revoked]"},
        {"_id": "d-no-token", "patient_id": "p1", "revoked_at": None,
         "push_token": None},
        {"_id": "d-other-patient", "patient_id": "p2", "revoked_at": None,
         "push_token": "ExponentPushToken[other]"},
    ])

    posted: list[Any] = []

    async def fake_post(messages, *, client=None):
        posted.append(messages)
        return [{"status": "ok", "id": f"r{i}"} for i, _ in enumerate(messages)]

    monkeypatch.setattr(push, "_post_to_expo", fake_post)
    n = await push.send_incoming_call(
        patient_id="p1", mode="widget", at_iso="2026-04-18T00:00:00Z",
    )
    assert n == 1
    assert len(posted) == 1
    assert len(posted[0]) == 1
    assert posted[0][0]["to"] == "ExponentPushToken[active]"


@pytest.mark.asyncio
async def test_send_incoming_call_payload_shape(client, monkeypatch):
    _, db = client
    await db.devices.insert_one({
        "_id": "d1", "patient_id": "p1", "revoked_at": None,
        "push_token": "ExponentPushToken[abc]",
    })

    captured: dict[str, Any] = {}

    async def fake_post(messages, *, client=None):
        captured["messages"] = messages
        return [{"status": "ok"}]

    monkeypatch.setattr(push, "_post_to_expo", fake_post)
    await push.send_incoming_call(
        patient_id="p1", mode="phone", at_iso="2026-04-18T12:00:00Z",
    )
    msg = captured["messages"][0]
    assert msg["to"] == "ExponentPushToken[abc]"
    assert msg["priority"] == "high"
    assert msg["channelId"] == push.INCOMING_CALL_CHANNEL_ID
    assert msg["sound"] == "default"
    assert msg["ttl"] == push.CALL_PUSH_TTL_SECONDS
    assert msg["data"] == {
        "kind": "incoming-call",
        "patientId": "p1",
        "mode": "phone",
        "at": "2026-04-18T12:00:00Z",
    }


@pytest.mark.asyncio
async def test_send_incoming_call_clears_unregistered_tokens(client, monkeypatch):
    _, db = client
    await db.devices.insert_many([
        {"_id": "d-good", "patient_id": "p1", "revoked_at": None,
         "push_token": "ExponentPushToken[good]"},
        {"_id": "d-stale", "patient_id": "p1", "revoked_at": None,
         "push_token": "ExponentPushToken[stale]"},
    ])

    async def fake_post(messages, *, client=None):
        out = []
        for m in messages:
            if m["to"] == "ExponentPushToken[stale]":
                out.append({
                    "status": "error",
                    "message": "...",
                    "details": {"error": "DeviceNotRegistered"},
                })
            else:
                out.append({"status": "ok", "id": "r"})
        return out

    monkeypatch.setattr(push, "_post_to_expo", fake_post)
    await push.send_incoming_call(
        patient_id="p1", mode="widget", at_iso="2026-04-18T00:00:00Z",
    )

    stale = await db.devices.find_one({"_id": "d-stale"})
    good = await db.devices.find_one({"_id": "d-good"})
    assert stale["push_token"] is None
    assert stale["push_token_invalid_at"] is not None
    assert good["push_token"] == "ExponentPushToken[good]"


@pytest.mark.asyncio
async def test_post_to_expo_swallows_transport_errors(monkeypatch):
    """The inner Expo POST helper must never raise — pushes are best-effort,
    the SSE foreground path is the backup. A network outage should return []
    so callers treat it as 'no receipts'."""
    import httpx as _httpx

    class FakeClient:
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return None
        async def post(self, *a, **kw):
            raise _httpx.ConnectError("expo down")
        async def aclose(self): pass

    monkeypatch.setattr(push.httpx, "AsyncClient", FakeClient)
    receipts = await push._post_to_expo([{"to": "ExponentPushToken[x]"}])
    assert receipts == []


@pytest.mark.asyncio
async def test_post_to_expo_handles_5xx(monkeypatch):
    class FakeResp:
        status_code = 503
        text = "service down"
        def json(self): return {}

    class FakeClient:
        def __init__(self, *a, **kw): pass
        async def post(self, *a, **kw): return FakeResp()
        async def aclose(self): pass

    monkeypatch.setattr(push.httpx, "AsyncClient", FakeClient)
    receipts = await push._post_to_expo([{"to": "ExponentPushToken[x]"}])
    assert receipts == []


# ---------------------------------------------------------------------------
# register_push_token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_push_token_persists(client):
    _, db = client
    await db.devices.insert_one({"_id": "d1", "patient_id": "p1"})
    await push.register_push_token(
        device_id="d1", token="ExponentPushToken[xyz]",
        provider="expo", platform="android",
    )
    d = await db.devices.find_one({"_id": "d1"})
    assert d["push_token"] == "ExponentPushToken[xyz]"
    assert d["push_provider"] == "expo"
    assert d["push_platform"] == "android"
    assert d["push_token_updated_at"] is not None


@pytest.mark.asyncio
async def test_register_push_token_rejects_malformed(client):
    with pytest.raises(ValueError):
        await push.register_push_token(
            device_id="d1", token="not-an-expo-token",
            provider="expo", platform="android",
        )


@pytest.mark.asyncio
async def test_register_push_token_rejects_unknown_provider(client):
    with pytest.raises(ValueError):
        await push.register_push_token(
            device_id="d1", token="ExponentPushToken[x]",
            provider="fcm", platform="android",
        )


# ---------------------------------------------------------------------------
# /api/devices/push-token endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_devices_push_token_endpoint_happy_path(client):
    c, db = client
    await db.devices.insert_one({
        "_id": "dev-1", "patient_id": "p1", "revoked_at": None,
    })
    tok = issue_device_token(device_id="dev-1", patient_id="p1")
    r = await c.post(
        "/api/devices/push-token",
        json={"token": "ExponentPushToken[hello]", "platform": "android"},
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    d = await db.devices.find_one({"_id": "dev-1"})
    assert d["push_token"] == "ExponentPushToken[hello]"


@pytest.mark.asyncio
async def test_devices_push_token_requires_auth(client):
    c, _ = client
    r = await c.post(
        "/api/devices/push-token",
        json={"token": "ExponentPushToken[x]", "platform": "android"},
    )
    # require_device_token raises on missing Authorization header.
    assert r.status_code in (401, 422)


@pytest.mark.asyncio
async def test_devices_push_token_rejects_bad_payload(client):
    c, db = client
    await db.devices.insert_one({
        "_id": "dev-2", "patient_id": "p2", "revoked_at": None,
    })
    tok = issue_device_token(device_id="dev-2", patient_id="p2")
    r = await c.post(
        "/api/devices/push-token",
        json={"token": "garbage", "platform": "android"},
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# /api/calls/trigger integration
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_trigger_call_fans_out_push(client, monkeypatch):
    c, db = client
    await db.patients.insert_one({
        "_id": "p1", "name": "John", "phone": "+15555550100",
        "language": "en", "surgery_type": "ortho",
        "surgery_date": datetime(2026, 4, 1, tzinfo=timezone.utc),
        "discharge_date": datetime(2026, 4, 5, tzinfo=timezone.utc),
        "next_call_at": None, "call_count": 0,
    })
    await db.devices.insert_one({
        "_id": "d1", "patient_id": "p1", "revoked_at": None,
        "push_token": "ExponentPushToken[abc]",
    })

    sent_calls: list[dict[str, Any]] = []

    async def fake_send(*, patient_id, mode, at_iso, client=None):
        sent_calls.append({"patient_id": patient_id, "mode": mode, "at_iso": at_iso})
        return 1

    monkeypatch.setattr("sentinel.push.send_incoming_call", fake_send)

    # place_call talks to ElevenLabs/Twilio — stub it.
    async def fake_place(pid):
        return "call-xyz"

    with patch("sentinel.call_handler.place_call", fake_place):
        r = await c.post("/api/calls/trigger", json={"patient_id": "p1"})

    assert r.status_code == 200
    body = r.json()
    assert body["call_id"] == "call-xyz"
    assert body["pushes_sent"] == 1
    assert len(sent_calls) == 1
    assert sent_calls[0]["patient_id"] == "p1"
