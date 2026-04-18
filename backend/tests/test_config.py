from sentinel.config import get_settings


def test_settings_load_from_env(monkeypatch):
    monkeypatch.setenv("MONGO_DB", "unit_test_db")
    get_settings.cache_clear()
    s = get_settings()
    assert s.mongo_db == "unit_test_db"
    assert s.call_cadence_hours == 12
