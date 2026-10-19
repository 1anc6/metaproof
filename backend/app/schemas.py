import uuid
from datetime import datetime

from pydantic import BaseModel


class JobCreated(BaseModel):
    job_id: uuid.UUID
    sha256: str
    status: str
    duplicate: bool  # True when this exact file was already analyzed by the current pipeline


class FindingOut(BaseModel):
    code: str
    signal: str
    strength: str
    message: str


class AnalyzerOut(BaseModel):
    analyzer: str
    version: str
    ok: bool
    duration_ms: int
    error: str | None
    findings: list[FindingOut]
    raw: dict


class VerdictOut(BaseModel):
    label: str
    confidence: float | None
    engine_version: str
    scores: dict[str, float]
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
    status: str
    sha256: str
    mime_type: str
    size_bytes: int
    width: int
    height: int
    label: str | None
    confidence: float | None
    created_at: datetime
    finished_at: datetime | None


class SimilarMedia(BaseModel):
    sha256: str
    similarity: float
    label: str | None
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


class JobOut(BaseModel):
    job_id: uuid.UUID
    status: str
    # While running: the analyzer in progress ("metadata", "c2pa", ...) or "verdict".
    # Analyzers run in report order, so the ones before it have finished.
    current_step: str | None = None
    error: str | None
    pipeline_version: str
    created_at: datetime
    finished_at: datetime | None
    media: MediaOut
    verdict: VerdictOut | None
    analyzers: list[AnalyzerOut]
