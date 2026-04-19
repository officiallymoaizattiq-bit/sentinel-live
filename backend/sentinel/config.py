from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load `.env` from the backend package root (`backend/.env`), not the shell cwd.
# Otherwise `uvicorn sentinel.main:app` started from the repo root ignores
# `backend/.env` and `mongo_uri` falls back to localhost.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ENV_FILE = _BACKEND_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE) if _ENV_FILE.is_file() else ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "sentinel"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    gemini_embed_model: str = "text-embedding-004"
    openrouter_api_key: str = ""
    openrouter_model: str = "google/gemini-2.0-flash-001"
    elevenlabs_api_key: str = ""
    elevenlabs_agent_id: str = ""
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    public_base_url: str = "http://localhost:8000"
    call_cadence_hours: int = Field(default=12, ge=1, le=24)
    demo_mode: bool = True
    # JWT signing secret for device tokens. Default is a developer-only
    # placeholder; if demo_mode is False (prod), refuse to start on this
    # value so a deploy can't accidentally ship with it.
    device_token_secret: str = "dev-only-change-in-prod-NOT-SECURE"
    admin_passkey: str = "a"
    patient_passkey: str = "b"
    session_secret: str = "dev-only-session-NOT-SECURE"
    # Passkey accepted by the mobile demo-login endpoint. Lets a paired
    # device skip the 6-digit code flow during hackathon demos / local
    # development. Set to a random string in production to disable.
    mobile_demo_passkey: str = "m"
    enable_call_summary: bool = True
    elevenlabs_webhook_secret: str = ""
    # Comma-separated list of allowed web origins. Default covers the local
    # Next dev servers. Set CORS_ORIGINS in the environment to lock down.
    cors_origins: str = (
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:3001,http://127.0.0.1:3001"
    )
    # Vitals clock-skew flagging window (samples older than this are flagged,
    # not rejected). Future samples are still rejected via
    # vitals_future_skew_minutes.
    vitals_past_skew_hours: int = Field(default=24, ge=1, le=168)
    vitals_future_skew_minutes: int = Field(default=60, ge=1, le=1440)

    @field_validator("cors_origins")
    @classmethod
    def _strip_origins(cls, v: str) -> str:
        return ",".join(o.strip() for o in v.split(",") if o.strip())

    def cors_origins_list(self) -> list[str]:
        return [o for o in self.cors_origins.split(",") if o]


@lru_cache
def get_settings() -> Settings:
    return Settings()
