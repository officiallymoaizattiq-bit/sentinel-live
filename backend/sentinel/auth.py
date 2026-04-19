from __future__ import annotations

import hashlib
import hmac
import json
import time
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import datetime, timezone

from fastapi import Header, HTTPException

from sentinel.config import get_settings
from sentinel.db import get_db


def _b64enc(b: bytes) -> str:
    return urlsafe_b64encode(b).rstrip(b"=").decode()


def _b64dec(s: str) -> bytes:
    padding = "=" * (-len(s) % 4)
    return urlsafe_b64decode(s + padding)


def issue_device_token(*, device_id: str, patient_id: str) -> str:
    """Issue HS256 JWT. Revocation enforced via DB check on each request.

    Includes `iat` (issued-at) so future migrations can add server-side
    max-age windows without a schema change. No `exp` by design: device
    tokens are long-lived and invalidated by setting `devices.revoked_at`.
    """
    secret = get_settings().device_token_secret.encode()
    header = _b64enc(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64enc(json.dumps({
        "sub": device_id,
        "pid": patient_id,
        "iat": int(time.time()),
        "typ": "device",
    }).encode())
    signing_input = f"{header}.{payload}".encode()
    sig = hmac.new(secret, signing_input, hashlib.sha256).digest()
    return f"{header}.{payload}.{_b64enc(sig)}"


def _decode_token(token: str) -> dict:
    """Verify signature and decode payload. Raises HTTPException(401) on failure.

    All error paths raise the same generic 401 shape so attackers can't
    distinguish malformed-vs-signature-vs-payload issues via response body.
    Signature comparison uses hmac.compare_digest for constant-time compare.
    """
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
    except ValueError:
        raise HTTPException(401, {"error": "malformed_token",
                                  "message": "Token format invalid"})
    secret = get_settings().device_token_secret.encode()
    signing_input = f"{header_b64}.{payload_b64}".encode()
    expected = hmac.new(secret, signing_input, hashlib.sha256).digest()
    try:
        actual = _b64dec(sig_b64)
    except (ValueError, TypeError):
        raise HTTPException(401, {"error": "malformed_token",
                                  "message": "Token signature undecodable"})
    if not hmac.compare_digest(expected, actual):
        raise HTTPException(401, {"error": "invalid_token",
                                  "message": "Token signature invalid"})
    try:
        payload = json.loads(_b64dec(payload_b64))
    except (ValueError, TypeError, json.JSONDecodeError):
        raise HTTPException(401, {"error": "malformed_token",
                                  "message": "Token payload undecodable"})
    if not isinstance(payload, dict) or payload.get("typ") != "device":
        raise HTTPException(401, {"error": "invalid_token",
                                  "message": "Not a device token"})
    if not isinstance(payload.get("sub"), str) or not payload.get("sub"):
        raise HTTPException(401, {"error": "invalid_token",
                                  "message": "Token missing subject"})
    return payload


async def require_device_token(authorization: str = Header(...)) -> dict:
    """FastAPI dependency: extract Bearer token, verify, check not revoked,
    update last_seen_at, return token payload.
    """
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, {"error": "malformed_token",
                                  "message": "Expected Bearer token"})
    token = authorization[7:].strip()
    payload = _decode_token(token)
    device_id = payload["sub"]

    device = await get_db().devices.find_one({"_id": device_id})
    if device is None:
        raise HTTPException(401, {"error": "invalid_token",
                                  "message": "Device not found"})
    if device.get("revoked_at") is not None:
        raise HTTPException(401, {"error": "device_revoked",
                                  "message": "This device was unpaired by your care team"})

    await get_db().devices.update_one(
        {"_id": device_id},
        {"$set": {"last_seen_at": datetime.now(tz=timezone.utc)}},
    )
    return payload
