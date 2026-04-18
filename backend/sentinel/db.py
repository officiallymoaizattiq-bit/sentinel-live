from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING

from sentinel.config import get_settings

_client: AsyncIOMotorClient | None = None


def get_db() -> AsyncIOMotorDatabase:
    global _client
    s = get_settings()
    if _client is None:
        _client = AsyncIOMotorClient(s.mongo_uri)
    return _client[s.mongo_db]


async def ensure_indexes() -> None:
    db = get_db()
    await db.patients.create_index([("next_call_at", ASCENDING)])
    await db.calls.create_index([("patient_id", ASCENDING), ("called_at", ASCENDING)])
    await db.alerts.create_index([("patient_id", ASCENDING), ("sent_at", ASCENDING)])


async def close_db() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
