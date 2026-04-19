from __future__ import annotations

import asyncio
import logging

from sentinel.db import get_db
from sentinel.finalize import finalize_call

log = logging.getLogger("sentinel.watchdog")


async def start_call_watchdog(conversation_id: str, timeout_s: int = 40) -> None:
    """Sleep `timeout_s` seconds then finalize the call if still active.

    Safe to race with the ElevenLabs post-call webhook: `finalize_call` is
    idempotent (keyed on the call's `ended_at` field).
    """
    await asyncio.sleep(timeout_s)
    db = get_db()
    doc = await db.calls.find_one({"conversation_id": conversation_id})
    if not doc:
        log.warning("watchdog: unknown conversation_id=%s", conversation_id)
        return
    if doc.get("ended_at") is not None:
        return
    log.info("watchdog timeout firing finalize for %s", conversation_id)
    await finalize_call(
        conversation_id=conversation_id,
        transcript="\n".join(t.get("text", "") for t in doc.get("transcript", [])),
        end_reason="timeout_40s",
    )
