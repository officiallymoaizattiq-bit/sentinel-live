import asyncio

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING

from sentinel.config import get_settings

_client: AsyncIOMotorClient | None = None
_indexes_lock = asyncio.Lock()
_indexes_done = False


def get_db() -> AsyncIOMotorDatabase:
    global _client
    s = get_settings()
    if _client is None:
        _client = AsyncIOMotorClient(s.mongo_uri, serverSelectionTimeoutMS=3000)
    return _client[s.mongo_db]


async def ensure_indexes() -> None:
    """Create MongoDB indexes required by hot-path queries.

    Idempotent and guarded by an asyncio lock so concurrent startup tasks
    (lifespan + demo seed) can't race into duplicate create_index calls.
    """
    global _indexes_done
    async with _indexes_lock:
        if _indexes_done:
            return
        db = get_db()
        await db.patients.create_index([("next_call_at", ASCENDING)])
        await db.calls.create_index(
            [("patient_id", ASCENDING), ("called_at", ASCENDING)]
        )
        await db.calls.create_index(
            [("conversation_id", ASCENDING)], sparse=True
        )
        await db.alerts.create_index(
            [("patient_id", ASCENDING), ("sent_at", DESCENDING)]
        )
        await db.alerts.create_index([("call_id", ASCENDING)])
        # Vitals: hot path is "latest samples for patient in window".
        await db.vitals.create_index(
            [("patient_id", ASCENDING), ("t", DESCENDING)]
        )
        # Device lookup by patient (fan-out push) + token-hash check.
        await db.devices.create_index([("patient_id", ASCENDING)])
        # Pairing codes auto-expire via TTL on expires_at.
        await db.pairing_codes.create_index(
            [("expires_at", ASCENDING)], expireAfterSeconds=0
        )
        # Processed-batch idempotency is by _id already, but patient lookup
        # helps audit tooling.
        await db.processed_batches.create_index([("patient_id", ASCENDING)])
        await db.cohort_outcomes.create_index(
            [("surgery_type", ASCENDING), ("day", ASCENDING)]
        )
        _indexes_done = True


async def close_db() -> None:
    global _client, _indexes_done
    if _client is not None:
        _client.close()
        _client = None
    _indexes_done = False
