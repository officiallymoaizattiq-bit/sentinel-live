from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator

log = logging.getLogger("sentinel.events")

# Per-subscriber queue; each SSE connection owns one.
_subscribers: set[asyncio.Queue[dict]] = set()

# Keepalive cadence so intermediate proxies / clients don't kill idle streams.
_KEEPALIVE_SECONDS = 15.0


def subscribe() -> asyncio.Queue[dict]:
    q: asyncio.Queue[dict] = asyncio.Queue(maxsize=100)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue[dict]) -> None:
    _subscribers.discard(q)


def publish(event: dict) -> None:
    """Non-blocking publish. Drops events if any subscriber queue is full.

    Snapshots the subscriber set so publishing while another coroutine is
    (un)subscribing is safe under the single-threaded asyncio event loop.
    """
    for q in list(_subscribers):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            log.warning("subscriber queue full - event dropped")


async def stream(q: asyncio.Queue[dict] | None = None) -> AsyncIterator[str]:
    """Format SSE messages. Yields `data: {...}\\n\\n` chunks.

    If `q` is None, subscribes and unsubscribes internally — the preferred
    pattern because the subscriber lifecycle is tied to the generator and
    cleanup happens even if the client disconnects before the first yield.
    Passing an externally-created queue is still supported for tests.
    """
    owns_queue = q is None
    if owns_queue:
        q = subscribe()
    try:
        # iOS Safari buffers ~2KB before dispatching SSE onmessage. Prepend a
        # comment of padding so the first real event flushes immediately.
        yield ":" + (" " * 4096) + "\n\n"
        # Hello event so the client knows the stream is live.
        yield f"data: {json.dumps({'type': 'hello'})}\n\n"
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=_KEEPALIVE_SECONDS)
            except asyncio.TimeoutError:
                # SSE comment line — keeps the connection open without
                # polluting the client's event stream.
                yield ": keepalive\n\n"
                continue
            try:
                payload = json.dumps(event, default=str)
            except (TypeError, ValueError):
                log.exception("failed to serialize SSE event; dropping")
                continue
            yield f"data: {payload}\n\n"
    finally:
        if owns_queue:
            unsubscribe(q)


def snapshot_subs() -> int:
    return len(_subscribers)
