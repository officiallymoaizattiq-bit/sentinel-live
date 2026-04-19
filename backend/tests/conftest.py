import os
os.environ.setdefault("MONGO_URI", "mongodb://localhost:27017")
os.environ.setdefault("MONGO_DB", "sentinel_test")
os.environ.setdefault("OPENROUTER_API_KEY", "test")
os.environ.setdefault("ELEVENLABS_API_KEY", "test")
os.environ.setdefault("ELEVENLABS_AGENT_ID", "agent_test")
os.environ.setdefault("TWILIO_ACCOUNT_SID", "AC_test")
os.environ.setdefault("TWILIO_AUTH_TOKEN", "test")
os.environ.setdefault("TWILIO_FROM_NUMBER", "+15555550100")
os.environ.setdefault("PUBLIC_BASE_URL", "http://localhost:8000")
os.environ.setdefault("DEMO_MODE", "true")

import pytest
from mongomock_motor import AsyncMongoMockClient


@pytest.fixture
async def mongo(monkeypatch):
    """Shared mongomock DB with get_db patched across sentinel modules."""
    client = AsyncMongoMockClient()
    db = client["sentinel_test"]

    import importlib
    module_names = [
        "sentinel.api",
        "sentinel.enrollment",
        "sentinel.escalation",
        "sentinel.scoring",
        "sentinel.call_handler",
        "sentinel.finalize",
        "sentinel.watchdog",
        "sentinel.webhooks",
        "sentinel.push",
    ]
    for name in module_names:
        try:
            mod = importlib.import_module(name)
        except ModuleNotFoundError:
            continue
        if hasattr(mod, "get_db"):
            monkeypatch.setattr(mod, "get_db", lambda d=db: d)

    yield db
