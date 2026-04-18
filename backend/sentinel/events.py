from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator

log = logging.getLogger("sentinel.events")

# Per-subscriber queue; each SSE connection owns one.
_subscribers: set[asyncio.Queue[dict]] = set()


def subscribe() -> asyncio.Queue[dict]:
    q: asyncio.Queue[dict] = asyncio.Queue(maxsize=100)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue[dict]) -> None:
    _subscribers.discard(q)


def publish(event: dict) -> None:
    """Non-blocking publish. Drops events if any subscriber queue is full."""
    for q in list(_subscribers):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            log.warning("subscriber queue full - event dropped")


async def stream(q: asyncio.Queue[dict]) -> AsyncIterator[str]:
    """Format SSE messages. Yields `data: {...}\\n\\n` chunks."""
    try:
        # Hello event so the client knows the stream is live.
        yield f"data: {json.dumps({'type': 'hello'})}\n\n"
        while True:
            event = await q.get()
            yield f"data: {json.dumps(event, default=str)}\n\n"
    finally:
        unsubscribe(q)


def snapshot_subs() -> int:
    return len(_subscribers)
