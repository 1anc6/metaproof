import enum
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.analyzers.base import Signal, Strength
from app.models import JobStatus

# The response models below are the API's contract: the OpenAPI schema they produce is committed
# as openapi.json and turned into the frontend's types (frontend/src/lib/api-schema.ts). Enums
# rather than plain strings, so the generated types know every value.


class VerdictLabel(str, enum.Enum):
    likely_authentic = "likely_authentic"
    edited = "edited"
    likely_ai_generated = "likely_ai_generated"
    inconclusive = "inconclusive"


class AnalysisStep(str, enum.Enum):
    """What a running job is doing: one analyzer after another (app.analyzers.ANALYZERS, whose
    names these must match), then weighing the evidence."""

    metadata = "metadata"
    structure = "structure"
    c2pa = "c2pa"
    watermark = "watermark"
    detector = "detector"
    verdict = "verdict"


class JobCreated(BaseModel):
    job_id: uuid.UUID
    sha256: str
    status: JobStatus
    duplicate: bool  # True when this exact file was already analyzed by the current pipeline


class FindingOut(BaseModel):
    code: str
    signal: Signal
    strength: Strength
    message: str


class AnalyzerOut(BaseModel):
    analyzer: str
    version: str
    ok: bool
    duration_ms: int
    error: str | None
    findings: list[FindingOut]
    raw: dict


class VerdictScores(BaseModel):
    """Summed evidence weight for each outcome (app/engine.py)."""

    authentic: float
    edited: float
    ai: float


class VerdictOut(BaseModel):
    label: VerdictLabel
    confidence: float | None
    engine_version: str
    scores: VerdictScores
    top_reasons: list[FindingOut]


class MediaOut(BaseModel):
    sha256: str
    mime_type: str
    size_bytes: int
    width: int
    height: int
    first_seen_at: datetime


class JobSummary(BaseModel):
    """Light row for history lists: no findings or raw analyzer output."""

    job_id: uuid.UUID
    status: JobStatus
    sha256: str
    mime_type: str
    size_bytes: int
    width: int
    height: int
    label: VerdictLabel | None
    confidence: float | None
    created_at: datetime
    finished_at: datetime | None


class SimilarMedia(BaseModel):
    sha256: str
    similarity: float
    label: VerdictLabel | None
    first_seen_at: datetime


class ServiceStatus(BaseModel):
    """Public health figures for the Settings page. No per-user or per-file data."""

    database_mb: float
    storage_warn_mb: int
    storage_limit_mb: int
    retention_days: int
    analyses_24h: int
    failed_24h: int
    daily_cap: int
    last_analysis_at: datetime | None
    pipeline_version: str
    # The API process, read on every request: resident memory now and its peak since the last
    # start (null off Linux), against the instance's memory; and the AI detector's model, which
    # is loaded by the first analysis after a start, or missing if the image was built without it.
    memory_mb: float | None = None
    memory_peak_mb: float | None = None
    memory_limit_mb: int
    detector: Literal["loaded", "available", "missing"]


class JobOut(BaseModel):
    job_id: uuid.UUID
    status: JobStatus
    # While running: the analyzer in progress or "verdict". Analyzers run in report order, so the
    # ones before it have finished.
    current_step: AnalysisStep | None = None
    error: str | None
    pipeline_version: str
    created_at: datetime
    finished_at: datetime | None
    media: MediaOut
    verdict: VerdictOut | None
    analyzers: list[AnalyzerOut]
