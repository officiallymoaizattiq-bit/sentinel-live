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

# Hard cap on webhook body size (1 MiB). ElevenLabs post-call payloads are
# small JSON blobs; anything larger is either misuse or an attack.
_MAX_BODY_BYTES = 1 * 1024 * 1024


def _verify(secret: str, body: bytes, provided: str | None) -> bool:
    if not provided:
        return False
    # Accept bare hex digest or `sha256=<hex>` / `t=...,v0=<hex>` forms.
    candidate = provided.strip()
    if "=" in candidate:
        # Take the last `=`-separated segment that looks like hex.
        for part in reversed(candidate.replace(",", " ").split()):
            _, _, tail = part.partition("=")
            if tail:
                candidate = tail
                break
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, candidate)


@router.post("/elevenlabs/post-call")
async def elevenlabs_post_call(
    request: Request,
    x_elevenlabs_signature: str | None = Header(default=None),
):
    s = get_settings()
    body = await request.body()

    if len(body) > _MAX_BODY_BYTES:
        raise HTTPException(413, "payload too large")

    if not s.demo_mode:
        if not s.elevenlabs_webhook_secret or not _verify(
            s.elevenlabs_webhook_secret, body, x_elevenlabs_signature
        ):
            log.warning("elevenlabs webhook: signature verification failed")
            raise HTTPException(401, "invalid signature")

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(400, "invalid json")
    if not isinstance(payload, dict):
        raise HTTPException(400, "payload must be a json object")

    conversation_id = payload.get("conversation_id")
    if not conversation_id or not isinstance(conversation_id, str):
        raise HTTPException(400, "conversation_id required")
    transcript = payload.get("transcript", "")
    if not isinstance(transcript, str):
        transcript = str(transcript or "")

    try:
        result = await finalize_call(
            conversation_id=conversation_id,
            transcript=transcript,
            end_reason="agent_signal",
        )
    except Exception:
        log.exception("elevenlabs webhook finalize failed for %s", conversation_id)
        raise HTTPException(500, "finalize failed")
    return result
