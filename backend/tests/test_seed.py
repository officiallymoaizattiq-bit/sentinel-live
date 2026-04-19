import pytest
from mongomock_motor import AsyncMongoMockClient

from sentinel import seed


@pytest.fixture
def db(monkeypatch):
    client = AsyncMongoMockClient()
    db = client["sentinel_test"]
    monkeypatch.setattr(seed, "get_db", lambda: db)
    return db


async def test_seed_cohort_inserts_cases(db):
    await seed.seed_cohort(count=20, seed=42)
    n = await db.cohort_outcomes.count_documents({})
    assert n == 20
    sample = await db.cohort_outcomes.find_one({})
    assert sample["outcome"] in {"recovered", "readmitted", "sepsis", "died"}
    assert len(sample["embedding"]) == 1536
