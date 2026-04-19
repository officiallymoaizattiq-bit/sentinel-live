from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "sentinel"
    gemini_api_key: str = ""
    elevenlabs_api_key: str = ""
    elevenlabs_agent_id: str = ""
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""
    public_base_url: str = "http://localhost:8000"
    call_cadence_hours: int = Field(default=12, ge=1, le=24)
    demo_mode: bool = True
    device_token_secret: str = "dev-only-change-in-prod-NOT-SECURE"
    admin_passkey: str = "a"
    patient_passkey: str = "b"
    session_secret: str = "dev-only-session-NOT-SECURE"
    # Passkey accepted by the mobile demo-login endpoint. Lets a paired
    # device skip the 6-digit code flow during hackathon demos / local
    # development. Set to a random string in production to disable.
    mobile_demo_passkey: str = "m"


@lru_cache
def get_settings() -> Settings:
    return Settings()
