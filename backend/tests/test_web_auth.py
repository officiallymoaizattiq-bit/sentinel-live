import pytest
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

from sentinel import web_auth
from sentinel.main import create_app


@pytest.fixture
async def client(monkeypatch):
    mock = AsyncMongoMockClient()
    db = mock["sentinel_test"]
    monkeypatch.setattr(web_auth, "get_db", lambda: db)
    # seed one patient
    await db.patients.insert_one({"_id": "p1", "name": "Test"})
    app = create_app(start_scheduler=False)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://t"
    ) as c:
        yield c


async def test_admin_login_happy_path(client):
    r = await client.post("/api/auth/login",
                          json={"role": "admin", "passkey": "sentinel-admin"})
    assert r.status_code == 200
    assert r.json() == {"role": "admin"}
    assert "sentinel_session" in r.cookies


async def test_admin_login_wrong_passkey(client):
    r = await client.post("/api/auth/login",
                          json={"role": "admin", "passkey": "wrong"})
    assert r.status_code == 401


async def test_patient_login_happy_path(client):
    r = await client.post("/api/auth/login",
                          json={"role": "patient",
                                "passkey": "sentinel-patient",
                                "patient_id": "p1"})
    assert r.status_code == 200
    assert r.json() == {"role": "patient", "patient_id": "p1"}


async def test_patient_login_unknown_patient(client):
    r = await client.post("/api/auth/login",
                          json={"role": "patient",
                                "passkey": "sentinel-patient",
                                "patient_id": "ghost"})
    assert r.status_code == 401
    assert r.json()["detail"]["error"] == "unknown_patient"


async def test_me_after_login(client):
    await client.post("/api/auth/login",
                      json={"role": "admin", "passkey": "sentinel-admin"})
    r = await client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["role"] == "admin"


async def test_me_without_session(client):
    r = await client.get("/api/auth/me")
    assert r.status_code == 401


async def test_logout_clears(client):
    await client.post("/api/auth/login",
                      json={"role": "admin", "passkey": "sentinel-admin"})
    r = await client.post("/api/auth/logout")
    assert r.status_code == 204
    r2 = await client.get("/api/auth/me")
    assert r2.status_code == 401
