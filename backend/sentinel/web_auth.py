from __future__ import annotations

import hashlib
import hmac
import json
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, HTTPException, Response
from pydantic import BaseModel

from sentinel.config import get_settings
from sentinel.db import get_db

COOKIE_NAME = "sentinel_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 14  # 14 days

router = APIRouter(prefix="/api/auth")


def _b64enc(b: bytes) -> str:
    return urlsafe_b64encode(b).rstrip(b"=").decode()


def _b64dec(s: str) -> bytes:
    padding = "=" * (-len(s) % 4)
    return urlsafe_b64decode(s + padding)


def _sign(payload: dict) -> str:
    secret = get_settings().session_secret.encode()
    body = _b64enc(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64enc(hmac.new(secret, body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def _verify(token: str) -> dict | None:
    try:
        body, sig = token.split(".")
    except ValueError:
        return None
    secret = get_settings().session_secret.encode()
    expected = _b64enc(hmac.new(secret, body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        payload = json.loads(_b64dec(body))
    except Exception:
        return None
    return payload


class LoginBody(BaseModel):
    role: str
    passkey: str
    patient_id: str | None = None


@router.post("/login")
async def login(body: LoginBody, response: Response):
    s = get_settings()
    if body.role == "admin":
        if body.passkey != s.admin_passkey:
            raise HTTPException(401, {"error": "invalid_passkey"})
        payload = {
            "role": "admin",
            "iat": datetime.now(tz=timezone.utc).isoformat(),
        }
    elif body.role == "patient":
        if body.passkey != s.patient_passkey:
            raise HTTPException(401, {"error": "invalid_passkey"})
        if not body.patient_id:
            raise HTTPException(401, {"error": "unknown_patient"})
        p = await get_db().patients.find_one({"_id": body.patient_id})
        if p is None:
            raise HTTPException(401, {"error": "unknown_patient"})
        payload = {
            "role": "patient",
            "patient_id": body.patient_id,
            "iat": datetime.now(tz=timezone.utc).isoformat(),
        }
    else:
        raise HTTPException(400, {"error": "invalid_role"})

    token = _sign(payload)
    response.set_cookie(
        key=COOKIE_NAME, value=token, max_age=COOKIE_MAX_AGE,
        httponly=True, samesite="lax", path="/",
    )
    out = {"role": payload["role"]}
    if payload["role"] == "patient":
        out["patient_id"] = payload["patient_id"]
    return out


@router.post("/logout", status_code=204)
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")


@router.get("/me")
async def me(sentinel_session: str | None = Cookie(default=None)):
    if sentinel_session is None:
        raise HTTPException(401, {"error": "no_session"})
    payload = _verify(sentinel_session)
    if payload is None:
        raise HTTPException(401, {"error": "invalid_session"})
    out = {"role": payload["role"]}
    if payload.get("patient_id"):
        out["patient_id"] = payload["patient_id"]
    return out


async def require_admin(
    sentinel_session: str | None = Cookie(default=None),
) -> dict:
    if sentinel_session is None:
        raise HTTPException(401, {"error": "no_session"})
    payload = _verify(sentinel_session)
    if payload is None or payload.get("role") != "admin":
        raise HTTPException(401, {"error": "not_admin"})
    return payload


async def require_patient(
    sentinel_session: str | None = Cookie(default=None),
) -> dict:
    if sentinel_session is None:
        raise HTTPException(401, {"error": "no_session"})
    payload = _verify(sentinel_session)
    if payload is None or payload.get("role") != "patient":
        raise HTTPException(401, {"error": "not_patient"})
    return payload
