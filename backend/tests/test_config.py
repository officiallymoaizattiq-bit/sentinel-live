from sentinel.config import get_settings


def test_settings_load_from_env(monkeypatch):
    monkeypatch.setenv("MONGO_DB", "unit_test_db")
    get_settings.cache_clear()
    s = get_settings()
    assert s.mongo_db == "unit_test_db"
    assert s.call_cadence_hours == 12


def test_settings_new_fields_defaults(monkeypatch):
    monkeypatch.delenv("ENABLE_CALL_SUMMARY", raising=False)
    monkeypatch.delenv("ELEVENLABS_WEBHOOK_SECRET", raising=False)
    from sentinel.config import Settings, get_settings
    get_settings.cache_clear()

    s = Settings()
    assert s.enable_call_summary is True
    assert s.elevenlabs_webhook_secret == ""
