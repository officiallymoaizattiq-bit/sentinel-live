from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class SurgeryType(str, Enum):
    LAP_CHOLE = "lap_chole"
    APPY = "appy"
    CSECTION = "csection"
    EX_LAP = "ex_lap"


class RecommendedAction(str, Enum):
    NONE = "none"
    PATIENT_CHECK = "patient_check"
    CAREGIVER_ALERT = "caregiver_alert"
    NURSE_ALERT = "nurse_alert"
    SUGGEST_911 = "suggest_911"


class Caregiver(BaseModel):
    name: str
    phone: str


class Consent(BaseModel):
    recorded_at: datetime
    ip: str
    version: str


class Patient(BaseModel):
    id: str | None = Field(default=None, alias="_id")
    name: str
    phone: str
    language: str = "en"
    surgery_type: SurgeryType
    surgery_date: datetime
    discharge_date: datetime
    caregiver: Caregiver
    assigned_nurse_id: str | None = None
    enrollment_day: int = 0
    next_call_at: datetime | None = None
    call_count: int = 0
    consent: Consent

    model_config = {"populate_by_name": True}


class CarePlan(BaseModel):
    id: str | None = Field(default=None, alias="_id")
    patient_id: str
    meds: list[str] = []
    red_flags: list[str] = []
    allergies: list[str] = []
    goals_of_care: str = ""

    model_config = {"populate_by_name": True}


class TranscriptTurn(BaseModel):
    role: str
    text: str
    t_start: float
    t_end: float


class AudioFeatures(BaseModel):
    f0_mean: float = 0.0
    jitter: float = 0.0
    shimmer: float = 0.0
    hnr: float = 0.0
    speech_rate: float = 0.0
    pause_ratio: float = 0.0
    breaths_per_min: float = 0.0


class Score(BaseModel):
    deterioration: float = Field(ge=0.0, le=1.0)
    qsofa: int = Field(ge=0, le=3)
    news2: int = Field(ge=0, le=20)
    red_flags: list[str]
    summary: str
    recommended_action: RecommendedAction


class SimilarCall(BaseModel):
    case_id: str
    similarity: float
    outcome: str


class Call(BaseModel):
    id: str | None = Field(default=None, alias="_id")
    patient_id: str
    called_at: datetime
    duration_s: float = 0.0
    transcript: list[TranscriptTurn] = []
    audio_url: str | None = None
    audio_features: AudioFeatures = AudioFeatures()
    baseline_drift: dict[str, float] = {}
    score: Score | None = None
    similar_calls: list[SimilarCall] = []
    llm_degraded: bool = False
    audio_degraded: bool = False
    short_call: bool = False
    conversation_id: str | None = None
    ended_at: datetime | None = None
    end_reason: Literal["agent_signal", "timeout_40s", "manual"] | None = None
    summary_patient: str | None = None
    summary_nurse: str | None = None
    summaries_generated_at: datetime | None = None
    summaries_error: str | None = None
    outcome_label: Literal["fine", "schedule_visit", "escalated_911"] | None = None
    escalation_911: bool = False

    model_config = {"populate_by_name": True}


class Alert(BaseModel):
    id: str | None = Field(default=None, alias="_id")
    patient_id: str
    call_id: str
    severity: RecommendedAction
    channel: list[str]
    sent_at: datetime
    acknowledged_by: str | None = None
    ack_at: datetime | None = None
    acknowledged: bool = False
    acknowledged_at: datetime | None = None

    model_config = {"populate_by_name": True}


class CohortCase(BaseModel):
    id: str | None = Field(default=None, alias="_id")
    case_id: str
    surgery_type: SurgeryType
    day: int
    summary: str
    embedding: list[float]
    outcome: str

    model_config = {"populate_by_name": True}


class Vital(BaseModel):
    t: datetime
    patient_id: str
    device_id: str
    kind: str  # heart_rate|spo2|resp_rate|temp|steps|sleep_stage|hrv_sdnn|hrv_rmssd
    value: float | str  # float for numeric; str for sleep_stage enum
    unit: str  # bpm|pct|cpm|c|count|enum|ms
    source: str  # apple_healthkit|health_connect|manual
    confidence: float | None = None
    clock_skew: bool = False


class DeviceInfo(BaseModel):
    model: str = ""
    os: str = ""
    app_version: str = ""


class Device(BaseModel):
    id: str | None = Field(default=None, alias="_id")
    patient_id: str
    token_hash: str  # bcrypt hash of JWT (for revocation check)
    device_info: DeviceInfo = DeviceInfo()
    created_at: datetime
    last_seen_at: datetime | None = None
    revoked_at: datetime | None = None
    clock_skew_detected_at: datetime | None = None
    clock_skew_severe: bool = False
    push_token: str | None = None

    model_config = {"populate_by_name": True}


class PairingCode(BaseModel):
    id: str | None = Field(default=None, alias="_id")  # the 6-digit code IS the _id
    patient_id: str
    expires_at: datetime
    consumed_at: datetime | None = None
    consumed_by_device_id: str | None = None

    model_config = {"populate_by_name": True}


class ProcessedBatch(BaseModel):
    id: str | None = Field(default=None, alias="_id")  # batch_id is _id
    patient_id: str
    device_id: str
    processed_at: datetime
    accepted_count: int
    flagged_clock_skew: int = 0

    model_config = {"populate_by_name": True}
