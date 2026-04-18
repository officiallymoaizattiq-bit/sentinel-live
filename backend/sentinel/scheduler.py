from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from sentinel.db import get_db

log = logging.getLogger("sentinel.scheduler")


async def trigger_call(patient_id: str) -> None:
    # Late import to avoid circular dep with call_handler.
    from sentinel.call_handler import place_call
    await place_call(patient_id)


async def tick() -> None:
    now = datetime.now(tz=timezone.utc)
    cur = get_db().patients.find({"next_call_at": {"$lte": now}})
    async for p in cur:
        try:
            await trigger_call(p["_id"])
        except Exception:
            log.exception("trigger_call failed for %s", p["_id"])


_sched: AsyncIOScheduler | None = None
_loop: asyncio.AbstractEventLoop | None = None


def _run_coro(coro_fn):
    """Submit an async callable onto the captured event loop.
    APScheduler job bodies run in its thread-pool executor — no loop — so we
    submit via run_coroutine_threadsafe on the loop captured in start().
    """
    def _wrap() -> None:
        if _loop is None or _loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(coro_fn(), _loop)
    return _wrap


def start() -> AsyncIOScheduler:
    global _sched, _loop
    if _sched is not None:
        return _sched
    try:
        _loop = asyncio.get_running_loop()
    except RuntimeError:
        _loop = asyncio.new_event_loop()
    _sched = AsyncIOScheduler()
    _sched.add_job(_run_coro(tick), trigger="interval", seconds=60,
                   id="sentinel_tick", replace_existing=True)
    _sched.add_job(_run_coro(_run_audit), trigger="interval", seconds=300,
                   id="sentinel_audit", replace_existing=True)
    _sched.add_job(_run_coro(_run_auto_finalize), trigger="interval", seconds=30,
                   id="sentinel_auto_finalize", replace_existing=True)
    _sched.start()
    return _sched


def stop() -> None:
    global _sched
    if _sched is not None:
        _sched.shutdown(wait=False)
        _sched = None


async def audit_missing_escalations(window_minutes: int = 10) -> list[str]:
    now = datetime.now(tz=timezone.utc)
    threshold = now - timedelta(minutes=window_minutes)
    cur = get_db().calls.find({
        "called_at": {"$gte": threshold},
        "score.recommended_action": {"$in": ["nurse_alert", "suggest_911"]},
    })
    bad: list[str] = []
    async for c in cur:
        existing = await get_db().alerts.find_one({"call_id": c["_id"]})
        if existing is None:
            bad.append(c["_id"])
    return bad


async def _run_audit() -> None:
    missing = await audit_missing_escalations()
    if missing:
        log.error("escalation missing for calls: %s", missing)


async def auto_finalize_conversations() -> list[str]:
    """Poll ElevenLabs for finished conversations + score any we haven't yet.

    Looks up conversations for the configured agent in the last 2 hours.
    For each status=done conversation not already scored in Mongo, call
    finalize_call() with the most recently enrolled patient as the fallback
    patient_id (widget path — no prior call doc exists).
    """
    from sentinel.call_handler import finalize_call
    from sentinel.config import get_settings

    s = get_settings()
    if not s.elevenlabs_api_key or not s.elevenlabs_agent_id:
        return []

    try:
        from elevenlabs.client import ElevenLabs
        el = ElevenLabs(api_key=s.elevenlabs_api_key)
        since = int((datetime.now(tz=timezone.utc) - timedelta(hours=2)).timestamp())
        page = el.conversational_ai.conversations.list(
            agent_id=s.elevenlabs_agent_id,
            call_start_after_unix=since,
            page_size=20,
        )
    except Exception as e:
        log.warning("auto_finalize: EL list failed: %s", e)
        return []

    db = get_db()
    finalized: list[str] = []
    latest_patient = await db.patients.find({}).sort("_id", -1).limit(1).to_list(1)
    fallback_pid = latest_patient[0]["_id"] if latest_patient else None

    for convo in getattr(page, "conversations", []) or []:
        cid = getattr(convo, "conversation_id", None)
        status = getattr(convo, "status", None)
        dur = getattr(convo, "call_duration_secs", 0) or 0
        if not cid:
            continue
        if status == "failed":
            log.warning("EL convo %s failed (duration=%ds) — widget connection issue",
                        cid, dur)
            continue
        if status != "done":
            continue
        existing = await db.calls.find_one({
            "conversation_id": cid, "status": "scored",
        })
        if existing is not None:
            continue
        try:
            await finalize_call(conversation_id=cid, patient_id_fallback=fallback_pid)
            finalized.append(cid)
        except Exception as e:
            log.warning("auto_finalize: finalize_call(%s) failed: %s", cid, e)
    return finalized


async def _run_auto_finalize() -> None:
    done = await auto_finalize_conversations()
    if done:
        log.info("auto-finalized %d conversations", len(done))
