from __future__ import annotations

import hashlib
import hmac
import json
import logging

from fastapi import APIRouter, Header, HTTPException, Request

from sentinel.config import get_settings
from sentinel.finalize import finalize_call

log = logging.getLogger("sentinel.webhooks")

router = APIRouter(prefix="/api/webhooks")


def _verify(secret: str, body: bytes, provided: str | None) -> bool:
    if not provided:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, provided)


@router.post("/elevenlabs/post-call")
async def elevenlabs_post_call(
    request: Request,
    x_elevenlabs_signature: str | None = Header(default=None),
):
    s = get_settings()
    body = await request.body()

    if not s.demo_mode:
        if not s.elevenlabs_webhook_secret or not _verify(
            s.elevenlabs_webhook_secret, body, x_elevenlabs_signature
        ):
            raise HTTPException(401, "invalid signature")

    try:
        payload = json.loads(body)
    except Exception:
        raise HTTPException(400, "invalid json")

    conversation_id = payload.get("conversation_id")
    if not conversation_id:
        raise HTTPException(400, "conversation_id required")
    transcript = payload.get("transcript", "")

    result = await finalize_call(
        conversation_id=conversation_id,
        transcript=transcript,
        end_reason="agent_signal",
    )
    return result
