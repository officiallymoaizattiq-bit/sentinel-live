import asyncio

import pytest

from sentinel import events as event_bus


async def test_publish_reaches_subscriber():
    q = event_bus.subscribe()
    try:
        event_bus.publish({"type": "test", "v": 1})
        ev = await asyncio.wait_for(q.get(), timeout=1.0)
        assert ev == {"type": "test", "v": 1}
    finally:
        event_bus.unsubscribe(q)


async def test_multiple_subscribers_receive_same_event():
    q1 = event_bus.subscribe()
    q2 = event_bus.subscribe()
    try:
        event_bus.publish({"type": "fanout"})
        e1 = await asyncio.wait_for(q1.get(), timeout=1.0)
        e2 = await asyncio.wait_for(q2.get(), timeout=1.0)
        assert e1 == {"type": "fanout"}
        assert e2 == {"type": "fanout"}
    finally:
        event_bus.unsubscribe(q1)
        event_bus.unsubscribe(q2)


async def test_full_queue_drops_gracefully(monkeypatch):
    q = event_bus.subscribe()
    try:
        # Fill the queue
        for i in range(q.maxsize):
            q.put_nowait({"seed": i})
        # Publishing now should not raise
        event_bus.publish({"type": "overflow"})
    finally:
        event_bus.unsubscribe(q)
