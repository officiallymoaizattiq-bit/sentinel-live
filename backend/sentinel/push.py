"""Expo Push Notifications client.

We use the Expo Push API (https://exp.host/--/api/v2/push/send) so we don't
have to maintain a Firebase project + APNS key for the demo. Expo's relay
forwards to FCM/APNS using their own credentials and gives us a single HTTP
endpoint with no auth header needed for non-rate-limited demo volumes.

The mobile client gets an `ExponentPushToken[...]` via
`Notifications.getExpoPushTokenAsync` and registers it via
`POST /api/devices/push-token`. We store one token per device row
(`devices.push_token`), then fan out to every active device row for a
patient when /calls/trigger fires.

Why the payload looks the way it does:
- `priority: 'high'` -> tells Expo to flag the FCM push as high-priority
  (FCM `priority: high`), which is what wakes a doze-suspended device. APNS
  doesn't have a true equivalent, but Expo maps high to apns-priority=10.
- `channelId: 'incoming-calls-v2'` -> routes to the Android channel we
  provisioned in mobile/src/notifications/incoming.ts. Without this the
  push lands on Expo's fallback channel (LOW importance, no ringer).
- `sound: 'default'` -> tells Expo to set the APNS sound + Android
  notification sound. Required even though our channel already has a
  sound set, because Expo's "no sound by default" behavior overrides the
  channel default otherwise.
- `data: {kind: 'incoming-call', ...}` -> mirror of the local-notification
  payload so the existing tap-routing logic (payloadFromResponse in
  incoming.ts) deep-links into /(main)/call.
- `ttl: 30` -> 30s. If the device is offline longer than that the
  notification is stale (the call has timed out), so don't bother
  delivering.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Iterable

import httpx

from sentinel.db import get_db

log = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# Must match INCOMING_CALL_CHANNEL_ID in mobile/src/notifications/incoming.ts.
INCOMING_CALL_CHANNEL_ID = "incoming-calls-v2"

# 30s — call invitations are ephemeral, no point delivering after the user's
# browser tab has already moved on.
CALL_PUSH_TTL_SECONDS = 30

# Per Expo docs the API accepts up to 100 messages per POST. We hand-roll the
# batching so a patient with multiple paired devices still goes out in one
# request.
EXPO_MAX_BATCH = 100

# Expo request timeout. Short because call invitations are ephemeral — if
# Expo is down for >10s the notification is stale anyway.
_EXPO_TIMEOUT_S = 10.0

_SUPPORTED_PLATFORMS = ("ios", "android")


async def _list_active_push_tokens(patient_id: str) -> list[str]:
    """Return Expo push tokens for every non-revoked device of a patient.

    De-duplicates identical tokens (two device rows sharing a token after a
    re-pair would otherwise double-ring).
    """
    cursor = get_db().devices.find(
        {
            "patient_id": patient_id,
            "revoked_at": None,
            "push_token": {"$ne": None, "$exists": True},
        },
        projection={"push_token": 1, "_id": 1},
    )
    seen: set[str] = set()
    tokens: list[str] = []
    async for d in cursor:
        tok = d.get("push_token")
        if (
            isinstance(tok, str)
            and tok.startswith("ExponentPushToken[")
            and tok.endswith("]")
            and tok not in seen
        ):
            seen.add(tok)
            tokens.append(tok)
    return tokens


def _build_call_messages(
    *,
    tokens: Iterable[str],
    patient_id: str,
    mode: str,
    at_iso: str,
) -> list[dict[str, Any]]:
    """Construct one Expo push message per token."""
    body_text = (
        "Your care team would like a quick check-in."
        if mode == "phone"
        else "A check-in is ready when you are."
    )
    base = {
        "title": "Sentinel is calling you",
        "body": body_text,
        "sound": "default",
        "priority": "high",
        "ttl": CALL_PUSH_TTL_SECONDS,
        "channelId": INCOMING_CALL_CHANNEL_ID,
        "categoryId": "sentinel.incoming-call",
        "data": {
            "kind": "incoming-call",
            "patientId": patient_id,
            "mode": mode,
            "at": at_iso,
        },
    }
    return [{**base, "to": t} for t in tokens]


async def _post_to_expo(
    messages: list[dict[str, Any]],
    *,
    client: httpx.AsyncClient | None = None,
) -> list[dict[str, Any]]:
    """POST a chunk to Expo, return the receipts list. Network/HTTP failures
    are logged and swallowed — pushes are best-effort, the SSE foreground path
    is the backup. Returns an empty list on failure."""
    if not messages:
        return []

    owns_client = client is None
    c = client or httpx.AsyncClient(timeout=_EXPO_TIMEOUT_S)
    try:
        resp = await c.post(
            EXPO_PUSH_URL,
            json=messages,
            headers={
                "accept": "application/json",
                "accept-encoding": "gzip, deflate",
                "content-type": "application/json",
            },
        )
        if resp.status_code >= 500:
            log.warning("expo push 5xx: %s %s", resp.status_code, resp.text[:200])
            return []
        if resp.status_code >= 400:
            log.warning("expo push 4xx: %s %s", resp.status_code, resp.text[:200])
            return []
        body = resp.json()
        # Shape: {"data": [{"status": "ok", "id": "..."}, ...]} OR error body.
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, list):
            log.warning("expo push unexpected body: %s", str(body)[:200])
            return []
        return data
    except httpx.HTTPError as e:
        log.warning("expo push transport error: %s", e)
        return []
    finally:
        if owns_client:
            await c.aclose()


async def _handle_receipts(
    receipts: list[dict[str, Any]],
    tokens: list[str],
) -> None:
    """Walk the per-message receipts. Clear stored tokens that Expo says are
    DeviceNotRegistered (uninstall, app data wiped, etc) so we stop sending
    to them. Other errors (MessageTooBig, MessageRateExceeded) are not the
    token's fault and are logged only."""
    if len(receipts) != len(tokens):
        # Receipts list out of sync with messages list — Expo guarantees
        # parallel ordering when the request succeeded, so this is just
        # defensive logging.
        log.warning(
            "expo push receipt/message count mismatch: %d vs %d",
            len(receipts),
            len(tokens),
        )
        return

    db = get_db()
    for token, r in zip(tokens, receipts):
        if not isinstance(r, dict) or r.get("status") == "ok":
            continue
        details = r.get("details")
        err = details.get("error") if isinstance(details, dict) else None
        log.info(
            "expo push not-ok: token=%s err=%s msg=%s",
            token[:24] + "...", err, r.get("message"),
        )
        if err == "DeviceNotRegistered":
            await db.devices.update_many(
                {"push_token": token},
                {
                    "$set": {
                        "push_token": None,
                        "push_token_invalid_at": datetime.now(tz=timezone.utc),
                    }
                },
            )


async def send_incoming_call(
    *,
    patient_id: str,
    mode: str,
    at_iso: str,
    client: httpx.AsyncClient | None = None,
) -> int:
    """Push an "incoming call" notification to every paired device of a patient.

    Returns the number of push messages sent (0 if no registered tokens).
    Best-effort: never raises. The SSE event_bus.publish() in /calls/trigger
    is the in-app fallback for foreground users.
    """
    tokens = await _list_active_push_tokens(patient_id)
    if not tokens:
        log.info("send_incoming_call: no push tokens for patient %s", patient_id)
        return 0

    sent = 0
    for i in range(0, len(tokens), EXPO_MAX_BATCH):
        chunk = tokens[i : i + EXPO_MAX_BATCH]
        messages = _build_call_messages(
            tokens=chunk, patient_id=patient_id, mode=mode, at_iso=at_iso,
        )
        receipts = await _post_to_expo(messages, client=client)
        await _handle_receipts(receipts, chunk)
        sent += len(messages)
    return sent


async def register_push_token(
    *,
    device_id: str,
    token: str,
    provider: str,
    platform: str,
) -> None:
    """Persist a freshly-minted push token on the device row. Idempotent —
    callers may invoke on every app launch.
    """
    if provider != "expo":
        # We currently only emit through Expo's relay. Raw FCM/APNS tokens
        # would need a different sender — reject loudly so a future engineer
        # remembers to add the matching backend path.
        raise ValueError(f"unsupported push provider: {provider!r}")
    if not (
        isinstance(token, str)
        and token.startswith("ExponentPushToken[")
        and token.endswith("]")
        and len(token) <= 256
    ):
        raise ValueError("malformed expo push token")
    if platform not in _SUPPORTED_PLATFORMS:
        raise ValueError(f"unsupported platform: {platform!r}")

    await get_db().devices.update_one(
        {"_id": device_id},
        {
            "$set": {
                "push_token": token,
                "push_provider": provider,
                "push_platform": platform,
                "push_token_updated_at": datetime.now(tz=timezone.utc),
                "push_token_invalid_at": None,
            }
        },
    )
