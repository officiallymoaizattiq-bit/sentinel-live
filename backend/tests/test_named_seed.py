import pytest
from mongomock_motor import AsyncMongoMockClient

from sentinel import enrollment, named_seed


@pytest.fixture
def db(monkeypatch):
    client = AsyncMongoMockClient()
    db = client["sentinel_test"]
    monkeypatch.setattr(named_seed, "get_db", lambda: db)
    monkeypatch.setattr(enrollment, "get_db", lambda: db)
    return db


async def test_seed_creates_three_distinct_patients(db):
    pids = await named_seed.seed_named_patients(clean=True)
    assert len(pids) == 3
    assert pids[0] == named_seed.JOHN_CHEN_PATIENT_ID
    docs = [d async for d in db.patients.find({})]
    names = {d["name"] for d in docs}
    assert names == {"John Chen", "Maria Garcia", "David Patel"}
    surgeries = {d["surgery_type"] for d in docs}
    assert surgeries == {"lap_chole", "csection", "appy"}


async def test_seed_clean_wipes_prior(db):
    await db.patients.insert_one({"_id": "old", "name": "X"})
    await named_seed.seed_named_patients(clean=True)
    assert await db.patients.find_one({"_id": "old"}) is None


async def test_seed_noclean_is_reentrant(db):
    """Seeding with clean=False twice should not collide on John's fixed _id."""
    pids1 = await named_seed.seed_named_patients(clean=True)
    pids2 = await named_seed.seed_named_patients(clean=False)
    assert pids1[0] == pids2[0] == named_seed.JOHN_CHEN_PATIENT_ID
